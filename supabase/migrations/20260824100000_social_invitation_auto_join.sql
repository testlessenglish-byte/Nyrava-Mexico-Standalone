begin;

-- Complete organization invitations through two secure paths:
-- 1) managers immediately activate an already-registered account; and
-- 2) a signed-in invitee claims pending invitations matching only their auth email.
-- This keeps one canonical organization/membership boundary and makes active
-- invitees available to case assignment without creating duplicate accounts.

create or replace function public.activate_existing_social_invitee(p_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $activate_existing_invitee$
declare
  v_actor uuid:=auth.uid();
  v_user uuid;
  v_inv public.organization_invitations%rowtype;
  v_social_role text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select * into v_inv
  from public.organization_invitations
  where id=p_invitation and status='invited' and expires_at>now()
  for update;

  if not found then
    return jsonb_build_object('activated',false,'reason','invitation_not_pending');
  end if;
  if not public.social_can_manage_org(v_inv.org_id,v_actor) then
    raise exception 'Organization manager authority required' using errcode='42501';
  end if;

  select id into v_user
  from auth.users
  where lower(email)=lower(v_inv.email)
  order by created_at
  limit 1;

  if v_user is null then
    return jsonb_build_object('activated',false,'reason','account_not_registered');
  end if;
  if public.social_org_seats_used(v_inv.org_id)>=public.social_org_seat_limit(v_inv.org_id)
     and not exists(
       select 1 from public.org_memberships
       where org_id=v_inv.org_id and user_id=v_user
         and status='active' and deleted_at is null
     ) then
    raise exception 'Organization seat limit reached';
  end if;

  insert into public.org_memberships(org_id,user_id,role_in_org,status,invited_by,deleted_at)
  values(v_inv.org_id,v_user,v_inv.role::public.org_role,'active',v_actor,null)
  on conflict (org_id,user_id) do update set
    role_in_org=excluded.role_in_org,status='active',invited_by=excluded.invited_by,
    deleted_at=null,updated_at=now();

  v_social_role:=public.social_org_role_to_care_role(v_inv.role);
  update public.social_role_assignments
  set active=false,ends_at=now()
  where org_id=v_inv.org_id and user_id=v_user
    and scope_type='organization' and active;
  insert into public.social_role_assignments(
    org_id,user_id,role,scope_type,active,assigned_by
  ) values(v_inv.org_id,v_user,v_social_role,'organization',true,v_actor);

  update public.organization_invitations
  set status='accepted',accepted_by=v_user,accepted_at=now()
  where id=v_inv.id;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_inv.org_id,v_actor,'member_joined','organization_membership',v_inv.id,
    jsonb_build_object(
      'role',v_inv.role,'user_id',v_user,'activation','manager_invite_existing_account'
    )
  );

  return jsonb_build_object(
    'activated',true,'organization_id',v_inv.org_id,'user_id',v_user,
    'role',v_inv.role,'status','active'
  );
end
$activate_existing_invitee$;

create or replace function public.accept_matching_social_organization_invitations()
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $accept_matching_invitations$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_inv public.organization_invitations%rowtype;
  v_social_role text;
  v_accepted jsonb:='[]'::jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select lower(email) into v_email from auth.users where id=v_user;
  if v_email is null then
    raise exception 'Signed-in account has no verified email' using errcode='42501';
  end if;

  update public.organization_invitations
  set status='expired'
  where status='invited' and expires_at<=now() and lower(email)=v_email;

  for v_inv in
    select *
    from public.organization_invitations
    where status='invited' and expires_at>now() and lower(email)=v_email
    order by invited_at
    for update
  loop
    if public.social_org_seats_used(v_inv.org_id)>=public.social_org_seat_limit(v_inv.org_id)
       and not exists(
         select 1 from public.org_memberships
         where org_id=v_inv.org_id and user_id=v_user
           and status='active' and deleted_at is null
       ) then
      continue;
    end if;

    insert into public.org_memberships(org_id,user_id,role_in_org,status,invited_by,deleted_at)
    values(v_inv.org_id,v_user,v_inv.role::public.org_role,'active',v_inv.invited_by,null)
    on conflict (org_id,user_id) do update set
      role_in_org=excluded.role_in_org,status='active',invited_by=excluded.invited_by,
      deleted_at=null,updated_at=now();

    v_social_role:=public.social_org_role_to_care_role(v_inv.role);
    update public.social_role_assignments
    set active=false,ends_at=now()
    where org_id=v_inv.org_id and user_id=v_user
      and scope_type='organization' and active;
    insert into public.social_role_assignments(
      org_id,user_id,role,scope_type,active,assigned_by
    ) values(v_inv.org_id,v_user,v_social_role,'organization',true,v_inv.invited_by);

    update public.organization_invitations
    set status='accepted',accepted_by=v_user,accepted_at=now()
    where id=v_inv.id;

    insert into public.social_activity_events(
      org_id,actor_id,event_type,entity_type,entity_id,metadata
    ) values(
      v_inv.org_id,v_user,'member_joined','organization_membership',v_inv.id,
      jsonb_build_object('role',v_inv.role,'activation','signed_in_email_match')
    );

    v_accepted:=v_accepted||jsonb_build_array(jsonb_build_object(
      'organization_id',v_inv.org_id,
      'organization_name',(select name from public.organizations where id=v_inv.org_id),
      'role',v_inv.role,'status','active'
    ));
  end loop;

  return jsonb_build_object(
    'accepted',v_accepted,
    'accepted_count',jsonb_array_length(v_accepted)
  );
