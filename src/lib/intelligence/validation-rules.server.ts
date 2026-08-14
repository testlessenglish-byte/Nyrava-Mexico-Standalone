// Continuous Legal Intelligence Phase C — validation rules as DATA.
//
// Phase B's self-audit escalates a live finding review using a hardcoded
// TypeScript map (tier -> action). This module is the shared home for that
// default map, the action/tier types, and the lookup that lets a deployed
// intelligence_validation_rules row OVERRIDE the default for one specific
// (matter_type, jurisdiction_country, error_type) bucket — never by an LLM
// editing code, only by proposals.server.ts's deployProposal, which only
// ever runs on an already-human-approved proposal.
//
// Lives in its own file (not patterns.server.ts or proposals.server.ts) to
// avoid a circular import: patterns.server.ts (self-audit) and
// proposals.server.ts (replay/deploy) both need these types/lookups, and
// proposals.server.ts also needs patterns.server.ts's aggregation — a
// one-directional dependency graph only works if the shared pieces live
// somewhere neither of those two files owns.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { IntelligenceErrorType } from "./chat-patch.server";

type Db = SupabaseClient<Database>;

export type PatternTier = "insufficient_sample" | "emerging" | "candidate" | "strong" | "significant";

/** Only these tiers can ever drive a validation-behavior change — matches
 *  patterns.server.ts's AUDIT_ELIGIBLE_TIERS and the DB CHECK constraint on
 *  intelligence_validation_rules.escalate_at_tier /
 *  intelligence_improvement_proposals.proposed_escalate_at_tier. */
export type AuditEligibleTier = "candidate" | "strong" | "significant";

export const AUDIT_ELIGIBLE_TIERS: readonly AuditEligibleTier[] = ["candidate", "strong", "significant"];

export const TIER_RANK: Record<PatternTier, number> = {
  insufficient_sample: 0,
  emerging: 1,
  candidate: 2,
  strong: 3,
  significant: 4,
};

export type SelfAuditRecommendedAction =
  | "require_additional_evidence"
  | "require_second_source"
  | "require_authority_verification"
  | "require_procedural_posture_verification"
  | "lower_confidence"
  | "send_to_critic"
  | "require_human_review";

/** Escalation intensity scales with tier — a deterministic, auditable
 *  policy, not a model's own judgment call. §7's explicit distinction:
 *  this is INCREASED SCRUTINY, never an automatic reject/remove — no
 *  action in this map ever suppresses or deletes a finding. This is the
 *  fallback used when no active intelligence_validation_rules row exists
 *  for a bucket — unchanged from Phase B, so shipping the rules table
 *  changes zero behavior until a rule is actually deployed. */
export const DEFAULT_TIER_ESCALATION: Record<AuditEligibleTier, SelfAuditRecommendedAction> = {
  candidate: "require_additional_evidence",
  strong: "require_second_source",
  significant: "require_human_review",
};

export type RuleBucketKey = {
  matterType: string | null;
  jurisdictionCountry: string;
  errorType: IntelligenceErrorType;
};

/**
 * Looks up the active intelligence_validation_rules row (if any) for this
 * bucket and, if the pattern's real tier meets or exceeds the rule's
 * escalate_at_tier, returns the rule's action as an override. Returns null
 * when no rule applies — the caller falls back to DEFAULT_TIER_ESCALATION.
 *
 * Best-effort: any lookup failure (network, unexpected shape) returns null
 * rather than throwing, so a rules-table problem can never change or block
 * self-audit's existing safe behavior.
 */
export async function getActiveRuleAction(
  db: Db,
  userId: string,
  key: RuleBucketKey,
  patternTier: PatternTier,
): Promise<SelfAuditRecommendedAction | null> {
  try {
    let query = db
      .from("intelligence_validation_rules")
      .select("escalate_at_tier,recommended_action")
      .eq("user_id", userId)
      .eq("jurisdiction_country", key.jurisdictionCountry)
      .eq("error_type", key.errorType)
      .eq("is_active", true);
    query = key.matterType ? query.eq("matter_type", key.matterType) : query.is("matter_type", null);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;

    const rule = data as { escalate_at_tier: AuditEligibleTier; recommended_action: SelfAuditRecommendedAction };
    if (TIER_RANK[patternTier] < TIER_RANK[rule.escalate_at_tier]) return null;
    return rule.recommended_action;
  } catch {
    return null;
  }
}

/**
 * Latest DEPLOYED intelligence_versions.version for this user, or null if
 * none has ever been deployed. Stamped onto reports.adaptive_intelligence_
 * version at report-generation time (pipeline.server.ts) so a past
 * report's forensic record never silently changes when the rules improve
 * later (directive §15). Best-effort — a lookup failure returns null, the
 * same "predates version tracking" value an environment with no deployed
 * versions yet would have anyway.
 */
export async function getCurrentIntelligenceVersion(db: Db, userId: string): Promise<number | null> {
  try {
    const { data, error } = await db
      .from("intelligence_versions")
      .select("version")
      .eq("user_id", userId)
      .eq("deployment_status", "deployed")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { version: number }).version;
  } catch {
    return null;
  }
}
