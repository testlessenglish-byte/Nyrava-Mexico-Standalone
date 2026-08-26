-- Forward-only security hardening for Comprehensive Care access scoping.
-- Resolves the five active Lovable security-scan findings.
-- Idempotent. Creates no tables, deletes no rows, renames nothing.

-- Finding 1 — consent records must match the case's actual person/family + org
drop policy if exists social_consents_read on public.social_consents;
create policy social_consents_read
  on public.social_consents
  for select
  to authenticated
  using (
    social_can_manage_org(org_id, auth.uid())
    or (created_by = auth.uid() and social_is_org_member(org_id, auth.uid()))
    or (
      social_is_org_member(org_id, auth.uid())
      and (
        (person_id is not null and social_can_access_person(person_id, auth.uid()))
        or exists (
          select 1
          from public.social_cases c
          where c.org_id = social_consents.org_id
            and (
              (social_consents.person_id is not null and c.person_id = social_consents.person_id)
              or (social_consents.family_id is not null and c.family_id = social_consents.family_id)
            )
            and social_can_access_case(c.id, 'general_case_record'::text, false, auth.uid())
        )
      )
    )
  );

drop policy if exists social_consents_update on public.social_consents;
create policy social_consents_update
  on public.social_consents
  for update
  to authenticated
  using (
    social_can_manage_org(org_id, auth.uid())
    or (
      social_is_org_member(org_id, auth.uid())
      and (
        (person_id is not null and social_can_access_person(person_id, auth.uid()))
        or exists (
          select 1
          from public.social_cases c
          where c.org_id = social_consents.org_id
            and (
              (social_consents.person_id is not null and c.person_id = social_consents.person_id)
              or (social_consents.family_id is not null and c.family_id = social_consents.family_id)
            )
            and social_can_access_case(c.id, 'general_case_record'::text, true, auth.uid())
        )
      )
    )
  )
  with check (
    social_is_org_member(org_id, auth.uid())
    and (
      social_can_manage_org(org_id, auth.uid())
      or (
        (person_id is not null and social_can_access_person(person_id, auth.uid()))
        or exists (
          select 1
          from public.social_cases c
          where c.org_id = social_consents.org_id
            and (
              (social_consents.person_id is not null and c.person_id = social_consents.person_id)
              or (social_consents.family_id is not null and c.family_id = social_consents.family_id)
            )
            and social_can_access_case(c.id, 'general_case_record'::text, true, auth.uid())
        )
      )
    )
  );

-- Finding 2 — family members must belong to the same org as person + family
drop policy if exists social_family_members_write on public.social_family_members;
create policy social_family_members_write
  on public.social_family_members
  for all
  to authenticated
  using (
    social_can_manage_org(org_id, auth.uid())
    or (
      social_has_capability(org_id, 'person.manage'::text, auth.uid())
      and exists (
        select 1
        from public.social_families f
        where f.id = social_family_members.family_id
          and f.org_id = social_family_members.org_id
          and (
            f.created_by = auth.uid()
            or f.assigned_case_manager = auth.uid()
            or exists (
              select 1
              from public.social_cases c
              where c.family_id = f.id
                and c.org_id = social_family_members.org_id
                and social_can_access_case(c.id, 'general_case_record'::text, true, auth.uid())
            )
          )
      )
    )
  )
  with check (
    social_is_org_member(org_id, auth.uid())
    and (
      social_can_manage_org(org_id, auth.uid())
      or social_has_capability(org_id, 'person.manage'::text, auth.uid())
    )
    and exists (
      select 1
      from public.social_people p
      where p.id = social_family_members.person_id
        and p.org_id = social_family_members.org_id
    )
    and exists (
      select 1
      from public.social_families f
      where f.id = social_family_members.family_id
        and f.org_id = social_family_members.org_id
    )
  );

-- Finding 3 — access-event rows must match the document's real case + org
drop policy if exists social_document_access_events_insert on public.social_document_access_events;
create policy social_document_access_events_insert
  on public.social_document_access_events
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1
      from public.social_documents d
      where d.id = social_document_access_events.document_id
        and d.social_case_id is not distinct from social_document_access_events.social_case_id
        and d.org_id = social_document_access_events.org_id
        and social_is_org_member(d.org_id, auth.uid())
        and social_can_access_case(d.social_case_id, d.record_type, false, auth.uid())
    )
  );

