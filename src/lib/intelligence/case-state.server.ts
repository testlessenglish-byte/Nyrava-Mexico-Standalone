// ============================================================================
// CASE_STATE — Single source of truth for ALL downstream rendering & analysis.
//
// PIPELINE FLOW: INGEST → NORMALIZE → ANALYZE → COMMIT TO CASE_STATE → RENDER
//
// Nothing downstream (renderer, scoring view, reports, exports) is allowed to
// infer or compute. They MUST read from this object and format it. This file
// owns the assembly + the citation resolver + the legacy mode compatibility
// policy.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

// Legacy persisted values. The product now has one verified-analysis pipeline;
// these strings remain accepted only so existing rows/migrations do not break.
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

/**
 * ONE VERIFIED PIPELINE.
 *
 * Historical strict/balanced/exploratory values must NEVER decide which
 * intelligence engines run. That old policy created a systemic UI failure:
 * cases persisted as `strict` could complete successfully while Strategy,
 * Perspectives, Theories, Opportunities, Trial Prep, Work Product, Evidence
 * Intel and the Strategy Center were deliberately prevented from writing,
 * leaving visible workspace tabs empty and making a complete case appear
 * broken.
 *
 * Evidence reliability is enforced by evidence-gate.server.ts, citation
 * verification, hallucination review and the final release gates. Engine
 * availability is not an evidentiary-strength control. All legacy values are
 * therefore compatibility aliases for the same complete engine set.
 */
const VERIFIED_ENGINE_SET: readonly EngineKey[] = [
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
] as const;

const ALLOWED: Record<AnalysisMode, Set<EngineKey>> = {
  strict: new Set(VERIFIED_ENGINE_SET),
  balanced: new Set(VERIFIED_ENGINE_SET),
  exploratory: new Set(VERIFIED_ENGINE_SET),
};

export function engineAllowedInMode(engine: EngineKey, mode: AnalysisMode): boolean {
  return ALLOWED[mode].has(engine);
}

/**
 * Retained for backward-compatible callers. With the one-pipeline policy this
 * should only fire for an actually unknown engine/mode combination, never for
 * a normal intelligence stage merely because an old case row says "strict".
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
  citation_resolver: Record<string, string>;
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
      strict_complete: !!caseRow.scored_at,
      balanced_complete: !!caseRow.scored_at,
      exploratory_complete: !!caseRow.scored_at,
    },
    citation_resolver: resolver,
  };
}

/** Canonical citation resolver. Renderer MUST use this — never raw UUIDs. */
export function resolveCitation(state: CaseState, docId: string | null | undefined): string | null {
  if (!docId) return null;
  return state.citation_resolver[docId] ?? null;
}

export function resolveCitationsInText(state: CaseState, text: string): string {
  if (!text) return text;
  return text.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    (m) => state.citation_resolver[m.toLowerCase()] ?? state.citation_resolver[m] ?? m,
  );
}

export const SCORE_DISAGREEMENT_THRESHOLD = 20;

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

export function reconcileCaseStrengthScore(
  llmScoreOrNull: number | null,
  deterministic: number | null,
): number | null {
  if (llmScoreOrNull === null) return null;
  if (typeof deterministic !== "number" || !Number.isFinite(deterministic)) return llmScoreOrNull;
  return Math.round(deterministic);
}
