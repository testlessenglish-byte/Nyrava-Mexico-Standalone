// TFJA (Tribunal Federal de Justicia Administrativa) connector — REAL
// implementation, endpoint audit 2026-07-27.
//
// ── Endpoint investigation ───────────────────────────────────────────────────
// The TFJA publishes its tesis/jurisprudencia corpus through the CESMDFA
// "Sistema General de Consulta de Tesis y Jurisprudencias" (SCTJ), a Django
// app at https://www.tfja.gob.mx/cesmdfa/sctj/. There is no JSON API; the
// only public interface is the HTML search form, which works fine
// server-side once the exact field set is replicated:
//
//   1. GET  /cesmdfa/sctj/sctj-busqueda/       → csrftoken cookie + hidden token
//   2. POST /cesmdfa/sctj/busqueda-resultados/ → results table (10 rows/page)
//        csrfmiddlewaretoken, allEpocas="", checkSelectEg=<época 1..9>,
//        rubro, rubroRadioEg=rubroFrase, texto, textoRadioEg=textoFrase,
//        materia, precedente, cve_tesis, sala_pleno, referencia
//      Pagination: repost the same fields plus input-pagina-siguiente=<n>.
//   3. POST /cesmdfa/sctj/detalle-tesis/       → full tesis text
//        detalle_identificador=<id from the results row>, detalle_* mirrors
//        of the search fields, rubroRadioEg, textoRadioEg
//
// Important: sending fields the view does not expect (e.g. `identificador`
// or `jurisprudencias` on the search POST) makes the search silently return
// zero rows — the payload below matches what the real form submits.
// Verified live from the sandbox on 2026-07-27 (10 rows/page, 9 pages for
// rubro="RENTA"; detail returns the full tesis body plus precedentes).

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const SITE = "https://www.tfja.gob.mx";
const SEARCH_FORM = `${SITE}/cesmdfa/sctj/sctj-busqueda/`;
const SEARCH_URL = `${SITE}/cesmdfa/sctj/busqueda-resultados/`;
const DETAIL_URL = `${SITE}/cesmdfa/sctj/detalle-tesis/`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Novena Época is the current one; earlier épocas are historical backfill. */
const EPOCAS = ["9", "8"] as const;

/**
 * The SCTJ has no "list everything" mode — every query needs at least one
 * filter. These broad rubro terms cover the tribunal's core administrative /
 * fiscal subject matter; runs walk them in order and stop at the budget, so
 * repeated runs keep widening the corpus.
 */
const SEED_TERMS = [
  "RENTA",
  "VALOR AGREGADO",
  "NULIDAD",
  "COMPETENCIA",
  "NOTIFICACIÓN",
  "CADUCIDAD",
  "PRESCRIPCIÓN",
  "VISITA DOMICILIARIA",
  "DEVOLUCIÓN",
  "RESPONSABILIDAD ADMINISTRATIVA",
  "COMERCIO EXTERIOR",
  "PRUEBA",
  "SENTENCIA",
  "AGRAVIO",
  "PENSIÓN",
];

const MAX_PAGES_PER_TERM = 3;
const MAX_DOCS_PER_RUN = 25;
const RUN_BUDGET_MS = 50_000;
const THROTTLE_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Session = { cookie: string; token: string };

type ResultRow = {
  identificador: string;
  materia: string;
  claveTesis: string;
  rubro: string;
  referencia: string;
  salaPleno: string;
  epoca: string;
  term: string;
};

