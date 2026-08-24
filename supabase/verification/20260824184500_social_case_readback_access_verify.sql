-- Run after 20260824184500_social_case_readback_access.sql.
select
  to_regprocedure('public.get_social_case_core(uuid)') is not null as case_core_reader_exists,
  to_regprocedure('public.social_can_access_case(uuid,text,boolean,uuid)') is not null as case_access_helper_exists,
  exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='social_cases'
      and policyname='social_cases_direct_participant_read'
  ) as direct_participant_policy_exists,
  (
    select relrowsecurity
    from pg_class
    where oid='public.social_cases'::regclass
  ) as social_cases_rls_enabled,
  position(
    'assigned_case_manager'
    in pg_get_functiondef('public.social_can_access_case(uuid,text,boolean,uuid)'::regprocedure)
  ) > 0 as assigned_manager_is_authorized,
  position(
    'supervising_manager'
    in pg_get_functiondef('public.social_can_access_case(uuid,text,boolean,uuid)'::regprocedure)
  ) > 0 as supervising_manager_is_authorized;
