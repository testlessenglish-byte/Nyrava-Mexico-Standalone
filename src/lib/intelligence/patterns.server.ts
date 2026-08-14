// Continuous Legal Intelligence Phase B — cross-case pattern aggregation and
// self-auditing. See migration 20260813235408_intelligence_patterns.sql.
//
// A pattern is NEVER a new source of truth: it is a real-time aggregation
// over Phase A's intelligence_lessons (recordLesson, chat-patch.server.ts),
// grouped by (user_id, matter_type, jurisdiction, error_type). Every count
// here comes from real stored rows — tier/confidence are computed, never
// asserted. Below the configured minimum-N floor a bucket's tier is
// honestly 'insufficient_sample', not a fabricated low-confidence pattern.
//
// Mexico-only in practice, not by a special code path: every Phase A
// lesson writes jurisdiction_country='MX' (the current directive's explicit
// scope), so every bucket this file aggregates is Mexican by construction.
// No US/Canadian taxonomy or logic exists here to remove — there was never
// any to begin with.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { IntelligenceErrorType } from "./chat-patch.server";

type Db = SupabaseClient<Database>;

export type PatternTier = "insufficient_sample" | "emerging" | "candidate" | "strong" | "significant";

const VERIFIED_STATUSES: readonly string[] = [
  "evidence_verified",
  "multi_source_verified",
  "human_confirmed",
];

/** Example thresholds from the Continuous Legal Intelligence directive
 *  (§6), made configurable constants rather than hardcoded per-pattern
 *  claims — changing these changes every future tier computation, never a
 *  single pattern's stored belief about itself. Based on verifiedCount
 *  (evidence_verified+ lessons only, §17) — never raw sampleSize, since an
 *  attorney's individual approval of ONE correction is not the same as
 *  independently-verified cross-case evidence that a pattern is real. */
export const TIER_THRESHOLDS = {
  insufficientMax: 1,
  emergingMax: 4,
  candidateMax: 9,
  strongMax: 19,
} as const;

export function computeTier(verifiedCount: number): PatternTier {
  if (verifiedCount <= TIER_THRESHOLDS.insufficientMax) return "insufficient_sample";
  if (verifiedCount <= TIER_THRESHOLDS.emergingMax) return "emerging";
  if (verifiedCount <= TIER_THRESHOLDS.candidateMax) return "candidate";
  if (verifiedCount <= TIER_THRESHOLDS.strongMax) return "strong";
  return "significant";
}

/** Only these tiers are strong enough to change live validation behavior
 *  via self-audit — 'insufficient_sample'/'emerging' remain visible in the
 *  data (queryable, informative) but must never escalate a live finding
 *  review on their own, per §6's "never create a supposedly reliable
 *  pattern from one correction." */
const AUDIT_ELIGIBLE_TIERS: readonly PatternTier[] = ["candidate", "strong", "significant"];

export type PatternBucketKey = {
  matterType: string | null;
  jurisdictionCountry: string;
  jurisdictionState: string | null;
  errorType: IntelligenceErrorType;
};

export type PatternAggregation = PatternBucketKey & {
  sampleSize: number;
  verifiedCount: number;
  rejectedCount: number;
  successCount: number;
  confidence: number | null;
  tier: PatternTier;
  supportingLessonIds: string[];
  categorySamples: string[];
};

/**
 * Pure read: aggregates every intelligence_lessons row in this bucket into
 * real counts. No LLM call — arithmetic over stored rows only.
 * rejectedCount/successCount sum each lesson's own times_rejected/
 * times_successful retrieval-effectiveness counters (Phase A, currently
 * always 0 until something actually starts retrieving/applying lessons —
 * an honest zero, not a placeholder statistic).
 */
export async function aggregateIntelligencePatterns(
  db: Db,
  userId: string,
  key: PatternBucketKey,
): Promise<PatternAggregation> {
  let query = db
    .from("intelligence_lessons")
    .select("id,finding_id,validation_status,times_successful,times_rejected")
    .eq("user_id", userId)
    .eq("jurisdiction_country", key.jurisdictionCountry)
    .eq("error_type", key.errorType);
  query = key.matterType ? query.eq("matter_type", key.matterType) : query.is("matter_type", null);
  query = key.jurisdictionState
    ? query.eq("jurisdiction_state", key.jurisdictionState)
    : query.is("jurisdiction_state", null);
  const { data: rows } = await query;

  const lessons = (rows ?? []) as Array<{
    id: string;
    finding_id: string | null;
    validation_status: string;
    times_successful: number | null;
    times_rejected: number | null;
  }>;

  const sampleSize = lessons.length;
  const verifiedCount = lessons.filter((l) => VERIFIED_STATUSES.includes(l.validation_status)).length;
  const rejectedCount = lessons.reduce((sum, l) => sum + (l.times_rejected ?? 0), 0);
  const successCount = lessons.reduce((sum, l) => sum + (l.times_successful ?? 0), 0);
  const confidence = sampleSize > 0 ? verifiedCount / sampleSize : null;
  const tier = computeTier(verifiedCount);

  const findingIds = [...new Set(lessons.map((l) => l.finding_id).filter((v): v is string => !!v))];
  let categorySamples: string[] = [];
  if (findingIds.length > 0) {
    const { data: findingRows } = await db.from("case_findings").select("category").in("id", findingIds);
    categorySamples = [
      ...new Set(((findingRows ?? []) as Array<{ category: string }>).map((f) => f.category)),
    ];
  }

  return {
    ...key,
    sampleSize,
    verifiedCount,
    rejectedCount,
    successCount,
    confidence,
    tier,
    supportingLessonIds: lessons.map((l) => l.id),
    categorySamples,
  };
}

