// Server-side canonical execution facade. Every server call site (pipeline
// runner, report gate, orchestrator, background worker) goes through this
// module. Reads exclusively from `pipeline_engine_runs`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  type ExecutionRow,
  type ProgressSnapshot,
  type ReportGate,
  type StageView,
  CANONICAL_STAGES,
  STAGE_BY_KEY,
  computeProgress,
  computeStageViews,
  canGenerateReport,
} from "@/lib/execution/canonical";

type Db = SupabaseClient<Database>;

const RUN_COLUMNS =
  "id,engine,status,runtime_ms,generated,accepted,rejected,suppressed_ess,suppressed_validator,skipped_reason,error,started_at,ended_at,created_at,meta";

export async function loadExecutionRows(db: Db, caseId: string): Promise<ExecutionRow[]> {
  const { data, error } = await db
    .from("pipeline_engine_runs")
    .select(RUN_COLUMNS)
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ExecutionRow[];
}

export async function loadExecutionState(db: Db, caseId: string): Promise<{
  rows: ExecutionRow[];
  stages: StageView[];
  progress: ProgressSnapshot;
  reportGate: ReportGate;
}> {
  const rows = await loadExecutionRows(db, caseId);
  return {
    rows,
    stages: computeStageViews(rows),
    progress: computeProgress(rows),
    reportGate: canGenerateReport(rows),
  };
}

/**
 * Assert every upstream dependency of `stageKey` is complete/skipped.
 * Throws a user-facing Error naming the missing stages.
 */
export async function assertCanRun(db: Db, caseId: string, stageKey: string): Promise<void> {
  const stage = STAGE_BY_KEY.get(stageKey);
  if (!stage || stage.dependsOn.length === 0) return;
  const { stages } = await loadExecutionState(db, caseId);
  const stateByKey = new Map(stages.map((s) => [s.key, s.state]));
  const missing = stage.dependsOn.filter((dep) => {
    const s = stateByKey.get(dep);
    return s !== "complete" && s !== "skipped";
  });
  if (missing.length > 0) {
    const labels = missing.map((k) => STAGE_BY_KEY.get(k)?.label ?? k);
    throw new Error(`Waiting for upstream stages: ${labels.join(", ")}.`);
  }
}


export { CANONICAL_STAGES };
