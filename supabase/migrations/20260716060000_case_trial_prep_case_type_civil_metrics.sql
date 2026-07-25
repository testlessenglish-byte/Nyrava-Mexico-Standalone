-- Fix: case_trial_prep upsert failed: Could not find the 'case_type' column
-- of 'case_trial_prep' in the schema cache.
--
-- Root cause: runTrialPrepEngine (engines.server.ts) has always written
-- `case_type` and `civil_metrics` fields into its case_trial_prep upsert
-- (case_type records which practice area produced this jury simulation;
-- civil_metrics holds plaintiff_success_pct / defense_success_pct /
-- settlement_probability_pct / comparative_fault_estimate_pct for non-
-- criminal matters, since jury_conviction_pct / jury_acquittal_pct are
-- criminal-only fields). The table itself was never migrated to add these
-- two columns, so every trial_prep run silently failed at the DB layer —
-- surfaced only as a missing "Trial Prep" section in the generated report,
-- with no visible warning to the user.
--
-- civil_metrics is a legitimate feature (it's what lets a medical
-- malpractice, employment, or tax_law (civil track) case show settlement /
-- plaintiff-success jury-simulation percentages instead of criminal
-- conviction/acquittal percentages) — this is a genuine schema fix, not a
-- rollback of that logic.
ALTER TABLE public.case_trial_prep
  ADD COLUMN IF NOT EXISTS case_type text,
  ADD COLUMN IF NOT EXISTS civil_metrics jsonb;

COMMENT ON COLUMN public.case_trial_prep.case_type IS
  'Practice area (see PracticeArea in practice-areas.ts) active when this trial prep / jury simulation was generated. Drives whether jury_conviction_pct/jury_acquittal_pct (criminal) or civil_metrics (civil) is populated.';
COMMENT ON COLUMN public.case_trial_prep.civil_metrics IS
  'Civil-track jury simulation metrics: { plaintiff_success_pct, defense_success_pct, settlement_probability_pct, comparative_fault_estimate_pct }. Null for criminal-track cases, which use jury_conviction_pct/jury_acquittal_pct/jury_appeal_pct instead.';
