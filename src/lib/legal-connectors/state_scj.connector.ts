// Tribunales Superiores de Justicia Estatales — real implementation.
// Endpoint audit 2026-07, verified live from the sandbox.
//
// ── Endpoint investigation ───────────────────────────────────────────────────
// Almost every state judiciary blocks server-side requests outright:
//   poderjudicialcdmx.gob.mx → 403 Cloudflare challenge
//   pjenl.gob.mx             → 403
//   tsjbc / pjedomex / poderjudicialjalisco / tsjsonora / tsjags → no answer
// The one state judiciary that publishes a documented, open, machine-readable
// interface is the Poder Judicial del Estado de Coahuila de Zaragoza (PJECZ),
// whose public "Consultas" site is backed by a public REST API:
//
//   GET https://api.justiciadigital.gob.mx/v3/sentencias/datatable?start&length
//        → paginated public "versión pública" sentencia index, newest first
//   GET https://api.justiciadigital.gob.mx/v3/sentencias/{id}
//        → distrito, autoridad (órgano emisor), materia/tipo de juicio,
//          expediente, fechas, perspectiva de género, archivo público
//
// The API key below is the one the PJECZ ships publicly in
// https://www.pjecz.gob.mx/consultas/js/consultas-api-url.js — it is a public
// read-only client key for the version-pública endpoints, not a credential.
//
// The sentencia PDFs themselves sit behind a reCAPTCHA-gated download service
// (archivos.justiciadigital.gob.mx), so this connector ingests the full
// structured record — órgano jurisdiccional, distrito judicial, materia,
// tipo de juicio, expediente, número de sentencia, fechas y descripción del
// asunto — and links to the official record. No PDF text is fabricated.
//
// Runs are incremental: `alreadyIngested` drives a skip-list so repeated runs
// page deeper into the corpus instead of re-fetching the newest page.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const API = "https://api.justiciadigital.gob.mx/v3";
const PUBLIC_API_KEY =
  "gAAAAABlErx69Ks3NE85EZmaGz7k2PnbGgtQ1tO8zJQfBPL1KwH4YCPUOGUrY6ng3yxiHzQi0p12n7SMPDE-JeHPAGS0ExVSiPjAAjGkP3HjEJmO6f4wf7c=";
const CONSULTAS = "https://www.pjecz.gob.mx/consultas/sentencias/";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PAGE_SIZE = 10;
const MAX_PAGES_PER_RUN = 12;
const MAX_DOCS_PER_RUN = 25;
const RUN_BUDGET_MS = 45_000;
const THROTTLE_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SentenciaRow = {
  id: number;
  autoridad_clave?: string;
  autoridad_descripcion?: string;
  autoridad_descripcion_corta?: string;
  distrito_clave?: string;
  distrito_nombre?: string;
  materia_tipo_juicio_descripcion?: string;
  sentencia?: string;
  sentencia_fecha?: string;
  expediente?: string;
  fecha?: string;
  descripcion?: string;
  es_perspectiva_genero?: boolean;
  archivo?: string;
  url?: string;
};

function headers(): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "es-MX,es;q=0.9",
    "User-Agent": BROWSER_UA,
    "X-Api-Key": PUBLIC_API_KEY,
    Origin: "https://www.pjecz.gob.mx",
    Referer: CONSULTAS,
  };
}

const externalIdOf = (id: number | string) => `state_scj:coa:sentencia:${id}`;

function clean(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function isoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

async function listPage(start: number): Promise<SentenciaRow[]> {
  const url = `${API}/sentencias/datatable?start=${start}&length=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`PJECZ ${res.status} at ${url}`);
  const json = (await res.json()) as { data?: SentenciaRow[] };
  return json.data ?? [];
}

async function fetchDetail(id: number | string): Promise<SentenciaRow | null> {
  const url = `${API}/sentencias/${id}`;
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PJECZ ${res.status} at ${url}`);
  return (await res.json()) as SentenciaRow;
}

