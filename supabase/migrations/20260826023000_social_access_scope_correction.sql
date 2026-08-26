begin;

-- Correct the blanket permission sweep introduced by
-- 20260826010357_99c4b5d1-fa9f-414d-a49b-6686c80f02d3.sql.
-- These routines were deliberately service-role-only before that migration.
do $permissions$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.has_role(uuid, public.app_role)',
    'public.is_case_manager(uuid)',
    'public.resolve_firm_for_email(text)',
    'public.firm_seat_usage(uuid)',
    'public.has_permission(uuid, uuid, text)',
    'public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid)',
    'public.project_case_findings(uuid, jsonb)',
    'public.consume_usage(uuid, text, integer, integer)',
    'public.increment_reports_generated(uuid)',
    'public.claim_engine_run(uuid, uuid, text, jsonb)',
    'public.provision_organization_subscription_from_webhook(text, text, text, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, text)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Expected server-only routine is missing: %', v_signature;
    end if;

    execute format('revoke all on function %s from public', v_function);
    execute format('revoke all on function %s from anon', v_function);
    execute format('revoke all on function %s from authenticated', v_function);
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end;
$permissions$;

-- Restore owner-only/internal routines that had no callable application role
-- before the blanket sweep. Trigger functions remain executable by their
-- existing triggers; the deprecated RPC overloads stay unavailable.
do $internal_permissions$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.handle_new_user()',
    'public.tg_set_updated_at()',
    'public.tg_protect_user_settings_firm_id()',
    'public.handle_beta_invite_redemption()',
    'public.tg_validate_canonical_analysis()',
    'public.tg_bump_canonical_version()',
    'public.tg_org_bootstrap_owner()',
    'public.tg_protect_user_settings_firm_id_insert()',
    'public.prevent_user_settings_firm_change()',
    'public.tg_normalize_finding_type()',
    'public.invite_social_organization_member(uuid, text, text)',
    'public.create_social_case(uuid, uuid, uuid, uuid, text, text, text[], text, text, text, text[])'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      continue;
    end if;

    execute format('revoke all on function %s from public', v_function);
    execute format('revoke all on function %s from anon', v_function);
    execute format('revoke all on function %s from authenticated', v_function);
    execute format('revoke all on function %s from service_role', v_function);
  end loop;
end;
$internal_permissions$;

-- Resolve activity entities through their canonical rows. Unknown types fail
-- closed, and restricted documents/interventions use their actual record type.
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
as $activity_visibility$
declare
  v_case uuid;
  v_person uuid;
  v_family uuid;
  v_entity_org uuid;
  v_record_type text := 'general_case_record';
  v_assigned_to uuid;