end
$accept_matching_invitations$;

-- Make token acceptance idempotent because an existing account may already
-- have been activated by the manager before the invitee opens the email.
create or replace function public.accept_social_organization_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $accept_invitation_token$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_inv public.organization_invitations%rowtype;
  v_social_role text;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select lower(email) into v_email from auth.users where id=v_user;

  select * into v_inv
  from public.organization_invitations
  where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  for update;

  if not found or v_inv.expires_at<=now() or v_inv.status in ('revoked','expired') then
    raise exception 'Invitation is invalid or expired';
  end if;
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'Invitation email does not match the signed-in account';
  end if;

  if v_inv.status='accepted' then
    if v_inv.accepted_by is distinct from v_user then
      raise exception 'Invitation was accepted by another account';
    end if;
    return jsonb_build_object(
      'organization_id',v_inv.org_id,'role',v_inv.role,'status','active',
      'already_accepted',true
    );
  end if;

  if public.social_org_seats_used(v_inv.org_id)>=public.social_org_seat_limit(v_inv.org_id)
     and not exists(
       select 1 from public.org_memberships
       where org_id=v_inv.org_id and user_id=v_user
         and status='active' and deleted_at is null
     ) then
    raise exception 'Organization seat limit reached';
  end if;

  insert into public.org_memberships(org_id,user_id,role_in_org,status,invited_by,deleted_at)
  values(v_inv.org_id,v_user,v_inv.role::public.org_role,'active',v_inv.invited_by,null)
  on conflict (org_id,user_id) do update set
    role_in_org=excluded.role_in_org,status='active',invited_by=excluded.invited_by,
    deleted_at=null,updated_at=now();

  v_social_role:=public.social_org_role_to_care_role(v_inv.role);
  update public.social_role_assignments
  set active=false,ends_at=now()
  where org_id=v_inv.org_id and user_id=v_user
    and scope_type='organization' and active;
  insert into public.social_role_assignments(
    org_id,user_id,role,scope_type,active,assigned_by
  ) values(v_inv.org_id,v_user,v_social_role,'organization',true,v_inv.invited_by);

  update public.organization_invitations
  set status='accepted',accepted_by=v_user,accepted_at=now()
  where id=v_inv.id;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_inv.org_id,v_user,'member_joined','organization_membership',v_inv.id,
    jsonb_build_object('role',v_inv.role,'activation','invitation_token')
  );

  return jsonb_build_object(
    'organization_id',v_inv.org_id,'role',v_inv.role,'status','active',
    'already_accepted',false
  );
end
$accept_invitation_token$;

revoke all on function public.activate_existing_social_invitee(uuid) from public,anon;
grant execute on function public.activate_existing_social_invitee(uuid) to authenticated,service_role;
revoke all on function public.accept_matching_social_organization_invitations() from public,anon;
grant execute on function public.accept_matching_social_organization_invitations() to authenticated,service_role;
revoke all on function public.accept_social_organization_invitation(text) from public,anon;
grant execute on function public.accept_social_organization_invitation(text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
