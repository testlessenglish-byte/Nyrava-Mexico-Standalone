begin;

-- Comprehensive Care blueprint alignment: independent intake workflow and
-- canonical case-assignment integrity. This migration does not create a new
-- organization, workspace, subscription, or legal matter.

create table if not exists public.social_intake_number_counters (
  org_id uuid not null references public.organizations(id) on delete cascade,
  intake_year integer not null,
  next_value bigint not null default 1 check (next_value > 0),
  primary key (org_id, intake_year)
);

create table if not exists public.social_intakes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid not null references public.social_programs(id),
  intake_number text not null,
  person_id uuid not null references public.social_people(id),
  family_id uuid references public.social_families(id),
  source text not null default 'direct',
  status text not null default 'draft',
  disposition text not null default 'pending',
  summary text not null,
  presenting_needs text[] not null default '{}'::text[],
  assigned_to uuid references auth.users(id),
  duplicate_check_completed_at timestamptz,
  duplicate_check_completed_by uuid references auth.users(id),
  disposition_reason text,
  social_case_id uuid references public.social_cases(id),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, intake_number),
  check (source in ('direct','phone','email','walk_in','outreach','referral','emergency','other')),
  check (status in ('draft','under_review','completed','cancelled')),
  check (disposition in ('pending','open_case','refer_only','information_only','ineligible','duplicate','no_follow_up')),
  check (
    (status <> 'completed')
    or (
      disposition <> 'pending'
      and completed_at is not null
      and completed_by is not null
    )
  ),
  check (
    disposition <> 'open_case'
    or social_case_id is not null
  )
);

create index if not exists social_intakes_org_status_time_idx
  on public.social_intakes(org_id, status, created_at desc);

create index if not exists social_intakes_person_idx
  on public.social_intakes(person_id, created_at desc);

create index if not exists social_intakes_assignee_idx
  on public.social_intakes(assigned_to, status)
  where status in ('draft','under_review');

create or replace function public.assign_social_intake_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $assign_intake_number$
declare
  v_year integer := extract(year from current_date)::integer;
  v_next bigint;
begin
  if new.intake_number is not null and btrim(new.intake_number) <> '' then
    return new;
  end if;

  insert into public.social_intake_number_counters(org_id, intake_year, next_value)
  values(new.org_id, v_year, 2)
  on conflict (org_id, intake_year)
  do update set next_value = public.social_intake_number_counters.next_value + 1
  returning next_value - 1 into v_next;

  new.intake_number :=
    'NYR-INT-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
  return new;
end
$assign_intake_number$;

drop trigger if exists social_intake_number_assign on public.social_intakes;
create trigger social_intake_number_assign
before insert on public.social_intakes
for each row execute function public.assign_social_intake_number();

create or replace function public.prevent_social_intake_number_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $immutable_intake_number$
begin
  if new.intake_number is distinct from old.intake_number
    or new.org_id is distinct from old.org_id
  then
    raise exception 'Intake number and organization are immutable';
  end if;
  return new;
end
$immutable_intake_number$;

drop trigger if exists social_intake_number_immutable on public.social_intakes;
create trigger social_intake_number_immutable
before update on public.social_intakes
for each row execute function public.prevent_social_intake_number_change();

alter table public.social_intake_number_counters enable row level security;
alter table public.social_intakes enable row level security;

revoke all on public.social_intake_number_counters from anon, public, authenticated;
revoke all on public.social_intakes from anon, public;
grant select on public.social_intakes to authenticated;
grant all on public.social_intake_number_counters, public.social_intakes to service_role;

drop policy if exists social_intakes_read on public.social_intakes;
create policy social_intakes_read
on public.social_intakes
for select to authenticated
using (
  public.social_is_org_member(org_id, auth.uid())
  and (
    assigned_to is null
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.social_can_manage_org(org_id, auth.uid())
    or public.social_has_capability(org_id, 'case.view_all', auth.uid())
  )
);

create or replace function public.create_social_intake(
  p_org uuid,
  p_program uuid,
  p_person uuid,
  p_family uuid,
  p_source text,
  p_summary text,
  p_presenting_needs text[],
  p_assigned_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $create_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.social_is_org_member(p_org, v_actor) then
    raise exception 'Active organization membership required' using errcode = '42501';
  end if;

  if not (
    public.social_can_manage_org(p_org, v_actor)
    or public.social_has_capability(p_org, 'case.create', v_actor)
  ) then
    raise exception 'Intake creation denied for this organization' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.social_programs
    where id = p_program and org_id = p_org and active
  ) then
    raise exception 'Invalid or inactive Comprehensive Care program';
  end if;

  if not exists (
    select 1 from public.social_people
    where id = p_person and org_id = p_org and deleted_at is null
  ) then
    raise exception 'The selected client is outside this organization';
  end if;

  if p_family is not null and not exists (
    select 1 from public.social_families
    where id = p_family and org_id = p_org and deleted_at is null
  ) then
    raise exception 'Family is outside this organization';
  end if;

  if p_source not in ('direct','phone','email','walk_in','outreach','referral','emergency','other') then
    raise exception 'Unsupported intake source';
  end if;

  if length(btrim(coalesce(p_summary, ''))) < 3 then
    raise exception 'Intake summary is required';
  end if;

  if p_assigned_user is not null and not exists (
    select 1 from public.org_memberships
    where org_id = p_org
      and user_id = p_assigned_user
      and status = 'active'
      and deleted_at is null
  ) then
    raise exception 'The selected team member is not active in this organization';
  end if;

  insert into public.social_intakes(
    org_id, program_id, intake_number, person_id, family_id, source,
    status, disposition, summary, presenting_needs, assigned_to, created_by
  )
  values(
    p_org, p_program, null, p_person, p_family, p_source,
    'under_review', 'pending', btrim(p_summary),
    coalesce(p_presenting_needs, '{}'::text[]),
    coalesce(p_assigned_user, v_actor), v_actor
  )
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    p_org, v_actor, 'intake_created', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'person_id', p_person,
      'family_id', p_family,
      'assigned_to', v_intake.assigned_to,
      'source', p_source
    )
  );

  return to_jsonb(v_intake);
