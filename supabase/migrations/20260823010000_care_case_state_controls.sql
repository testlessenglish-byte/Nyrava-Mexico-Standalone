begin;

-- Controlled case-header changes for Comprehensive Care.
-- Closure, reopening and transfer remain in their dedicated authorized workflows.

alter table public.social_case_status_history
  add column if not exists change_kind text not null default 'status',
  add column if not exists from_priority text,
  add column if not exists to_priority text;

alter table public.social_case_status_history
  drop constraint if exists social_case_status_history_change_kind_check;
alter table public.social_case_status_history
  add constraint social_case_status_history_change_kind_check
  check (change_kind in ('status','priority','status_and_priority','created','reopened','closed','transferred'));

alter table public.social_case_status_history
  drop constraint if exists social_case_status_history_priority_check;
alter table public.social_case_status_history
  add constraint social_case_status_history_priority_check
  check (
    (from_priority is null or from_priority in ('standard','urgent','emergency'))
    and (to_priority is null or to_priority in ('standard','urgent','emergency'))
  );

create or replace function public.update_care_case_state(
  p_case uuid,
  p_status text,
  p_priority text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $update_case_state$
declare
  v_actor uuid := auth.uid();
  v_case public.social_cases%rowtype;
  v_status text;
  v_priority text;
  v_kind text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_case
  from public.social_cases
  where id = p_case
  for update;

  if not found then
    raise exception 'Comprehensive Care case not found';
  end if;

  if not public.social_can_access_case(
    v_case.id, 'general_case_record', true, v_actor
  ) then
    raise exception 'Case state change denied' using errcode = '42501';
  end if;

  if v_case.status = 'closed' then
    raise exception 'Closed cases must use the authorized reopening workflow';
  end if;

  v_status := coalesce(nullif(btrim(p_status), ''), v_case.status);
  v_priority := coalesce(nullif(btrim(p_priority), ''), v_case.priority);

  if v_case.status in ('transferred','archived') then
    raise exception 'Transferred or archived cases cannot be changed from the case header';
  end if;

  if v_status in ('closed','reopened','transferred','archived')
    and v_status is distinct from v_case.status
  then
    raise exception 'Use the dedicated closure, reopening, transfer, or archive workflow';
  end if;

  if v_priority not in ('standard','urgent','emergency') then
    raise exception 'Priority must be standard, urgent, or emergency';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A documented reason of at least five characters is required';
  end if;

  if v_status is distinct from v_case.status and not (
    (v_case.status = 'intake' and v_status in ('assessment','active'))
    or (v_case.status = 'assessment' and v_status in ('active','monitoring'))
    or (v_case.status = 'active' and v_status in ('monitoring','pending_referral'))
    or (v_case.status = 'monitoring' and v_status in ('active','pending_referral'))
    or (v_case.status = 'pending_referral' and v_status in ('active','monitoring'))
    or (v_case.status = 'reopened' and v_status in ('assessment','active'))
  ) then
    raise exception 'Invalid Comprehensive Care status transition: % to %',
      v_case.status, v_status;
  end if;

  if v_status = v_case.status and v_priority = v_case.priority then
    raise exception 'Status and priority are unchanged';
  end if;

  v_kind := case
    when v_status is distinct from v_case.status
      and v_priority is distinct from v_case.priority
      then 'status_and_priority'
    when v_status is distinct from v_case.status then 'status'
    else 'priority'
  end;

  update public.social_cases
  set status = v_status,
      priority = v_priority,
      updated_at = now(),
      last_activity_at = now()
  where id = v_case.id;

  insert into public.social_case_status_history(
    org_id, social_case_id, from_status, to_status,
    changed_by, reason, change_kind, from_priority, to_priority
  )
  values(
    v_case.org_id, v_case.id, v_case.status, v_status,
    v_actor, btrim(p_reason), v_kind, v_case.priority, v_priority
  );

  insert into public.social_activity_events(
    org_id, social_case_id, actor_id, event_type,
    entity_type, entity_id, metadata
  )
  values(
    v_case.org_id, v_case.id, v_actor, 'case_state_changed',
    'social_case', v_case.id,
    jsonb_build_object(
      'change_kind', v_kind,
      'from_status', v_case.status,
      'to_status', v_status,
      'from_priority', v_case.priority,
      'to_priority', v_priority,
      'reason', btrim(p_reason)
    )
  );

  if v_priority = 'emergency'
    and v_case.priority is distinct from 'emergency'
  then
    insert into public.social_alerts(
      org_id, social_case_id, alert_type, severity,
      title_es, title_en, due_at, assigned_to, metadata
    )
    values(
      v_case.org_id, v_case.id, 'emergency_priority_escalation', 'critical',
      'Prioridad de emergencia: ' || v_case.case_number,
      'Emergency priority: ' || v_case.case_number,
      now() + interval '15 minutes',
      coalesce(v_case.assigned_case_manager, v_actor),
      jsonb_build_object(
        'case_id', v_case.id,
        'changed_by', v_actor,
        'reason', btrim(p_reason),
        'requires_acknowledgement', true
      )
    );

    insert into public.social_tasks(
      org_id, social_case_id, title, description,
      assignee_id, priority, status, due_at,
      reminder_at, supervisor_escalation_at, created_by
    )
    values(
      v_case.org_id, v_case.id,
      'Immediate emergency response and acknowledgement',
      'Review the emergency-priority change, document the response, and acknowledge it. This system does not replace emergency services.',
      coalesce(v_case.assigned_case_manager, v_actor),
      'urgent', 'todo',
      now() + interval '15 minutes',
      now() + interval '5 minutes',
      now() + interval '15 minutes',
      v_actor
    );
  end if;

  select * into v_case
  from public.social_cases
  where id = p_case;

  return to_jsonb(v_case);
end
$update_case_state$;

revoke all on function public.update_care_case_state(
  uuid, text, text, text
) from public, anon;

grant execute on function public.update_care_case_state(
  uuid, text, text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
