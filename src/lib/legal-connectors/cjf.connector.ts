// CJF (Consejo de la Judicatura Federal) — órganos jurisdiccionales federales.
// Endpoint audit 2026-07, verified live from the sandbox.
//
// ── Endpoint investigation ───────────────────────────────────────────────────
// www.cjf.gob.mx, sise.cjf.gob.mx and dgepj.cjf.gob.mx do not answer
// server-side requests at all (connection never completes — no HTTP status,
// not a WAF challenge). There is therefore no CJF-hosted interface to build
// against.
//
// The criterio-setting output of the organs the CJF administers — Tribunales
// Colegiados de Circuito, Plenos de Circuito and Plenos Regionales — IS
// published, officially, through the Semanario Judicial de la Federación
// microservice (same SJF2 service the SCJN connector uses, different
// `instancia` facet). That is the authoritative source for federal circuit
// criteria, so it is what this connector reads:
//
//   POST /services/sjftesismicroservice/api/public/tesis?page={0}&size={n}
//     classifiers: tipoDocumento=["1"] +
//                  instancia=["Tribunales Colegiados de Circuito",
//                             "Plenos de Circuito","Plenos Regionales"]
//     → 90,069 documents, newest publication first.
//   GET  /services/sjftesismicroservice/api/public/tesis/{ius}
//     → full texto/precedentes/localización/circuito/órgano.
//
// Browser-shaped headers are required (bot UAs get 403 from the WAF).
// Runs are incremental: `alreadyIngested` drives a skip-list so repeated
// runs walk deeper into the corpus instead of re-fetching the newest page.

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

const INSTANCIAS = [
  "Tribunales Colegiados de Circuito",
  "Plenos de Circuito",
  "Plenos Regionales",
];

const PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 8;
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
  circuito?: string;
  organoJuris?: string;
  fuente?: string;
  materias?: unknown;
  tipoTesis?: string;
  tipoJurisprudencia?: string;
  fechaPublicacion?: string;
  urlSemanario?: string;
};

function headers(referer: string, json = false): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "es-MX,es;q=0.9",
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
      { name: "instancia", value: INSTANCIAS, allSelected: false, visible: true, isMatrix: false },
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

const iusOf = (t: SjfTesis) => String(t.ius ?? "").trim();
const externalIdOf = (ius: string) => `cjf:tesis:${ius}`;

function materiasOf(t: SjfTesis): string[] {
  const m = t.materias;
  if (Array.isArray(m)) {
    return m
      .map((x) =>
        typeof x === "string"
          ? x
          : ((x as { nombre?: string; descripcion?: string })?.nombre ??
            (x as { descripcion?: string })?.descripcion ??
            ""),
      )
      .map((s) => stripHtml(String(s)))
      .filter(Boolean);
  }
  if (typeof m === "string") return stripHtml(m).split(/\s*,\s*/).filter(Boolean);
  return [];
}