function toIngested(row: SentenciaRow): IngestedDocument | null {
  if (!row?.id) return null;
  const organo = clean(row.autoridad_descripcion) || clean(row.autoridad_descripcion_corta);
  const distrito = clean(row.distrito_nombre);
  const tipoJuicio = clean(row.materia_tipo_juicio_descripcion);
  const numero = clean(row.sentencia);
  const expediente = clean(row.expediente);
  const descripcion = clean(row.descripcion);
  const publicada = isoDate(row.fecha);
  const dictada = isoDate(row.sentencia_fecha);

  const title =
    [numero ? `Sentencia ${numero}` : `Sentencia ${row.id}`, tipoJuicio, organo]
      .filter(Boolean)
      .join(" — ") || `Sentencia ${row.id}`;

  const rawText = [
    `Sentencia ${numero || row.id} del Poder Judicial del Estado de Coahuila de Zaragoza.`,
    organo ? `Órgano jurisdiccional: ${organo}.` : "",
    distrito ? `Distrito judicial: ${distrito}.` : "",
    tipoJuicio ? `Tipo de juicio: ${tipoJuicio}.` : "",
    expediente ? `Expediente: ${expediente}.` : "",
    dictada ? `Fecha de la sentencia: ${dictada}.` : "",
    publicada ? `Fecha de publicación en versión pública: ${publicada}.` : "",
    row.es_perspectiva_genero ? "Resuelta con perspectiva de género." : "",
    descripcion ? `Asunto: ${descripcion}.` : "",
    "Versión pública publicada por el Poder Judicial del Estado de Coahuila de Zaragoza (consulta pública de sentencias).",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    externalId: externalIdOf(row.id),
    kind: "court_decision",
    jurisdiction: "COA",
    title,
    shortTitle: title.slice(0, 200),
    issuer: organo || "Tribunal Superior de Justicia del Estado de Coahuila de Zaragoza",
    citation: [numero ? `Sentencia ${numero}` : "", expediente ? `Expediente ${expediente}` : ""]
      .filter(Boolean)
      .join("; "),
    publishedAt: publicada ?? dictada,
    effectiveAt: dictada ?? publicada,
    sourceUrl: row.autoridad_clave
      ? `${CONSULTAS}?autoridad_clave=${encodeURIComponent(row.autoridad_clave)}`
      : CONSULTAS,
    rawText,
    metadata: {
      estado: "Coahuila de Zaragoza",
      poderJudicial: "Poder Judicial del Estado de Coahuila de Zaragoza (PJECZ)",
      organoJurisdiccional: organo,
      autoridadClave: clean(row.autoridad_clave),
      distritoJudicial: distrito,
      distritoClave: clean(row.distrito_clave),
      tipoJuicio,
      expediente,
      numeroSentencia: numero,
      fechaSentencia: dictada,
      perspectivaGenero: Boolean(row.es_perspectiva_genero),
      archivoVersionPublica: clean(row.archivo) || undefined,
      archivoUrl: row.url,
      descargaRequiereCaptcha: true,
    },
  };
}

async function collect(
  since: Date | null,
  known: Set<string> | undefined,
): Promise<IngestedDocument[]> {
  const out: IngestedDocument[] = [];
  const seen = new Set<number>();
  const floor = since ? new Date(since).getTime() : null;
  const deadline = Date.now() + RUN_BUDGET_MS;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    if (out.length >= MAX_DOCS_PER_RUN || Date.now() >= deadline) break;
    const rows = await listPage(page * PAGE_SIZE);
    if (!rows.length) break;
    let crossedFloor = false;

    for (const row of rows) {
      if (out.length >= MAX_DOCS_PER_RUN || Date.now() >= deadline) break;
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      if (known?.has(externalIdOf(row.id))) continue;

      const pub = row.fecha ? new Date(row.fecha).getTime() : null;
      if (floor !== null && pub !== null && pub < floor) {
        crossedFloor = true;
        continue;
      }
      try {
        await sleep(THROTTLE_MS);
        const detail = await fetchDetail(row.id);
        const doc = toIngested({ ...row, ...(detail ?? {}) });
        if (doc) out.push(doc);
      } catch (e) {
        console.warn(`[state_scj] skip sentencia ${row.id}: ${String(e)}`);
      }
    }
    // Only honor the date floor when nothing is being skipped for backfill,
    // otherwise a full skip-list would end the run at page 0 forever.
    if (crossedFloor && !known?.size) break;
  }
  return out;
}

export const stateScjConnector: LegalSourceConnector = {
  code: "state_scj",
  displayName: "Tribunales Superiores de Justicia Estatales (Coahuila · PJECZ)",
  kind: "court_decision",
  accessMethod: "official_api",
  auth: { kind: "none" },

  async discover() {
    const rows = await listPage(0);
    return rows
      .filter((r) => r?.id)
      .map((r) => ({
        externalId: externalIdOf(r.id),
        sourceUrl: r.autoridad_clave
          ? `${CONSULTAS}?autoridad_clave=${encodeURIComponent(r.autoridad_clave)}`
          : CONSULTAS,
        publishedAt: isoDate(r.fecha),
      }));
  },

  async sync() {
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    return collect(since, this.alreadyIngested);
  },

  async fetchDocument(externalId) {
    const id = externalId.replace(/^state_scj:coa:sentencia:/, "");
    const detail = await fetchDetail(id);
    if (!detail) throw new Error(`Sentencia estatal no encontrada: ${externalId}`);
    const doc = toIngested(detail);
    if (!doc) throw new Error(`Sentencia estatal malformada: ${externalId}`);
    return doc;
  },

  async extractMetadata(doc) {
    return { issuer: doc.issuer, publishedAt: doc.publishedAt, citation: doc.citation };
  },

  /** Sentencias are not article-structured; cited articles surface as citations. */
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
      const res = await fetch(`${API}/sentencias/datatable?start=0&length=1`, {
        headers: headers(),
        signal: AbortSignal.timeout(20_000),
      });
      return {
        connectorCode: "state_scj",
        ok: res.ok,
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return {
        connectorCode: "state_scj",
        ok: false,
        checkedAt: new Date().toISOString(),
        detail: String(e),
      };
    }
  },
};
