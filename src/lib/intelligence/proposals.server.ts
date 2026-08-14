// Continuous Legal Intelligence Phase C — the controlled improvement
// pipeline: AI PROPOSAL -> HISTORICAL REPLAY -> REGRESSION CHECK -> HUMAN
// APPROVAL -> DEPLOY. See migrations 20260814125523_intelligence_
// validation_rules.sql, ..._improvement_proposals.sql, ..._versions.sql.
//
// Every function here is one state transition and enforces its own
// precondition — no path can skip a gate:
//   proposed -> testing            runHistoricalReplay
//   testing  -> passed | failed    runRegressionCheck
//   passed   -> approved           approveProposal  (a real human action)
//   approved -> deployed           deployProposal
//   deployed -> rolled_back        rollbackVersion   (intelligence_versions)
//
// Nothing here writes TypeScript, SQL migrations, prompts, or
// legal_authorities — only intelligence_validation_rules /
// intelligence_improvement_proposals / intelligence_versions rows, and
// only deployProposal/rollbackVersion ever touch the LIVE rule set, and
// only from an already-human-approved proposal. "The AI may propose,
// never self-authorize."
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { IntelligenceErrorType } from "./chat-patch.server";
import {
  DEFAULT_TIER_ESCALATION,
  TIER_RANK,
  getActiveRuleAction,
  type AuditEligibleTier,
  type PatternTier,
  type SelfAuditRecommendedAction,
} from "./validation-rules.server";

type Db = SupabaseClient<Database>;

type ProposalRow = {
  id: string;
  user_id: string;
  matter_type: string | null;
  jurisdiction_country: string;
  error_type: IntelligenceErrorType;
  supporting_pattern_id: string;
  proposed_escalate_at_tier: AuditEligibleTier;
  proposed_recommended_action: SelfAuditRecommendedAction;
  status: string;
  historical_replay: { findings_evaluated: number; findings_would_change_action: number; insufficient_data: boolean } | null;
  approved_by: string | null;
  approved_at: string | null;
};

