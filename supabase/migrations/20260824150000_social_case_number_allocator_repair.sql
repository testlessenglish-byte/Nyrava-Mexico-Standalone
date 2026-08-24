begin;

-- Historical/demo imports may provide an explicit immutable case number. Those
-- inserts correctly preserve the number but do not advance the legacy counter.
-- Reconcile every counter with the greatest suffix already present. Prefer the
-- year embedded in a canonical case number so imports with historical intake
-- dates cannot leave the allocator behind.
lock table public.social_case_number_counters in share row exclusive mode;

with existing_maximums as (
  select
    c.org_id,
    c.program_id,
    coalesce(
      substring(c.case_number from '-([0-9]{4})-[0-9]+$')::integer,
      extract(year from coalesce(c.intake_date,current_date))::integer
    ) as calendar_year,
    max(substring(c.case_number from '([0-9]+)$')::bigint) as last_number
  from public.social_cases c
  where c.case_number ~ '[0-9]+$'
  group by
    c.org_id,
    c.program_id,
    coalesce(
      substring(c.case_number from '-([0-9]{4})-[0-9]+$')::integer,
      extract(year from coalesce(c.intake_date,current_date))::integer
    )
)
insert into public.social_case_number_counters(org_id,program_id,calendar_year,last_number)
select org_id,program_id,calendar_year,last_number
from existing_maximums
where last_number is not null
on conflict(org_id,program_id,calendar_year)
do update set last_number=greatest(
  public.social_case_number_counters.last_number,
  excluded.last_number
);

-- Allocate under an organization/prefix/year advisory lock. The existence loop
-- also protects organizations that intentionally reuse one prefix across more
-- than one program. Client names and case types never participate in numbering.
create or replace function public.assign_social_case_number()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $case_number$
declare
  v_prefix text;
  v_year integer;
  v_next bigint;
  v_candidate text;
begin
  if new.case_number is not null and btrim(new.case_number)<>'' then
    return new;
  end if;

  select p.case_prefix into v_prefix
  from public.social_programs p
  where p.id=new.program_id
    and p.org_id=new.org_id
    and p.active;

  if v_prefix is null then
    raise exception 'Invalid or inactive Comprehensive Care program';
  end if;

  v_year:=extract(year from coalesce(new.intake_date,current_date))::integer;

  perform pg_advisory_xact_lock(
    hashtext(new.org_id::text||':'||v_prefix||':'||v_year::text)
  );

  loop
    insert into public.social_case_number_counters(
      org_id,program_id,calendar_year,last_number
    ) values(
      new.org_id,new.program_id,v_year,1
    )
    on conflict(org_id,program_id,calendar_year)
    do update set last_number=public.social_case_number_counters.last_number+1
    returning last_number into v_next;

    v_candidate:=v_prefix||'-'||v_year::text||'-'||lpad(v_next::text,6,'0');

    exit when not exists(
      select 1
      from public.social_cases c
      where c.org_id=new.org_id
        and c.case_number=v_candidate
    );
  end loop;

  new.case_number:=v_candidate;
  return new;
end
$case_number$;

revoke all on function public.assign_social_case_number() from public,anon,authenticated;
grant execute on function public.assign_social_case_number() to service_role;

drop trigger if exists social_case_number_assign on public.social_cases;
create trigger social_case_number_assign
before insert on public.social_cases
for each row execute function public.assign_social_case_number();

comment on function public.assign_social_case_number() is
'Atomically allocates a unique immutable organization case number independent of client name and case type.';

notify pgrst,'reload schema';
commit;
