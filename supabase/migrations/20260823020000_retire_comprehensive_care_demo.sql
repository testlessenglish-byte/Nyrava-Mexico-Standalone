begin;

-- Retire the synthetic Comprehensive Care sales-demo fixture after workflow
-- validation. This removes only records registered by the fixture manifest and
-- leaves organization, subscription, membership, program, and real case data
-- untouched.

-- Historical versions are immutable during normal operation. Disable only the
-- four named immutability triggers inside this transaction so the retired,
-- manifest-scoped synthetic fixture can be deleted. PostgreSQL rolls these
-- ALTER TABLE statements back automatically if any cleanup step fails.
alter table public.social_assessment_versions
  disable trigger immutable_social_assessment_versions;
alter table public.social_care_plan_versions
  disable trigger immutable_social_care_plan_versions;
alter table public.social_consent_versions
  disable trigger immutable_social_consent_versions;
alter table public.social_document_versions
  disable trigger immutable_social_document_versions;

-- The generic case audit trigger writes a post-delete event whose foreign key
-- necessarily points at the just-deleted case. Disable only that trigger for
-- this manifest-scoped retirement transaction.
alter table public.social_cases
  disable trigger audit_social_cases;

do $cleanup$
declare
  v_owner constant uuid := 'd1c91a8d-de47-48c9-95b4-519c60ae8e04';
  v_org constant uuid := '121250d0-c4bd-49ff-8a9e-e9557b0f88fb';
  v_fixture constant text := 'comprehensive-care-sales-demo-v1';
  v_result jsonb;
begin
  if to_regclass('public.social_sales_demo_records') is null then
    raise exception 'Demo manifest table is missing; cleanup cannot be safely scoped';
  end if;

  if to_regprocedure('public.remove_existing_account_comprehensive_care_demo()') is null then
    raise exception 'Scoped demo cleanup function is missing';
  end if;

  -- The original cleanup function intentionally requires the fixture owner.
  -- Supply that identity only inside this transaction so its existing safety
  -- checks and manifest-scoped deletion path remain authoritative.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'select public.remove_existing_account_comprehensive_care_demo()'
    into v_result;

  if coalesce((v_result ->> 'removed')::boolean, false) is not true then
    raise exception 'Comprehensive Care demo cleanup did not confirm removal';
  end if;

  if exists (
    select 1
    from public.social_sales_demo_records
    where fixture_version = v_fixture
      and owner_user_id = v_owner
      and org_id = v_org
  ) then
    raise exception 'Comprehensive Care demo manifest rows remain after cleanup';
  end if;

  if exists (
    select 1
    from public.social_cases
    where id in (
      'd3000000-0000-4000-8000-000000000417',
      'd3000000-0000-4000-8000-000000000318',
      'd3000000-0000-4000-8000-000000000271',
      'd3000000-0000-4000-8000-000000000199'
    )
       or (
         org_id = v_org
         and case_number in (
           'NYR-SOC-2026-000417',
           'NYR-SOC-2026-000318',
           'NYR-SOC-2026-000271',
           'NYR-SOC-2026-000199'
         )
         and tags @> array[v_fixture]::text[]
       )
  ) then
    raise exception 'Synthetic Comprehensive Care cases remain after cleanup';
  end if;
end
$cleanup$;

-- Restore the case audit trigger and immutable-history protection before
-- committing. Transaction rollback also restores them automatically on error.
alter table public.social_cases
  enable trigger audit_social_cases;

alter table public.social_assessment_versions
  enable trigger immutable_social_assessment_versions;
alter table public.social_care_plan_versions
  enable trigger immutable_social_care_plan_versions;
alter table public.social_consent_versions
  enable trigger immutable_social_consent_versions;
alter table public.social_document_versions
  enable trigger immutable_social_document_versions;

-- Remove all entry points that could recreate or mutate the retired fixture.
drop function if exists public.reset_existing_account_comprehensive_care_demo();
drop function if exists public.register_existing_account_care_demo_document_version(
  text, text, text, bigint
);
drop function if exists public.register_existing_account_care_demo_document(
  text, text, text, text, text, text, bigint
);
drop function if exists public.existing_account_care_demo_storage_paths();
drop function if exists public.existing_account_care_demo_dry_run();
drop function if exists public.populate_existing_account_comprehensive_care_demo();
drop function if exists public.remove_existing_account_comprehensive_care_demo();
drop function if exists public.demo_manifest(text, uuid, text);
drop function if exists public.assert_existing_account_care_demo_owner();

notify pgrst, 'reload schema';
commit;
