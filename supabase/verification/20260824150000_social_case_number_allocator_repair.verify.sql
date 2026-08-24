with expected as (
  select
    c.org_id,
    c.program_id,
    extract(year from coalesce(c.intake_date,current_date))::integer as calendar_year,
    max((regexp_match(c.case_number,'([0-9]+)$'))[1]::bigint) as existing_maximum
  from public.social_cases c
  where c.case_number ~ '[0-9]+$'
  group by c.org_id,c.program_id,extract(year from coalesce(c.intake_date,current_date))::integer
)
select
  to_regprocedure('public.assign_social_case_number()') is not null
    as allocator_exists,
  exists(
    select 1 from pg_trigger
    where tgrelid='public.social_cases'::regclass
      and tgname='social_case_number_assign'
      and not tgisinternal
  ) as allocator_trigger_exists,
  not exists(
    select 1
    from expected e
    left join public.social_case_number_counters n
      on n.org_id=e.org_id
     and n.program_id=e.program_id
     and n.calendar_year=e.calendar_year
    where n.last_number<e.existing_maximum
       or n.last_number is null
  ) as counters_cover_existing_numbers,
  not exists(
    select 1
    from public.social_cases
    group by org_id,case_number
    having count(*)>1
  ) as existing_case_numbers_unique;
