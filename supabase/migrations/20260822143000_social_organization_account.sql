begin;

-- Comprehensive Care uses the existing organization as the single billing,
-- membership, authorization and case-management boundary. Employees are seats;
-- this migration does not create a second firm, tenant or subscription.

alter type public.membership_status add value if not exists 'removed';
alter type public.org_role add value if not exists 'firm_manager';
alter type public.org_role add value if not exists 'supervisor';
alter type public.org_role add value if not exists 'case_worker';
alter type public.org_role add value if not exists 'legal_provider';
alter type public.org_role add value if not exists 'psychosocial_provider';

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in (
    'firm_manager','supervisor','case_worker','legal_provider',
    'psychosocial_provider','read_only'
  )),
  token_hash text not null unique,
  status text not null default 'invited'
    check (status in ('invited','accepted','revoked','expired')),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists organization_invitations_one_pending
  on public.organization_invitations(org_id,lower(email)) where status='invited';

create index if not exists organization_invitations_org_status_idx
  on public.organization_invitations(org_id,status,expires_at);
alter table public.organization_invitations enable row level security;

create or replace function public.social_can_manage_org(
  p_org uuid,p_user uuid default auth.uid()
) returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select public.social_is_platform_admin(p_user) or exists (
    select 1
    from public.org_memberships m
    join public.organizations o on o.id=m.org_id
    where m.org_id=p_org and m.user_id=p_user and m.status='active'
      and m.role_in_org::text in ('owner','admin','firm_administrator','firm_manager')
      and o.status='active' and o.deleted_at is null
  )
$$;

create or replace function public.social_can_contribute_org(
  p_org uuid,p_user uuid default auth.uid()
) returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select public.social_is_platform_admin(p_user) or exists (
    select 1
    from public.org_memberships m
    join public.organizations o on o.id=m.org_id
    where m.org_id=p_org and m.user_id=p_user and m.status='active'
      and m.role_in_org::text in (
        'owner','admin','firm_administrator','firm_manager','supervisor',
        'case_worker','legal_provider','psychosocial_provider','lawyer',
        'paralegal','attorney','associate_attorney','legal_assistant'
      )
      and o.status='active' and o.deleted_at is null
  )
$$;

create or replace function public.social_org_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select greatest(1,coalesce(
    (
      select coalesce(bp.team_member_limit,bp.included_seats)
      from public.org_subscriptions s
      join public.billing_plans bp on bp.id=s.plan_id
      where s.org_id=p_org and s.status in ('active','trialing')
      order by s.updated_at desc limit 1
    ),
    (
      select coalesce(bp.team_member_limit,bp.included_seats)
      from public.organizations o
      join public.billing_plans bp on bp.code=o.plan or bp.key=o.plan
      where o.id=p_org and bp.active
      order by bp.updated_at desc limit 1
    ),
    1
  ))
$$;

