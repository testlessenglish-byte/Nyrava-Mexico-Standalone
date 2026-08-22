begin;

-- Provider-neutral organization subscription entitlements for Comprehensive Care.
-- This extends the existing billing_plans/org_subscriptions model; it does not
-- introduce a second tenant, firm, membership, or checkout system.

alter table public.billing_plans
  add column if not exists owner_seats integer not null default 1,
  add column if not exists employee_seats integer not null default 0,
  add column if not exists total_user_limit integer,
  add column if not exists monthly_document_pages integer,
  add column if not exists storage_limit_bytes bigint,
  add column if not exists max_upload_size_bytes bigint,
  add column if not exists annual_price_cents integer,
  add column if not exists stripe_annual_price_id text,
  add column if not exists mercadopago_annual_plan_id text;

-- Basic/Solo is one subscriber-owner plus three employee accounts.
-- Clients, families and outside contacts are records and never consume seats.
update public.billing_plans
set owner_seats=1,
    employee_seats=3,
    total_user_limit=4,
    included_seats=4,
    team_member_limit=4,
    feature_flags=coalesce(feature_flags,'{}'::jsonb)||jsonb_build_object(
      'organization_account',true,
      'owner_seats',1,
      'employee_seats',3,
      'client_records_consume_seats',false
    )
where lower(coalesce(key,code,name)) in ('basic','solo');

alter table public.org_subscriptions
  add column if not exists provider_customer_id text,
  add column if not exists billing_interval text not null default 'month',
  add column if not exists currency text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists grace_period_ends_at timestamptz,
  add column if not exists primary_subscription boolean not null default true;

create unique index if not exists org_subscriptions_provider_subscription_uidx
  on public.org_subscriptions(provider,provider_subscription_id)
  where provider_subscription_id is not null;

-- Existing installations may have more than one historical row per organization.
-- Keep only the newest one primary before enforcing the invariant.
with ranked as (
  select id,row_number() over(partition by org_id order by updated_at desc,created_at desc,id desc) as rn
  from public.org_subscriptions where primary_subscription
)
update public.org_subscriptions s set primary_subscription=false
from ranked r where s.id=r.id and r.rn>1;

create unique index if not exists org_subscriptions_one_primary_uidx
  on public.org_subscriptions(org_id)
  where primary_subscription;

create table if not exists public.organization_entitlements (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  subscription_id uuid references public.org_subscriptions(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id),
  status text not null default 'inactive'
    check(status in ('active','trialing','past_due','canceled','inactive')),
  owner_seats integer not null default 1 check(owner_seats>=1),
  employee_seats integer not null default 0 check(employee_seats>=0),
  total_user_limit integer not null default 1 check(total_user_limit>=1),
  case_limit integer,
  ai_requests_monthly integer,
  talk_to_case_monthly integer,
  monthly_document_pages integer,
  storage_limit_bytes bigint,
  max_upload_size_bytes bigint,
  byok_allowed boolean not null default true,
  feature_flags jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  updated_at timestamptz not null default now(),
  check(total_user_limit>=owner_seats+employee_seats)
);

create table if not exists public.organization_usage_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.org_subscriptions(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  ai_requests_used bigint not null default 0,
  talk_to_case_used bigint not null default 0,
  document_pages_used bigint not null default 0,
  storage_bytes_used bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,period_start,period_end),
  check(period_end>period_start)
);

create table if not exists public.organization_usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  social_case_id uuid references public.social_cases(id) on delete set null,
  usage_type text not null,
  quantity bigint not null default 1 check(quantity>0),
  provider text,
  model text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique(org_id,idempotency_key)
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('stripe','mercadopago')),
  provider_event_id text not null,
  event_type text,
  verified boolean not null default false,
  processing_status text not null default 'received'
    check(processing_status in ('received','processed','ignored','failed')),
  user_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.organizations(id) on delete set null,
  provider_subscription_id text,
  payload_hash text,
  error_detail text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,provider_event_id)
);

