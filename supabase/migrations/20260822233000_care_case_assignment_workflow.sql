begin;

-- Canonical case priorities for Comprehensive Care. Legacy values are
-- normalized once so new and historical reports use the same vocabulary.
alter table public.social_cases drop constraint if exists social_cases_priority_check;
update public.social_cases
set priority=case
  when priority in ('low','normal') then 'standard'
  when priority in ('high','urgent') then 'urgent'
  else priority
end
where priority in ('low','normal','high','urgent');
alter table public.social_cases alter column priority set default 'standard';
alter table public.social_cases add constraint social_cases_priority_check
  check(priority in ('standard','urgent','emergency'));

create table if not exists public.social_case_status_history(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  social_case_id uuid not null references public.social_cases(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid not null references auth.users(id),
  reason text not null,
  changed_at timestamptz not null default now()
);
create index if not exists social_case_status_history_case_time_idx
  on public.social_case_status_history(social_case_id,changed_at desc);
alter table public.social_case_status_history enable row level security;
revoke all on public.social_case_status_history from anon,public;
grant select on public.social_case_status_history to authenticated;
grant all on public.social_case_status_history to service_role;
drop policy if exists social_case_status_history_read on public.social_case_status_history;
create policy social_case_status_history_read on public.social_case_status_history
for select to authenticated
using(public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()));

