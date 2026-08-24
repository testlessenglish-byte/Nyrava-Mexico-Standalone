create or replace function public.social_org_unlimited_seats(p_org uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select exists (
    select 1
    from public.organizations o
    join public.user_roles r on r.user_id = o.created_by
    where o.id = p_org
      and r.role in ('super_admin','platform_admin','admin')
  )
  or exists (
    select 1
    from public.org_memberships m
    join public.user_roles r on r.user_id = m.user_id
    where m.org_id = p_org
      and m.status = 'active'
      and m.role_in_org::text in ('owner','admin','firm_administrator')
      and r.role in ('super_admin','platform_admin','admin')
  )
$$;

revoke all on function public.social_org_unlimited_seats(uuid) from public, anon;
grant execute on function public.social_org_unlimited_seats(uuid) to authenticated, service_role;

create or replace function public.social_org_employee_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select case when public.social_org_unlimited_seats(p_org) then 100000 else
    greatest(0,coalesce(
      (select e.employee_seats from public.organization_entitlements e
        where e.org_id=p_org and e.status in ('active','trialing','past_due')),
      (select bp.employee_seats
        from public.org_subscriptions s join public.billing_plans bp on bp.id=s.plan_id
        where s.org_id=p_org and s.primary_subscription
        order by s.updated_at desc limit 1),
      (select greatest(0,coalesce(bp.team_member_limit,bp.included_seats,1)-1)
        from public.organizations o join public.billing_plans bp
          on bp.code=o.plan or bp.key=o.plan
        where o.id=p_org and bp.active order by bp.updated_at desc limit 1),
      0
    ))
  end
$$;

create or replace function public.social_org_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select case when public.social_org_unlimited_seats(p_org) then 100001 else
    greatest(1,coalesce(
      (select e.total_user_limit from public.organization_entitlements e
        where e.org_id=p_org and e.status in ('active','trialing','past_due')),
      1+public.social_org_employee_seat_limit(p_org)
    ))
  end
$$;

create or replace function public.enforce_social_invitation_subscription()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $invitation$
begin
  if new.status in ('invited','accepted')
     and not public.social_org_unlimited_seats(new.org_id)
     and not public.social_org_subscription_active(new.org_id) then
    raise exception 'An active organization subscription is required to use employee seats';
  end if;
  return new;
end
$invitation$;