function headers(referer: string, cookie?: string): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    "User-Agent": BROWSER_UA,
    Referer: referer,
    Origin: SITE,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cookieHeaderFrom(res: Response, previous?: string): string {
  // The Worker runtime exposes Set-Cookie via getSetCookie() when available.
  const raw =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const jar = new Map<string, string>();
  for (const part of (previous ?? "").split(/;\s*/)) {
    const [k, ...v] = part.split("=");
    if (k && v.length) jar.set(k, v.join("="));
  }
  for (const line of raw) {
    for (const c of line.split(/,(?=[^;]+=[^;]+)/)) {
      const first = c.split(";")[0];
      const [k, ...v] = first.split("=");
      if (k?.trim() && v.length) jar.set(k.trim(), v.join("="));
    }
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function openSession(): Promise<Session> {
  const res = await fetch(SEARCH_FORM, {
    headers: headers(SITE),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`TFJA ${res.status} at ${SEARCH_FORM}`);
  const html = await res.text();
  const cookie = cookieHeaderFrom(res);
  const token = /name="csrfmiddlewaretoken"\s+value="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error("TFJA search form returned no CSRF token — page layout changed");
  return { cookie, token };
}

function searchBody(session: Session, epoca: string, rubro: string, page: number): string {
  const p = new URLSearchParams();
  p.set("csrfmiddlewaretoken", session.token);
  p.set("allEpocas", "");
  p.set("checkSelectEg", epoca);
  p.set("rubro", rubro);
  p.set("rubroRadioEg", "rubroFrase");
  p.set("texto", "");
  p.set("textoRadioEg", "textoFrase");
  p.set("materia", "");
  p.set("precedente", "");
  p.set("cve_tesis", "");
  p.set("sala_pleno", "");
  p.set("referencia", "");
  if (page > 1) {
    p.set("input-pagina-siguiente", String(page));
    p.set("jurisprudencias", "NoJurisprudencia");
  }
  return p.toString();
}

async function post(url: string, session: Session, body: string, referer: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headers(referer, session.cookie),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`TFJA ${res.status} at ${url}`);
  session.cookie = cookieHeaderFrom(res, session.cookie);
  return res.text();
}

function cellText(row: string, cls: string): string {
  const m = new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</span>`).exec(row);
  return m ? stripHtml(m[1]) : "";
}

function parseRows(html: string, epoca: string, term: string): ResultRow[] {
  const out: ResultRow[] = [];
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const id = /name="detalle_identificador"/.test(row)
      ? /value="(\d+)"\s+name="detalle_identificador"/.exec(row)?.[1]
      : undefined;
    if (!id) continue;
    const tds = row.match(/<td[\s\S]*?<\/td>/gi) ?? [];
    out.push({
      identificador: id,
      materia: cellText(row, "selIdmateria"),
      claveTesis: cellText(row, "selIdcvetesis"),
      rubro: cellText(row, "seIdrubro"),
      referencia: tds[4] ? stripHtml(tds[4]) : "",
      salaPleno: tds[5] ? stripHtml(tds[5]) : "",
      epoca,
      term,
    });
  }
  return out;
}

function totalPages(html: string): number {
  const m = /name="input-pagina-ultimo"/.test(html)
    ? /value="(\d+)"\s+name="input-pagina-ultimo"/.exec(html)?.[1]
    : undefined;
  return m ? Math.max(1, Number(m)) : 1;
}

/** Extracts the tesis body from the detail page (between rubro and the footer). */
function parseDetail(html: string): { body: string; precedentes: string } {
  const start = html.indexOf("TESIS SELECCIONADA");
  const endMarkers = ["Regresar al listado anterior", "Regresar al menú principal"];
  let end = html.length;
  for (const marker of endMarkers) {
    const i = html.indexOf(marker);
    if (i > start && i < end) end = i;
  }
  const section = start >= 0 ? html.slice(start, end) : html;
  const text = stripHtml(section)
    .replace(/^TESIS SELECCIONADA[^\n]*\n?/, "")
    .trim();
  const pi = text.indexOf("PRECEDENTES:");
  if (pi >= 0) return { body: text.slice(0, pi).trim(), precedentes: text.slice(pi).trim() };
  return { body: text, precedentes: "" };
}

function detailBody(session: Session, row: ResultRow): string {
  const p = new URLSearchParams();
  p.set("csrfmiddlewaretoken", session.token);
  p.set("detalle_checkSelectEg", row.epoca);
  p.set("detalle_materia", "");
  p.set("detalle_cve_tesis", "");
  p.set("detalle_rubro", row.term);
  p.set("detalle_precedente", "");
  p.set("detalle_referencia", "");
  p.set("detalle_sala_pleno", "");
  p.set("detalle_texto", "");
  p.set("detalle_jurisprudencias", "None");
  p.set("detalle_identificador", row.identificador);
  p.set("rubroRadioEg", "rubroFrase");
  p.set("textoRadioEg", "textoFrase");
  return p.toString();
}

/** "R.T.F.J.A. Novena Época. Año V. No. 52. Junio 2026. p. 377" → 2026-06-01 */
const MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

function publishedFrom(referencia: string): string | undefined {
  const explicit = /el (\d{1,2}) de ([a-záéíóú]+) de (\d{4})/i.exec(referencia);
  if (explicit) {
    const mm = MONTHS[explicit[2].toLowerCase()];
    if (mm) return `${explicit[3]}-${mm}-${explicit[1].padStart(2, "0")}`;
  }
  const loose = /([A-Za-záéíóúÁÉÍÓÚ]+)\s+(\d{4})/.exec(referencia);
  if (loose) {
    const mm = MONTHS[loose[1].toLowerCase()];
    if (mm) return `${loose[2]}-${mm}-01`;
  }
  return undefined;
}

function toIngested(row: ResultRow, body: string, precedentes: string): IngestedDocument {
  const rawText = [row.rubro, body, precedentes].filter(Boolean).join("\n\n");
  const published = publishedFrom(row.referencia);
  return {
    externalId: `tfja:tesis:${row.identificador}`,
    kind: "administrative_ruling",
    jurisdiction: "federal",
    title: row.rubro || `Tesis TFJA ${row.claveTesis || row.identificador}`,
    shortTitle: row.rubro ? row.rubro.slice(0, 200) : undefined,
    issuer: row.salaPleno || "Tribunal Federal de Justicia Administrativa",
    citation: [row.claveTesis, row.referencia].filter(Boolean).join("; "),
    publishedAt: published,
    effectiveAt: published,
    sourceUrl: `${SITE}/cesmdfa/sctj/sctj-busqueda/`,
    rawText,
    metadata: {
      connector_code: "tfja",
      external_id: `tfja:tesis:${row.identificador}`,
      identificador: row.identificador,
      clave_tesis: row.claveTesis,
      materia: row.materia,
      referencia: row.referencia,
      sala_pleno: row.salaPleno,
      epoca: row.epoca,
      search_term: row.term,
      tiene_precedentes: Boolean(precedentes),
    },
  };
}

async function collect(known: Set<string> | undefined, limit: number): Promise<IngestedDocument[]> {
  const started = Date.now();
  const session = await openSession();
  const docs: IngestedDocument[] = [];
  const seen = new Set<string>();

  outer: for (const epoca of EPOCAS) {
    for (const term of SEED_TERMS) {
      let pages = MAX_PAGES_PER_TERM;
      for (let page = 1; page <= pages; page++) {
        if (docs.length >= limit || Date.now() - started > RUN_BUDGET_MS) break outer;
        const html = await post(SEARCH_URL, session, searchBody(session, epoca, term, page), SEARCH_FORM);
        if (page === 1) pages = Math.min(MAX_PAGES_PER_TERM, totalPages(html));
        const rows = parseRows(html, epoca, term);
        if (!rows.length) break;
        for (const row of rows) {
          const id = `tfja:tesis:${row.identificador}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (known?.has(id)) continue;
          if (docs.length >= limit || Date.now() - started > RUN_BUDGET_MS) break outer;
          try {
            const detail = await post(DETAIL_URL, session, detailBody(session, row), SEARCH_URL);
            const { body, precedentes } = parseDetail(detail);
            docs.push(toIngested(row, body, precedentes));
          } catch {
            docs.push(toIngested(row, "", ""));
          }
          await sleep(THROTTLE_MS);
        }
      }
    }
  }

  return docs;
}

