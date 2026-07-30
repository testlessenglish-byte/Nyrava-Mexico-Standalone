// =============================================================================
// CANONICAL EXECUTION ARCHITECTURE — Single source of truth.
//
// Every stage list, engine mapping, status derivation, progress calculation,
// and release gate in the platform lives in this file. NO other file may
// hardcode a stage list, engine name string, or derive execution status from
// case-row `*_at` timestamps.
//
// Read-side:   `pipeline_engine_runs` rows → deriveStageState → StageState
// Write-side:  `runEngine()` in engine-audit.server.ts is the only writer.
//
// UI hook:     `src/hooks/useCaseExecution.ts`
// Server API:  `src/lib/execution/service.server.ts`
// =============================================================================

export type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_negative"
  | "failed"
  | "skipped"
  | "blocked";

export type ExecutionRow = {
  id: string;
  engine: string;
  status: ExecutionStatus | (string & {});
  started_at: string | null;
  ended_at: string | null;
  created_at?: string | null;
  runtime_ms?: number | null;
  generated?: number | null;
  accepted?: number | null;
  rejected?: number | null;
  suppressed_ess?: number | null;
  suppressed_validator?: number | null;
  skipped_reason?: string | null;
  error?: string | null;
  meta?: Record<string, unknown> | null;
  // Phase 1 ledger fields — populated best-effort by callers.
  provider?: string | null;
  model?: string | null;
  prompt_version?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  retry_count?: number | null;
  cost_usd?: number | null;
  db_write_confirmed?: boolean | null;
  rows_written?: number | null;
  parent_engine?: string | null;
  blocking_engines?: string[] | null;
  dependency_status?: string | null;
};

export type StageState = "locked" | "waiting" | "running" | "complete" | "failed" | "skipped" | "blocked";

/**
 * Report requirement classification.
 *   blocking  — report cannot be assembled without this engine
 *   enriching — feeds sections; empty/failed is downgraded to partial coverage
 *   optional  — decorative; never blocks
 */
export type RequirementLevel = "blocking" | "enriching" | "optional";

export type StageDef = {
  /** UI/URL identifier. Stable across the platform. */
  readonly key: string;
  /** Human label shown in every panel. */
  readonly label: string;
  /** Engine name written to `pipeline_engine_runs.engine`. */
  readonly engine: string;
  /** Legacy `cases.*_at` timestamp column used ONLY for one-time backfill. */
  readonly timestampColumn?: string;
  /** Upstream stage keys this stage depends on. */
  readonly dependsOn: readonly string[];
  /** Report requirement level. */
  readonly requirement: RequirementLevel;
  /**
   * Hard wall-clock ceiling for this stage, in milliseconds. Enforced by
   * `withStageTimeout()` in `blocking-stage-guard.server.ts`. A stage that
   * exceeds it is aborted and recorded as FAILED — it never hangs the run.
   * Only set on stages that can block the report.
   */
  readonly timeoutMs?: number;
};


