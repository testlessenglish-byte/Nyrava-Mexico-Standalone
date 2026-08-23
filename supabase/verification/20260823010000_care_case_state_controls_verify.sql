-- Read-only verification for 20260823010000_care_case_state_controls.sql
select
  to_regprocedure('public.update_care_case_state(uuid,text,text,text)') is not null
    as update_case_state_exists;

select
  count(*) = 4 as history_columns_exist
from information_schema.columns
where table_schema = 'public'
  and table_name = 'social_case_status_history'
  and column_name in ('change_kind','from_priority','to_priority','reason');

select
  has_function_privilege(
    'authenticated',
    'public.update_care_case_state(uuid,text,text,text)',
    'EXECUTE'
  ) as authenticated_can_execute,
  not has_function_privilege(
    'anon',
    'public.update_care_case_state(uuid,text,text,text)',
    'EXECUTE'
  ) as anonymous_cannot_execute;

select count(*) as invalid_priority_history_rows
from public.social_case_status_history
where from_priority not in ('standard','urgent','emergency')
   or to_priority not in ('standard','urgent','emergency');