create or replace function public.create_and_assign_care_case(
  p_org uuid,
  p_program uuid,
  p_person uuid,
  p_client_name text,
  p_family uuid,
  p_case_type text,
  p_priority text,
  p_assigned_user uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $care_case$
declare
  v_actor uuid:=auth.uid();
  v_case public.social_cases%rowtype;
  v_client_name text;
  v_assignee_name text;
  v_due timestamptz;
  v_person_id uuid:=p_person;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.social_is_org_member(p_org,v_actor) then
    raise exception 'Active organization membership required' using errcode='42501';
  end if;
  if not (public.social_can_manage_org(p_org,v_actor)
    or public.social_has_capability(p_org,'case.create',v_actor)) then
    raise exception 'Case creation denied for this organization' using errcode='42501';
  end if;
  if not exists(select 1 from public.social_programs
    where id=p_program and org_id=p_org and active) then
    raise exception 'Invalid or inactive Comprehensive Care program';
  end if;
  if v_person_id is null then
    if length(btrim(coalesce(p_client_name,'')))<2 then
      raise exception 'Select an existing client or enter the new client legal name';
    end if;
    insert into public.social_people(
      org_id,person_number,legal_name,aliases,languages,current_location,
      immigration_identifiers,unaccompanied_minor,separated_minor,
      assigned_case_manager,created_by
    ) values(
      p_org,null,btrim(p_client_name),'{}'::text[],'{}'::text[],'{}'::jsonb,
      '{}'::jsonb,false,false,coalesce(p_assigned_user,v_actor),v_actor
    ) returning id into v_person_id;
  elsif not exists(select 1 from public.social_people
    where id=v_person_id and org_id=p_org and deleted_at is null) then
    raise exception 'The selected client is outside this organization';
  end if;
  if p_family is not null and not exists(select 1 from public.social_families
    where id=p_family and org_id=p_org and deleted_at is null) then
    raise exception 'Family is outside this organization';
  end if;
  if p_case_type not in ('individual','minor_child','family') then
    raise exception 'Case type must be individual, minor_child, or family';
  end if;
  if p_priority not in ('standard','urgent','emergency') then
    raise exception 'Priority must be standard, urgent, or emergency';
  end if;
  if p_assigned_user is not null and not exists(
    select 1 from public.org_memberships m
    where m.org_id=p_org and m.user_id=p_assigned_user
      and m.status='active' and m.deleted_at is null
  ) then raise exception 'The selected team member is not active in this organization'; end if;

  select legal_name into v_client_name from public.social_people where id=v_person_id;
  if p_assigned_user is not null then
    select coalesce(p.display_name,p.full_name,p.email,'Team member')
      into v_assignee_name from public.profiles p where p.id=p_assigned_user;
  end if;

  insert into public.social_cases(
    org_id,program_id,person_id,family_id,case_type,assigned_case_manager,
    supervising_manager,status,priority,risk_level,confidentiality_level,
    service_areas,tags,created_by
  ) values(
    p_org,p_program,v_person_id,p_family,p_case_type,p_assigned_user,v_actor,
    'intake',p_priority,'unknown','standard','{}'::text[],'{}'::text[],v_actor
  ) returning * into v_case;

  if p_assigned_user is not null then
    insert into public.social_case_assignments(
      org_id,social_case_id,user_id,assignment_role,assigned_by
    ) values(p_org,v_case.id,p_assigned_user,'primary_case_manager',v_actor)
    on conflict do nothing;
  end if;

  insert into public.social_case_status_history(
    org_id,social_case_id,from_status,to_status,changed_by,reason
  ) values(p_org,v_case.id,null,'intake',v_actor,'Case opened; displayed as New');

  insert into public.social_activity_events(
    org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    p_org,v_case.id,v_actor,'case_opened_and_assigned','social_case',v_case.id,
    jsonb_build_object(
      'case_type',p_case_type,'priority',p_priority,
      'assigned_user_id',p_assigned_user,'supervising_manager',v_actor
    )
  );

  insert into public.social_alerts(
    org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,
    assigned_to,metadata
  ) values(
    p_org,v_case.id,'new_case_assignment',
    case when p_priority='emergency' then 'critical'
         when p_priority='urgent' then 'high' else 'info' end,
    'Nuevo caso asignado: '||v_client_name,
    'New case assigned: '||v_client_name,
    case when p_priority='emergency' then now()+interval '15 minutes'
         when p_priority='urgent' then now()+interval '4 hours' else null end,
    coalesce(p_assigned_user,v_actor),
    jsonb_build_object('case_id',v_case.id,'case_number',v_case.case_number,
      'priority',p_priority,'assigned_by',v_actor,'requires_acknowledgement',p_priority<>'standard')
  );

  if p_priority in ('urgent','emergency') then
    v_due:=case when p_priority='emergency' then now()+interval '15 minutes'
                else now()+interval '4 hours' end;
    insert into public.social_tasks(
      org_id,social_case_id,title,description,assignee_id,priority,status,
      due_at,reminder_at,supervisor_escalation_at,created_by
    ) values(
      p_org,v_case.id,
      case when p_priority='emergency' then 'Immediate emergency response and acknowledgement'
           else 'Acknowledge urgent case assignment' end,
      'Review the new assignment, document the initial response, and acknowledge it. This system does not replace emergency services.',
      coalesce(p_assigned_user,v_actor),'urgent','todo',v_due,
      case when p_priority='emergency' then now()+interval '5 minutes' else now()+interval '2 hours' end,
      v_due,v_actor
    );
  end if;

  if p_priority='emergency' and p_assigned_user is distinct from v_actor then
    insert into public.social_alerts(
      org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,
      assigned_to,metadata
    ) values(
      p_org,v_case.id,'emergency_case_supervision','critical',
      'Supervisión inmediata requerida: '||v_case.case_number,
      'Immediate supervision required: '||v_case.case_number,
      now()+interval '15 minutes',v_actor,
      jsonb_build_object('case_id',v_case.id,'assigned_user_id',p_assigned_user)
    );
  end if;

  return to_jsonb(v_case)||jsonb_build_object(
    'display_status','new','client_name',v_client_name,
    'assigned_user_name',v_assignee_name
  );
end
$care_case$;

-- Retire the partial creator-only RPC for signed-in clients. Historical
-- migrations remain immutable; this forward migration is authoritative.
revoke all on function public.create_social_case(
  uuid,uuid,uuid,uuid,text,text,text[],text,text,text,text[]
) from authenticated,anon,public;
revoke all on function public.create_and_assign_care_case(
  uuid,uuid,uuid,text,uuid,text,text,uuid
) from public,anon;
grant execute on function public.create_and_assign_care_case(
  uuid,uuid,uuid,text,uuid,text,text,uuid
) to authenticated,service_role;

-- Correct the old team summary's stale social_tasks.assigned_to reference
-- and include each member's account title for the Account team roster.
create or replace function public.get_social_organization_account(p_org uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $organization_account$
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
        'title',s.title,'joined_at',m.created_at,
        'assigned_cases',(select count(*) from public.social_case_assignments a where a.org_id=p_org and a.user_id=m.user_id and a.active),
        'open_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assignee_id=m.user_id and t.status not in ('done','cancelled')),
        'overdue_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assignee_id=m.user_id and t.status not in ('done','cancelled') and t.due_at<now()),
        'completed_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assignee_id=m.user_id and t.status='done'),
        'referrals',(select count(*) from public.social_referrals r where r.org_id=p_org and r.created_by=m.user_id),
        'last_activity',(select max(e.occurred_at) from public.social_activity_events e where e.org_id=p_org and e.actor_id=m.user_id)
      ) order by coalesce(p.display_name,p.full_name,p.email),m.created_at)
      from public.org_memberships m
      left join public.profiles p on p.id=m.user_id
      left join public.user_settings s on s.user_id=m.user_id
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
          'entity_type',e.entity_type,'entity_id',e.entity_id,
          'occurred_at',e.occurred_at,'case_number',c.case_number
        ) row,e.occurred_at
        from public.social_activity_events e
        left join public.social_cases c on c.id=e.social_case_id
        where e.org_id=p_org order by e.occurred_at desc limit 100
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

