// Engine execution audit — every intelligence engine that runs on a case
// writes a row to `pipeline_engine_runs` via `runEngine()`. This is the
// single source of truth for the dashboard's Engine Status panel and for
// the report's `engines_summary` block.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { emitEvent } from "./progress.server";
import { summarizeScope, withTelemetryScope } from "../ai/telemetry.server";
import { isCheckpointError } from "../pipeline-checkpoint.server";

type Db = SupabaseClient<Database>;

export type EngineName =
  | "extraction"
  | "ocr"
  | "entity_extraction"
  | "fact_extraction"
  | "evidence_intelligence"
  | "contradictions"
  | "witness_intelligence"
  | "discovery_gaps"
  | "theory"
  | "strategy"
  | "opportunity"
  | "motion"
  | "scoring"
  | "ess_validator"
  | "claim_validator"
  | "report_generator"
  | "report_validator"
  // legacy/aux
  | "analyzers"
  | "agents"
  | (string & {});

export type EngineStats = {
  generated?: number;
  accepted?: number;
  rejected?: number;
  suppressed_ess?: number;
  suppressed_validator?: number;
  // Phase 1 ledger fields — every engine should populate what it can.
  provider?: string;
  model?: string;
  prompt_version?: string;
  tokens_in?: number;
  tokens_out?: number;
  retry_count?: number;
  cost_usd?: number;
  rows_written?: number;
  db_write_confirmed?: boolean;
  parent_engine?: string;
  meta?: Record<string, unknown>;
  /**
   * When set to "negative", the engine ran successfully but reached a
   * legitimate no-result outcome (Judge reject, QA no-findings, thin-evidence
   * hallucination gate). Persisted as status="completed_negative" so
   * dashboards can render it green/amber instead of red.
   */
  outcome?: "positive" | "negative";
  /**
   * Non-determinism instrumentation — Groq sampling temperature/seed and a
   * per-engine input hash. Merged into `meta.determinism` for post-hoc
   * variance analysis. Use `buildDeterminismMeta()` to construct.
   */
  determinism?: {
    temperature?: number | null;
    seed?: number | null;
    input_hash?: string | null;
  };
};


export type EngineResult<T> = { value: T; stats?: EngineStats };

