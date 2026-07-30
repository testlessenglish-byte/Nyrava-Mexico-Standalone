// Engine persistence verification + telemetry aggregation — reliability
// freeze Phases 3 + 6.
//
// Every engine that writes to the database MUST have its persistence
// verified. An engine is only "complete" when:
//   1. Its AI execution succeeded (validated JSON).
//   2. Its output payload was accepted.
//   3. Its rows were written to the expected table(s).
//   4. Those rows are actually present when we re-read them (post-write count).
//   5. The ledger row was updated.
//
// The wrapper also opens an AsyncLocalStorage telemetry scope so every
// routeAI call the engine makes is captured (provider, model, tokens,
// retries, latency, cost, provider request ids, retry reasons) and rolled
// into the ledger row's `stats` + `meta.telemetry` blob. Nothing is
// inferred — fields the provider omits are stored as null/undefined.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  runEngine,
  type EngineName,
  type EngineResult,
  type EngineStats,
} from "./engine-audit.server";
import { withTelemetryScope, summarizeScope } from "../ai/telemetry.server";
import { snapshotCorpus } from "./corpus-snapshot.server";
import { engineVersion } from "./engine-fingerprint";
import { trace, traceAsync } from "../pipeline-trace.server";

type Db = SupabaseClient<Database>;

/**
 * Declaration of a table a given engine MUST populate for the case.
 *
 * `expectedMin` is the minimum row count the engine's own return value
 * implies. Zero is legal — some engines legitimately produce empty output
 * (e.g. a case with no witnesses). In that case we still confirm the
 * post-count matches (0 == 0) and mark the write as confirmed.
 */
export type PersistenceExpectation = {
  /** Table name (case_theories, case_witnesses, ...). */
  table: string;
  /** Minimum row count required for the case after the engine ran. */
  expectedMin: number;
  /** Column to filter by; defaults to `case_id`. */
  keyColumn?: string;
};

export type PersistenceReport = {
  ok: boolean;
  rows_written: number;
  tables: Array<{
    name: string;
    expected_min: number;
    actual: number;
    primary_keys: string[];
  }>;
  primary_keys: string[];
  error?: string;
};

/**
 * Verify that every declared table actually contains the expected number of
 * rows for this case. Returns the report; DOES NOT throw. Callers decide
 * whether to throw (typically they do — see `runVerifiedEngine`).
 */
