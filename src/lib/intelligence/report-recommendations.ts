// ============================================================================
// CANONICAL RECOMMENDATIONS MERGE
//
// Before this refactor, "what should the attorney do" was answered up to six
// separate times in one report:
//   narrative.prose.recommendations              (free prose)
//   memo.legal_memorandum.next_actions            (structured)
//   memo.legal_memorandum.recommended_motions     (structured)
//   intelligence.next_actions                     (structured)
//   intelligence.strategy_recommendations         (structured)
//   intelligence.motion_opportunities             (structured)
//
// This module does NOT try to make one generation pass own all of that —
// narrative runs before memo/intelligence exist, so it can't reference their
// motions. Instead, every pass keeps producing its own typed candidates in
// its own lane, and this module runs once ALL THREE passes are done,
// merging + deduplicating them into the single canonical `Recommendation[]`
// the renderer displays. This is pure merge logic — no extra LLM call.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  extractRecommendationCandidatesFromProse,
  type RecommendationCandidate,
  type RecommendationOwner,
} from "./report-canonical-context";

export type RecommendationPriority = "critical" | "high" | "medium" | "low";

export interface CanonicalRecommendation {
  id: string;
  priority: RecommendationPriority;
  owner: RecommendationOwner;
  title: string;
  reason: string;
  supportingFindingIds: string[];
  supportingEvidence: string[];
  confidence: number | null;
  expectedImpact: string | null;
  /** ids of other candidates that were merged into this one as duplicates */
  mergedFrom: string[];
}

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

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "for", "and", "or", "in", "on", "with", "should",
  "file", "consider", "recommend", "recommended", "attorney", "case", "this",
]);

function significantTokens(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}

