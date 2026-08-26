-- Run after 20260826024500_social_family_and_public_function_hardening.sql.
-- Read-only verification; changes made by this script are rolled back.
begin;

do $verify$
declare
  v_policy text;
begin
  select coalesce(qual, '')
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'social_families'
    and policyname = 'social_families_read';

  if v_policy not ilike '%c.family_id = social_families.id%'
    or v_policy not ilike '%c.org_id = social_families.org_id%'
  then
    raise exception 'Family read policy is not correlated to the outer family and organization';
  end if;

  if v_policy ilike '%c.family_id = c.id%' then
    raise exception 'Family read policy still contains the self-reference';
  end if;

  if (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid = 'public.list_public_billing_plans()'::regprocedure
  ) then
    raise exception 'Public billing helper is still SECURITY DEFINER';
  end if;

  if not has_function_privilege(
    'anon',
    'public.list_public_billing_plans()'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'Anonymous pricing access was unintentionally removed';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'An anonymous-executable SECURITY DEFINER routine remains';
  end if;

  if exists (
    select 1
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.table_name = 'billing_plans'
      and cp.grantee = 'anon'
      and cp.privilege_type = 'SELECT'
      and cp.column_name not in (
        'key',
        'label',
        'tagline',
        'features',
        'price_cents',
        'currency',
        'interval',
        'self_serve',
        'contact_url',
        'included_seats',
        'per_seat_price_cents',
        'sort_order'
      )
  ) then
    raise exception 'Anonymous role can select a non-marketing billing column';
  end if;

  select coalesce(qual, '')
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'billing_plans'
    and policyname = 'billing_plans_public_marketing_read';

  if v_policy not ilike '%active is true%' then
    raise exception 'Public billing policy does not require an active plan';
  end if;
end;
$verify$;

rollback;

