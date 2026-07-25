// Canonical client-side execution hook. Every UI panel reads from here so
// every screen displays identical execution state.
//
// - ONE query key per case: ['case-execution', caseId]
// - ONE Supabase realtime channel per case, subscribed to
//   `pipeline_engine_runs` filtered by case_id
// - Status derivation delegated to `src/lib/execution/canonical.ts`
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  type ExecutionRow,
  type StageView,
  type ProgressSnapshot,
  type ReportGate,
  CANONICAL_STAGES,
  computeStageViews,
  computeProgress,
  canGenerateReport,
  latestRowsByEngine,
} from "@/lib/execution/canonical";

const RUN_COLUMNS =
  "id,engine,status,runtime_ms,generated,accepted,rejected,suppressed_ess,suppressed_validator,skipped_reason,error,started_at,ended_at,created_at,meta";

async function fetchRuns(caseId: string): Promise<ExecutionRow[]> {
  const { data, error } = await supabase
    .from("pipeline_engine_runs")
    .select(RUN_COLUMNS)
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ExecutionRow[];
}

export type UseCaseExecutionResult = {
  runs: ExecutionRow[];
  stages: StageView[];
  latestByEngine: Map<string, ExecutionRow>;
  progress: ProgressSnapshot;
  reportGate: ReportGate;
  isRunning: boolean;
  isLoading: boolean;
  refresh: () => void;
};

export function useCaseExecution(caseId: string | null | undefined): UseCaseExecutionResult {
  const queryClient = useQueryClient();
  const enabled = !!caseId;

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["case-execution", caseId],
    queryFn: () => fetchRuns(caseId!),
    enabled,
    staleTime: 5_000,
  });

  // Single realtime channel per case, shared across every consumer of the hook
  // via TanStack Query cache invalidation.
  useEffect(() => {
    if (!caseId) return;
    // Unique topic per hook instance — Supabase reuses channels by name, and a
    // second consumer of the same case would otherwise get an already-subscribed
    // channel and throw "cannot add postgres_changes callbacks after subscribe()".
    const topic = `case-execution:${caseId}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_engine_runs", filter: `case_id=eq.${caseId}` },
        () => { queryClient.invalidateQueries({ queryKey: ["case-execution", caseId] }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [caseId, queryClient]);

  const stages = useMemo(() => computeStageViews(runs), [runs]);
  const latestByEngine = useMemo(() => latestRowsByEngine(runs), [runs]);
  const progress = useMemo(() => computeProgress(runs), [runs]);
  const reportGate = useMemo(() => canGenerateReport(runs), [runs]);

  return {
    runs,
    stages,
    latestByEngine,
    progress,
    reportGate,
    isRunning: progress.isRunning,
    isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: ["case-execution", caseId] }),
  };
}

// Re-export the canonical stage list so components don't reach past the hook.
export { CANONICAL_STAGES };