// -----------------------------------------------------------------------------
// THE canonical stage list. Order == execution order == UI display order.
// -----------------------------------------------------------------------------
export const CANONICAL_STAGES: readonly StageDef[] = [
  {
    key: "extraction",
    label: "Extraction",
    engine: "extraction",
    timestampColumn: "extracted_at",
    dependsOn: [],
    requirement: "blocking",
  },
  {
    key: "analyzers",
    label: "Analyzers",
    engine: "analyzers",
    timestampColumn: "analysis_at",
    dependsOn: ["extraction"],
    requirement: "blocking",
  },
  {
    key: "agents",
    label: "Agents",
    engine: "agents",
    timestampColumn: "agents_at",
    dependsOn: ["extraction", "analyzers"],
    requirement: "blocking",
  },
  { key: "timeline", label: "Build Timeline", engine: "timeline", dependsOn: ["extraction"], requirement: "enriching" },
  {
    key: "evidence_map",
    label: "Evidence Mapping",
    engine: "evidence_map",
    dependsOn: ["extraction"],
    requirement: "enriching",
  },
  {
    key: "contradictions",
    label: "Contradiction Analysis",
    engine: "contradictions",
    timestampColumn: "contradiction_at",
    dependsOn: ["analyzers"],
    requirement: "enriching",
  },
  {
    key: "witness",
    label: "Witness Intelligence",
    engine: "witness_intelligence",
    timestampColumn: "witnesses_at",
    dependsOn: ["analyzers", "agents"],
    requirement: "enriching",
  },
  {
    key: "evidence_intel",
    label: "Evidence Intelligence",
    engine: "evidence_intelligence",
    timestampColumn: "evidence_intel_at",
    dependsOn: ["analyzers"],
    requirement: "enriching",
  },
  {
    // Resolves país / entidad federativa / fuero / materia and the codes that
    // actually govern the matter. Runs right after the analyzers so every
    // downstream engine reasons against the correct body of Mexican law.
    key: "jurisdiction_intel",
    label: "Jurisdiction Intelligence",
    engine: "jurisdiction_intel",
    dependsOn: ["analyzers"],
    requirement: "blocking",
    // Deterministic + a small corpus read. Anything past 2 min is a hang.
    timeoutMs: 120_000,
  },

  {
    // Materia-specific procedural checklist (plazos, actos, formalidades).
    key: "procedural_compliance",
    label: "Procedural Compliance Analysis",
    engine: "procedural_compliance",
    dependsOn: ["analyzers", "jurisdiction_intel"],
    requirement: "enriching",
  },
  {
    key: "constitutional",
    label: "Constitutional Analysis",
    engine: "constitutional_compliance",
    dependsOn: ["analyzers"],
    requirement: "enriching",
  },
  {
    key: "discovery",
    label: "Discovery Gap Detection",
    engine: "discovery_gaps",
    timestampColumn: "discovery_at",
    dependsOn: ["analyzers"],
    requirement: "enriching",
  },
  {
    key: "perspectives",
    label: "Multi-Perspective Analysis",
    engine: "perspectives",
    timestampColumn: "perspectives_at",
    dependsOn: ["analyzers", "agents"],
    requirement: "optional",
  },
  {
    key: "theories",
    label: "Theory Generation",
    engine: "theory",
    timestampColumn: "theories_at",
    dependsOn: ["perspectives"],
    requirement: "optional",
  },
  {
    key: "opportunities",
    label: "Case Opportunities",
    engine: "opportunity",
    timestampColumn: "opportunities_at",
    dependsOn: ["analyzers", "agents"],
    requirement: "optional",
  },
  {
    key: "trial_prep",
    label: "Trial Prep & Jury Simulation",
    engine: "trial_prep",
    timestampColumn: "trial_prep_at",
    dependsOn: ["analyzers", "agents"],
    requirement: "optional",
  },
  {
    key: "strategy",
    label: "Strategy Synthesis",
    engine: "strategy",
    timestampColumn: "strategy_at",
    dependsOn: ["perspectives", "theories"],
    requirement: "optional",
  },
  {
    key: "litigation_strategy_center",
    label: "Litigation Strategy Center",
    engine: "litigation_strategy_center",
    timestampColumn: "strategy_center_at",
    // Synthesis-only — reads the already-gated output of these stages and
    // doesn't touch the corpus itself. Runs after strategy so it can
    // summarize it too.
    dependsOn: ["theories", "opportunities", "witness", "strategy"],
    requirement: "optional",
  },
  {
    key: "work_product",
    label: "Attorney Work Product",
    engine: "work_product",
    timestampColumn: "work_product_at",
    dependsOn: ["strategy"],
    requirement: "optional",
  },
  {
    key: "hallucination",
    label: "Hallucination Review",
    engine: "hallucination",
    timestampColumn: "hallucination_at",
    dependsOn: ["analyzers", "agents"],
    requirement: "optional",
  },
  {
    key: "scoring",
    label: "Score Case",
    engine: "scoring",
    timestampColumn: "scored_at",
    dependsOn: ["analyzers", "agents"],
    requirement: "blocking",
  },
  {
    // Control de Calidad Jurídica — terminal gate. Remediates US/common-law
    // terminology and invalid party roles in persisted engine output, then
    // audits it. A surviving blocking violation fails this stage, which blocks
    // `report`: a defective report is never silently published.
    key: "legal_qa",
    label: "Legal Quality Control",
    engine: "legal_qa",
    dependsOn: ["scoring", "analyzers", "agents"],
    requirement: "blocking",
  },
  {
    key: "report",
    label: "Generate Report",
    engine: "report_generator",
    timestampColumn: "report_at",
    // FIX (2026-07-29): jurisdiction_intel is requirement:"blocking" (so
    // canGenerateReport() already correctly refuses to generate without
    // it) but wasn't reachable from this list, and nothing upstream of
    // scoring/legal_qa/analyzers/agents depends on it either. That meant
    // deriveStageState() could show this stage as "waiting" (ready to
    // run) purely from those four completing, while the real server-side
    // gate still correctly blocked report generation on jurisdiction_intel
    // — a misleading UI state, not a data-correctness bug (the actual
    // gate was always right), but confusing to anyone watching the
    // pipeline. Added so the UI and the real gate agree.
    dependsOn: ["scoring", "legal_qa", "analyzers", "agents", "jurisdiction_intel"],
    requirement: "blocking",
  },
  {
    key: "multi_agent",
    label: "Multi-Agent Review (13 Agents)",
    engine: "multi_agent",
    dependsOn: ["report"],
    requirement: "optional",
  },
] as const;