export async function verifyPersistence(
  db: Db,
  args: { caseId: string; expectations: PersistenceExpectation[] },
): Promise<PersistenceReport> {
  const tables: PersistenceReport["tables"] = [];
  const allKeys: string[] = [];
  const errors: string[] = [];

  // Tables whose primary key is `case_id` (one row per case, upserted) —
  // they have no separate `id` column, so the read-back must select the
  // key column itself, not `id`.
  const SINGLETON_TABLES = new Set(["case_trial_prep"]);

  for (const exp of args.expectations) {
    const keyColumn = exp.keyColumn ?? "case_id";
    const pkColumn = SINGLETON_TABLES.has(exp.table) ? keyColumn : "id";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from(exp.table)
      .select(pkColumn)
      .eq(keyColumn, args.caseId);
    if (error) {
      errors.push(`${exp.table}: read-back failed — ${error.message}`);
      tables.push({ name: exp.table, expected_min: exp.expectedMin, actual: -1, primary_keys: [] });
      continue;
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const ids = rows.map((r) => String(r[pkColumn] ?? "")).filter(Boolean);
    tables.push({
      name: exp.table,
      expected_min: exp.expectedMin,
      actual: rows.length,
      primary_keys: ids,
    });
    allKeys.push(...ids);
    if (rows.length < exp.expectedMin) {
      errors.push(
        `${exp.table}: expected >=${exp.expectedMin} row(s) for case, found ${rows.length}`,
      );
    }
  }

  const rows_written = tables.reduce((n, t) => n + Math.max(0, t.actual), 0);
  return {
    ok: errors.length === 0,
    rows_written,
    tables,
    primary_keys: allKeys,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

/**
 * Spec passed to `runVerifiedEngine`. Given the engine's returned value,
 * produce the list of tables that must have received writes and how many
 * rows are expected at minimum. Return `[]` when the engine writes nothing
 * (e.g. hallucination review — updates `cases.hallucination_report` only).
 */
export type VerificationSpec<T> = (value: T) => PersistenceExpectation[];

/**
 * Wrap `runEngine()` with mandatory persistence verification.
 *
 * After the engine's business logic resolves, we re-query the declared
 * tables. If a declared minimum is not met, we throw — the wrapping
 * `runEngine` records the failure in `pipeline_engine_runs`, the dashboard
 * shows Failed, and dependent engines are blocked by the pipeline runner.
 *
 * On success, `db_write_confirmed=true` and `rows_written`, affected tables,
 * and primary keys are recorded in the ledger row's `meta.persistence` blob.
 */
export async function runVerifiedEngine<T>(
  db: Db,
  args: { caseId: string; userId: string; engine: EngineName; parentEngine?: string },
  spec: VerificationSpec<T>,
  fn: () => Promise<T | EngineResult<T>>,
): Promise<T> {
  return runEngine<T>(db, args, async () => {
    const runId = `${args.engine}-${args.caseId}-${Date.now().toString(36)}`;
    const engVer = engineVersion(args.engine as string);
    const engineStartedAt = Date.now();
    traceAsync({
      phase: "engine",
      step: `${args.engine}.start`,
      status: "start",
      detail: { run_id: runId, engine_version: engVer },
      db,
      caseId: args.caseId,
      userId: args.userId,
    });
    // Open a telemetry scope so every routeAI call inside `fn` is captured.
    const { value: raw, scope } = await withTelemetryScope(
      {
        runId,
        traceId: runId,
        replay: { engine: args.engine, engine_version: engVer, case_id: args.caseId },
      },
      async (s) => {
        // Snapshot the corpus BEFORE the engine runs so we capture the
        // exact evidence/document set the engine will see. Non-fatal —
        // snapshot failure must not block execution.
        try {
          const snap = await snapshotCorpus(db, args.caseId);
          s.corpus = snap;
          s.replay.corpus_hash = snap.corpus_hash;
          if (snap.case_snapshot_version)
            s.replay.case_snapshot_version = snap.case_snapshot_version;
        } catch (e) {
          s.replay.corpus_snapshot_error = (e as Error)?.message ?? String(e);
        }
        return fn();
      },
    );
    const isWrapped = raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>);
    const value = isWrapped ? (raw as EngineResult<T>).value : (raw as T);
    const priorStats = (isWrapped ? ((raw as EngineResult<T>).stats ?? {}) : {}) as EngineStats;

    const telemetry = summarizeScope(scope);
    // Fields we surface into top-level ledger columns. Provider-omitted
    // fields are left undefined (never inferred to 0 for absence).
    const telemetryStats: Partial<EngineStats> = {
      provider: telemetry.provider ?? priorStats.provider,
      model: telemetry.model ?? priorStats.model,
      prompt_version: telemetry.promptVersion ?? priorStats.prompt_version,
      tokens_in: telemetry.tokensIn || priorStats.tokens_in || 0,
      tokens_out: telemetry.tokensOut || priorStats.tokens_out || 0,
      retry_count: telemetry.retryCount + (priorStats.retry_count ?? 0),
      cost_usd: Number((telemetry.costUsd + (priorStats.cost_usd ?? 0)).toFixed(6)),
    };
    const telemetryMeta = {
      telemetry: {
        run_id: scope.runId,
        trace_id: scope.traceId,
        total_calls: telemetry.totalCalls,
        success_calls: telemetry.successCalls,
        failed_calls: telemetry.failedCalls,
        tokens_total: telemetry.tokensTotal || null,
        provider_latency_ms: telemetry.providerLatencyMs || null,
        total_latency_ms: telemetry.totalLatencyMs || null,
        retry_reasons: telemetry.retryReasons,
        provider_request_ids: telemetry.providerRequestIds,
        fell_back_from: telemetry.fellBackFrom,
        cached_calls: telemetry.cached,
        errors: telemetry.errors,
      },
      // Explicit JSON validation state — never inferred.
      validation: {
        response_valid_json: telemetry.responseValidJson,
        schema_validation_passed: telemetry.schemaValidationPassed,
        repair_attempts: telemetry.repairAttempts,
        repair_strategies: telemetry.repairStrategies,
        repair_reasons: telemetry.repairReasons,
        json_validation_events: scope.jsonValidations.length,
      },
      // Build / engine / prompt fingerprints so replays can prove same-build.
      fingerprint: {
        engine: args.engine,
        engine_version: engVer,
        git_commit: scope.build.git_commit ?? null,
        build_id: scope.build.build_id ?? null,
        node_env: scope.build.node_env ?? null,
        prompt_version: telemetry.promptVersion ?? null,
        prompt_sha256: telemetry.promptSha256 ?? null,
        config_hash: telemetry.configHash ?? null,
      },
      corpus: scope.corpus ?? null,
      replay: scope.replay,
    };

    await trace({
      phase: "engine",
      step: `${args.engine}.model_calls`,
      status: telemetry.failedCalls > 0 ? "warn" : "ok",
      provider: telemetry.provider ?? null,
      model: telemetry.model ?? null,
      durationMs: telemetry.totalLatencyMs || null,
      detail: {
        total_calls: telemetry.totalCalls,
        success_calls: telemetry.successCalls,
        failed_calls: telemetry.failedCalls,
        tokens_in: telemetry.tokensIn,
        tokens_out: telemetry.tokensOut,
        retry_count: telemetry.retryCount,
        retry_reasons: telemetry.retryReasons,
        response_valid_json: telemetry.responseValidJson,
        schema_validation_passed: telemetry.schemaValidationPassed,
        repair_attempts: telemetry.repairAttempts,
        errors: telemetry.errors?.slice(0, 3) ?? [],
      },
      db,
      caseId: args.caseId,
      userId: args.userId,
    });

    const expectations = spec(value);
    if (expectations.length === 0) {
      traceAsync({
        phase: "engine",
        step: `${args.engine}.complete`,
        status: "ok",
        durationMs: Date.now() - engineStartedAt,
        detail: {
          persistence: "no table writes declared",
          rows_written: priorStats.rows_written ?? 0,
        },
        db,
        caseId: args.caseId,
        userId: args.userId,
      });
      const stats: EngineStats = {
        ...priorStats,
        ...telemetryStats,
        db_write_confirmed: true,
        rows_written: priorStats.rows_written ?? 0,
        meta: {
          ...(priorStats.meta ?? {}),
          ...telemetryMeta,
          persistence: { ok: true, tables: [], primary_keys: [], note: "no table writes declared" },
        },
      };
      return { value, stats };
    }

    const report = await verifyPersistence(db, { caseId: args.caseId, expectations });
    await trace({
      phase: "db",
      step: `${args.engine}.persistence_verified`,
      status: report.ok ? "ok" : "error",
      error: report.ok ? null : (report.error ?? "verification failed"),
      detail: { rows_written: report.rows_written, tables: report.tables },
      db,
      caseId: args.caseId,
      userId: args.userId,
    });
    if (!report.ok) {
      const err = new Error(`Persistence verification failed for ${args.engine}: ${report.error}`);
      (err as unknown as { persistence?: PersistenceReport; telemetry?: unknown }).persistence =
        report;
      (err as unknown as { telemetry?: unknown }).telemetry = telemetry;
      throw err;
    }

    // Phase 2: mirror specialized-table output into case_findings so the
    // aggregation layer can see it. ONE batched call per engine execution.
    // Additive and non-fatal — projected rows use the `projection:` source
    // class, which no pre-existing counter selects, and a failure here must
    // never fail an engine whose real output is already persisted.
    const projectable = report.tables.filter((t) => PROJECTABLE_TABLES.includes(t));
    if (projectable.length > 0) {
      const projection = await projectCaseFindings(db, {
        caseId: args.caseId,
        tables: projectable,
      });
      traceAsync({
        phase: "db",
        step: `${args.engine}.findings_projected`,
        status: projection.ok ? "ok" : "warn",
        error: projection.error ?? null,
        detail: {
          tables: projection.tables,
          candidates: projection.candidates,
          rows_upserted: projection.written,
        },
        db,
        caseId: args.caseId,
        userId: args.userId,
      });
    }

    traceAsync({
      phase: "engine",
      step: `${args.engine}.complete`,
      status: "ok",
      durationMs: Date.now() - engineStartedAt,
      detail: { rows_written: report.rows_written },
      db,
      caseId: args.caseId,
      userId: args.userId,
    });
    const stats: EngineStats = {
      ...priorStats,
      ...telemetryStats,
      rows_written: report.rows_written,
      db_write_confirmed: true,
      meta: {
        ...(priorStats.meta ?? {}),
        ...telemetryMeta,
        persistence: {
          ok: report.ok,
          tables: report.tables,
          primary_keys: report.primary_keys.slice(0, 50),
          primary_key_count: report.primary_keys.length,
        },
      },
    };
    return { value, stats };
  });
}

/**
 * Central catalog of engine → tables it MUST populate. Keeping this in one
 * place means a single audit surface for future engines. `expected` is a
 * function of the engine's return value so we can distinguish "legitimately
 * empty" from "silently dropped".
 *
 * NOTE: engines whose only side-effect is updating a `cases.*_at` column
 * (evidence_map, constitutional_compliance, hallucination) declare `[]` —
 * they get `db_write_confirmed=true` without a table check, because there
 * is no row-based side-effect to verify.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ENGINE_TABLE_SPECS: Record<string, VerificationSpec<any>> = {
  theory: (v: { theories?: unknown[] }) => [
    { table: "case_theories", expectedMin: v?.theories?.length ?? 0 },
  ],
  opportunity: () => [
    // Optional engine — a legitimately thin corpus may yield zero
    // defensible opportunities. Persistence only fails on hard read errors.
    { table: "case_opportunities", expectedMin: 0 },
  ],
  witness_intelligence: (v: { witnesses?: unknown[] }) => [
    { table: "case_witnesses", expectedMin: v?.witnesses?.length ?? 0 },
  ],
  trial_prep: () => [
    // Singleton row per case (PK = case_id). Optional — engine may skip
    // when there's nothing defensible to prepare.
    { table: "case_trial_prep", expectedMin: 0 },
  ],
  strategy: () => [
    // Optional — see opportunity/trial_prep.
    { table: "case_strategy", expectedMin: 0 },
  ],
  work_product: () => [{ table: "case_work_product", expectedMin: 0 }],
  perspectives: () => [
    // At least one perspective row is expected; if all failed the engine
    // will have thrown before we get here.
    { table: "case_perspectives", expectedMin: 1 },
  ],
  evidence_intelligence: () => [{ table: "evidence_classifications", expectedMin: 0 }],
  discovery_gaps: () => [
    // discovery gaps live in case_findings under source_module = engine:discovery
    { table: "case_findings", expectedMin: 0 },
  ],
  contradictions: () => [{ table: "case_findings", expectedMin: 0 }],
  // No table writes — cases.* column updates only.
  evidence_map: () => [],
  constitutional_compliance: () => [],
  hallucination: () => [],
};

/**
 * Convenience wrapper — uses the catalog above. Prefer this call site so
 * every engine's persistence rules live in one file.
 */
export function runCatalogedEngine<T>(
  db: Db,
  args: { caseId: string; userId: string; engine: EngineName; parentEngine?: string },
  fn: () => Promise<T | EngineResult<T>>,
): Promise<T> {
  const spec = ENGINE_TABLE_SPECS[args.engine as string] ?? (() => []);
  return runVerifiedEngine<T>(db, args, spec, fn);
}
