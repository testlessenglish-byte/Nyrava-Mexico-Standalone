// ============================================================================
// CASE_STATE — shared canonical case intelligence for downstream consumers.
//
// PIPELINE FLOW: INGEST → NORMALIZE → ANALYZE → RECONCILE → CASE_STATE → RENDER
//
// Downstream consumers must use reconciled findings and the persisted stage
// state exposed here rather than rebuilding their own competing interpretation.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  PROJECTION_LIKE,
  isCanonicalFinding,
  type SelectableFinding,
} from "@/lib/intelligence/finding-selection";
import { consolidateFindings } from "@/lib/intelligence/finding-dedupe";

// `strict`, `balanced`, and `exploratory` are accepted only as historical
// storage/input aliases. Runtime behavior is always the single verified mode.
export type AnalysisMode = "verified" | "strict" | "balanced" | "exploratory";

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
 * There is one verified pipeline. Historical mode tokens must never gate an
 * engine. Evidence reliability is enforced by reconciliation, citations,
 * hallucination/QA/Judge gates, and procedural-posture rules.
 */
export function engineAllowedInMode(_engine: EngineKey, _mode: AnalysisMode): boolean {
  return true;
}

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

// Compatibility export for callers that still invoke the old guard. With one
// verified pipeline this intentionally never throws.
export function assertEngineAllowed(_engine: EngineKey, _mode: AnalysisMode): void {}

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
    verified_complete: boolean;
    // Compatibility aliases for older UI code. They all represent the same
    // verified scoring completion state and must not fork behavior.
    strict_complete: boolean;
    balanced_complete: boolean;
    exploratory_complete: boolean;
  };
  citation_resolver: Record<string, string>;
};

export async function buildCaseState(db: SupabaseClient<Database>, caseId: string): Promise<CaseState> {
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

  // Runtime case-state is always unified. We deliberately do not echo the
  // retired DB token back into downstream decision logic.
  const mode: AnalysisMode = "verified";

  // Apply the same reconciliation/dedupe policy before any workspace, report,
  // scoring, or Talk-to-Case consumer sees the findings.
  const rawFindings = (findings.data ?? []) as Array<Record<string, unknown>>;
  const deduped = consolidateFindings(rawFindings) as typeof rawFindings;
  const canonicalFindings = deduped.filter((f) =>
    isCanonicalFinding(f as unknown as SelectableFinding),
  );
  const allFindings = canonicalFindings.length > 0 ? canonicalFindings : deduped;
  const contradictions = allFindings.filter(
    (f) => String(f.category ?? "").toLowerCase() === "contradiction",
  );

  const documents: CaseStateDoc[] = (docs.data ?? []).map((d) => ({
    id: d.id as string,
    filename: d.filename,
    status: d.status,
  }));
  const resolver: Record<string, string> = {};
  for (const d of documents) resolver[d.id] = d.filename;

  // Use the actual live-schema stage fields. The old implementation checked
  // non-existent `uploaded_at`/`analyzed_at` properties, which could report a
  // stage as incomplete after the pipeline had actually finished.
  const ingestionComplete = Boolean(caseRow.extracted_at);
  const analysisComplete = Boolean(caseRow.analysis_at);
  const verifiedComplete = Boolean(caseRow.scored_at);

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
      ingestion_complete: ingestionComplete,
      analysis_complete: analysisComplete,
      verified_complete: verifiedComplete,
      strict_complete: verifiedComplete,
      balanced_complete: verifiedComplete,
      exploratory_complete: verifiedComplete,
    },
    citation_resolver: resolver,
  };
}

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