function describePattern(key: PatternBucketKey, agg: PatternAggregation): string {
  const matter = key.matterType ?? "unspecified matter type";
  const readableError = key.errorType.replace(/_/g, " ");
  return `${agg.verifiedCount} verified correction${agg.verifiedCount === 1 ? "" : "s"} (of ${agg.sampleSize} total reviewed) in ${matter} (${key.jurisdictionCountry}) previously found: ${readableError}.`;
}

/**
 * Writes/refreshes one intelligence_patterns row from a real aggregation.
 * Best-effort — called opportunistically after recordLesson writes a new
 * lesson; a failure here must never block or unwind the correction that
 * triggered it, same convention as every other Phase A supplementary
 * write. Never touches `status`: a fresh bucket gets the table's own
 * DEFAULT 'monitoring' on first insert, and an update never resets a
 * human's later decision to retire a pattern back to 'monitoring'.
 */
export async function upsertIntelligencePattern(
  db: Db,
  userId: string,
  key: PatternBucketKey,
): Promise<void> {
  const agg = await aggregateIntelligencePatterns(db, userId, key);
  const nowIso = new Date().toISOString();
  const { error } = await db.from("intelligence_patterns").upsert(
    {
      user_id: userId,
      matter_type: key.matterType,
      jurisdiction_country: key.jurisdictionCountry,
      jurisdiction_state: key.jurisdictionState,
      error_type: key.errorType,
      pattern_description: describePattern(key, agg),
      sample_size: agg.sampleSize,
      verified_count: agg.verifiedCount,
      rejected_count: agg.rejectedCount,
      success_count: agg.successCount,
      confidence: agg.confidence,
      tier: agg.tier,
      supporting_lesson_ids: agg.supportingLessonIds,
      category_samples: agg.categorySamples,
      last_recomputed_at: nowIso,
      updated_at: nowIso,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    { onConflict: "user_id,matter_type,jurisdiction_country,jurisdiction_state,error_type" },
  );
  if (error) {
    console.error("[patterns] failed to upsert intelligence pattern", error);
  }
}

export type SelfAuditRecommendedAction =
  | "require_additional_evidence"
  | "require_second_source"
  | "require_authority_verification"
  | "require_procedural_posture_verification"
  | "lower_confidence"
  | "send_to_critic"
  | "require_human_review";

export type SelfAuditNotice = {
  patternId: string;
  errorType: IntelligenceErrorType;
  tier: PatternTier;
  /** How this finding was matched to the pattern — currently always a
   *  real case_findings.category value shared with the pattern's
   *  supporting lessons (see category_samples), never an invented
   *  category-to-error_type mapping. */
  similarityBasis: "category_match";
  recommendedAction: SelfAuditRecommendedAction;
  reason: string;
};

/** Escalation intensity scales with tier — a deterministic, auditable
 *  policy, not a model's own judgment call. §7's explicit distinction:
 *  this is INCREASED SCRUTINY, never an automatic reject/remove — no
 *  action in this map ever suppresses or deletes a finding. */
const TIER_ESCALATION: Record<"candidate" | "strong" | "significant", SelfAuditRecommendedAction> = {
  candidate: "require_additional_evidence",
  strong: "require_second_source",
  significant: "require_human_review",
};

/**
 * Self-auditing (§7): "have we historically made this type of mistake?"
 * Checks whether an existing, non-retired pattern at tier >= candidate
 * shares a category with the finding under review. Returns null (no
 * historical concern) or a single escalation notice for the
 * highest-tier match — never more than one, and never a rejection.
 */
export async function auditFindingAgainstPatterns(
  db: Db,
  args: {
    userId: string;
    matterType: string | null;
    jurisdictionCountry: string;
    findingCategory: string;
  },
): Promise<SelfAuditNotice | null> {
  let query = db
    .from("intelligence_patterns")
    .select("id,error_type,tier,pattern_description,category_samples,status")
    .eq("user_id", args.userId)
    .eq("jurisdiction_country", args.jurisdictionCountry)
    .neq("status", "retired")
    .in("tier", AUDIT_ELIGIBLE_TIERS);
  query = args.matterType ? query.eq("matter_type", args.matterType) : query.is("matter_type", null);
  const { data: rows } = await query;

  const candidates = ((rows ?? []) as Array<{
    id: string;
    error_type: IntelligenceErrorType;
    tier: PatternTier;
    pattern_description: string;
    category_samples: string[];
  }>).filter((p) => p.category_samples.includes(args.findingCategory));
  if (candidates.length === 0) return null;

  const tierRank: Record<PatternTier, number> = {
    insufficient_sample: 0,
    emerging: 1,
    candidate: 2,
    strong: 3,
    significant: 4,
  };
  candidates.sort((a, b) => tierRank[b.tier] - tierRank[a.tier]);
  const best = candidates[0];

  return {
    patternId: best.id,
    errorType: best.error_type,
    tier: best.tier,
    similarityBasis: "category_match",
    recommendedAction: TIER_ESCALATION[best.tier as "candidate" | "strong" | "significant"],
    reason: best.pattern_description,
  };
}
