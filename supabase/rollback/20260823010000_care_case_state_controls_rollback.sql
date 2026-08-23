-- Guarded reversal for 20260823010000_care_case_state_controls.sql
begin;
do $rollback_guard$
begin
  if exists(
    select 1 from public.social_case_status_history
    where change_kind in ('priority','status_and_priority')
  ) then
    raise exception 'Rollback refused: priority-change history exists and must be preserved.';
  end if;
end
$rollback_guard$;

drop function if exists public.update_care_case_state(uuid,text,text,text);
alter table public.social_case_status_history
  drop constraint if exists social_case_status_history_priority_check,
  drop constraint if exists social_case_status_history_change_kind_check,
  drop column if exists to_priority,
  drop column if exists from_priority,
  drop column if exists change_kind;
notify pgrst, 'reload schema';
commit;
