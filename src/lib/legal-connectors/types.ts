// Modular Legal Source Connector Framework — Phase 20.
//
// Expanded per explicit direction: build the full interface now, prioritize
// official machine-readable interfaces (API > JSON > XML/RSS > CSV/ZIP >
// PDF > HTML-scrape-as-last-resort), keep auth fully optional/pluggable so
// public sources need zero credentials and any future source that DOES
// require them just fills in `auth` without changing the interface.

export type LegalSourceKind =
  | "jurisprudencia"        // SCJN tesis/jurisprudencia
  | "federal_statute"       // Cámara de Diputados / SCJN legislative compilation
  | "federal_gazette"       // DOF
  | "state_statute"
  | "state_gazette"
  | "court_decision"
  | "administrative_ruling" // TFJA
  | "electoral_ruling"      // Tribunal Electoral
  | "human_rights_report";  // CNDH / state commissions

export type AccessMethod =
  | "official_api"
  | "official_json_endpoint"
  | "official_xml_feed"
  | "official_rss"
  | "official_csv_download"
  | "official_zip_download"
  | "official_pdf"
  | "html_scrape"; // last resort only — see connector priority rule below

/** Auth is optional and pluggable. Public sources (the default assumption
 *  for official Mexican legal publications) simply omit this entirely. */
export type ConnectorAuth =
  | { kind: "none" }
  | { kind: "api_key"; secretName: string; headerName?: string; queryParam?: string }
  | { kind: "oauth2"; secretName: string; tokenUrl: string; scope?: string }
  | { kind: "cookie"; secretName: string }
  | { kind: "client_cert"; certSecretName: string; keySecretName: string };

export type IngestedDocument = {
  /** Stable external identifier from the source (docket #, DOF edition, tesis registry #, etc.). */
  externalId: string;
  kind: LegalSourceKind;
  jurisdiction: string; // "federal" or a JURISDICTION_OPTIONS value
  title: string;
  shortTitle?: string;
  issuer?: string;
  citation?: string;
  publishedAt?: string; // ISO date
  effectiveAt?: string; // ISO date
  sourceUrl: string;
  rawText: string;
  metadata?: Record<string, unknown>;
};

export type ExtractedArticle = {
  articleNumber: string; // e.g. "123", "3 Bis"
  heading?: string;
  text: string;
};

export type ExtractedCitation = {
  citationText: string;      // normalized display form, e.g. "Art. 123 LFT"
  citedAuthorityHint?: string; // best-effort guess at what it refers to, for later resolution against legal_authorities
};

export type ConnectorHealth = {
  connectorCode: string;
  ok: boolean;
  checkedAt: string; // ISO
  detail?: string;
};

export type ValidationResult = { valid: boolean; errors: string[] };

/**
 * Every real connector implements this. Method breakdown follows the
 * pipeline stages exactly (Source → Download → Validate → OCR if needed →
 * Extract → Normalize → Metadata → Articles → Citations → Version → Store)
 * so the orchestrator (ingest-pipeline.server.ts) can drive any connector
 * identically regardless of source.
 */
export interface LegalSourceConnector {
  /** Matches public.legal_source_connectors.code, e.g. "scjn", "dof", "diputados". */
  code: string;
  displayName: string;
  kind: LegalSourceKind;
  accessMethod: AccessMethod;
  auth?: ConnectorAuth;

  /** One-time or periodic discovery of what's available (e.g. list of DOF editions, SCJN dataset files). */
  discover(): Promise<{ externalId: string; sourceUrl: string; publishedAt?: string }[]>;

  /** Full sync — used for first run / backfill. */
  sync(): Promise<IngestedDocument[]>;

  /** Incremental sync since the last successful run. */
  fetchUpdates(since: Date | null): Promise<IngestedDocument[]>;

  /** Fetch one document's full content by external id, if discover() only returned metadata. */
  fetchDocument(externalId: string): Promise<IngestedDocument>;

  extractMetadata(doc: IngestedDocument): Promise<Partial<IngestedDocument>>;
  extractArticles(doc: IngestedDocument): Promise<ExtractedArticle[]>;
  extractCitations(doc: IngestedDocument): Promise<ExtractedCitation[]>;

  /** Clean/standardize raw text (whitespace, encoding, OCR artifacts if the source was PDF/scanned). */
  normalize(doc: IngestedDocument): Promise<IngestedDocument>;

  validate(doc: IngestedDocument): Promise<ValidationResult>;

  healthCheck(): Promise<ConnectorHealth>;
}

/**
 * Registry of connectors actually wired up. Presence here means the code
 * exists and conforms to LegalSourceConnector; it does NOT mean the source
 * has been verified end-to-end. Actual enable/disable is DB-driven via
 * public.legal_source_connectors.status (see registry.server.ts) — a
 * connector only runs when it's BOTH implemented here AND status='active'.
 * Kept status='planned' until a real ingest run confirms rows land in
 * public.legal_authorities.
 */
import { dofConnector } from "./dof.connector";
import { scjnConnector } from "./scjn.connector";

export const IMPLEMENTED_CONNECTORS: LegalSourceConnector[] = [
  dofConnector,
  scjnConnector,
];
