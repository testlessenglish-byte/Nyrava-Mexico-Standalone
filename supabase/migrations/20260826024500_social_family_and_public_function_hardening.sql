begin;

-- Fix the family-to-case correlation. The previous unqualified "id" inside
-- the subquery resolved to c.id, producing c.family_id = c.id instead of
-- comparing the case family to the outer family row.
drop policy if exists social_families_read on public.social_families;
create policy social_families_read
  on public.social_families
  for select
  to authenticated
  using (
    public.social_sales_demo_owner_allows(
      'social_families',
      social_families.id,
      auth.uid()
    )
    and public.social_is_org_member(social_families.org_id, auth.uid())
    and (
      public.social_can_manage_org(social_families.org_id, auth.uid())
      or social_families.created_by = auth.uid()
      or social_families.assigned_case_manager = auth.uid()
      or exists (
        select 1
        from public.social_cases c
        where c.family_id = social_families.id
          and c.org_id = social_families.org_id
          and public.social_can_access_case(
            c.id,
            'general_case_record',
            false,
            auth.uid()
          )
      )
    )
  );

-- No SECURITY DEFINER routine in the exposed public schema may be callable
-- anonymously. This is intentionally generic so a future routine cannot keep
-- an implicit PUBLIC grant.
do $revoke_anon_definers$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prokind in ('f', 'p')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public', v_function);
    execute format('revoke all on function %s from anon', v_function);
  end loop;
end;
$revoke_anon_definers$;

-- Public pricing does not need elevated privileges. Give anon access only to
-- the marketing columns used by this SECURITY INVOKER function, protected by
-- an active-row RLS policy.
alter table public.billing_plans enable row level security;

drop policy if exists billing_plans_public_marketing_read
  on public.billing_plans;
create policy billing_plans_public_marketing_read
  on public.billing_plans
  for select
  to anon
  using (active is true);

revoke all on table public.billing_plans from anon;
grant select (
  key,
  label,
  tagline,
  features,
  price_cents,
  currency,
  "interval",
  self_serve,
  contact_url,
  included_seats,
  per_seat_price_cents,
  sort_order
) on table public.billing_plans to anon;

alter function public.list_public_billing_plans()
  security invoker;
alter function public.list_public_billing_plans()
  set search_path = public, pg_temp;

revoke all on function public.list_public_billing_plans()
  from public;
grant execute on function public.list_public_billing_plans()
  to anon, authenticated, service_role;

commit;

