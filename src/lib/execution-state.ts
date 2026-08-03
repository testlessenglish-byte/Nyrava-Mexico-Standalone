// =============================================================================
// DEPRECATED — this module is a thin re-export shim for the canonical
// execution architecture. All implementation lives in
// `src/lib/execution/canonical.ts`. Import from there in new code.
//
// This file exists only so existing imports resolve; there is a single
// implementation of every symbol below.
// =============================================================================
export {
  type ExecutionStatus,
  type ExecutionRow,
  type StageState,
  CANONICAL_STAGES,
  STAGE_BY_KEY,
  STAGE_BY_ENGINE,
  STAGE_KEYS,
  ENGINE_ORDER as PIPELINE_ENGINE_ORDER,
  ENGINE_ORDER,
  PIPELINE_STAGE_TO_ENGINE,
  COMMAND_CENTER_ENGINES,
  REPORT_BLOCKING_ENGINES,
  REPORT_ENRICHING_ENGINES,
  REPORT_REQUIRED_ENGINES,
  ENGINE_TIMESTAMP_FALLBACK,
  latestRowsByEngine,
  deriveStageState,
  computeStageViews,
  computeProgress,
  completedPipelineStageCount,
  pipelineProgressPercent,
  canGenerateReport,
  missingRequiredEngines,
} from "@/lib/execution/canonical";

