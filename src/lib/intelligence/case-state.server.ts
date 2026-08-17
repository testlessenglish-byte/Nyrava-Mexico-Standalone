// ============================================================================
// CASE_STATE — Single source of truth for ALL downstream rendering & analysis.
//
// Per the 3-Mode Architecture spec:
//   PIPELINE FLOW: INGEST → NORMALIZE → ANALYZE → COMMIT TO CASE_STATE → RENDER
//
// Nothing downstream (renderer, scoring view, reports, exports) is allowed to
// infer or compute. They MUST read from this object and format it. This file
// owns the assembly + the citation resolver + the mode policy.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

export type AnalysisMode = "strict" | "balanced" | "exploratory";

export type EngineKey =
  | "extraction"
  | "analyzers"
  | "agents"
  | "scoring"
  | "contradictions"
  | "discovery"
  | "witness"
  | "theory"
  | "opportunity"
  | "trial_prep"
  | "work_product"
  | "strategy"
  | "perspectives"
  | "evidence_intel"
  | "litigation_strategy_center";

// Mode policy — which engines may write to CASE_STATE in each mode.
// STRICT: extraction + validation only (no interpretive layers).
// BALANCED: full pipeline.
// EXPLORATORY: full pipeline, outputs flagged UNVERIFIED.
const ALLOWED: Record<AnalysisMode, Set<EngineKey>> = {
  strict: new Set<EngineKey>([
    "extraction",
    "analyzers",
    "agents",
    "scoring",
    "contradictions",
    "discovery",
    "witness",
  ]),
  balanced: new Set<EngineKey>([
    "extraction",
    "analyzers",
    "agents",
    "scoring",
    "contradictions",
    "discovery",
    "witness",
    "theory",
    "opportunity",
    "trial_prep",
    "work_product",
    "strategy",
    "perspectives",
    "evidence_intel",
    "litigation_strategy_center",
  ]),
  exploratory: new Set<EngineKey>([
    "extraction",
    "analyzers",
    "agents",
    "scoring",
    "contradictions",
    "discovery",
    "witness",
    "theory",
    "opportunity",
    "trial_prep",
    "work_product",
    "strategy",
    "perspectives",
    "evidence_intel",
    "litigation_strategy_center",
  ]),
};

export function engineAllowedInMode(engine: EngineKey, mode: AnalysisMode): boolean {
  return ALLOWED[mode].has(engine);
}

/**
 * Raise a deterministic skip-signal so callers can record a stage as SKIPPED
 * (not failed, not silently complete).
 */
export class StageSkippedError extends Error {
  readonly engine: EngineKey;
  readonly mode: AnalysisMode;
  constructor(engine: EngineKey, mode: AnalysisMode) {
    super(`[mode:${mode}] engine "${engine}" is not allowed in this mode`);
    this.name = "StageSkippedError";
    this.engine = engine;
    this.mode = mode;
  }
}

export function assertEngineAllowed(engine: EngineKey, mode: AnalysisMode): void {
  if (!engineAllowedInMode(engine, mode)) throw new StageSkippedError(engine, mode);
}

// ----------------------------------------------------------------------------
// CASE_STATE assembler
// ----------------------------------------------------------------------------
export type CaseStateDoc = { id: string; filename: string; status: string | null };
export type CaseState = {
  case_id: string;
  case_type: string | null;
  analysis_mode: AnalysisMode;
  documents: CaseStateDoc[];
  findings: Array<Record<string, unknown>>;
  contradictions: Array<Record<string, unknown>>;
  witnesses: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  theories: Array<Record<string, unknown>>;
  trial_prep: Array<Record<string, unknown>>;
  work_product: Array<Record<string, unknown>>;
  scores: Record<string, unknown> | null;
  pipeline_status: {
    ingestion_complete: boolean;
    analysis_complete: boolean;
    strict_complete: boolean;
    balanced_complete: boolean;
    exploratory_complete: boolean;
  };
  citation_resolver: Record<string, string>; // doc_id → filename
};

