// Modular Legal Source Connector Framework — Phase 20.
//
// This is a CONTRACT ONLY. No connector implementations live here yet —
// writing a real one requires actually inspecting the target source's live
// site/API (page structure, auth, rate limits), which nobody on this build
// has done yet. See MIGRATION_NOTES for status.
//
// Every future connector (SCJN, DOF, Cámara de Diputados, CJF, state
// judicial powers, etc.) should implement this interface so the ingestion
// pipeline, scheduler, and error handling stay identical across sources —
// only the source-specific download/parse logic differs.

export type LegalSourceKind =
  | "jurisprudencia"     // SCJN tesis/jurisprudencia
  | "federal_statute"    // Cámara de Diputados codes/laws
  | "federal_gazette"    // DOF
  | "state_statute"
  | "state_gazette"
  | "court_decision"
  | "administrative_ruling" // TFJA
  | "electoral_ruling"      // Tribunal Electoral
  | "human_rights_report";  // CNDH / state commissions

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

export type ConnectorHealth = {
  connectorCode: string;
  lastSyncAt: string | null;
  lastSyncOk: boolean;
  lastError?: string;
  documentsIngestedLastRun?: number;
};

/**
 * Every real connector (one file per source, e.g. dof.connector.ts,
 * scjn.connector.ts) implements this. The ingestion pipeline (not yet
 * built — see Phase 20 pipeline stages: download → validate → OCR if
 * needed → extract → normalize → store) calls fetchLatest() on whatever
 * schedule is configured in public.legal_source_connectors, then hands
 * the results to the shared normalize/store step so every source ends up
 * in the same public.legal_authorities shape regardless of origin.
 */
export interface LegalSourceConnector {
  /** Matches public.legal_source_connectors.code, e.g. "scjn", "dof", "tfja". */
  code: string;
  displayName: string;
  kind: LegalSourceKind;

  /**
   * Fetch documents published/updated since `since` (or all available, if
   * `since` is null — first run). Must be idempotent: re-fetching the same
   * window twice should be safe (upsert on externalId downstream), since
   * schedules will occasionally overlap or retry.
   */
  fetchLatest(since: Date | null): Promise<IngestedDocument[]>;

  /** Lightweight reachability/auth check, for the health-monitoring requirement in Phase 20. */
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Registry of connectors actually wired up. Empty until a real connector is
 * built and added here — deliberately not pre-populated with stubs that
 * would silently return no data while looking like they work.
 */
export const REGISTERED_CONNECTORS: LegalSourceConnector[] = [];