function labelEngine(engine: string): string {
  return engine
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Wrap an engine invocation so its execution is recorded in
 * pipeline_engine_runs. The wrapped fn may return either a plain value or
 * { value, stats } to declare its accepted/rejected/suppressed counts.
 */
export async function runEngine<T>(
  db: Db,
  args: { caseId: string; userId: string; engine: EngineName; parentEngine?: string },
  fn: () => Promise<T | EngineResult<T>>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  await emitEvent(db, args.caseId, args.engine, `${labelEngine(args.engine)} started`, {
    meta: { engine: args.engine, status: "running" },
  });
  // Insert running row. We REQUIRE an id back — if the insert silently
  // returns no row (RLS quirk, driver oddity), we must fail loudly rather
  // than let the engine run without a ledger anchor, because a subsequent
  // exception would then have no row to flip to `failed` and leave the
  // engine perceived as never-started.
  const { data: inserted, error: insertErr } = await db
    .from("pipeline_engine_runs")
    .insert({
      case_id: args.caseId,
      user_id: args.userId,
      engine: args.engine,
      status: "running",
      started_at: startedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parent_engine: args.parentEngine ?? null,
    } as never)
    .select("id")
    .maybeSingle();
  if (insertErr || !inserted?.id) {
    const reason = insertErr?.message ?? "insert returned no id";
    throw new Error(`runEngine(${args.engine}): failed to create ledger row — ${reason}`);
  }
  const id = inserted.id;
  let terminalWritten = false;

  try {
    const runId = `${args.engine}-${args.caseId}-${Date.now().toString(36)}`;
    const { value: result, scope } = await withTelemetryScope(
      { runId, traceId: runId, replay: { engine: args.engine, case_id: args.caseId } },
      async () => fn(),
    );
    const isWrapped =
      result && typeof result === "object" && "value" in (result as Record<string, unknown>);
    const value = (isWrapped ? (result as EngineResult<T>).value : (result as T));
    const stats = (isWrapped ? (result as EngineResult<T>).stats ?? {} : {}) as EngineStats;
    const runtime = Date.now() - t0;
    const finalStatus = stats.outcome === "negative" ? "completed_negative" : "completed";
    const telemetry = summarizeScope(scope);
    const mergedMeta: Record<string, unknown> = { ...(stats.meta ?? {}) };
    if (stats.determinism) mergedMeta.determinism = stats.determinism;
    if (telemetry.totalCalls > 0) {
      mergedMeta.telemetry = {
        run_id: scope.runId,
        trace_id: scope.traceId,
        total_calls: telemetry.totalCalls,
        success_calls: telemetry.successCalls,
        failed_calls: telemetry.failedCalls,
        retry_count: telemetry.retryCount,
        retry_reasons: telemetry.retryReasons,
        provider_request_ids: telemetry.providerRequestIds,
        fell_back_from: telemetry.fellBackFrom,
        errors: telemetry.errors,
        calls: telemetry.calls,
      };
    }
    const { error: updErr } = await db.from("pipeline_engine_runs").update({
      status: finalStatus,
      ended_at: new Date().toISOString(),
      runtime_ms: runtime,
      generated: stats.generated ?? 0,
      accepted: stats.accepted ?? 0,
      rejected: stats.rejected ?? 0,
      suppressed_ess: stats.suppressed_ess ?? 0,
      suppressed_validator: stats.suppressed_validator ?? 0,
      provider: stats.provider ?? telemetry.provider ?? null,
      model: stats.model ?? telemetry.model ?? null,
      prompt_version: stats.prompt_version ?? null,
      tokens_in: stats.tokens_in ?? telemetry.tokensIn ?? 0,
      tokens_out: stats.tokens_out ?? telemetry.tokensOut ?? 0,
      retry_count: (stats.retry_count ?? 0) + telemetry.retryCount,
      cost_usd: stats.cost_usd ?? Number(telemetry.costUsd.toFixed(6)) ?? 0,
      rows_written: stats.rows_written ?? null,
      db_write_confirmed: stats.db_write_confirmed ?? true,
      meta: mergedMeta as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).eq("id", id);
    if (updErr) {
      throw new Error(`ledger update failed: ${updErr.message}`);
    }
    terminalWritten = true;
    await emitEvent(db, args.caseId, args.engine, `${labelEngine(args.engine)} ${finalStatus}`, {
      meta: { engine: args.engine, status: finalStatus, runtime_ms: runtime, ...stats },
    });
    return value;

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const runtime = Date.now() - t0;
    if (isCheckpointError(e)) {
      await db.from("pipeline_engine_runs").update({
        status: "queued",
        ended_at: new Date().toISOString(),
        runtime_ms: runtime,
        error: `Checkpoint — ${e.progress}`.slice(0, 2000),
      }).eq("id", id);
      terminalWritten = true;
      await emitEvent(db, args.caseId, args.engine, `${labelEngine(args.engine)} checkpointed`, {
        level: "warn",
        meta: { engine: args.engine, status: "queued", runtime_ms: runtime, checkpoint: e.progress },
      });
      throw e;
    }
    await db.from("pipeline_engine_runs").update({
      status: "failed",
      ended_at: new Date().toISOString(),
      runtime_ms: runtime,
      error: msg.slice(0, 2000),
    }).eq("id", id);
    terminalWritten = true;
    await emitEvent(db, args.caseId, args.engine, `${labelEngine(args.engine)} failed`, {
      level: "error",
      meta: { engine: args.engine, status: "failed", runtime_ms: runtime, error: msg.slice(0, 2000) },
    });
    throw e;
  } finally {
    // Defense-in-depth: if we somehow exit without writing a terminal state
    // force the row failed so it can never stay `running` forever.
    if (!terminalWritten) {
      try {
        await db.from("pipeline_engine_runs").update({
          status: "failed",
          ended_at: new Date().toISOString(),
          runtime_ms: Date.now() - t0,
          error: "engine exited without writing terminal state",
        }).eq("id", id).eq("status", "running");
      } catch (finalErr) {
        console.warn(`[runEngine] finally cleanup failed for ${args.engine}`, finalErr);
      }
    }
  }
}


/**
 * Record that an engine was prevented from running because one or more
 * upstream engines failed. This is different from `skipped` (deliberate
 * non-run) — `blocked` means we WANTED to run it but couldn't.
 */
export async function recordBlocked(
  db: Db,
  args: {
    caseId: string;
    userId: string;
    engine: EngineName;
    blockingEngines: string[];
    reason?: string;
  },
) {
  const now = new Date().toISOString();
  const reason = args.reason ?? `Upstream failure(s): ${args.blockingEngines.join(", ")}`;
  await db.from("pipeline_engine_runs").insert({
    case_id: args.caseId,
    user_id: args.userId,
    engine: args.engine,
    status: "blocked",
    started_at: now,
    ended_at: now,
    runtime_ms: 0,
    error: reason.slice(0, 2000),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocking_engines: args.blockingEngines,
    dependency_status: "upstream_failed",
  } as never);
  await emitEvent(db, args.caseId, args.engine, `${labelEngine(args.engine)} blocked`, {
    level: "warn",
    meta: {
      engine: args.engine,
      status: "blocked",
      blocking_engines: args.blockingEngines,
      reason,
    },
  });
}

/** Record an engine that was deliberately not run (e.g. case-type gated). */
export async function recordSkipped(
  db: Db,
  args: { caseId: string; userId: string; engine: EngineName; reason: string },
) {
  const now = new Date().toISOString();
  await db.from("pipeline_engine_runs").insert({
    case_id: args.caseId,
    user_id: args.userId,
    engine: args.engine,
    status: "skipped",
    started_at: now,
    ended_at: now,
    runtime_ms: 0,
    skipped_reason: args.reason,
  });
  await emitEvent(db, args.caseId, args.engine, `${labelEngine(args.engine)} skipped`, {
    level: "warn",
    meta: { engine: args.engine, status: "skipped", reason: args.reason },
  });
}

/** Clear any prior run rows for a case before a fresh pipeline pass. */
export async function clearEngineRuns(db: Db, caseId: string) {
  await db.from("pipeline_engine_runs").delete().eq("case_id", caseId);
}

/** Build a compact summary keyed by engine name for embedding in reports. */
export async function buildEnginesSummary(db: Db, caseId: string) {
  const { data } = await db
    .from("pipeline_engine_runs")
    .select("engine,status,runtime_ms,generated,accepted,rejected,suppressed_ess,suppressed_validator,skipped_reason,error,started_at,ended_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const out: Record<string, unknown> = {};
  for (const row of data ?? []) {
    // Last-wins so a successful re-run overwrites prior failure.
    out[row.engine] = row;
  }
  return out;
}