// Derived indexes — DO NOT rebuild these elsewhere.
export const STAGE_BY_KEY: ReadonlyMap<string, StageDef> = new Map(CANONICAL_STAGES.map((s) => [s.key, s]));
export const STAGE_BY_ENGINE: ReadonlyMap<string, StageDef> = new Map(CANONICAL_STAGES.map((s) => [s.engine, s]));
export const STAGE_KEYS: readonly string[] = CANONICAL_STAGES.map((s) => s.key);
export const ENGINE_ORDER: readonly string[] = CANONICAL_STAGES.map((s) => s.engine);
export const PIPELINE_STAGE_TO_ENGINE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CANONICAL_STAGES.map((s) => [s.key, s.engine])),
);

// NOTE: the report stage itself is deliberately excluded here. `report_generator`
// is the consumer of this gate, not a precondition for itself — including it
// would make the pre-flight check permanently unsatisfiable (it can only
// become "completed" after it has already run).
export const REPORT_BLOCKING_ENGINES: readonly string[] = CANONICAL_STAGES.filter(
  (s) => s.requirement === "blocking" && s.engine !== "report_generator",
).map((s) => s.engine);

export const REPORT_ENRICHING_ENGINES: readonly string[] = CANONICAL_STAGES.filter(
  (s) => s.requirement === "enriching",
).map((s) => s.engine);

/** All engines the report gate considers (blocking + enriching). */
export const REPORT_REQUIRED_ENGINES: readonly string[] = [...REPORT_BLOCKING_ENGINES, ...REPORT_ENRICHING_ENGINES];

/** Subset the Command Center dashboard summarizes. Same list — kept for API compat. */
export const COMMAND_CENTER_ENGINES: readonly string[] = REPORT_REQUIRED_ENGINES;

/** Legacy timestamp column → engine map used ONLY by the backfill migration. */
export const ENGINE_TIMESTAMP_FALLBACK: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    CANONICAL_STAGES.filter((s) => s.timestampColumn).map((s) => [s.engine, s.timestampColumn as string]),
  ),
);

// -----------------------------------------------------------------------------
// Row selection — most-recent row per engine wins.
// -----------------------------------------------------------------------------
const STATUS_RANK: Record<ExecutionStatus, number> = {
  queued: 1,
  running: 2,
  blocked: 3,
  failed: 4,
  skipped: 5,
  completed_negative: 6,
  completed: 7,
};

export function latestRowsByEngine<T extends ExecutionRow>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const prev = map.get(row.engine);
    if (!prev) {
      map.set(row.engine, row);
      continue;
    }
    const prevTime = new Date(prev.created_at ?? prev.started_at ?? 0).getTime();
    const rowTime = new Date(row.created_at ?? row.started_at ?? 0).getTime();
    const prevRank = STATUS_RANK[prev.status as ExecutionStatus] ?? 0;
    const rowRank = STATUS_RANK[row.status as ExecutionStatus] ?? 0;
    if (rowTime > prevTime || (rowTime === prevTime && rowRank >= prevRank)) {
      map.set(row.engine, row);
    }
  }
  return map;
}