export const tfjaConnector: LegalSourceConnector = {
  code: "tfja",
  displayName: "Tribunal Federal de Justicia Administrativa",
  kind: "administrative_ruling",
  accessMethod: "html_scrape", // SCTJ exposes no JSON/API surface
  auth: { kind: "none" },

  async discover() {
    const docs = await collect(undefined, 10);
    return docs.map((d) => ({
      externalId: d.externalId,
      sourceUrl: d.sourceUrl,
      publishedAt: d.publishedAt,
    }));
  },

  async sync(): Promise<IngestedDocument[]> {
    return collect(this.alreadyIngested, MAX_DOCS_PER_RUN);
  },

  async fetchUpdates(_since: Date | null): Promise<IngestedDocument[]> {
    // The SCTJ has no date-range filter; incremental progress comes from the
    // orchestrator's already-ingested skip list, so each run brings back
    // tesis this project has never stored.
    return collect(this.alreadyIngested, MAX_DOCS_PER_RUN);
  },

  async fetchDocument(externalId: string): Promise<IngestedDocument> {
    const id = externalId.replace(/^tfja:tesis:/, "");
    const session = await openSession();
    const row: ResultRow = {
      identificador: id,
      materia: "",
      claveTesis: "",
      rubro: "",
      referencia: "",
      salaPleno: "",
      epoca: "9",
      term: "",
    };
    const html = await post(DETAIL_URL, session, detailBody(session, row), SEARCH_URL);
    const { body, precedentes } = parseDetail(html);
    const rubro = body.split("\n").find((l) => l.trim().length > 20) ?? "";
    return toIngested({ ...row, rubro: rubro.trim() }, body, precedentes);
  },

  async extractMetadata(doc: IngestedDocument): Promise<Partial<IngestedDocument>> {
    return {
      title: doc.title,
      citation: doc.citation,
      issuer: doc.issuer,
      publishedAt: doc.publishedAt,
      sourceUrl: doc.sourceUrl,
    };
  },

  async extractArticles(_doc: IngestedDocument): Promise<ExtractedArticle[]> {
    // Tesis are not articulated instruments — no articles to extract.
    return [];
  },

  async extractCitations(doc: IngestedDocument): Promise<ExtractedCitation[]> {
    return extractCitationsFromText(doc.rawText);
  },

  async normalize(doc: IngestedDocument): Promise<IngestedDocument> {
    return { ...doc, rawText: doc.rawText.replace(/\n{3,}/g, "\n\n").trim() };
  },

  async validate(doc: IngestedDocument): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!doc.externalId.startsWith("tfja:tesis:")) errors.push("external id is not a TFJA tesis id");
    if (!doc.title) errors.push("missing rubro/title");
    if (doc.rawText.trim().length < 40) errors.push("tesis text too short — detail fetch likely failed");
    return { valid: errors.length === 0, errors };
  },

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const session = await openSession();
      const html = await post(SEARCH_URL, session, searchBody(session, "9", SEED_TERMS[0], 1), SEARCH_FORM);
      const rows = parseRows(html, "9", SEED_TERMS[0]);
      return {
        connectorCode: "tfja",
        ok: rows.length > 0,
        checkedAt,
        detail: rows.length ? `SCTJ search returned ${rows.length} rows` : "SCTJ search returned no rows",
      };
    } catch (e) {
      return { connectorCode: "tfja", ok: false, checkedAt, detail: String(e) };
    }
  },
};
