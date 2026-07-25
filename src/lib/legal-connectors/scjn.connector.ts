// SCJN (Suprema Corte de Justicia de la Nación) connector — Phase 20.
//
// SCJN publishes two distinct public interfaces relevant to us:
//
// 1. Semanario Judicial de la Federación (SJF) — the official reporter of
//    tesis and jurisprudencia. It exposes a public search UI at
//    https://sjf2.scjn.gob.mx/ and its own JSON search endpoints under
//    /busqueda-principal-tesis. We use those to enumerate recently
//    published tesis and pull each one's detail JSON.
//
// 2. Servicio de Compilación de Leyes at
//    https://www.scjn.gob.mx/normativa-nacional-internacional/servicio-compilacion-leyes
//    for current & historical federal/state statutes. There is no
//    documented open JSON here — items are downloadable individually. Full
//    statute ingestion happens in a future federal_statute connector; this
//    connector covers jurisprudencia (kind: "jurisprudencia") only.
//
// Sandbox note: outbound HTTP to *.scjn.gob.mx is blocked from Lovable's
// build sandbox but works from the deployed Worker runtime. Left
// status='planned' in public.legal_source_connectors until the worker runs
// from Cloudflare and legal_ingest_runs shows real rows.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const SJF_BASE = "https://sjf2.scjn.gob.mx/detalle/tesis";
const SJF_SEARCH = "https://sjf2.scjn.gob.mx/busqueda-principal-tesis";
const HEALTH_URL = "https://sjf2.scjn.gob.mx/";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 4; // conservative — SJF search can be slow

type SjfTesisSummary = {
  ius?: string | number;      // registro digital, SCJN's stable id
  registro?: string | number;
  rubro?: string;             // title/heading of the tesis
  texto?: string;             // preview text in search results
  epoca?: string;
  instancia?: string;
  fechaPublicacion?: string;
  tipoTesis?: "J" | "A" | string; // Jurisprudencia vs Aislada
  materia?: string;
};

type SjfTesisDetail = SjfTesisSummary & {
  textoTesis?: string;
  precedentes?: string;
  votoConcurrente?: string;
  urlDetalle?: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "NyravaMexico-LegalIngest/1.0",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SCJN ${res.status} at ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`SCJN non-JSON response at ${url}: ${text.slice(0, 200)}`);
  }
}

function extractIus(item: SjfTesisSummary): string {
  return String(item.ius ?? item.registro ?? "").trim();
}

function toIngested(detail: SjfTesisDetail): IngestedDocument | null {
  const ius = extractIus(detail);
  if (!ius) return null;
  const rubro = (detail.rubro ?? "").trim();
  const body = [detail.textoTesis, detail.precedentes, detail.votoConcurrente]
    .filter(Boolean)
    .join("\n\n");
  const raw = body || detail.texto || rubro;
  return {
    externalId: `scjn:tesis:${ius}`,
    kind: "jurisprudencia",
    jurisdiction: "federal",
    title: rubro || `Tesis SCJN ${ius}`,
    shortTitle: rubro?.slice(0, 200),
    issuer: detail.instancia || "Suprema Corte de Justicia de la Nación",
    citation: `Tesis ${detail.tipoTesis ?? ""} — Registro ${ius}`.trim(),
    publishedAt: detail.fechaPublicacion,
    effectiveAt: detail.fechaPublicacion,
    sourceUrl: detail.urlDetalle ?? `${SJF_BASE}/${ius}`,
    rawText: typeof raw === "string" ? raw : String(raw ?? ""),
    metadata: {
      epoca: detail.epoca,
      instancia: detail.instancia,
      tipoTesis: detail.tipoTesis,
      materia: detail.materia,
    },
  };
}

async function searchPage(page: number, since: Date | null): Promise<SjfTesisSummary[]> {
  const params = new URLSearchParams({
    tipo: "tesis",
    pagina: String(page),
    tamanio: String(DEFAULT_PAGE_SIZE),
    orden: "fechaDesc",
  });
  if (since) params.set("desde", since.toISOString().slice(0, 10));
  const data = await fetchJson<{ resultados?: SjfTesisSummary[] } | SjfTesisSummary[]>(
    `${SJF_SEARCH}?${params.toString()}`,
  );
  if (!data) return [];
  return Array.isArray(data) ? data : data.resultados ?? [];
}

async function fetchDetail(ius: string): Promise<SjfTesisDetail | null> {
  return fetchJson<SjfTesisDetail>(`${SJF_BASE}/${ius}`);
}

export const scjnConnector: LegalSourceConnector = {
  code: "scjn",
  displayName: "Suprema Corte de Justicia de la Nación (SJF)",
  kind: "jurisprudencia",
  accessMethod: "official_json_endpoint",
  auth: { kind: "none" },

  async discover() {
    const first = await searchPage(1, null);
    return first
      .filter((i) => extractIus(i))
      .map((i) => ({
        externalId: `scjn:tesis:${extractIus(i)}`,
        sourceUrl: `${SJF_BASE}/${extractIus(i)}`,
        publishedAt: i.fechaPublicacion,
      }));
  },

  async sync() {
    return this.fetchUpdates(null);
  },

  async fetchUpdates(since) {
    const seen = new Set<string>();
    const out: IngestedDocument[] = [];
    for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
      const summaries = await searchPage(page, since);
      if (summaries.length === 0) break;
      let newThisPage = 0;
      for (const s of summaries) {
        const ius = extractIus(s);
        if (!ius || seen.has(ius)) continue;
        seen.add(ius);
        try {
          const detail = await fetchDetail(ius);
          const doc = toIngested({ ...s, ...(detail ?? {}) });
          if (doc) {
            out.push(doc);
            newThisPage++;
          }
        } catch (e) {
          console.warn(`[scjn] skip tesis ${ius}: ${String(e)}`);
        }
      }
      if (newThisPage === 0) break;
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
      const res = await fetch(HEALTH_URL, { method: "GET" });
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