// -----------------------------------------------------------------------------
// Status derivation — the ONLY function that maps engine rows → StageState.
// -----------------------------------------------------------------------------
export function deriveStageState(
  stageKey: string,
  latest: ReadonlyMap<string, ExecutionRow>,
  upstreamStates?: ReadonlyMap<string, StageState>,
): StageState {
  const stage = STAGE_BY_KEY.get(stageKey);
  if (!stage) return "locked";
  const row = latest.get(stage.engine);
  if (row) {
    switch (row.status) {
      case "completed":
        return "complete";
      // Legitimate negative outcomes (Judge reject, QA no-findings, thin-evidence
      // hallucination gate) are complete for pipeline purposes — not failures.
      case "completed_negative":
        return "complete";
      case "running":
        return "running";
      case "failed":
        return "failed";
      case "skipped":
        return "skipped";
      case "blocked":
        return "blocked";
      case "queued":
        return "waiting";
    }
  }

  // No row yet. Propagate upstream failure/blocked as "blocked"; show
  // `waiting` if all upstreams are complete/skipped, otherwise `locked`.
  if (upstreamStates && stage.dependsOn.length > 0) {
    const upstreamStatuses = stage.dependsOn.map((dep) => upstreamStates.get(dep));
    if (upstreamStatuses.some((s) => s === "failed" || s === "blocked")) {
      return "blocked";
    }
    const allReady = upstreamStatuses.every((s) => s === "complete" || s === "skipped");
    return allReady ? "waiting" : "locked";
  }
  return stage.dependsOn.length === 0 ? "waiting" : "locked";
}

export type StageView = {
  key: string;
  label: string;
  engine: string;
  state: StageState;
  row: ExecutionRow | null;
  requirement: RequirementLevel;
  dependsOn: readonly string[];
};

/** Compute every stage's current view. Used by every UI panel. */
export function computeStageViews(rows: ExecutionRow[]): StageView[] {
  const latest = latestRowsByEngine(rows);
  const stateByKey = new Map<string, StageState>();
  const out: StageView[] = [];
  for (const stage of CANONICAL_STAGES) {
    const state = deriveStageState(stage.key, latest, stateByKey);
    stateByKey.set(stage.key, state);
    out.push({
      key: stage.key,
      label: stage.label,
      engine: stage.engine,
      state,
      row: latest.get(stage.engine) ?? null,
      requirement: stage.requirement,
      dependsOn: stage.dependsOn,
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Progress — the ONLY progress calculation.
// -----------------------------------------------------------------------------
export type ProgressSnapshot = {
  completedStages: number;
  totalStages: number;
  percent: number;
  isRunning: boolean;
  hasFailures: boolean;
  missingBlocking: string[];
};

export function computeProgress(rows: ExecutionRow[]): ProgressSnapshot {
  const views = computeStageViews(rows);
  // Multi-agent is optional/parallel; keep out of the primary progress bar.
  const pipeline = views.filter((v) => v.key !== "multi_agent");
  const done = pipeline.filter((v) => v.state === "complete" || v.state === "skipped").length;
  const total = pipeline.length;
  const running = pipeline.some((v) => v.state === "running");
  const failed = pipeline.some((v) => v.state === "failed" || v.state === "blocked");
  const missingBlocking = pipeline
    .filter((v) => v.requirement === "blocking" && v.state !== "complete" && v.state !== "skipped")
    .map((v) => v.engine);
  return {
    completedStages: done,
    totalStages: total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    isRunning: running,
    hasFailures: failed,
    missingBlocking,
  };
}

export function completedPipelineStageCount(rows: ExecutionRow[]): number {
  return computeProgress(rows).completedStages;
}

export function pipelineProgressPercent(rows: ExecutionRow[]): number {
  return computeProgress(rows).percent;
}

// -----------------------------------------------------------------------------
// Report gate — the ONLY report-generation gate.
// -----------------------------------------------------------------------------
export type ReportGate = {
  ok: boolean;
  missingBlocking: string[];
  missingEnriching: string[];
};

export function canGenerateReport(rows: ExecutionRow[]): ReportGate {
  const latest = latestRowsByEngine(rows);
  const missing = (engines: readonly string[]) =>
    engines.filter((e) => {
      const s = latest.get(e)?.status;
      return s !== "completed" && s !== "completed_negative" && s !== "skipped";
    });
  const blocking = missing(REPORT_BLOCKING_ENGINES);
  return {
    ok: blocking.length === 0,
    missingBlocking: blocking,
    missingEnriching: missing(REPORT_ENRICHING_ENGINES),
  };
}

/** Back-compat with legacy call sites. `required` defaults to full report set. */
export function missingRequiredEngines(
  rows: ExecutionRow[],
  required: readonly string[] = REPORT_REQUIRED_ENGINES,
): string[] {
  const latest = latestRowsByEngine(rows);
  return required.filter((e) => {
    const s = latest.get(e)?.status;
    return s !== "completed" && s !== "completed_negative" && s !== "skipped";
  });
}
