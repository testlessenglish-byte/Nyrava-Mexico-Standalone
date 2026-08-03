// Single source of truth for what a full "Rerun from scratch" clears.
// Used both at click time (queueCaseForPipeline) and when the worker picks
// the case up (runPipelineForCase's reset branch), so a rerun can never
// leave stale derived data behind from the previous run.
//
// Documents (and their extracted text) are intentionally preserved: they are
// the evidence the attorney uploaded, not derived output. Everything the
// pipeline produces from them is deleted.

export const CASE_DERIVED_TABLES = [
  "analyses",
  "canonical_analysis",
  "agent_findings",
  "agent_logs",
  "case_findings",
  "case_scores",
  "case_opportunities",
  "case_perspectives",
  "case_strategy",
  "case_strategy_center",
  "case_theories",
  "case_timeline_events",
  "case_trial_prep",
  "case_witnesses",
  "case_work_product",
  "case_motion_drafts",
  "case_domain_activations",
  "case_chat_messages",
  "evidence_classifications",
  "image_intelligence",
  "report_versions",
  "reports",
  "pipeline_engine_runs",
  "pipeline_events",
  // 2026-08-03: audited every table with a case_id column against this
  // list (see commit message) looking specifically for pipeline-DERIVED
  // output that a full Rerun should wipe but wasn't — as opposed to
  // user-authored data (case_parties, case_tasks, case_communications,
  // case_events) or billing/audit trails (ai_usage, usage_events,
  // audit_logs), which correctly survive a rerun same as documents do.
  // Found four genuine gaps, all pure pipeline-run artifacts:
  "pipeline_trace",
  // verification_items has UNIQUE(case_id, category) — leaving stale rows
  // behind exposes a rerun to exactly the same class of crash as the
  // case_theories UNIQUE(case_id, theory_type) bug fixed 2026-08-03 (a
  // fresh run's insert collides with a leftover row from the previous
  // run instead of starting clean).
  "verification_items",
  // References report_version / canonical_finding_id — after a rerun
  // clears case_findings and reports, old snapshot rows here would
  // otherwise dangle, referencing findings and report versions that no
  // longer exist.
  "finding_version_snapshots",
  "cross_agent_audit",
] as const;

// Every stage timestamp / cached artifact column on `cases` that must go back
// to its "never ran" value so no stage is treated as already complete.
export const CASE_RESET_FIELDS = {
  extracted_at: null,
  analysis_at: null,
  agents_at: null,
  scored_at: null,
  report_at: null,
  theories_at: null,
  opportunities_at: null,
  trial_prep_at: null,
  witnesses_at: null,
  perspectives_at: null,
  evidence_intel_at: null,
  strategy_at: null,
  strategy_center_at: null,
  contradiction_at: null,
  discovery_at: null,
  hallucination_at: null,
  work_product_at: null,
  completed_at: null,
  shared_brief: null,
  shared_brief_at: null,
  hallucination_report: null,
  legal_qa_report: null,
  procedural_compliance: null,
  extraction_report: null,
  attack_surface: {},
  error: null,
  stall_reason: null,
  status_message: null,
  progress: 0,
  report_checkpoint_count: 0,
  cancel_requested: false,
} as const;

/** Deletes every derived row produced by previous runs of this case. */
export async function clearCaseDerivedData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  caseId: string,
): Promise<void> {
  for (const table of CASE_DERIVED_TABLES) {
    const { error } = await db.from(table).delete().eq("case_id", caseId);
    if (error) {
      // A missing/locked derived table must never abort the rerun.
      console.warn(`[pipeline.reset] failed clearing ${table}: ${error.message}`);
    }
  }
}
