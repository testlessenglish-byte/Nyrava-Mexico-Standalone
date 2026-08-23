-- Rollback for 20260823030000_care_case_lifecycle_integrity.sql.
-- Restores the prior Phase 3 closure routine. Existing closure records remain immutable.

create or replace function public.close_social_case(
  p_case uuid,
  p_reason text,
  p_final_risk text,
  p_summary jsonb
) returns uuid
language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype;
declare v_id uuid;
declare v_version integer;
begin
  select * into c from public.social_cases where id=p_case for update;
  if not found or not (
    public.can_manage_org(c.org_id,auth.uid())
    or public.social_has_capability(c.org_id,'closure.approve',auth.uid())
  ) then raise exception 'Closure approval denied'; end if;
  if p_reason not in ('services_completed','client_withdrew','unable_to_contact','transferred','ineligible','relocated','duplicate_case','other') then
    raise exception 'Invalid closure reason';
  end if;
  if p_final_risk not in ('unknown','low','moderate','high','critical') then raise exception 'Invalid risk'; end if;
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
    p_summary->>'goals_completed',p_summary->>'goals_incomplete',
    p_summary->>'referrals_completed',p_summary->>'pending_referrals',
    p_summary->>'outstanding_deadlines',p_summary->>'client_notification',
    p_summary->>'document_disposition',p_summary->>'retention_status',
    auth.uid(),auth.uid(),now(),now()
  ) returning id into v_id;
  update public.social_cases set status='closed',closure_date=now(),updated_at=now() where id=c.id;
  return v_id;
end;
$$;

revoke all on function public.close_social_case(uuid,text,text,jsonb) from public;
grant execute on function public.close_social_case(uuid,text,text,jsonb) to authenticated;
