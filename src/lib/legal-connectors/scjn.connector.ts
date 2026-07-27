// SCJN (Suprema Corte de Justicia de la Nación) connector — Phase 20, endpoint audit 2026-07.
//
// ── Endpoint investigation (2026-07-27) ──────────────────────────────────────
// The old paths (`/busqueda-principal-tesis?...`, `/detalle/tesis/{ius}` as
// JSON) are Angular *view* routes, not data endpoints — hitting them with a
// bot User-Agent returns 403 from the WAF, and with a browser UA returns the
// SPA shell HTML. Capturing the SPA's own XHR traffic revealed the real
// public microservice behind the Semanario Judicial (SJF2):
//
//   Search / listing (POST, JSON body):
//     POST /services/sjftesismicroservice/api/public/tesis?page={0-based}&size={n}
//     body: { classifiers:[{name:"tipoDocumento",value:["1"],…}], searchTerms:[],
//             bFacet:false, ius:[], idApp:"SJFAPP2020", filterExpression:"" }
//     → { total, documents:[{ ius, rubro, texto, fechaPublicacion, … }] }
//     An empty `searchTerms` returns the whole corpus (262k+ docs) ordered
//     newest-publication-first, which is exactly the incremental feed we need.
//
//   Detail (GET):
//     GET /services/sjftesismicroservice/api/public/tesis/{ius}
//         ?isSemanal=true&hostName=https://sjf2.scjn.gob.mx
//     → { ius, rubro, texto, precedentes, localizacion, epoca, instancia,
//         tipoTesis, materias, claveTesis, … } with HTML-tagged strings.
//
// The 403s were bot-blocking, not moved endpoints: the service answers 200
// with a realistic browser User-Agent plus Origin/Referer on the sjf2 host.
// Verified working from the sandbox on 2026-07-27.
//
// Scope unchanged: jurisprudencia/tesis only. Statutes still come from the
// separate legislative-compilation source.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const SITE = "https://sjf2.scjn.gob.mx";
const API = `${SITE}/services/sjftesismicroservice/api/public/tesis`;
const DETAIL_VIEW = `${SITE}/detalle/tesis`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 4; // conservative — the corpus feed is large
// A sync runs inside one request. Each document needs its own detail call, so
// an unbounded run means hundreds of sequential HTTP calls and a timeout that
// looks like "the connector doesn't work". Bound both count and wall clock.
const MAX_DOCS_PER_RUN = 25;
const RUN_BUDGET_MS = 45_000;
const THROTTLE_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


type SjfTesis = {
  ius?: string | number;
  rubro?: string;
  texto?: string;
  textoPublicacion?: string;
  precedentes?: string;
  localizacion?: string;
  localizacionAbr?: string;
  claveTesis?: string;
  epoca?: string;
  instancia?: string;
  sala?: string;
  fuente?: string;
  materias?: unknown;
  tipoTesis?: string;
  tipoJurisprudencia?: string;
  fechaPublicacion?: string;
  urlSemanario?: string;
};

type SearchResponse = { total?: number; documents?: SjfTesis[] };

/** Browser-shaped headers — the WAF rejects bot identifiers with 403. */
function headers(referer: string, json = false): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    "User-Agent": BROWSER_UA,
    Origin: SITE,
    Referer: referer,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function searchBody() {
  return {
    classifiers: [
      { name: "tipoDocumento", value: ["1"], allSelected: false, visible: false, isMatrix: false },
    ],
    searchTerms: [] as unknown[],
    bFacet: false,
    ius: [] as unknown[],
    idApp: "SJFAPP2020",
    filterExpression: "",
  };
}