alter table public.organization_entitlements enable row level security;
alter table public.organization_usage_periods enable row level security;
alter table public.organization_usage_events enable row level security;
alter table public.billing_webhook_events enable row level security;

revoke all on public.organization_entitlements from anon,authenticated;
revoke all on public.organization_usage_periods from anon,authenticated;
revoke all on public.organization_usage_events from anon,authenticated;
revoke all on public.billing_webhook_events from anon,authenticated;
grant all on public.organization_entitlements to service_role;
grant all on public.organization_usage_periods to service_role;
grant all on public.organization_usage_events to service_role;
grant all on public.billing_webhook_events to service_role;

create or replace function public.social_org_subscription_active(p_org uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select public.social_is_platform_admin(auth.uid()) or exists(
    select 1 from public.org_subscriptions s
    where s.org_id=p_org and s.primary_subscription
      and (
        s.status in ('active','trialing')
        or (s.status='past_due' and s.grace_period_ends_at>now())
      )
      and (s.current_period_end is null or s.current_period_end>now() or s.grace_period_ends_at>now())
  )
$$;

create or replace function public.social_org_employee_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select greatest(0,coalesce(
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
$$;

create or replace function public.social_org_employee_seats_used(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select count(*)::integer
  from public.org_memberships
  where org_id=p_org and status='active' and deleted_at is null
    and role_in_org::text<>'owner'
$$;

create or replace function public.social_org_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select greatest(1,coalesce(
    (select e.total_user_limit from public.organization_entitlements e
      where e.org_id=p_org and e.status in ('active','trialing','past_due')),
    1+public.social_org_employee_seat_limit(p_org)
  ))
$$;

create or replace function public.enforce_social_invitation_subscription()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $invitation$
begin
  if new.status in ('invited','accepted')
     and not public.social_org_subscription_active(new.org_id) then
    raise exception 'An active organization subscription is required to use employee seats';
  end if;
  return new;
end
$invitation$;

drop trigger if exists organization_invitations_require_subscription
  on public.organization_invitations;
create trigger organization_invitations_require_subscription
before insert or update of status on public.organization_invitations
for each row execute function public.enforce_social_invitation_subscription();

create or replace function public.provision_organization_subscription_from_webhook(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_user_id uuid,
  p_org_id uuid,
  p_plan_key text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_status text,
  p_billing_interval text default 'month',
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_payload_hash text default null
) returns jsonb language plpgsql security definer
set search_path=public,extensions,pg_temp as $$
declare
  v_event uuid;
  v_org uuid;
  v_plan public.billing_plans%rowtype;
  v_subscription uuid;
  v_name text;
  v_status text;
begin
  if p_provider not in ('stripe','mercadopago') then
    raise exception 'Unsupported billing provider';
  end if;
  if p_provider_event_id is null or btrim(p_provider_event_id)='' then
    raise exception 'Provider event id is required';
  end if;

  insert into public.billing_webhook_events(
    provider,provider_event_id,event_type,verified,processing_status,user_id,
    org_id,provider_subscription_id,payload_hash
  ) values(
    p_provider,p_provider_event_id,p_event_type,true,'received',p_user_id,
    p_org_id,p_provider_subscription_id,p_payload_hash
  )
  on conflict(provider,provider_event_id) do nothing
  returning id into v_event;

  if v_event is null then
    return jsonb_build_object('ok',true,'duplicate',true,'provider_event_id',p_provider_event_id);
  end if;
  if p_user_id is null then
    update public.billing_webhook_events set processing_status='ignored',
      error_detail='No user could be resolved',processed_at=now() where id=v_event;
    return jsonb_build_object('ok',false,'ignored',true,'reason','no_user');
  end if;

  if p_plan_key is not null then
    select * into v_plan from public.billing_plans
    where active and (key=p_plan_key or code=p_plan_key)
    order by updated_at desc limit 1;
  end if;
  if v_plan.id is null and p_provider_subscription_id is not null then
    select bp.* into v_plan
    from public.org_subscriptions s join public.billing_plans bp on bp.id=s.plan_id
    where s.provider=p_provider and s.provider_subscription_id=p_provider_subscription_id
    order by s.updated_at desc limit 1;
  end if;
  if v_plan.id is null then
    select bp.* into v_plan
    from public.org_memberships m
    join public.org_subscriptions s on s.org_id=m.org_id and s.primary_subscription
    join public.billing_plans bp on bp.id=s.plan_id
    where m.user_id=p_user_id and m.status='active' and m.deleted_at is null
    order by s.updated_at desc limit 1;
  end if;
  if v_plan.id is null then
    update public.billing_webhook_events set processing_status='failed',
      error_detail='Billing plan could not be resolved',processed_at=now() where id=v_event;
    raise exception 'Billing plan could not be resolved';
  end if;

  if p_org_id is not null and exists(
    select 1 from public.org_memberships
    where org_id=p_org_id and user_id=p_user_id and status='active' and deleted_at is null
  ) then v_org:=p_org_id; end if;

  if v_org is null then
    select m.org_id into v_org from public.org_memberships m
    where m.user_id=p_user_id and m.status='active' and m.deleted_at is null
    order by (m.role_in_org::text='owner') desc,m.created_at limit 1;
  end if;

  if v_org is null and p_status in ('active','trialing') then
    select coalesce(nullif(btrim(s.firm_name),''),
      split_part(coalesce(u.email,'Nyrava'),'@',1)||' Organization')
    into v_name
    from auth.users u left join public.user_settings s on s.user_id=u.id
    where u.id=p_user_id;
    insert into public.organizations(name,slug,created_by,plan,status)
    values(coalesce(v_name,'Nyrava Organization'),
      'org-'||replace(p_user_id::text,'-',''),p_user_id,
      coalesce(v_plan.key,v_plan.code),'active')
    returning id into v_org;
    insert into public.org_memberships(org_id,user_id,role_in_org,status,deleted_at)
    values(v_org,p_user_id,'owner','active',null)
    on conflict(org_id,user_id) do update set
      role_in_org='owner',status='active',deleted_at=null,updated_at=now();
  end if;

  if v_org is null then
    update public.billing_webhook_events set processing_status='ignored',
      error_detail='No organization exists for an inactive subscription',
      processed_at=now() where id=v_event;
    return jsonb_build_object('ok',false,'ignored',true,'reason','no_organization');
  end if;

  v_status:=case
    when p_status in ('active','trialing','past_due','canceled') then p_status
    when p_status='authorized' then 'active'
    when p_status in ('cancelled','cancelled_by_user') then 'canceled'
    else 'inactive' end;

  select id into v_subscription from public.org_subscriptions
  where provider=p_provider and provider_subscription_id=p_provider_subscription_id
  order by updated_at desc limit 1 for update;

  if v_subscription is null then
    select id into v_subscription from public.org_subscriptions
    where org_id=v_org and primary_subscription
    order by updated_at desc limit 1 for update;
  end if;

  if v_subscription is null then
    insert into public.org_subscriptions(
      org_id,plan_id,provider,provider_subscription_id,status,
      current_period_start,current_period_end,metadata,provider_customer_id,
      billing_interval,currency,primary_subscription,grace_period_ends_at
    ) values(
      v_org,v_plan.id,p_provider,p_provider_subscription_id,v_status,
      p_period_start,p_period_end,'{}'::jsonb,p_provider_customer_id,
      coalesce(p_billing_interval,'month'),v_plan.currency,true,
      case when v_status='past_due' then now()+interval '7 days' else null end
    ) returning id into v_subscription;
  else
    update public.org_subscriptions set
      plan_id=v_plan.id,provider=p_provider,
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_customer_id=coalesce(p_provider_customer_id,provider_customer_id),
      status=v_status,current_period_start=coalesce(p_period_start,current_period_start),
      current_period_end=coalesce(p_period_end,current_period_end),
      billing_interval=coalesce(p_billing_interval,billing_interval),
      currency=v_plan.currency,cancelled_at=case when v_status='canceled' then now() else null end,
      grace_period_ends_at=case when v_status='past_due' then
        coalesce(grace_period_ends_at,now()+interval '7 days') else null end,
      updated_at=now()
    where id=v_subscription;
  end if;

  update public.org_subscriptions set primary_subscription=false,updated_at=now()
  where org_id=v_org and id<>v_subscription and primary_subscription;

  insert into public.organization_entitlements(
    org_id,subscription_id,plan_id,status,owner_seats,employee_seats,total_user_limit,
    case_limit,ai_requests_monthly,talk_to_case_monthly,monthly_document_pages,
    storage_limit_bytes,max_upload_size_bytes,byok_allowed,feature_flags,
    valid_from,valid_until,updated_at
  ) values(
    v_org,v_subscription,v_plan.id,v_status,
    greatest(1,v_plan.owner_seats),greatest(0,v_plan.employee_seats),
    greatest(coalesce(v_plan.total_user_limit,1+v_plan.employee_seats),1+v_plan.employee_seats),
    v_plan.case_limit,v_plan.ai_requests_monthly,v_plan.talk_to_case_monthly,
    v_plan.monthly_document_pages,
    coalesce(v_plan.storage_limit_bytes,(v_plan.storage_gb_limit*1073741824)::bigint),
    v_plan.max_upload_size_bytes,v_plan.byok_allowed,v_plan.feature_flags,
    coalesce(p_period_start,now()),p_period_end,now()
  )
  on conflict(org_id) do update set
    subscription_id=excluded.subscription_id,plan_id=excluded.plan_id,status=excluded.status,
    owner_seats=excluded.owner_seats,employee_seats=excluded.employee_seats,
    total_user_limit=excluded.total_user_limit,case_limit=excluded.case_limit,
    ai_requests_monthly=excluded.ai_requests_monthly,
    talk_to_case_monthly=excluded.talk_to_case_monthly,
    monthly_document_pages=excluded.monthly_document_pages,
    storage_limit_bytes=excluded.storage_limit_bytes,
    max_upload_size_bytes=excluded.max_upload_size_bytes,
    byok_allowed=excluded.byok_allowed,feature_flags=excluded.feature_flags,
    valid_from=excluded.valid_from,valid_until=excluded.valid_until,updated_at=now();

  update public.organizations set plan=coalesce(v_plan.key,v_plan.code),
    status=case when v_status in ('active','trialing','past_due') then 'active' else status end,
    updated_at=now() where id=v_org;

  if p_period_start is not null and p_period_end is not null then
    insert into public.organization_usage_periods(
      org_id,subscription_id,period_start,period_end
    ) values(v_org,v_subscription,p_period_start,p_period_end)
    on conflict(org_id,period_start,period_end) do update set
      subscription_id=excluded.subscription_id,updated_at=now();
  end if;

  update public.billing_webhook_events set org_id=v_org,
    processing_status='processed',processed_at=now() where id=v_event;
  return jsonb_build_object(
    'ok',true,'duplicate',false,'organization_id',v_org,
    'subscription_id',v_subscription,'plan',coalesce(v_plan.key,v_plan.code),
    'owner_seats',v_plan.owner_seats,'employee_seats',v_plan.employee_seats
  );
exception when others then
  if v_event is not null then
    update public.billing_webhook_events set processing_status='failed',
      error_detail=left(sqlerrm,500),processed_at=now() where id=v_event;
  end if;
  raise;
end
$$;

revoke all on function public.provision_organization_subscription_from_webhook(
  text,text,text,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.provision_organization_subscription_from_webhook(
  text,text,text,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text
) to service_role;
revoke all on function public.social_org_subscription_active(uuid) from public,anon;
revoke all on function public.social_org_employee_seat_limit(uuid) from public,anon;
revoke all on function public.social_org_employee_seats_used(uuid) from public,anon;
grant execute on function public.social_org_subscription_active(uuid) to authenticated,service_role;
grant execute on function public.social_org_employee_seat_limit(uuid) to authenticated,service_role;
grant execute on function public.social_org_employee_seats_used(uuid) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