begin
  if p_user is null or p_org is null or p_entity_type is null or p_entity_id is null then
    return false;
  end if;

  if not public.social_is_org_member(p_org, p_user) then
    return false;
  end if;

  case p_entity_type
    when 'person', 'social_people' then
      select p.org_id
      into v_entity_org
      from public.social_people p
      where p.id = p_entity_id
        and p.deleted_at is null;

      return v_entity_org = p_org
        and public.social_can_access_person(p_entity_id, p_user);

    when 'family', 'social_families' then
      v_family := p_entity_id;

    when 'social_family_members' then
      select fm.org_id, fm.family_id, fm.person_id
      into v_entity_org, v_family, v_person
      from public.social_family_members fm
      where fm.id = p_entity_id;

      if v_entity_org is distinct from p_org then
        return false;
      end if;

      if not public.social_can_access_person(v_person, p_user) then
        return false;
      end if;

    when 'case', 'social_case', 'social_cases' then
      select c.org_id, c.id
      into v_entity_org, v_case
      from public.social_cases c
      where c.id = p_entity_id
        and c.deleted_at is null;

    when 'social_document', 'social_documents' then
      select d.org_id, d.social_case_id, d.record_type
      into v_entity_org, v_case, v_record_type
      from public.social_documents d
      where d.id = p_entity_id
        and d.deleted_at is null;

    when 'social_document_versions' then
      select d.org_id, d.social_case_id, d.record_type
      into v_entity_org, v_case, v_record_type
      from public.social_document_versions dv
      join public.social_documents d on d.id = dv.document_id
      where dv.id = p_entity_id
        and dv.org_id = p_org
        and d.org_id = p_org
        and d.deleted_at is null;

    when 'social_interventions' then
      select i.org_id, i.social_case_id, i.record_type
      into v_entity_org, v_case, v_record_type
      from public.social_interventions i
      where i.id = p_entity_id;

    when 'social_consents' then
      select c.org_id, c.person_id, c.family_id
      into v_entity_org, v_person, v_family
      from public.social_consents c
      where c.id = p_entity_id;

      if v_entity_org is distinct from p_org then
        return false;
      end if;

      return
        (v_person is not null and public.social_can_access_person(v_person, p_user))
        or (
          v_family is not null
          and exists (
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
                    and c.org_id = p_org
                    and public.social_can_access_case(
                      c.id,
                      'general_case_record',
                      false,
                      p_user
                    )
                )
              )
          )
        );

    when 'social_intake' then
      select i.org_id, i.social_case_id, i.person_id, i.family_id, i.assigned_to
      into v_entity_org, v_case, v_person, v_family, v_assigned_to
      from public.social_intakes i
      where i.id = p_entity_id;

      if v_entity_org is distinct from p_org then
        return false;
      end if;

      if v_assigned_to = p_user then
        return true;
      end if;

      if v_case is not null
        and public.social_can_access_case(v_case, 'general_case_record', false, p_user)
      then
        return true;
      end if;

      if v_person is not null and public.social_can_access_person(v_person, p_user) then
        return true;
      end if;

    when 'social_assessments',
         'social_care_plans',
         'social_referrals',
         'social_tasks',
         'social_case_transfers',
         'social_case_closures',
         'social_immigration_links' then
      execute format(
        'select org_id, social_case_id from public.%I where id = $1',
        p_entity_type
      )
      into v_entity_org, v_case
      using p_entity_id;

    else
      -- Organization membership and all future/unknown entity types are
      -- manager-only through the outer RLS policy, never audit-role visible.
      return false;
  end case;

  if v_family is not null then
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
              and c.org_id = p_org
              and public.social_can_access_case(
                c.id,
                'general_case_record',
                false,
                p_user
              )
          )
        )
    );
  end if;

  return v_entity_org = p_org
    and v_case is not null
    and public.social_can_access_case(v_case, v_record_type, false, p_user);
end;
$activity_visibility$;

revoke all on function public.social_activity_entity_visible(text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.social_activity_entity_visible(text, uuid, uuid, uuid)
  to authenticated, service_role;

drop policy if exists social_activity_read on public.social_activity_events;
create policy social_activity_read
  on public.social_activity_events
  for select
  to authenticated
  using (
    public.social_is_org_member(org_id, auth.uid())
    and public.social_sales_demo_any_owner_allows(entity_id, auth.uid())
    and (
      social_case_id is null
      or public.social_can_access_case(
        social_case_id,
        'general_case_record',
        false,
        auth.uid()
      )
    )
    and (
      actor_id = auth.uid()
      or public.social_can_manage_org(org_id, auth.uid())
      or (
        public.social_has_capability(org_id, 'audit.view', auth.uid())
        and public.social_activity_entity_visible(
          entity_type,
          entity_id,
          org_id,
          auth.uid()
        )
      )
    )
  );

-- Browser clients may only add the one event currently emitted directly by
-- social.functions.ts. Workflow and trigger events continue through their
-- checked SECURITY DEFINER routines.
drop policy if exists social_activity_insert on public.social_activity_events;
create policy social_activity_insert
  on public.social_activity_events
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and event_type = 'case_media_ai_access_changed'
    and entity_type in ('social_document', 'social_documents')
    and exists (
      select 1
      from public.social_documents d
      where d.id = social_activity_events.entity_id
        and d.org_id = social_activity_events.org_id
        and d.social_case_id is not distinct from social_activity_events.social_case_id
        and d.deleted_at is null
        and public.social_can_access_case(
          d.social_case_id,
          d.record_type,
          false,
          auth.uid()
        )
    )
  );

commit;

