begin;

create or replace function public.assign_social_case_number()
returns trigger
language plpgsql
security definer
set search_path=public
as $case_number$
declare
  v_prefix text;
  v_year integer;
  v_next bigint;
begin
  if new.case_number is not null and btrim(new.case_number)<>'' then
    return new;
  end if;

  select case_prefix into v_prefix
  from public.social_programs
  where id=new.program_id and org_id=new.org_id and active;

  if v_prefix is null then
    raise exception 'Invalid or inactive social program';
  end if;

  v_year:=extract(year from coalesce(new.intake_date,current_date));

  insert into public.social_case_number_counters(
    org_id,program_id,calendar_year,last_number
  ) values(
    new.org_id,new.program_id,v_year,1
  )
  on conflict(org_id,program_id,calendar_year)
  do update set last_number=public.social_case_number_counters.last_number+1
  returning last_number into v_next;

  new.case_number:=v_prefix||'-'||v_year::text||'-'||lpad(v_next::text,6,'0');
  return new;
end
$case_number$;

drop trigger if exists social_case_number_assign on public.social_cases;
create trigger social_case_number_assign
before insert on public.social_cases
for each row execute function public.assign_social_case_number();

notify pgrst,'reload schema';
commit;
