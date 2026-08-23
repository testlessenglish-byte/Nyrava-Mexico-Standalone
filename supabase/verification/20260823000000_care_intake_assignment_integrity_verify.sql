-- Read-only verification for 20260823000000_care_intake_assignment_integrity.sql
-- Expected result: every check returns true and duplicate_active_roles returns 0.

select
  to_regclass('public.social_intakes') is not null as social_intakes_exists,
  to_regclass('public.social_intake_number_counters') is not null as intake_counters_exist,
  to_regprocedure('public.create_social_intake(uuid,uuid,uuid,uuid,text,text,text[],uuid)') is not null as create_intake_exists,
  to_regprocedure('public.complete_social_intake(uuid,text,text)') is not null as complete_intake_exists,
  to_regprocedure('public.open_care_case_from_intake(uuid,text,text,uuid)') is not null as open_from_intake_exists;

select
  relrowsecurity as social_intakes_rls_enabled
from pg_class
where oid = 'public.social_intakes'::regclass;

select count(*) as legacy_primary_case_manager_roles
from public.social_case_assignments
where assignment_role = 'primary_case_manager';

select count(*) as duplicate_active_roles
from (
  select social_case_id, assignment_role
  from public.social_case_assignments
  where active
    and assignment_role in ('case_manager','supervisor')
  group by social_case_id, assignment_role
  having count(*) > 1
) duplicates;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'social_case_assignments_one_active',
    'social_case_assignments_one_active_role',
    'social_intakes_org_status_time_idx'
  )
order by indexname;