async function fetchProposal(db: Db, userId: string, proposalId: string): Promise<ProposalRow> {
  const { data, error } = await db
    .from("intelligence_improvement_proposals")
    .select(
      "id,user_id,matter_type,jurisdiction_country,error_type,supporting_pattern_id,proposed_escalate_at_tier,proposed_recommended_action,status,historical_replay,approved_by,approved_at",
    )
    .eq("id", proposalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error(`intelligence_improvement_proposals row not found: ${proposalId}`);
  return data as unknown as ProposalRow;
}

/**
 * The bucket-pull-forward this pass proposes: a pattern that already
 * proved itself real at the ceiling tier (significant, >=20 independently
 * verified corrections) gets caught one tier sooner next time. A
 * structural, explainable move — not an invented number — and the
 * strongest action (require_human_review) is already what 'significant'
 * gets by default, so this never invents a NEW action, only an earlier
 * trigger point for the one that already exists.
 */
const PROPOSAL_PULL_FORWARD_TIER: AuditEligibleTier = "strong";
const PROPOSAL_ACTION: SelfAuditRecommendedAction = "require_human_review";

const IN_FLIGHT_STATUSES = ["proposed", "testing", "passed", "approved"] as const;

/**
 * Deterministic proposal generation — no LLM, no fabricated heuristic.
 * Scans this user's patterns at tier='significant' with category_samples
 * (an audit-eligible bucket already exists) and creates one proposal per
 * bucket that doesn't already have an active rule or an in-flight
 * proposal. Best-effort per-pattern: one failure doesn't stop the scan.
 */
export async function proposeIntelligenceImprovement(
  db: Db,
  userId: string,
): Promise<Array<{ id: string; matterType: string | null; errorType: IntelligenceErrorType }>> {
  const { data: patternRows } = await db
    .from("intelligence_patterns")
    .select("id,matter_type,jurisdiction_country,error_type,tier,pattern_description,supporting_lesson_ids,status")
    .eq("user_id", userId)
    .eq("tier", "significant")
    .neq("status", "retired");

  const patterns = (patternRows ?? []) as Array<{
    id: string;
    matter_type: string | null;
    jurisdiction_country: string;
    error_type: IntelligenceErrorType;
    pattern_description: string;
  }>;

  const created: Array<{ id: string; matterType: string | null; errorType: IntelligenceErrorType }> = [];

  for (const pattern of patterns) {
    try {
      let ruleQuery = db
        .from("intelligence_validation_rules")
        .select("id")
        .eq("user_id", userId)
        .eq("jurisdiction_country", pattern.jurisdiction_country)
        .eq("error_type", pattern.error_type)
        .eq("is_active", true);
      ruleQuery = pattern.matter_type
        ? ruleQuery.eq("matter_type", pattern.matter_type)
        : ruleQuery.is("matter_type", null);
      const { data: existingRule } = await ruleQuery.maybeSingle();
      if (existingRule) continue;

      let proposalQuery = db
        .from("intelligence_improvement_proposals")
        .select("id")
        .eq("user_id", userId)
        .eq("jurisdiction_country", pattern.jurisdiction_country)
        .eq("error_type", pattern.error_type)
        .in("status", IN_FLIGHT_STATUSES);
      proposalQuery = pattern.matter_type
        ? proposalQuery.eq("matter_type", pattern.matter_type)
        : proposalQuery.is("matter_type", null);
      const { data: inFlight } = await proposalQuery;
      if ((inFlight ?? []).length > 0) continue;

      const matter = pattern.matter_type ?? "unspecified matter type";
      const { data: inserted, error } = await db
        .from("intelligence_improvement_proposals")
        .insert({
          user_id: userId,
          matter_type: pattern.matter_type,
          jurisdiction_country: pattern.jurisdiction_country,
          error_type: pattern.error_type,
          supporting_pattern_id: pattern.id,
          problem: `Recurring, independently-verified mistake in ${matter} (${pattern.jurisdiction_country}): ${pattern.error_type.replace(/_/g, " ")}.`,
          observed_failure: pattern.pattern_description,
          proposed_escalate_at_tier: PROPOSAL_PULL_FORWARD_TIER,
          proposed_recommended_action: PROPOSAL_ACTION,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .select("id")
        .single();
      if (error || !inserted) {
        console.error("[proposals] failed to create proposal", error);
        continue;
      }
      created.push({ id: (inserted as { id: string }).id, matterType: pattern.matter_type, errorType: pattern.error_type });
    } catch (err) {
      console.error("[proposals] error evaluating pattern for proposal", pattern.id, err);
    }
  }

  return created;
}

/**
 * proposed -> testing. Counts this user's currently-active case_findings
 * whose category appears in the supporting pattern's category_samples
 * (findings_evaluated), and whether today's effective action for this
 * bucket differs from the proposed one (findings_would_change_action).
 * Both are real integer counts from stored rows — never a percentage,
 * never fabricated. insufficient_data stays true (and the proposal cannot
 * advance past 'testing') when findings_evaluated is 0.
 */
export async function runHistoricalReplay(db: Db, userId: string, proposalId: string): Promise<void> {
  const proposal = await fetchProposal(db, userId, proposalId);
  if (proposal.status !== "proposed") {
    throw new Error(`runHistoricalReplay requires status='proposed', got '${proposal.status}'`);
  }

  const { data: patternRow } = await db
    .from("intelligence_patterns")
    .select("tier,category_samples")
    .eq("id", proposal.supporting_pattern_id)
    .maybeSingle();
  const pattern = patternRow as { tier: PatternTier; category_samples: string[] } | null;
  const categories = pattern?.category_samples ?? [];

  let findingsEvaluated = 0;
  if (categories.length > 0) {
    const { data: findingRows } = await db
      .from("case_findings")
      .select("id")
      .eq("user_id", userId)
      .in("category", categories)
      .is("superseded_at", null);
    findingsEvaluated = (findingRows ?? []).length;
  }

  let findingsWouldChangeAction = 0;
  if (findingsEvaluated > 0 && pattern) {
    const oldAction =
      (await getActiveRuleAction(
        db,
        userId,
        { matterType: proposal.matter_type, jurisdictionCountry: proposal.jurisdiction_country, errorType: proposal.error_type },
        pattern.tier,
      )) ??
      (TIER_RANK[pattern.tier] >= TIER_RANK["candidate"]
        ? DEFAULT_TIER_ESCALATION[pattern.tier as AuditEligibleTier]
        : null);

    const newActionApplies = TIER_RANK[pattern.tier] >= TIER_RANK[proposal.proposed_escalate_at_tier];
    const newAction = newActionApplies ? proposal.proposed_recommended_action : oldAction;

    if (newAction !== oldAction) findingsWouldChangeAction = findingsEvaluated;
  }

  const historicalReplay = {
    findings_evaluated: findingsEvaluated,
    findings_would_change_action: findingsWouldChangeAction,
    insufficient_data: findingsEvaluated === 0,
    evaluated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("intelligence_improvement_proposals")
    .update({ status: "testing", historical_replay: historicalReplay, updated_at: new Date().toISOString() } as never)
    .eq("id", proposalId);
  if (error) throw new Error(`failed to record historical replay: ${error.message}`);
}

/**
 * testing -> passed | failed. Enforces two things, both real and testable:
 * (1) never advance on zero real evaluated findings (§12's anti-
 * fabrication floor); (2) a hard safety invariant — a rule targeting
 * escalate_at_tier='significant' must use recommended_action=
 * 'require_human_review'. The system can never let a proposal quietly
 * reduce scrutiny at the tier with the most verified evidence behind it.
 */
export async function runRegressionCheck(db: Db, userId: string, proposalId: string): Promise<void> {
  const proposal = await fetchProposal(db, userId, proposalId);
  if (proposal.status !== "testing") {
    throw new Error(`runRegressionCheck requires status='testing', got '${proposal.status}'`);
  }

  let invariantHolds = true;
  let reason = "No safety invariant violated.";

  if (!proposal.historical_replay || proposal.historical_replay.insufficient_data) {
    invariantHolds = false;
    reason = "Insufficient data: historical replay evaluated 0 findings — cannot pass a proposal on no real evidence.";
  } else if (proposal.proposed_escalate_at_tier === "significant" && proposal.proposed_recommended_action !== "require_human_review") {
    invariantHolds = false;
    reason = "Safety floor violated: a rule for tier='significant' must use recommended_action='require_human_review'.";
  }

  const regressionCheck = { invariant_holds: invariantHolds, reason, checked_at: new Date().toISOString() };
  const { error } = await db
    .from("intelligence_improvement_proposals")
    .update({
      status: invariantHolds ? "passed" : "failed",
      regression_check: regressionCheck,
      updated_at: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", proposalId);
  if (error) throw new Error(`failed to record regression check: ${error.message}`);
}

/**
 * passed -> approved. The human gate: nothing else in this file calls
 * this automatically. Exists so an explicit human action (no UI built
 * this pass — same "no fake dashboards before real data exists"
 * precedent as Phase B/D) is the only thing that can invoke it.
 */
export async function approveProposal(
  db: Db,
  userId: string,
  proposalId: string,
  approvedByUserId: string,
): Promise<void> {
  const proposal = await fetchProposal(db, userId, proposalId);
  if (proposal.status !== "passed") {
    throw new Error(`approveProposal requires status='passed', got '${proposal.status}'`);
  }
  const { error } = await db
    .from("intelligence_improvement_proposals")
    .update({
      status: "approved",
      approved_by: approvedByUserId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", proposalId);
  if (error) throw new Error(`failed to approve proposal: ${error.message}`);
}

async function nextVersionNumber(db: Db, userId: string): Promise<number> {
  const { data } = await db
    .from("intelligence_versions")
    .select("version")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { version: number } | null)?.version ?? 0) + 1;
}

/**
 * approved -> deployed. Only place in this codebase that ever mutates the
 * LIVE validation-rule set, and only ever from an already-approved
 * proposal. Deactivates the bucket's prior active rule (if any) via
 * superseded_by_rule_id, inserts the new active rule, and appends one
 * intelligence_versions row recording the exact diff.
 */
export async function deployProposal(db: Db, userId: string, proposalId: string): Promise<{ version: number }> {
  const proposal = await fetchProposal(db, userId, proposalId);
  if (proposal.status !== "approved") {
    throw new Error(`deployProposal requires status='approved', got '${proposal.status}'`);
  }

  let oldRuleQuery = db
    .from("intelligence_validation_rules")
    .select("id,escalate_at_tier,recommended_action")
    .eq("user_id", userId)
    .eq("jurisdiction_country", proposal.jurisdiction_country)
    .eq("error_type", proposal.error_type)
    .eq("is_active", true);
  oldRuleQuery = proposal.matter_type
    ? oldRuleQuery.eq("matter_type", proposal.matter_type)
    : oldRuleQuery.is("matter_type", null);
  const { data: oldRuleRow } = await oldRuleQuery.maybeSingle();
  const oldRule = oldRuleRow as { id: string; escalate_at_tier: string; recommended_action: string } | null;

  const version = await nextVersionNumber(db, userId);

  const { data: newRuleRow, error: insertRuleError } = await db
    .from("intelligence_validation_rules")
    .insert({
      user_id: userId,
      matter_type: proposal.matter_type,
      jurisdiction_country: proposal.jurisdiction_country,
      error_type: proposal.error_type,
      escalate_at_tier: proposal.proposed_escalate_at_tier,
      recommended_action: proposal.proposed_recommended_action,
      is_active: true,
      version,
      source_proposal_id: proposalId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .select("id")
    .single();
  if (insertRuleError || !newRuleRow) {
    throw new Error(`failed to deploy new validation rule: ${insertRuleError?.message}`);
  }
  const newRuleId = (newRuleRow as { id: string }).id;

  if (oldRule) {
    await db
      .from("intelligence_validation_rules")
      .update({ is_active: false, superseded_by_rule_id: newRuleId, updated_at: new Date().toISOString() } as never)
      .eq("id", oldRule.id);
  }

  const { data: patternRow } = await db
    .from("intelligence_patterns")
    .select("supporting_lesson_ids")
    .eq("id", proposal.supporting_pattern_id)
    .maybeSingle();

  const { error: versionError } = await db.from("intelligence_versions").insert({
    user_id: userId,
    version,
    proposal_id: proposalId,
    changes: {
      rule_id: newRuleId,
      old_rule_id: oldRule?.id ?? null,
      matter_type: proposal.matter_type,
      jurisdiction_country: proposal.jurisdiction_country,
      error_type: proposal.error_type,
      old: oldRule ? { escalate_at_tier: oldRule.escalate_at_tier, recommended_action: oldRule.recommended_action } : null,
      new: { escalate_at_tier: proposal.proposed_escalate_at_tier, recommended_action: proposal.proposed_recommended_action },
    },
    supporting_lesson_ids: (patternRow as { supporting_lesson_ids: string[] } | null)?.supporting_lesson_ids ?? [],
    supporting_pattern_ids: [proposal.supporting_pattern_id],
    approved_by: proposal.approved_by,
    approved_at: proposal.approved_at,
    deployment_status: "deployed",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (versionError) throw new Error(`failed to record intelligence version: ${versionError.message}`);

  const { error: updateProposalError } = await db
    .from("intelligence_improvement_proposals")
    .update({ status: "deployed", deployed_version: version, updated_at: new Date().toISOString() } as never)
    .eq("id", proposalId);
  if (updateProposalError) throw new Error(`failed to finalize deployed proposal: ${updateProposalError.message}`);

  return { version };
}

/**
 * deployed -> rolled_back. Never edits or deletes a row: reactivates
 * whatever rule this version superseded (if any — a bucket's first-ever
 * rule simply goes back to "no active rule," falling back to
 * DEFAULT_TIER_ESCALATION), flips deployment_status on the version being
 * rolled back (metadata, not content — its `changes` diff is never
 * touched), and APPENDS a new version row recording the reversal.
 */
export async function rollbackVersion(db: Db, userId: string, versionId: string): Promise<{ version: number }> {
  const { data: versionRow, error: fetchError } = await db
    .from("intelligence_versions")
    .select("id,user_id,version,deployment_status,changes")
    .eq("id", versionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchError || !versionRow) throw new Error(`intelligence_versions row not found: ${versionId}`);

  const target = versionRow as unknown as {
    id: string;
    version: number;
    deployment_status: string;
    changes: {
      rule_id: string;
      old_rule_id: string | null;
      matter_type: string | null;
      jurisdiction_country: string;
      error_type: IntelligenceErrorType;
      old: { escalate_at_tier: string; recommended_action: string } | null;
      new: { escalate_at_tier: string; recommended_action: string };
    };
  };
  if (target.deployment_status !== "deployed") {
    throw new Error(`rollbackVersion requires deployment_status='deployed', got '${target.deployment_status}'`);
  }

  const { data: liveRule } = await db
    .from("intelligence_validation_rules")
    .select("id,is_active")
    .eq("id", target.changes.rule_id)
    .maybeSingle();
  if (!liveRule || !(liveRule as { is_active: boolean }).is_active) {
    throw new Error("rollbackVersion refused: this version's rule is no longer the live rule for its bucket (already superseded by a later deploy).");
  }

  await db
    .from("intelligence_validation_rules")
    .update({ is_active: false, updated_at: new Date().toISOString() } as never)
    .eq("id", target.changes.rule_id);

  if (target.changes.old_rule_id) {
    await db
      .from("intelligence_validation_rules")
      .update({ is_active: true, updated_at: new Date().toISOString() } as never)
      .eq("id", target.changes.old_rule_id);
  }

  const nextVersion = await nextVersionNumber(db, userId);
  const { data: newVersionRow, error: insertError } = await db
    .from("intelligence_versions")
    .insert({
      user_id: userId,
      version: nextVersion,
      changes: {
        rule_id: target.changes.old_rule_id,
        old_rule_id: target.changes.rule_id,
        matter_type: target.changes.matter_type,
        jurisdiction_country: target.changes.jurisdiction_country,
        error_type: target.changes.error_type,
        old: target.changes.new,
        new: target.changes.old,
      },
      rollback_reference: target.id,
      deployment_status: "deployed",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .select("id")
    .single();
  if (insertError || !newVersionRow) throw new Error(`failed to record rollback version: ${insertError?.message}`);

  await db
    .from("intelligence_versions")
    .update({ deployment_status: "rolled_back", rollback_reference: (newVersionRow as { id: string }).id } as never)
    .eq("id", target.id);

  return { version: nextVersion };
}
