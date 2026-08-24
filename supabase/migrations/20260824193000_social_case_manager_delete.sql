begin;

alter table public.social_cases
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_reason text;

create or replace function public.delete_social_case_by_assigning_manager(
  p_case uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $delete_case$
declare
  v_actor uuid := auth.uid();
  v_case public.social_cases%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'A deletion reason of at least 5 characters is required';
  end if;

  select *
  into v_case
  from public.social_cases
  where id=p_case
  for update;

  if not found then
    raise exception 'Comprehensive Care case not found' using errcode='P0002';
  end if;

  if v_case.deleted_at is not null then
    raise exception 'This Comprehensive Care case has already been deleted';
  end if;

  -- The employee who receives the case is deliberately not authorized here.
  -- Only the manager who opened/assigned it may remove it.
  if v_case.created_by is distinct from v_actor
     and v_case.supervising_manager is distinct from v_actor then
    raise exception 'Only the manager who created and assigned this case may delete it'
      using errcode='42501';
  end if;

  if v_case.status='closed' then
    raise exception 'A closed case must be reopened before it can be deleted';
  end if;

  insert into public.social_activity_events(
    org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_case.org_id,v_case.id,v_actor,'case_deleted','social_cases',v_case.id,
    jsonb_build_object(
      'case_number',v_case.case_number,
      'reason',btrim(p_reason),
      'assigned_case_manager',v_case.assigned_case_manager,
      'supervising_manager',v_case.supervising_manager
    )
  );

  update public.social_case_assignments
  set active=false,
      ended_at=coalesce(ended_at,now())
  where social_case_id=v_case.id
    and active;

  update public.social_cases
  set deleted_at=now(),
      deleted_by=v_actor,
      deletion_reason=btrim(p_reason),
      updated_at=now()
  where id=v_case.id;

  return jsonb_build_object(
    'id',v_case.id,
    'case_number',v_case.case_number,
    'deleted',true
  );
end
$delete_case$;

revoke all on function public.delete_social_case_by_assigning_manager(uuid,text)
  from public, anon;
grant execute on function public.delete_social_case_by_assigning_manager(uuid,text)
  to authenticated, service_role;

notify pgrst,'reload schema';

commit;