export async function buildCaseState(db: SupabaseClient<Database>, caseId: string): Promise<CaseState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [c, docs, findings, scores, witnesses, opps, theories, trial, wp] = await Promise.all([
    db.from("cases").select("*").eq("id", caseId).maybeSingle(),
    db.from("documents").select("id,filename,status").eq("case_id", caseId).order("created_at", { ascending: true }),
    db.from("case_findings").select("*").eq("case_id", caseId).not("source_module", "like", PROJECTION_LIKE),
    db.from("case_scores").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("case_witnesses").select("*").eq("case_id", caseId),
    db.from("case_opportunities").select("*").eq("case_id", caseId),
    db.from("case_theories").select("*").eq("case_id", caseId),
    db.from("case_trial_prep").select("*").eq("case_id", caseId),
    db.from("case_work_product").select("*").eq("case_id", caseId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caseRow = (c.data ?? {}) as any;
  const mode: AnalysisMode =
    caseRow.analysis_mode === "balanced" || caseRow.analysis_mode === "exploratory" ? caseRow.analysis_mode : "strict";

  const allFindings = (findings.data ?? []) as Array<Record<string, unknown>>;
  const contradictions = allFindings.filter((f) => String(f.category ?? "").toLowerCase() === "contradiction");

  const documents: CaseStateDoc[] = (docs.data ?? []).map((d) => ({
    id: d.id as string,
    filename: d.filename,
    status: d.status,
  }));
  const resolver: Record<string, string> = {};
  for (const d of documents) resolver[d.id] = d.filename;

  return {
    case_id: caseId,
    case_type: caseRow.case_type ?? null,
    analysis_mode: mode,
    documents,
    findings: allFindings,
    contradictions,
    witnesses: (witnesses.data ?? []) as Array<Record<string, unknown>>,
    opportunities: (opps.data ?? []) as Array<Record<string, unknown>>,
    theories: (theories.data ?? []) as Array<Record<string, unknown>>,
    trial_prep: (trial.data ?? []) as Array<Record<string, unknown>>,
    work_product: (wp.data ?? []) as Array<Record<string, unknown>>,
    scores: (scores.data ?? null) as Record<string, unknown> | null,
    pipeline_status: {
      ingestion_complete: !!caseRow.extracted_at || !!caseRow.uploaded_at,
      analysis_complete: !!caseRow.analyzed_at,
      strict_complete: mode === "strict" && !!caseRow.scored_at,
      balanced_complete: mode === "balanced" && !!caseRow.work_product_at,
      exploratory_complete: mode === "exploratory" && !!caseRow.work_product_at,
    },
    citation_resolver: resolver,
  };
}

/**
 * Canonical citation resolver. Replaces raw UUIDs in any text/object with the
 * filename of the document. Renderer MUST use this — never raw UUIDs.
 */
export function resolveCitation(state: CaseState, docId: string | null | undefined): string | null {
  if (!docId) return null;
  return state.citation_resolver[docId] ?? null;
}

export function resolveCitationsInText(state: CaseState, text: string): string {
  if (!text) return text;
  // UUID v4-ish pattern
  return text.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (m) => state.citation_resolver[m.toLowerCase()] ?? state.citation_resolver[m] ?? m,
  );
}

// ----------------------------------------------------------------------------
// Score-delta / MODEL_DISAGREEMENT helper
// ----------------------------------------------------------------------------
export const SCORE_DISAGREEMENT_THRESHOLD = 20; // points (0..100 scale)

export function computeScoreDelta(
  deterministic: Record<string, { score?: number | null } | undefined>,
  llm: Record<string, { score?: number | null } | undefined> | null | undefined,
): { deltas: Record<string, number>; disagreement: boolean; max_delta: number } {
  const deltas: Record<string, number> = {};
  let max = 0;
  if (!llm) return { deltas, disagreement: false, max_delta: 0 };
  for (const k of Object.keys(deterministic)) {
    const d = Number(deterministic[k]?.score ?? NaN);
    const l = Number(llm[k]?.score ?? NaN);
    if (!Number.isFinite(d) || !Number.isFinite(l)) continue;
    const diff = Math.abs(d - l);
    deltas[k] = diff;
    if (diff > max) max = diff;
  }
  return { deltas, disagreement: max >= SCORE_DISAGREEMENT_THRESHOLD, max_delta: max };
}

/**
 * Canonical Reconciliation Design (2026-08-16), P2 §10 — same mechanism as
 * computeScoreDelta above (deterministic-authoritative, LLM-comparison-only,
 * SCORE_DISAGREEMENT_THRESHOLD-gated), applied to the report-writer's
 * top-level case_strength_score instead of a per-dimension breakdown. Pulled
 * out as its own pure function (rather than inlined in pipeline.server.ts)
 * so the threshold math is unit-testable without the surrounding runReport
 * machinery.
 */
export function computeCaseStrengthDisagreement(
  llmScore: number | null | undefined,
  deterministicDimensionScores: ReadonlyArray<number>,
): { deterministic: number | null; delta: number | null; disagreement: boolean } {
  if (deterministicDimensionScores.length === 0 || typeof llmScore !== "number" || !Number.isFinite(llmScore)) {
    return { deterministic: null, delta: null, disagreement: false };
  }
  const deterministic =
    deterministicDimensionScores.reduce((a, b) => a + b, 0) / deterministicDimensionScores.length;
  const delta = Math.abs(llmScore - deterministic);
  return { deterministic, delta, disagreement: delta >= SCORE_DISAGREEMENT_THRESHOLD };
}

/**
 * FIX (2026-08-17): computeCaseStrengthDisagreement's flag was informational
 * only — pipeline.server.ts kept persisting the raw, self-reported LLM
 * case_strength_score regardless, so score_consistency's MODEL_DISAGREEMENT
 * flag (never read by any UI/export renderer) caught the exact disagreement
 * this fixes but nothing acted on it. Confirmed live: the same report's
 * case_strength_score (70), case_scores.case_quality (76), and
 * case_scores.overall_confidence (86) all disagreed with each other with no
 * reconciliation. This makes the deterministic mean authoritative — the
 * same "deterministic overrides LLM" rule every other scorecard number in
 * this codebase already follows — falling back to the raw LLM value only
 * when there is no deterministic score to compare against at all (e.g. zero
 * findings), and passing through `null` unchanged so modo LIMITADO's score
 * suppression (gatedScore in pipeline.server.ts) is never overridden.
 */
export function reconcileCaseStrengthScore(
  llmScoreOrNull: number | null,
  deterministic: number | null,
): number | null {
  if (llmScoreOrNull === null) return null;
  if (typeof deterministic !== "number" || !Number.isFinite(deterministic)) return llmScoreOrNull;
  return Math.round(deterministic);
}
