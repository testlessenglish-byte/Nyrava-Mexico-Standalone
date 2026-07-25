// ============================================================================
// CANONICAL REPORT CONTEXT
//
// Fixes cross-chunk narrative duplication in report generation. The report
// used to be produced by three parallel, mutually-blind LLM calls
// (narrative / memo / intelligence), each independently re-deriving the
// executive summary, risk assessment, recommendations, constitutional
// analysis, contradictions, and missing-evidence narrative. That's why the
// final report reads as repetitive — it isn't one report, it's three
// overlapping ones stitched together.
//
// This module is NOT another LLM call. It's a pure extraction step that
// runs after the `narrative` chunk succeeds, and turns its output into a
// small structured object that gets injected into the `memo` and
// `intelligence` prompts so those passes can reference the canonical
// narrative instead of re-generating their own version of it.
//
// Ownership (see Phase 2 of the report refactor):
//   narrative     — owns executive summary, facts/timeline, high-level risk,
//                    primary recommendation candidates. Runs FIRST, alone.
//   memo          — owns legal memorandum / IRAC / motion drafts / discovery
//                    requests / cross-examination / work product. Runs
//                    SECOND, references canonical context, never rewrites it.
//   intelligence  — owns structured findings, scorecards, contradiction
//                    matrix, evidence classifications, citations. Runs
//                    SECOND (parallel with memo), same rule.
//
// This file only builds the context object narrative produces. Final
// recommendation merging across all three passes lives in
// `report-recommendations.ts`, run once all passes are done — narrative
// can't fully own final recommendations because good recommendations
// reference motions/strategy items that memo and intelligence haven't
// generated yet at the point narrative runs.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RecommendationOwner = "narrative" | "memo" | "intelligence";

export interface RecommendationCandidate {
  /** Stable id, derived deterministically from the normalized title so the
   *  same recommendation text always produces the same id across retries. */
  id: string;
  owner: RecommendationOwner;
  title: string;
  reason: string;
  /** canonical_finding_id values this recommendation is grounded in, when known. */
  supportingFindingIds: string[];
  supportingEvidence: string[];
  confidence: number | null;
  expectedImpact: string | null;
  priorityHint: "critical" | "high" | "medium" | "low" | null;
}

export interface CanonicalRiskAssessment {
  score: number | null;
  narrative: string;
  majorContributors: string[];
  weaknesses: string[];
  unknowns: string[];
}

export interface CanonicalReportContext {
  executiveSummary: string;
  primaryIssues: string[];
  recommendations: RecommendationCandidate[];
  riskAssessment: CanonicalRiskAssessment;
  constitutionalIssues: string;
  contradictionSummary: string;
  missingEvidenceSummary: string;
  witnessSummary: string;
  timelineSummary: string;
}

// ----------------------------------------------------------------------------
// Deterministic short hash — same algorithm family already used elsewhere in
// the intelligence layer (canonical-id.ts uses FNV-1a). Reused here so
// recommendation ids are stable across retries/resumes without adding a new
// hashing dependency.
// ----------------------------------------------------------------------------
function fnv1a(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Narrative's `prose.recommendations` field is free-form prose (a bulleted
 * or paragraph narrative, not structured JSON — see `narrativeShape` in
 * pipeline.server.ts). Split it into candidate items so it can participate
 * in the same merge as memo's/intelligence's structured recommendation
 * arrays, without requiring an extra LLM call to restructure it.
 */
export function extractRecommendationCandidatesFromProse(
  prose: string,
  owner: RecommendationOwner = "narrative",
): RecommendationCandidate[] {
  if (!prose || typeof prose !== "string") return [];

  // Split on bullet markers, numbered-list markers, or blank lines. Falls
  // back to sentence-ish splitting if the prose has no list structure.
  let lines = prose
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-•\u2022\*]+/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 0);

  if (lines.length <= 1) {
    lines = prose
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((l) => l.trim())
      .filter((l) => l.length > 20);
  }

  const out: RecommendationCandidate[] = [];
  for (const line of lines) {
    const title = line.length > 140 ? `${line.slice(0, 137)}...` : line;
    const norm = normalizeTitle(title);
    if (!norm) continue;
    out.push({
      id: `rec_${fnv1a(norm)}`,
      owner,
      title,
      reason: line,
      supportingFindingIds: [],
      supportingEvidence: [],
      confidence: null,
      expectedImpact: null,
      priorityHint: null,
    });
  }
  return out;
}

/**
 * Build the canonical report context from the narrative chunk's parsed
 * output. `narrativeParsed` is `chunkParsedByName.narrative` from
 * pipeline.server.ts — the parsed `{ prose: {...} }` object.
 */
export function buildCanonicalReportContext(narrativeParsed: Record<string, any> | null | undefined): CanonicalReportContext {
  const prose = (narrativeParsed?.prose ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  return {
    executiveSummary: str(prose.executive_summary),
    primaryIssues: [], // populated by caller if a structured issues list becomes available
    recommendations: extractRecommendationCandidatesFromProse(str(prose.recommendations), "narrative"),
    riskAssessment: {
      score: null, // filled in later from intelligence.risk_score once that pass completes
      narrative: str(prose.risk_analysis),
      majorContributors: [],
      weaknesses: [],
      unknowns: [],
    },
    constitutionalIssues: str(prose.constitutional_issues),
    contradictionSummary: str(prose.contradiction_report),
    missingEvidenceSummary: str(prose.missing_evidence_report),
    witnessSummary: str(prose.witness_analysis),
    timelineSummary: str(prose.timeline_summary),
  };
}

/**
 * Serialize the canonical context into a compact prompt block for the memo
 * and intelligence passes. Deliberately terse — this is reference material,
 * not something those passes should be quoting back at length. Truncated
 * defensively so a very long narrative pass can't blow the token budget of
 * the passes that come after it.
 */
export function serializeCanonicalContextForPrompt(ctx: CanonicalReportContext): string {
  const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
  const recList = ctx.recommendations
    .slice(0, 12)
    .map((r) => `- [${r.id}] ${r.title}`)
    .join("\n");

  return `CANONICAL REPORT CONTEXT (already established by the narrative pass — DO NOT regenerate or restate these; reference them by id/summary only and add ONLY content in your own lane):

Executive Summary (already written, do not rewrite):
${truncate(ctx.executiveSummary, 1200)}

High-Level Risk (already written, do not rewrite):
${truncate(ctx.riskAssessment.narrative, 800)}

Constitutional Discussion (already written at a high level, do not restate — you may go deeper with citations/authority, but do not re-summarize):
${truncate(ctx.constitutionalIssues, 800)}

Contradiction Summary (already written, do not restate — you may add structured detail, but do not re-narrate):
${truncate(ctx.contradictionSummary, 800)}

Missing Evidence Summary (already written, do not restate):
${truncate(ctx.missingEvidenceSummary, 600)}

Primary Recommendation Candidates already identified (reference by id if you build on one; do not restate its text; ADD new items only if they are genuinely not covered above):
${recList || "(none extracted)"}
`;
}
