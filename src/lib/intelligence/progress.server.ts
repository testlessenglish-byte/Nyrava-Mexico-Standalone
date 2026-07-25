// Canonical-only progress helpers. This file previously owned the legacy
// `cases.pipeline_progress` JSON column and duplicate STAGE_ORDER / UPSTREAM_OF
// maps. All of that has been removed — execution state now lives exclusively
// in `pipeline_engine_runs`. The only responsibilities kept here are:
//
//   1. `emitEvent` — thin insert into `pipeline_events` (activity feed).
//   2. `assertCanRun` — re-export of the canonical dependency gate.
//   3. `StageKey` — legacy type alias, kept so existing callers compile;
//      the canonical stage keys live in `src/lib/execution/canonical.ts`.
//
// No function in this module writes to `cases.pipeline_progress` or reads
// from `cases.*_at` timestamps. The column has been dropped in migration
// `20260702_drop_pipeline_progress_column`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertCanRun as canonicalAssertCanRun } from "@/lib/execution/service.server";

type Db = SupabaseClient<Database>;

/** Legacy stage-key alias. New code should import from `canonical.ts`. */
export type StageKey =
  | "extraction" | "analyzers" | "agents" | "evidence_intel" | "contradictions"
  | "witness_intel" | "discovery_gaps" | "theories" | "strategy" | "scoring" | "report";

/**
 * Canonical dependency gate. Throws if any upstream stage of `stage` is not
 * complete/skipped in `pipeline_engine_runs`. Backed by
 * `src/lib/execution/service.server.ts` → `assertCanRun`.
 */
export async function ensurePrereqs(db: Db, caseId: string, stage: StageKey): Promise<void> {
  await canonicalAssertCanRun(db, caseId, stage);
}

/**
 * Activity-feed insert. Never let logging crash the pipeline.
 */
export async function emitEvent(
  db: Db,
  caseId: string,
  stage: StageKey | string,
  message: string,
  opts: { level?: "info" | "warn" | "error"; meta?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.from("pipeline_events").insert({
      case_id: caseId,
      stage,
      message,
      level: opts.level ?? "info",
      meta: (opts.meta ?? {}) as never,
    } as never);
  } catch {
    /* swallow — logging must never break the pipeline */
  }
}
