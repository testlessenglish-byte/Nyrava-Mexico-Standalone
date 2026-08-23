-- Verification for 20260823020000_retire_comprehensive_care_demo.sql

select
  count(*) = 0 as demo_manifest_empty
from public.social_sales_demo_records
where fixture_version = 'comprehensive-care-sales-demo-v1'
  and owner_user_id = 'd1c91a8d-de47-48c9-95b4-519c60ae8e04'
  and org_id = '121250d0-c4bd-49ff-8a9e-e9557b0f88fb';

select
  count(*) = 0 as demo_cases_removed
from public.social_cases
where id in (
  'd3000000-0000-4000-8000-000000000417',
  'd3000000-0000-4000-8000-000000000318',
  'd3000000-0000-4000-8000-000000000271',
  'd3000000-0000-4000-8000-000000000199'
)
or (
  org_id = '121250d0-c4bd-49ff-8a9e-e9557b0f88fb'
  and case_number in (
    'NYR-SOC-2026-000417',
    'NYR-SOC-2026-000318',
    'NYR-SOC-2026-000271',
    'NYR-SOC-2026-000199'
  )
  and tags @> array['comprehensive-care-sales-demo-v1']::text[]
);

select
  to_regprocedure('public.populate_existing_account_comprehensive_care_demo()') is null
    as demo_population_disabled,
  to_regprocedure('public.reset_existing_account_comprehensive_care_demo()') is null
    as demo_reset_disabled,
  to_regprocedure(
    'public.register_existing_account_care_demo_document(text,text,text,text,text,text,bigint)'
  ) is null as demo_document_registration_disabled,
  to_regprocedure(
    'public.register_existing_account_care_demo_document_version(text,text,text,bigint)'
  ) is null as demo_document_version_registration_disabled;

select
  count(*) = 4 as immutable_version_triggers_enabled
from pg_trigger
where tgname in (
  'immutable_social_assessment_versions',
  'immutable_social_care_plan_versions',
  'immutable_social_consent_versions',
  'immutable_social_document_versions'
)
and tgenabled = 'O'
and not tgisinternal;

select exists (
  select 1
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'social_cases'
    and t.tgname = 'audit_social_cases'
    and t.tgenabled = 'O'
    and not t.tgisinternal
) as social_case_audit_trigger_enabled;

select
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_and_assign_care_case'
  ) as real_case_creation_preserved,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_social_intake'
  ) as real_intake_creation_preserved,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_care_case_state'
  ) as real_case_state_workflow_preserved;
