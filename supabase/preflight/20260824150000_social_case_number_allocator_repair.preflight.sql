do $preflight$
begin
  if to_regclass('public.social_cases') is null then
    raise exception 'Required table public.social_cases does not exist';
  end if;
  if to_regclass('public.social_case_number_counters') is null then
    raise exception 'Required table public.social_case_number_counters does not exist';
  end if;
  if to_regclass('public.social_programs') is null then
    raise exception 'Required table public.social_programs does not exist';
  end if;
end
$preflight$;

select
  count(*) as duplicate_case_number_groups
from (
  select org_id,case_number
  from public.social_cases
  group by org_id,case_number
  having count(*)>1
) duplicates;