end
$create_intake$;

create or replace function public.complete_social_intake(
  p_intake uuid,
  p_disposition text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $complete_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
begin
  select * into v_intake
  from public.social_intakes
  where id = p_intake
  for update;

  if not found then
    raise exception 'Intake not found';
  end if;

  if not (
    v_intake.assigned_to = v_actor
    or v_intake.created_by = v_actor
    or public.social_can_manage_org(v_intake.org_id, v_actor)
    or public.social_has_capability(v_intake.org_id, 'case.view_all', v_actor)
  ) then
    raise exception 'Intake disposition denied' using errcode = '42501';
  end if;

  if v_intake.status = 'completed' then
    raise exception 'Intake is already completed';
  end if;

  if p_disposition not in ('refer_only','information_only','ineligible','duplicate','no_follow_up') then
    raise exception 'Use the intake-to-case workflow when opening a case';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A disposition reason is required';
  end if;

  update public.social_intakes
  set status = 'completed',
      disposition = p_disposition,
      disposition_reason = btrim(p_reason),
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_intake.id
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    v_intake.org_id, v_actor, 'intake_completed', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'disposition', p_disposition,
      'reason', btrim(p_reason)
    )
  );

  return to_jsonb(v_intake);
end
$complete_intake$;

create or replace function public.open_care_case_from_intake(
  p_intake uuid,
  p_case_type text,
  p_priority text,
  p_assigned_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $open_from_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
  v_case jsonb;
  v_case_id uuid;
begin
  select * into v_intake
  from public.social_intakes
  where id = p_intake
  for update;

  if not found then
    raise exception 'Intake not found';
  end if;

  if v_intake.status = 'completed' then
    raise exception 'Intake is already completed';
  end if;

  if not (
    v_intake.assigned_to = v_actor
    or v_intake.created_by = v_actor
    or public.social_can_manage_org(v_intake.org_id, v_actor)
    or public.social_has_capability(v_intake.org_id, 'case.view_all', v_actor)
  ) then
    raise exception 'Intake-to-case conversion denied' using errcode = '42501';
  end if;

  v_case := public.create_and_assign_care_case(
    v_intake.org_id,
    v_intake.program_id,
    v_intake.person_id,
    null,
    v_intake.family_id,
    p_case_type,
    p_priority,
    coalesce(p_assigned_user, v_intake.assigned_to)
  );

  v_case_id := (v_case ->> 'id')::uuid;

  update public.social_intakes
  set status = 'completed',
      disposition = 'open_case',
      disposition_reason = 'Converted through the authorized intake-to-case workflow',
      social_case_id = v_case_id,
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_intake.id
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, social_case_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    v_intake.org_id, v_case_id, v_actor,
    'intake_converted_to_case', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'case_id', v_case_id,
      'case_number', v_case ->> 'case_number'
    )
  );

  return v_case || jsonb_build_object(
    'intake_id', v_intake.id,
    'intake_number', v_intake.intake_number
  );
end
$open_from_intake$;

revoke all on function public.create_social_intake(
  uuid, uuid, uuid, uuid, text, text, text[], uuid
) from public, anon;

revoke all on function public.complete_social_intake(
  uuid, text, text
) from public, anon;

revoke all on function public.open_care_case_from_intake(
  uuid, text, text, uuid
) from public, anon;

grant execute on function public.create_social_intake(
  uuid, uuid, uuid, uuid, text, text, text[], uuid
) to authenticated, service_role;

grant execute on function public.complete_social_intake(
  uuid, text, text
) to authenticated, service_role;

grant execute on function public.open_care_case_from_intake(
  uuid, text, text, uuid
) to authenticated, service_role;

-- PR 204 originally used primary_case_manager while the established workflow
-- and UI use case_manager. Canonicalize that role without changing case data.
drop index if exists public.social_case_assignments_one_active;

update public.social_case_assignments
set assignment_role = 'case_manager'
where assignment_role = 'primary_case_manager';

with ranked as (
  select id,
    row_number() over (
      partition by social_case_id, assignment_role
      order by assigned_at desc, id desc
    ) as position
  from public.social_case_assignments
  where active
    and assignment_role in ('case_manager', 'supervisor')
)
update public.social_case_assignments a
set active = false,
    ended_at = coalesce(a.ended_at, now())
from ranked r
where a.id = r.id
  and r.position > 1;

create unique index if not exists social_case_assignments_one_active
  on public.social_case_assignments(social_case_id, user_id, assignment_role)
  where active;

create unique index if not exists social_case_assignments_one_active_role
  on public.social_case_assignments(social_case_id, assignment_role)
  where active and assignment_role in ('case_manager', 'supervisor');

create or replace function public.canonicalize_social_assignment_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $canonical_assignment_role$
begin
  if new.assignment_role = 'primary_case_manager' then
    new.assignment_role := 'case_manager';
  end if;
  return new;
end
$canonical_assignment_role$;

drop trigger if exists canonicalize_social_assignment_role
  on public.social_case_assignments;

create trigger canonicalize_social_assignment_role
before insert or update of assignment_role
on public.social_case_assignments
for each row execute function public.canonicalize_social_assignment_role();

notify pgrst, 'reload schema';

commit;