async function searchPage(page: number): Promise<SjfTesis[]> {
  const res = await fetch(`${API}?page=${page}&size=${PAGE_SIZE}`, {
    method: "POST",
    headers: headers(`${SITE}/busqueda-principal-tesis`, true),
    body: JSON.stringify(searchBody()),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`CJF/SJF ${res.status} at ${API}?page=${page}`);
  const data = (await res.json()) as { documents?: SjfTesis[] };
  return data.documents ?? [];
}

async function fetchDetail(ius: string): Promise<SjfTesis | null> {
  const url = `${API}/${ius}?isSemanal=true&hostName=${encodeURIComponent(SITE)}`;
  const res = await fetch(url, {
    headers: headers(`${DETAIL_VIEW}/${ius}`),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CJF/SJF ${res.status} at ${url}`);
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
  const raw =
    [stripHtml(t.texto || t.textoPublicacion), stripHtml(t.precedentes)].filter(Boolean).join("\n\n") ||
    rubro;
  const iso = publishedIso(t);
  const clave = stripHtml(t.claveTesis);
  const organo = stripHtml(t.organoJuris) || stripHtml(t.instancia);
  return {
    externalId: externalIdOf(ius),
    kind: "court_decision",
    jurisdiction: "federal",
    title: rubro || `Criterio de circuito ${ius}`,
    shortTitle: rubro ? rubro.slice(0, 200) : undefined,
    issuer: organo || "Órganos jurisdiccionales del Poder Judicial de la Federación (CJF)",
    citation: [clave, `Registro digital ${ius}`].filter(Boolean).join("; "),
    publishedAt: iso,
    effectiveAt: iso,
    sourceUrl: `${DETAIL_VIEW}/${ius}`,
    rawText: raw,
    metadata: {
      epoca: stripHtml(t.epoca),
      instancia: stripHtml(t.instancia),
      circuito: stripHtml(t.circuito),
      organoJuris: stripHtml(t.organoJuris),
      fuente: stripHtml(t.fuente),
      localizacion: stripHtml(t.localizacion || t.localizacionAbr),
      tipoTesis: t.tipoTesis,
      tipoJurisprudencia: t.tipoJurisprudencia,
      claveTesis: clave,
      materias: materiasOf(t),
      urlSemanario: t.urlSemanario,
      organoAdministrador: "Consejo de la Judicatura Federal",
    },
  };
}

async function collect(
  since: Date | null,
  known: Set<string> | undefined,
): Promise<IngestedDocument[]> {
  const out: IngestedDocument[] = [];
  const seen = new Set<string>();
  const floor = since ? new Date(since).getTime() : null;
  const deadline = Date.now() + RUN_BUDGET_MS;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    if (out.length >= MAX_DOCS_PER_RUN || Date.now() >= deadline) break;
    const items = await searchPage(page);
    if (!items.length) break;
    let crossedFloor = false;

    for (const s of items) {
      if (out.length >= MAX_DOCS_PER_RUN || Date.now() >= deadline) break;
      const ius = iusOf(s);
      if (!ius || seen.has(ius)) continue;
      seen.add(ius);
      // Incremental backfill: skip anything already stored so repeated runs
      // page deeper into the 90k-document corpus.
      if (known?.has(externalIdOf(ius))) continue;
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
        console.warn(`[cjf] skip tesis ${ius}: ${String(e)}`);
      }
    }
    // Only stop on the date floor when nothing is being skipped for backfill;
    // otherwise a full skip-list would end the run at page 0 forever.
    if (crossedFloor && !known?.size) break;
  }
  return out;
}

export const cjfConnector: LegalSourceConnector = {
  code: "cjf",
  displayName: "Órganos Jurisdiccionales Federales (CJF · Semanario Judicial)",
  kind: "court_decision",
  accessMethod: "official_json_endpoint",
  auth: { kind: "none" },

  async discover() {
    const items = await searchPage(0);
    return items
      .filter((i) => iusOf(i))
      .map((i) => ({
        externalId: externalIdOf(iusOf(i)),
        sourceUrl: `${DETAIL_VIEW}/${iusOf(i)}`,
        publishedAt: publishedIso(i),
      }));
  },

  async sync() {
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    return collect(since, this.alreadyIngested);
  },

  async fetchDocument(externalId) {
    const ius = externalId.replace(/^cjf:tesis:/, "");
    const detail = await fetchDetail(ius);
    if (!detail) throw new Error(`CJF criterio not found: ${externalId}`);
    const doc = toIngested(detail);
    if (!doc) throw new Error(`CJF criterio malformed: ${externalId}`);
    return doc;
  },

  async extractMetadata(doc) {
    return { issuer: doc.issuer, publishedAt: doc.publishedAt, citation: doc.citation };
  },

  /** Criterios are not article-structured; cited articles surface as citations. */
  async extractArticles(_doc): Promise<ExtractedArticle[]> {
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
        connectorCode: "cjf",
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return { connectorCode: "cjf", ok: false, checkedAt: new Date().toISOString(), detail: String(e) };
    }
  },
};
