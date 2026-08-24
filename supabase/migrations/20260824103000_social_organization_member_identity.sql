begin;

-- Organization rosters and case assignment must use the identity captured for
-- this organization. Global account profile fields are fallback values only.
create or replace function public.get_social_organization_account(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $organization_account$
declare
  v_result jsonb;
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
        'id',m.id,
        'user_id',m.user_id,
        'role',m.role_in_org::text,
        'status',m.status::text,
        'name',coalesce(nullif(btrim(inv.invitee_name),''),p.display_name,p.full_name,p.email,'Member'),
        'email',case when public.social_can_manage_org(p_org,auth.uid()) then p.email else null end,
        'title',coalesce(nullif(btrim(inv.invitee_title),''),s.title),
        'joined_at',m.created_at,
        'assigned_cases',(select count(*) from public.social_case_assignments a where a.org_id=p_org and a.user_id=m.user_id and a.active),
        'open_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assignee_id=m.user_id and t.status not in ('done','cancelled')),
        'overdue_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assignee_id=m.user_id and t.status not in ('done','cancelled') and t.due_at<now()),
        'completed_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assignee_id=m.user_id and t.status='done'),
        'referrals',(select count(*) from public.social_referrals r where r.org_id=p_org and r.created_by=m.user_id),
        'last_activity',(select max(e.occurred_at) from public.social_activity_events e where e.org_id=p_org and e.actor_id=m.user_id)
      ) order by coalesce(nullif(btrim(inv.invitee_name),''),p.display_name,p.full_name,p.email),m.created_at)
      from public.org_memberships m
      left join public.profiles p on p.id=m.user_id
      left join public.user_settings s on s.user_id=m.user_id
      left join lateral (
        select i.invitee_name,i.invitee_title
        from public.organization_invitations i
        where i.org_id=p_org
          and i.accepted_by=m.user_id
          and i.status='accepted'
        order by i.accepted_at desc nulls last,i.invited_at desc
        limit 1
      ) inv on true
      where m.org_id=p_org and m.deleted_at is null
    ),'[]'::jsonb),
    'invitations',case when public.social_can_manage_org(p_org,auth.uid()) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,
        'email',i.email,
        'name',i.invitee_name,
        'title',i.invitee_title,
        'role',i.role,
        'status',case when i.status='invited' and i.expires_at<=now() then 'expired' else i.status end,
        'invited_at',i.invited_at,
        'expires_at',i.expires_at
      ) order by i.invited_at desc)
      from public.organization_invitations i
      where i.org_id=p_org
    ),'[]'::jsonb) else '[]'::jsonb end,
    'recent_activity',coalesce((
      select jsonb_agg(x.row order by x.occurred_at desc)
      from (
        select jsonb_build_object(
          'id',e.id,
          'actor_id',e.actor_id,
          'event_type',e.event_type,
          'entity_type',e.entity_type,
          'entity_id',e.entity_id,
          'occurred_at',e.occurred_at,
          'case_number',c.case_number
        ) row,e.occurred_at
        from public.social_activity_events e
        left join public.social_cases c on c.id=e.social_case_id
        where e.org_id=p_org
        order by e.occurred_at desc
        limit 100
      ) x
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end
$organization_account$;

revoke all on function public.get_social_organization_account(uuid) from public,anon;
grant execute on function public.get_social_organization_account(uuid) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