/** Jaccard similarity over significant tokens. Cheap, deterministic, no embeddings needed. */
function similarity(a: string, b: string): number {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Two recommendations are treated as the same underlying item above this threshold. */
const DUPLICATE_THRESHOLD = 0.55;

const PRIORITY_RANK: Record<RecommendationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function coercePriority(v: unknown): RecommendationPriority {
  const s = String(v ?? "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

// ----------------------------------------------------------------------------
// Adapters — pull candidates out of each pass's structured output into the
// common RecommendationCandidate shape before merging.
// ----------------------------------------------------------------------------

function fromMemoNextActions(memo: Record<string, any> | null | undefined): RecommendationCandidate[] {
  const actions = memo?.legal_memorandum?.next_actions;
  if (!Array.isArray(actions)) return [];
  return actions.map((a: any) => {
    const title = String(a?.action ?? "").trim();
    return {
      id: `rec_${fnv1a(normalize(title))}`,
      owner: "memo" as const,
      title,
      reason: title,
      supportingFindingIds: [],
      supportingEvidence: [],
      confidence: null,
      expectedImpact: a?.deadline ? `Deadline: ${a.deadline}` : null,
      priorityHint: coercePriority(a?.priority),
    };
  });
}

function fromMemoRecommendedMotions(memo: Record<string, any> | null | undefined): RecommendationCandidate[] {
  const motions = memo?.legal_memorandum?.recommended_motions;
  if (!Array.isArray(motions)) return [];
  return motions.map((m: any) => {
    const title = String(m?.motion ?? "").trim();
    return {
      id: `rec_${fnv1a(normalize(title))}`,
      owner: "memo" as const,
      title,
      reason: String(m?.legal_standard ?? title),
      supportingFindingIds: [],
      supportingEvidence: Array.isArray(m?.factual_basis) ? m.factual_basis.map(String) : [],
      confidence: null,
      expectedImpact: null,
      priorityHint: m?.likelihood === "High" ? "high" : m?.likelihood === "Low" ? "low" : "medium",
    };
  });
}

function fromIntelNextActions(intel: Record<string, any> | null | undefined): RecommendationCandidate[] {
  const actions = intel?.next_actions;
  if (!Array.isArray(actions)) return [];
  return actions.map((a: any) => {
    const title = String(a?.action ?? "").trim();
    return {
      id: `rec_${fnv1a(normalize(title))}`,
      owner: "intelligence" as const,
      title,
      reason: String(a?.why ?? title),
      supportingFindingIds: Array.isArray(a?.depends_on) ? a.depends_on.map(String) : [],
      supportingEvidence: [],
      confidence: null,
      expectedImpact: a?.deadline_hint ? `Deadline: ${a.deadline_hint}` : null,
      priorityHint: null,
    };
  });
}

function fromIntelStrategyRecommendations(intel: Record<string, any> | null | undefined): RecommendationCandidate[] {
  const items = intel?.strategy_recommendations;
  if (!Array.isArray(items)) return [];
  return items.map((s: any) => {
    const title = String(s?.title ?? "").trim();
    return {
      id: `rec_${fnv1a(normalize(title))}`,
      owner: "intelligence" as const,
      title,
      reason: String(s?.rationale ?? title),
      supportingFindingIds: [],
      supportingEvidence: [],
      confidence: null,
      expectedImpact: String(s?.expected_impact ?? "") || null,
      priorityHint: coercePriority(s?.priority),
    };
  });
}

function fromIntelMotionOpportunities(intel: Record<string, any> | null | undefined): RecommendationCandidate[] {
  const items = intel?.motion_opportunities;
  if (!Array.isArray(items)) return [];
  return items.map((m: any) => {
    const title = String(m?.motion ?? "").trim();
    return {
      id: `rec_${fnv1a(normalize(title))}`,
      owner: "intelligence" as const,
      title,
      reason: String(m?.legal_rationale ?? m?.basis ?? title),
      supportingFindingIds: [],
      supportingEvidence: Array.isArray(m?.citations)
        ? m.citations.map((c: any) => `DOC ${c?.doc_n ?? "?"} p.${c?.page ?? "?"}`)
        : [],
      confidence: typeof m?.priority === "number" ? m.priority : null,
      expectedImpact: String(m?.likely_outcome ?? "") || null,
      priorityHint: m?.likelihood_of_success === "high" ? "high" : m?.likelihood_of_success === "low" ? "low" : "medium",
    };
  });
}

/**
 * Merge recommendation candidates from all three passes into the single
 * canonical, deduplicated list. Call this once, after narrative, memo, and
 * intelligence have all finished (or salvage-recovered).
 */
export function mergeCanonicalRecommendations(args: {
  narrativeParsed?: Record<string, any> | null;
  memoParsed?: Record<string, any> | null;
  intelParsed?: Record<string, any> | null;
}): CanonicalRecommendation[] {
  const narrativeProseText = String(args.narrativeParsed?.prose?.recommendations ?? "");

  const candidates: RecommendationCandidate[] = [
    ...extractRecommendationCandidatesFromProse(narrativeProseText, "narrative"),
    ...fromMemoNextActions(args.memoParsed),
    ...fromMemoRecommendedMotions(args.memoParsed),
    ...fromIntelNextActions(args.intelParsed),
    ...fromIntelStrategyRecommendations(args.intelParsed),
    ...fromIntelMotionOpportunities(args.intelParsed),
  ].filter((c) => c.title.length > 0);

  // Greedy clustering by pairwise similarity. Candidate order roughly
  // reflects generation order (narrative → memo → intelligence), so the
  // first candidate in a cluster is usually the highest-level statement of
  // the recommendation; later, more specific candidates get folded into it
  // with their extra detail (evidence, findings, expected impact) merged in
  // rather than dropped.
  const clusters: CanonicalRecommendation[] = [];
  for (const cand of candidates) {
    let match: CanonicalRecommendation | undefined;
    for (const cluster of clusters) {
      if (similarity(cluster.title, cand.title) >= DUPLICATE_THRESHOLD) {
        match = cluster;
        break;
      }
    }
    if (!match) {
      clusters.push({
        id: cand.id,
        priority: cand.priorityHint ?? "medium",
        owner: cand.owner,
        title: cand.title,
        reason: cand.reason,
        supportingFindingIds: [...cand.supportingFindingIds],
        supportingEvidence: [...cand.supportingEvidence],
        confidence: cand.confidence,
        expectedImpact: cand.expectedImpact,
        mergedFrom: [],
      });
      continue;
    }
    // Fold cand into match: keep match's title/owner (first-seen wins for
    // display), but union in the extra detail and upgrade priority/
    // confidence/impact if the merged-in candidate has stronger data.
    match.supportingFindingIds = Array.from(new Set([...match.supportingFindingIds, ...cand.supportingFindingIds]));
    match.supportingEvidence = Array.from(new Set([...match.supportingEvidence, ...cand.supportingEvidence]));
    if (cand.priorityHint && PRIORITY_RANK[cand.priorityHint] < PRIORITY_RANK[match.priority]) {
      match.priority = cand.priorityHint;
    }
    if (match.confidence == null && cand.confidence != null) match.confidence = cand.confidence;
    if (!match.expectedImpact && cand.expectedImpact) match.expectedImpact = cand.expectedImpact;
    match.mergedFrom.push(cand.id);
  }

  return clusters.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}