create or replace function public.social_org_seats_used(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select count(*)::integer from public.org_memberships
  where org_id=p_org and status='active' and deleted_at is null
$$;

create or replace function public.social_org_role_to_care_role(p_role text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case p_role
    when 'firm_manager' then 'program_director'
    when 'supervisor' then 'case_management_supervisor'
    when 'case_worker' then 'case_manager'
    when 'legal_provider' then 'attorney'
    when 'psychosocial_provider' then 'psychologist'
    when 'read_only' then 'read_only_reviewer'
    else 'read_only_reviewer'
  end
$$;

create or replace function public.invite_social_organization_member(
  p_org uuid,p_email text,p_role text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_email text:=lower(btrim(coalesce(p_email,'')));
  v_token text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  v_id uuid;
  v_limit integer;
  v_used integer;
begin
  if not public.social_can_manage_org(p_org,auth.uid()) then
    raise exception 'Organization manager authority required';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid email address is required';
  end if;
  if p_role not in ('firm_manager','supervisor','case_worker','legal_provider','psychosocial_provider','read_only') then
    raise exception 'Unsupported organization role';
  end if;
  if exists(select 1 from public.org_memberships m join public.profiles p on p.id=m.user_id
    where m.org_id=p_org and lower(p.email)=v_email and m.status='active' and m.deleted_at is null) then
    raise exception 'That person is already an active organization member';
  end if;
  update public.organization_invitations set status='expired'
    where org_id=p_org and status='invited' and expires_at<=now();
  v_limit:=public.social_org_seat_limit(p_org);
  v_used:=public.social_org_seats_used(p_org)
    +(select count(*)::integer from public.organization_invitations
      where org_id=p_org and status='invited' and expires_at>now());
  if v_used>=v_limit then raise exception 'Organization seat limit reached'; end if;

  update public.organization_invitations set status='revoked',revoked_at=now()
    where org_id=p_org and email=v_email and status='invited';
  insert into public.organization_invitations(
    org_id,email,role,token_hash,invited_by
  ) values(p_org,v_email,p_role,encode(digest(v_token,'sha256'),'hex'),auth.uid())
  returning id into v_id;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(p_org,auth.uid(),'member_invited','organization_membership',v_id,
    jsonb_build_object('role',p_role));

  return jsonb_build_object(
    'id',v_id,'email',v_email,'role',p_role,'token',v_token,
    'expires_at',now()+interval '7 days','seat_limit',v_limit,'seats_used',v_used+1
  );
end
$$;

create or replace function public.accept_social_organization_invitation(p_token text)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_inv public.organization_invitations%rowtype;
  v_org_role text;
  v_social_role text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select lower(email) into v_email from auth.users where id=v_user;
  select * into v_inv from public.organization_invitations
    where token_hash=encode(digest(p_token,'sha256'),'hex')
      and status='invited' and expires_at>now() for update;
  if not found then raise exception 'Invitation is invalid or expired'; end if;
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'Invitation email does not match the signed-in account';
  end if;
  if public.social_org_seats_used(v_inv.org_id)>=public.social_org_seat_limit(v_inv.org_id) then
    raise exception 'Organization seat limit reached';
  end if;

  v_org_role:=v_inv.role;
  insert into public.org_memberships(org_id,user_id,role_in_org,status,invited_by,deleted_at)
  values(v_inv.org_id,v_user,v_org_role::public.org_role,'active',v_inv.invited_by,null)
  on conflict (org_id,user_id) do update set
    role_in_org=excluded.role_in_org,status='active',invited_by=excluded.invited_by,
    deleted_at=null,updated_at=now();

  v_social_role:=public.social_org_role_to_care_role(v_inv.role);
  update public.social_role_assignments set active=false,ends_at=now()
    where org_id=v_inv.org_id and user_id=v_user and scope_type='organization' and active;
  insert into public.social_role_assignments(
    org_id,user_id,role,scope_type,active,assigned_by
  ) values(v_inv.org_id,v_user,v_social_role,'organization',true,v_inv.invited_by);

  update public.organization_invitations set
    status='accepted',accepted_by=v_user,accepted_at=now()
  where id=v_inv.id;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(v_inv.org_id,v_user,'member_joined','organization_membership',v_inv.id,
    jsonb_build_object('role',v_inv.role));

  return jsonb_build_object('organization_id',v_inv.org_id,'role',v_inv.role,'status','active');
end
$$;

create or replace function public.set_social_organization_member(
  p_org uuid,p_user uuid,p_role text,p_status text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_owner boolean; v_social_role text;
begin
  if not public.social_can_manage_org(p_org,v_actor) then
    raise exception 'Organization manager authority required';
  end if;
  if p_user=v_actor and p_status in ('suspended','removed') then
    raise exception 'Managers cannot remove or suspend their own account';
  end if;
  if p_role not in ('firm_manager','supervisor','case_worker','legal_provider','psychosocial_provider','read_only') then
    raise exception 'Unsupported organization role';
  end if;
  if p_status not in ('active','suspended','removed') then
    raise exception 'Unsupported membership status';
  end if;
  select role_in_org::text='owner' into v_owner from public.org_memberships
    where org_id=p_org and user_id=p_user and deleted_at is null;
  if coalesce(v_owner,false) then raise exception 'Organization owner cannot be changed here'; end if;

  update public.org_memberships set
    role_in_org=p_role::public.org_role,status=p_status::public.membership_status,
    deleted_at=case when p_status='removed' then now() else null end,updated_at=now()
  where org_id=p_org and user_id=p_user;
  if not found then raise exception 'Organization member not found'; end if;

  update public.social_case_assignments set active=false,ended_at=now()
    where org_id=p_org and user_id=p_user and active and p_status<>'active';
  update public.social_role_assignments set active=false,ends_at=now()
    where org_id=p_org and user_id=p_user and active;

  if p_status='active' then
    v_social_role:=public.social_org_role_to_care_role(p_role);
    insert into public.social_role_assignments(
      org_id,user_id,role,scope_type,active,assigned_by
    ) values(p_org,p_user,v_social_role,'organization',true,v_actor);
  end if;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(p_org,v_actor,'member_'||p_status,'organization_membership',p_user,
    jsonb_build_object('role',p_role,'status',p_status));

  return jsonb_build_object('user_id',p_user,'role',p_role,'status',p_status);
end
$$;

create or replace function public.get_social_organization_account(p_org uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if not public.social_is_org_member(p_org,auth.uid()) then
    raise exception 'Active organization membership required';
  end if;
  select jsonb_build_object(
    'can_manage',public.social_can_manage_org(p_org,auth.uid()),
    'seat_limit',public.social_org_seat_limit(p_org),
    'seats_used',public.social_org_seats_used(p_org),
    'members',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'user_id',m.user_id,'role',m.role_in_org::text,'status',m.status::text,
        'name',coalesce(p.display_name,p.full_name,p.email,'Member'),
        'email',case when public.social_can_manage_org(p_org,auth.uid()) then p.email else null end,
        'joined_at',m.created_at,
        'assigned_cases',(select count(*) from public.social_case_assignments a where a.org_id=p_org and a.user_id=m.user_id and a.active),
        'open_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assigned_to=m.user_id and t.status not in ('done','cancelled')),
        'overdue_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assigned_to=m.user_id and t.status not in ('done','cancelled') and t.due_at<now()),
        'completed_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assigned_to=m.user_id and t.status='done'),
        'referrals',(select count(*) from public.social_referrals r where r.org_id=p_org and r.created_by=m.user_id),
        'last_activity',(select max(e.occurred_at) from public.social_activity_events e where e.org_id=p_org and e.actor_id=m.user_id)
      ) order by coalesce(p.display_name,p.full_name,p.email),m.created_at)
      from public.org_memberships m left join public.profiles p on p.id=m.user_id
      where m.org_id=p_org and m.deleted_at is null
    ),'[]'::jsonb),
    'invitations',case when public.social_can_manage_org(p_org,auth.uid()) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'email',i.email,'role',i.role,'status',
        case when i.status='invited' and i.expires_at<=now() then 'expired' else i.status end,
        'invited_at',i.invited_at,'expires_at',i.expires_at
      ) order by i.invited_at desc)
      from public.organization_invitations i where i.org_id=p_org
    ),'[]'::jsonb) else '[]'::jsonb end,
    'recent_activity',coalesce((
      select jsonb_agg(x.row order by x.occurred_at desc) from (
        select jsonb_build_object(
          'id',e.id,'actor_id',e.actor_id,'event_type',e.event_type,
          'entity_type',e.entity_type,'occurred_at',e.occurred_at,
          'case_number',c.case_number
        ) row,e.occurred_at
        from public.social_activity_events e
        left join public.social_cases c on c.id=e.social_case_id
        where e.org_id=p_org order by e.occurred_at desc limit 100
      ) x
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

drop policy if exists organization_invitations_manage on public.organization_invitations;
create policy organization_invitations_manage on public.organization_invitations
for select to authenticated
using (public.social_can_manage_org(org_id,auth.uid()) or accepted_by=auth.uid());

revoke all on function public.social_org_seat_limit(uuid) from public,anon;
revoke all on function public.social_org_seats_used(uuid) from public,anon;
revoke all on function public.invite_social_organization_member(uuid,text,text) from public,anon;
revoke all on function public.accept_social_organization_invitation(text) from public,anon;
revoke all on function public.set_social_organization_member(uuid,uuid,text,text) from public,anon;
revoke all on function public.get_social_organization_account(uuid) from public,anon;
grant execute on function public.social_org_seat_limit(uuid) to authenticated,service_role;
grant execute on function public.social_org_seats_used(uuid) to authenticated,service_role;
grant execute on function public.invite_social_organization_member(uuid,text,text) to authenticated;
grant execute on function public.accept_social_organization_invitation(text) to authenticated;
grant execute on function public.set_social_organization_member(uuid,uuid,text,text) to authenticated;
grant execute on function public.get_social_organization_account(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
