// Ingestion orchestrator — drives any LegalSourceConnector through the full
// pipeline (discover → download → validate → extract → normalize →
// version/store), with retry logic and a run ledger, mirroring the pattern
// already established by pipeline_engine_runs for the case-analysis engine
// (see src/lib/pipeline.server.ts) so both systems are operationally
// consistent (same kind of observability, same kind of failure handling).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { LegalSourceConnector, IngestedDocument } from "./types";
import { upsertAuthorityWithVersioning } from "./versioning.server";

type Db = SupabaseClient<Database>;

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 5000, 15000];

async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = MAX_RETRIES): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 15000));
      }
    }
  }
  throw new Error(`${label} failed after ${maxRetries + 1} attempts: ${String(lastErr)}`);
}

export type IngestRunResult = {
  connectorCode: string;
  startedAt: string;
  endedAt: string;
  status: "completed" | "failed" | "completed_with_errors";
  documentsFetched: number;
  documentsStored: number;
  documentsVersioned: number;
  errors: string[];
};

/**
 * Run one connector's incremental sync end-to-end. Never throws — failures
 * are captured in the result and logged to legal_ingest_runs so a bad
 * source doesn't take down the scheduler loop for the others.
 */
export async function runConnectorIngest(
  db: Db,
  connector: LegalSourceConnector,
  since: Date | null,
): Promise<IngestRunResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let documentsStored = 0;
  let documentsVersioned = 0;
  let entitiesProjected = 0;
  let rawDocs: IngestedDocument[] = [];

  try {
    rawDocs = await withRetry(() => connector.fetchUpdates(since), `${connector.code}.fetchUpdates`);
  } catch (e) {
    errors.push(String(e));
    return finalize("failed");
  }

  for (const raw of rawDocs) {
    try {
      const normalized = await connector.normalize(raw);
      const validation = await connector.validate(normalized);
      if (!validation.valid) {
        errors.push(`${normalized.externalId}: validation failed — ${validation.errors.join("; ")}`);
        continue;
      }
      const { authorityId, versioned } = await withRetry(
        () => upsertAuthorityWithVersioning(db, connector.code, normalized),
        `${connector.code}.store(${normalized.externalId})`,
        1, // a write failure is almost always permanent (RLS/constraint) — don't burn 21s per doc
      );
      documentsStored += 1;
      if (versioned) documentsVersioned += 1;

      // Parse the stored authority into typed entities (tesis /
      // jurisprudencia / articles). Never fatal to the run.
      const { projectDocument } = await import("./projection.server");
      const projection = await projectDocument(db, connector, normalized, authorityId);
      entitiesProjected += projection.theses + projection.jurisprudencia + projection.articles;
      errors.push(...projection.errors);
    } catch (e) {
      errors.push(`${raw.externalId}: ${String(e)}`);
    }
  }


  return finalize(errors.length === 0 ? "completed" : documentsStored > 0 ? "completed_with_errors" : "failed");

  function finalize(status: IngestRunResult["status"]): IngestRunResult {
    return {
      connectorCode: connector.code,
      startedAt,
      endedAt: new Date().toISOString(),
      status,
      documentsFetched: rawDocs.length,
      documentsStored,
      documentsVersioned,
      errors,
    };
  }
}

/** Persist a run result to legal_ingest_runs and bump legal_source_connectors.last_sync_at. */
export async function recordIngestRun(db: Db, result: IngestRunResult): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from("legal_ingest_runs").insert({
    connector_code: result.connectorCode,
    started_at: result.startedAt,
    ended_at: result.endedAt,
    status: result.status,
    documents_fetched: result.documentsFetched,
    documents_stored: result.documentsStored,
    documents_versioned: result.documentsVersioned,
    errors: result.errors,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .from("legal_source_connectors")
    .update({ last_sync_at: result.endedAt })
    .eq("code", result.connectorCode);
}
