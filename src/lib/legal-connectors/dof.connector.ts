// DOF (Diario Oficial de la Federación) connector — Phase 20.
//
// Real implementation against Segob's sidof open-data JSON service. The
// canonical shape (documented at https://sidof.segob.gob.mx/datos_abiertos):
//
//   GET https://sidof.segob.gob.mx/notas/{yyyy}/{mm}/{dd}
//     → JSON list of "notas" for that gazette edition; each note has
//       { codNota, titulo, codDependencia, nombreDependencia, tipoNota, ... }
//
//   GET https://sidof.segob.gob.mx/notas/{codNota}
//     → full detail incl. { titulo, dependencia, textoNota, fechaPublicacion }
//
// The service is public — no auth. Rate limiting is not documented; we
// pace by iterating dates sequentially. Weekend/holiday editions may 404;
// treat that as an empty-day, not an error.
//
// Sandbox note: outbound HTTP to *.segob.gob.mx and dof.gob.mx is blocked
// from Lovable's build sandbox but works from the deployed Worker runtime.
// That's why this connector is registered in IMPLEMENTED_CONNECTORS in code
// but left status='planned' in public.legal_source_connectors until the
// worker runs from Cloudflare and legal_ingest_runs shows real rows.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const BASE = "https://sidof.segob.gob.mx";
const DAY_LOOKBACK_ON_INITIAL = 3; // first-run backfill window when `since` is null
const MAX_DAYS_PER_RUN = 14;        // cap incremental runs so a long outage doesn't blow up one invocation

type SidofNoteListItem = {
  codNota?: string | number;
  titulo?: string;
  codDependencia?: string | number;
  nombreDependencia?: string;
  tipoNota?: string;
  fechaPublicacion?: string;
};

type SidofNoteDetail = SidofNoteListItem & {
  textoNota?: string;
  contenido?: string;
  urlPublicacion?: string;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "NyravaMexico-LegalIngest/1.0" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DOF ${res.status} at ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`DOF non-JSON response at ${url}: ${text.slice(0, 200)}`);
  }
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function toDateOnly(d: Date) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function dayUrl(d: Date) { return `${BASE}/notas/${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`; }
function noteUrl(codNota: string | number) { return `${BASE}/notas/${codNota}`; }

function enumerateDays(since: Date | null): Date[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = since ? new Date(since) : new Date(today.getTime() - DAY_LOOKBACK_ON_INITIAL * 86400_000);
  start.setUTCHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let d = new Date(start); d <= today && days.length < MAX_DAYS_PER_RUN; d = new Date(d.getTime() + 86400_000)) {
    days.push(new Date(d));
  }
  return days;
}

function toIngested(detail: SidofNoteDetail): IngestedDocument | null {
  const codNota = detail.codNota != null ? String(detail.codNota) : "";
  if (!codNota) return null;
  const raw = detail.textoNota ?? detail.contenido ?? "";
  return {
    externalId: `dof:${codNota}`,
    kind: "federal_gazette",
    jurisdiction: "federal",
    title: (detail.titulo ?? "").trim() || `DOF nota ${codNota}`,
    shortTitle: undefined,
    issuer: detail.nombreDependencia?.trim(),
    citation: `DOF ${detail.fechaPublicacion ?? ""}`.trim(),
    publishedAt: detail.fechaPublicacion,
    effectiveAt: detail.fechaPublicacion,
    sourceUrl: detail.urlPublicacion ?? noteUrl(codNota),
    rawText: typeof raw === "string" ? raw : String(raw ?? ""),
    metadata: {
      codDependencia: detail.codDependencia,
      tipoNota: detail.tipoNota,
    },
  };
}

async function fetchOneDay(d: Date): Promise<IngestedDocument[]> {
  const list = await fetchJson<SidofNoteListItem[] | { notas?: SidofNoteListItem[] }>(dayUrl(d));
  if (!list) return [];
  const items: SidofNoteListItem[] = Array.isArray(list) ? list : list.notas ?? [];
  const out: IngestedDocument[] = [];
  for (const item of items) {
    if (item.codNota == null) continue;
    try {
      const detail = await fetchJson<SidofNoteDetail>(noteUrl(item.codNota));
      const doc = toIngested({ ...item, ...(detail ?? {}) });
      if (doc) out.push(doc);
    } catch (e) {
      // one bad note shouldn't tank the whole day
      console.warn(`[dof] skip nota ${item.codNota} on ${toDateOnly(d)}: ${String(e)}`);
    }
  }
  return out;
}

export const dofConnector: LegalSourceConnector = {
  code: "dof",
  displayName: "Diario Oficial de la Federación",
  kind: "federal_gazette",
  accessMethod: "official_json_endpoint",
  auth: { kind: "none" },

  async discover() {
    // Latest day only — a lightweight ping used by the worker to see what's currently listed.
    const today = new Date();
    const list = await fetchJson<SidofNoteListItem[] | { notas?: SidofNoteListItem[] }>(dayUrl(today));
    const items = Array.isArray(list) ? list : list?.notas ?? [];
    return items
      .filter((i) => i.codNota != null)
      .map((i) => ({
        externalId: `dof:${i.codNota}`,
        sourceUrl: noteUrl(i.codNota!),
        publishedAt: i.fechaPublicacion,
      }));
  },

  async sync() {
    // Full sync = same as fetchUpdates with no floor; scheduler enforces bounds.
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    const days = enumerateDays(since);
    const out: IngestedDocument[] = [];
    for (const d of days) {
      const perDay = await fetchOneDay(d);
      out.push(...perDay);
    }
    return out;
  },

  async fetchDocument(externalId) {
    const codNota = externalId.replace(/^dof:/, "");
    const detail = await fetchJson<SidofNoteDetail>(noteUrl(codNota));
    if (!detail) throw new Error(`DOF nota not found: ${externalId}`);
    const doc = toIngested(detail);
    if (!doc) throw new Error(`DOF nota malformed: ${externalId}`);
    return doc;
  },

  async extractMetadata(doc) {
    return { issuer: doc.issuer, publishedAt: doc.publishedAt, citation: doc.citation };
  },

  async extractArticles(doc): Promise<ExtractedArticle[]> {
    // DOF notes are gazette entries (decrees, notices, resolutions), not
    // article-structured statutes. Article extraction is a no-op here; the
    // legislative-compilation connector (SCJN) is where articles come from.
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
      const today = new Date();
      // A HEAD would be nicer but sidof serves JSON on GET; keep it cheap.
      const res = await fetch(dayUrl(today), { method: "GET", headers: { Accept: "application/json" } });
      return {
        connectorCode: "dof",
        ok: res.ok || res.status === 404, // 404 = no edition today (weekend/holiday) is still "service up"
        checkedAt: new Date().toISOString(),
        detail: `HTTP ${res.status}`,
      };
    } catch (e) {
      return { connectorCode: "dof", ok: false, checkedAt: new Date().toISOString(), detail: String(e) };
    }
  },
};