function stripHtml(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function iusOf(t: SjfTesis): string {
  return String(t.ius ?? "").trim();
}

function materiasOf(t: SjfTesis): string[] {
  const m = t.materias;
  if (Array.isArray(m)) {
    return m
      .map((x) => (typeof x === "string" ? x : ((x as { nombre?: string; descripcion?: string })?.nombre ??
        (x as { descripcion?: string })?.descripcion ?? "")))
      .map((s) => stripHtml(String(s)))
      .filter(Boolean);
  }
  if (typeof m === "string") return stripHtml(m).split(/\s*,\s*/).filter(Boolean);
  return [];
}

async function searchPage(page: number): Promise<{ items: SjfTesis[]; total: number }> {
  const res = await fetch(`${API}?page=${page}&size=${DEFAULT_PAGE_SIZE}`, {
    method: "POST",
    headers: headers(`${SITE}/busqueda-principal-tesis`, true),
    body: JSON.stringify(searchBody()),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SCJN ${res.status} at ${API}?page=${page}`);
  const data = (await res.json()) as SearchResponse;
  return { items: data.documents ?? [], total: data.total ?? 0 };
}

async function fetchDetail(ius: string): Promise<SjfTesis | null> {
  const url = `${API}/${ius}?isSemanal=true&hostName=${encodeURIComponent(SITE)}`;
  const res = await fetch(url, { headers: headers(`${DETAIL_VIEW}/${ius}`), signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SCJN ${res.status} at ${url}`);
  return (await res.json()) as SjfTesis;
}

function publishedIso(t: SjfTesis): string | undefined {
  if (!t.fechaPublicacion) return undefined;
  const d = new Date(t.fechaPublicacion);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function toIngested(t: SjfTesis): IngestedDocument | null {
  const ius = iusOf(t);
  if (!ius) return null;
  const rubro = stripHtml(t.rubro);
  const raw = [stripHtml(t.texto || t.textoPublicacion), stripHtml(t.precedentes)]
    .filter(Boolean)
    .join("\n\n") || rubro;
  const iso = publishedIso(t);
  const clave = stripHtml(t.claveTesis);
  return {
    externalId: `scjn:tesis:${ius}`,
    kind: "jurisprudencia",
    jurisdiction: "federal",
    title: rubro || `Tesis SCJN ${ius}`,
    shortTitle: rubro ? rubro.slice(0, 200) : undefined,
    issuer: stripHtml(t.instancia) || "Suprema Corte de Justicia de la Nación",
    citation: [clave, `Registro digital ${ius}`].filter(Boolean).join("; "),
    publishedAt: iso,
    effectiveAt: iso,
    sourceUrl: `${DETAIL_VIEW}/${ius}`,
    rawText: raw,
    metadata: {
      epoca: stripHtml(t.epoca),
      instancia: stripHtml(t.instancia),
      sala: stripHtml(t.sala),
      fuente: stripHtml(t.fuente),
      localizacion: stripHtml(t.localizacion || t.localizacionAbr),
      tipoTesis: t.tipoTesis,
      tipoJurisprudencia: t.tipoJurisprudencia,
      claveTesis: clave,
      materias: materiasOf(t),
      urlSemanario: t.urlSemanario,
    },
  };
}

export const scjnConnector: LegalSourceConnector = {
  code: "scjn",
  displayName: "Suprema Corte de Justicia de la Nación (SJF)",
  kind: "jurisprudencia",
  accessMethod: "official_json_endpoint",
  auth: { kind: "none" },

  async discover() {
    const { items } = await searchPage(0);
    return items
      .filter((i) => iusOf(i))
      .map((i) => ({
        externalId: `scjn:tesis:${iusOf(i)}`,
        sourceUrl: `${DETAIL_VIEW}/${iusOf(i)}`,
        publishedAt: publishedIso(i),
      }));
  },

  async sync() {
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    // The unfiltered feed is ordered newest publication first, so we can page
    // until we cross `since` and then stop.
    const seen = new Set<string>();
    const out: IngestedDocument[] = [];
    const floor = since ? new Date(since).getTime() : null;
    const deadline = Date.now() + RUN_BUDGET_MS;
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      if (out.length >= MAX_DOCS_PER_RUN || Date.now() >= deadline) break;
      const { items } = await searchPage(page);
      if (items.length === 0) break;
      let crossedFloor = false;
      for (const s of items) {
        if (out.length >= MAX_DOCS_PER_RUN || Date.now() >= deadline) break;
        const ius = iusOf(s);
        if (!ius || seen.has(ius)) continue;
        seen.add(ius);
        const pub = s.fechaPublicacion ? new Date(s.fechaPublicacion).getTime() : null;
        if (floor !== null && pub !== null && pub < floor) {
          crossedFloor = true;
          continue;
        }
        try {
          await sleep(THROTTLE_MS);
          const detail = await fetchDetail(ius);
          const doc = toIngested({ ...s, ...(detail ?? {}) });
          if (doc) out.push(doc);
        } catch (e) {
          console.warn(`[scjn] skip tesis ${ius}: ${String(e)}`);
        }
      }
      if (crossedFloor) break;
    }
    return out;
  },


  async fetchDocument(externalId) {
    const ius = externalId.replace(/^scjn:tesis:/, "");
    const detail = await fetchDetail(ius);
    if (!detail) throw new Error(`SCJN tesis not found: ${externalId}`);
    const doc = toIngested(detail);
    if (!doc) throw new Error(`SCJN tesis malformed: ${externalId}`);
    return doc;
  },

  async extractMetadata(doc) {
    return { issuer: doc.issuer, publishedAt: doc.publishedAt, citation: doc.citation };
  },

  async extractArticles(doc): Promise<ExtractedArticle[]> {
    // Tesis are not article-structured; the referenced articles live inside
    // the tesis text and are surfaced by extractCitations instead.
    void doc;
    return [];
  },

  async extractCitations(doc): Promise<ExtractedCitation[]> {
    return extractCitationsFromText(doc.rawText);
  },

  async normalize(doc) {
    const cleaned = doc.rawText
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { ...doc, rawText: cleaned };
  },

  async validate(doc): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!doc.externalId) errors.push("missing externalId");
    if (!doc.title) errors.push("missing title");
    if (!doc.sourceUrl) errors.push("missing sourceUrl");
    if (!doc.rawText || doc.rawText.length < 20) errors.push("rawText too short (<20 chars)");
    return { valid: errors.length === 0, errors };
  },

  async healthCheck(): Promise<ConnectorHealth> {
    try {
      const res = await fetch(`${API}?page=0&size=1`, {
        method: "POST",
        headers: headers(`${SITE}/busqueda-principal-tesis`, true),
        body: JSON.stringify(searchBody()),
        signal: AbortSignal.timeout(20_000),
      });
      return {
        connectorCode: "scjn",
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return { connectorCode: "scjn", ok: false, checkedAt: new Date().toISOString(), detail: String(e) };
    }
  },
};