drop policy if exists social_document_access_events_read on public.social_document_access_events;
create policy social_document_access_events_read
  on public.social_document_access_events
  for select
  to authenticated
  using (
    social_is_org_member(org_id, auth.uid())
    and (
      social_can_manage_org(org_id, auth.uid())
      or social_can_access_case(social_case_id, 'general_case_record'::text, false, auth.uid())
    )
  );

-- Finding 4 — activity events must stay inside org + case + entity scope
create or replace function public.social_activity_entity_visible(
  p_entity_type text,
  p_entity_id uuid,
  p_org uuid,
  p_user uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_family uuid;
  v_case uuid;
begin
  if p_user is null or p_org is null then
    return false;
  end if;
  if not social_is_org_member(p_org, p_user) then
    return false;
  end if;
  if p_entity_id is null or p_entity_type is null then
    return true;
  end if;

  case p_entity_type
    when 'social_people', 'person' then
      return social_can_access_person(p_entity_id, p_user);

    when 'social_cases', 'social_case', 'case' then
      return social_can_access_case(p_entity_id, 'general_case_record'::text, false, p_user);

    when 'social_families', 'family' then
      v_family := p_entity_id;

    when 'social_family_members' then
      select fm.family_id into v_family
      from public.social_family_members fm
      where fm.id = p_entity_id;

    when 'social_documents', 'social_document_versions' then
      select d.social_case_id into v_case
      from public.social_documents d
      where d.id = p_entity_id
      limit 1;
      if v_case is null then
        return social_can_manage_org(p_org, p_user);
      end if;
      return social_can_access_case(v_case, 'general_case_record'::text, false, p_user);

    else
      -- Org-level bookkeeping entities (memberships, invitations, counters)
      -- carry no person-level record data; org membership is sufficient.
      return true;
  end case;

  if v_family is null then
    return social_can_manage_org(p_org, p_user);
  end if;

  return exists (
    select 1
    from public.social_families f
    where f.id = v_family
      and f.org_id = p_org
      and (
        f.created_by = p_user
        or f.assigned_case_manager = p_user
        or exists (
          select 1
          from public.social_cases c
          where c.family_id = f.id
            and social_can_access_case(c.id, 'general_case_record'::text, false, p_user)
        )
      )
  );
end;
$fn$;

revoke all on function public.social_activity_entity_visible(text, uuid, uuid, uuid) from public;
revoke all on function public.social_activity_entity_visible(text, uuid, uuid, uuid) from anon;
grant execute on function public.social_activity_entity_visible(text, uuid, uuid, uuid) to authenticated;
grant execute on function public.social_activity_entity_visible(text, uuid, uuid, uuid) to service_role;

drop policy if exists social_activity_read on public.social_activity_events;
create policy social_activity_read
  on public.social_activity_events
  for select
  to authenticated
  using (
    is_org_member(org_id, auth.uid())
    and social_sales_demo_any_owner_allows(entity_id, auth.uid())
    and (
      social_case_id is null
      or social_can_access_case(social_case_id, 'general_case_record'::text, false, auth.uid())
    )
    and (
      actor_id = auth.uid()
      or can_manage_org(org_id, auth.uid())
      or (
        social_has_capability(org_id, 'audit.view'::text, auth.uid())
        and public.social_activity_entity_visible(entity_type, entity_id, org_id, auth.uid())
      )
    )
  );

drop policy if exists social_activity_insert on public.social_activity_events;
create policy social_activity_insert
  on public.social_activity_events
  for insert
  to authenticated
  with check (
    social_is_org_member(org_id, auth.uid())
    and actor_id = auth.uid()
    and (
      social_case_id is null
      or exists (
        select 1
        from public.social_cases c
        where c.id = social_activity_events.social_case_id
          and c.org_id = social_activity_events.org_id
      )
    )
  );

-- Finding 5 — no PUBLIC/anon EXECUTE on project routines; fixed search_path
do $hard$
declare
  r record;
  fn text;
  is_trigger boolean;
begin
  for r in
    select p.oid, p.prorettype, p.prosecdef, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    fn := r.oid::regprocedure::text;
    is_trigger := r.prorettype = 'trigger'::regtype;

    if r.proconfig is null or not (r.proconfig::text like '%search_path%') then
      execute format('alter function %s set search_path = public, pg_temp', fn);
    end if;

    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);

    if is_trigger then
      execute format('revoke all on function %s from authenticated', fn);
    else
      execute format('grant execute on function %s to authenticated', fn);
    end if;

    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$hard$;

-- The single deliberate anonymous entry point: public marketing pricing only.
grant execute on function public.list_public_billing_plans() to anon;
