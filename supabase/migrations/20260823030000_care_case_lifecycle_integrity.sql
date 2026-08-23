-- Phase 6: end-to-end Comprehensive Care lifecycle integrity.
-- Prevents "services completed" closure while actionable work remains and records
-- a complete, immutable closure snapshot.

create or replace function public.close_social_case(
  p_case uuid,
  p_reason text,
  p_final_risk text,
  p_summary jsonb
) returns uuid
language plpgsql
security invoker
set search_path=public
as $$
declare
  c public.social_cases%rowtype;
  v_id uuid;
  v_version integer;
  v_completed_goals bigint;
  v_incomplete_goals bigint;
  v_completed_referrals bigint;
  v_pending_referrals bigint;
  v_open_tasks bigint;
begin
  select * into c from public.social_cases where id=p_case for update;
  if not found or not (
    public.can_manage_org(c.org_id,auth.uid())
    or public.social_has_capability(c.org_id,'closure.approve',auth.uid())
  ) then
    raise exception 'Closure approval denied';
  end if;

  if c.status='closed' then
    raise exception 'Case is already closed; use the authorized reopening workflow';
  end if;

  if p_reason not in ('services_completed','client_withdrew','unable_to_contact','transferred','ineligible','relocated','duplicate_case','other') then
    raise exception 'Invalid closure reason';
  end if;
  if p_final_risk not in ('unknown','low','moderate','high','critical') then
    raise exception 'Invalid risk';
  end if;

  if nullif(btrim(coalesce(p_summary->>'goals_completed','')),'') is null
     or nullif(btrim(coalesce(p_summary->>'client_notification','')),'') is null
     or nullif(btrim(coalesce(p_summary->>'document_disposition','')),'') is null
     or nullif(btrim(coalesce(p_summary->>'retention_status','')),'') is null then
    raise exception 'Closure summary, client notification, document disposition, and retention status are required';
  end if;

  select
    count(*) filter (where g.status in ('completed','done','achieved','cancelled')),
    count(*) filter (where g.status not in ('completed','done','achieved','cancelled'))
  into v_completed_goals,v_incomplete_goals
  from public.social_care_plans p
  join public.social_care_plan_versions v
    on v.care_plan_id=p.id and v.version=p.current_version
  join public.social_care_plan_goals g on g.care_plan_version_id=v.id
  where p.social_case_id=p_case;

  select
    count(*) filter (where r.status='completed'),
    count(*) filter (where r.status not in ('completed','rejected','unable_to_contact','cancelled'))
  into v_completed_referrals,v_pending_referrals
  from public.social_referrals r
  where r.social_case_id=p_case;

  select count(*) into v_open_tasks
  from public.social_tasks t
  where t.social_case_id=p_case and t.status not in ('done','cancelled');

  if p_reason='services_completed'
     and (v_incomplete_goals>0 or v_pending_referrals>0 or v_open_tasks>0) then
    raise exception 'Services cannot be marked completed while work remains (goals %, referrals %, tasks %)',
      v_incomplete_goals,v_pending_referrals,v_open_tasks;
  end if;

  select coalesce(max(closure_version),0)+1 into v_version
  from public.social_case_closures where social_case_id=p_case;

  insert into public.social_case_closures(
    org_id,social_case_id,closure_version,closure_reason,final_risk_level,
    goals_completed,goals_incomplete,referrals_completed,pending_referrals,
    outstanding_deadlines,client_notification,document_disposition,
    retention_status,closing_professional,supervisor_approval_by,
    supervisor_approved_at,closure_date
  ) values(
    c.org_id,c.id,v_version,p_reason,p_final_risk,
    format('%s; completed goals: %s',p_summary->>'goals_completed',v_completed_goals),
    format('incomplete goals: %s',v_incomplete_goals),
    format('completed referrals: %s',v_completed_referrals),
    format('pending referrals: %s',v_pending_referrals),
    format('open tasks or deadlines: %s',v_open_tasks),
    p_summary->>'client_notification',
    p_summary->>'document_disposition',
    p_summary->>'retention_status',
    auth.uid(),auth.uid(),now(),now()
  ) returning id into v_id;

  update public.social_cases
  set status='closed',closure_date=now(),updated_at=now()
  where id=c.id;

  insert into public.social_activity_events(
    org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    c.org_id,c.id,auth.uid(),'case_closed','social_case_closures',v_id,
    jsonb_build_object(
      'closure_version',v_version,
      'reason',p_reason,
      'final_risk',p_final_risk,
      'completed_goals',v_completed_goals,
      'incomplete_goals',v_incomplete_goals,
      'completed_referrals',v_completed_referrals,
      'pending_referrals',v_pending_referrals,
      'open_tasks',v_open_tasks
    )
  );

  return v_id;
end;
$$;

revoke all on function public.close_social_case(uuid,text,text,jsonb) from public;
grant execute on function public.close_social_case(uuid,text,text,jsonb) to authenticated;
