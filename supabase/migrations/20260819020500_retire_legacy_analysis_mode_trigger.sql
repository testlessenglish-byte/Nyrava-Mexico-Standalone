-- Retire the old strict/balanced/exploratory storage enforcement.
-- The product now has one verified analysis pipeline. Procedural posture remains
-- represented independently by cases.case_analysis_mode.

-- Re-running this migration is safe.
drop trigger if exists trg_nyrava_verified_analysis_mode on public.cases;
drop function if exists public.nyrava_enforce_verified_analysis_mode();

alter table public.cases
  drop constraint if exists cases_analysis_mode_check;

alter table public.cases
  alter column analysis_mode drop default;

comment on column public.cases.analysis_mode is
  'LEGACY compatibility field only. strict/balanced/exploratory do not control pipeline execution. Procedural posture is cases.case_analysis_mode.';

-- Feature-routing rows inherited the same retired vocabulary. Keep the column
-- for compatibility, but remove the retired balanced default so new rows cannot
-- silently recreate a second analysis-mode concept at the DB layer.
alter table public.user_intelligence_features
  alter column mode drop default;

comment on column public.user_intelligence_features.mode is
  'Legacy feature-routing metadata. Must not control case analysis depth or legal intelligence engines.';
