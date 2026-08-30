-- Keep final case/report release state in one transaction. Uses caller RLS.
create or replace function public.finalize_report_release(
  p_case_id uuid, p_execution_id uuid, p_report_id uuid,
  p_expected_full_report jsonb, p_full_report jsonb,
  p_released boolean, p_errors jsonb, p_status_message text
) returns void language plpgsql security invoker set search_path = public as $$
declare
  case_execution uuid;
  saved_report public.reports%rowtype;
begin
  if p_released is null or
    (p_full_report->'release_gate'->>'ok')::boolean is distinct from p_released or
    (p_full_report->'final_review'->>'released')::boolean is distinct from p_released or
    (p_full_report->>'release_decision' in ('PASS','PASS_WITH_WARNINGS')) is distinct from p_released
  then raise exception 'RELEASE_MIRRORS_DISAGREE'; end if;
  select execution_id into case_execution from public.cases where id=p_case_id for update;
  if not found or case_execution is distinct from p_execution_id then
    raise exception 'RELEASE_EXECUTION_SUPERSEDED';
  end if;
  select * into saved_report from public.reports where id=p_report_id and case_id=p_case_id for update;
  if not found or saved_report.full_report is distinct from p_expected_full_report then
    raise exception 'RELEASE_REPORT_CHANGED';
  end if;
  if p_released and (
    saved_report.quality_blocked or
    coalesce((p_full_report->'final_report_contract_validation'->>'ok')::boolean,false) is not true or
    coalesce(p_full_report->>'release_decision','BLOCKED') not in ('PASS','PASS_WITH_WARNINGS') or
    coalesce(jsonb_array_length(p_errors),1) <> 0 or
    exists (
      select 1 from jsonb_array_elements(coalesce(p_full_report->'qa_statuses','[]'::jsonb)) q
      where coalesce((q->>'blocking')::boolean,true) and q->>'status' in ('FAIL','BLOCKED')
    )
  ) then raise exception 'BLOCKING_QA_CANNOT_RELEASE'; end if;

  update public.reports set full_report=p_full_report,
    quality_blocked=not p_released, quality_block_reasons=coalesce(p_errors,'[]'::jsonb)
    where id=p_report_id and case_id=p_case_id;
  if not found then raise exception 'RELEASE_REPORT_WRITE_DENIED'; end if;
  update public.cases set
    status=(case when p_released then 'released' else 'needs_revision' end)::public.case_status,
    progress=case when p_released then 100 else 99 end,
    completed_at=case when p_released then now() else null end,
    report_at=case when p_released then now() else null end,
    next_stage=null, worker_lease_until=null, status_message=p_status_message,
    error=case when p_released then null else left(p_errors::text,2000) end
    where id=p_case_id;
  if not found then raise exception 'RELEASE_CASE_WRITE_DENIED'; end if;
end;
$$;
revoke all on function public.finalize_report_release(uuid,uuid,uuid,jsonb,jsonb,boolean,jsonb,text) from public;
grant execute on function public.finalize_report_release(uuid,uuid,uuid,jsonb,jsonb,boolean,jsonb,text) to authenticated, service_role;
