-- Nyrava México — retire the legacy Strict/Balanced/Exploratory database gate.
--
-- The product now has one verified intelligence pipeline. `analysis_mode` is
-- retained temporarily as a compatibility column for older application code,
-- but it must not influence execution and the database must not silently force
-- a legacy token on inserts/updates.
--
-- `case_analysis_mode` remains the real procedural-posture control
-- (ongoing/concluded_audit/judgment_audit/appeal_routes) and is intentionally
-- untouched by this migration.

begin;

alter table public.cases
  drop constraint if exists cases_analysis_mode_check;

alter table public.cases
  alter column analysis_mode drop default;

-- Migration 20260818153000 created this compatibility trigger. It is now
-- obsolete: application routing treats all historical values identically.
drop trigger if exists trg_nyrava_verified_analysis_mode on public.cases;
drop function if exists public.nyrava_enforce_verified_analysis_mode();

comment on column public.cases.analysis_mode is
  'LEGACY compatibility field only. strict/balanced/exploratory do not control pipeline execution. Do not branch application behavior on this field; use case_analysis_mode only for procedural posture.';

commit;
