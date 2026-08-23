-- Verification for Phase 6 lifecycle integrity. Read-only.
select
  to_regprocedure('public.close_social_case(uuid,text,text,jsonb)') is not null as close_social_case_exists,
  position('Services cannot be marked completed while work remains' in pg_get_functiondef(to_regprocedure('public.close_social_case(uuid,text,text,jsonb)'))) > 0 as completion_blockers_enforced,
  position('case_closed' in pg_get_functiondef(to_regprocedure('public.close_social_case(uuid,text,text,jsonb)'))) > 0 as closure_activity_audited,
  position('document disposition' in lower(pg_get_functiondef(to_regprocedure('public.close_social_case(uuid,text,text,jsonb)')))) > 0 as closure_metadata_required;
