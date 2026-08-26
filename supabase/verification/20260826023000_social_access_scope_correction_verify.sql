-- Run after applying 20260826023000_social_access_scope_correction.sql.
-- This script is read-only and aborts on any failed security invariant.
begin;

do $verify$
declare
  v_signature text;
  v_function regprocedure;
  v_definition text;
  v_policy text;
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
      raise exception 'Missing server-only routine: %', v_signature;
    end if;
    if has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'authenticated can execute server-only routine: %', v_signature;
    end if;
    if has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'anon can execute server-only routine: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'service_role cannot execute required routine: %', v_signature;
    end if;
  end loop;

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
    if has_function_privilege('authenticated', v_function, 'EXECUTE')
      or has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('service_role', v_function, 'EXECUTE')
    then
      raise exception 'Internal routine is exposed to an application role: %', v_signature;
    end if;
  end loop;

  v_definition := pg_get_functiondef(
    'public.social_activity_entity_visible(text, uuid, uuid, uuid)'::regprocedure
  );
  if v_definition not ilike '%join public.social_documents d on d.id = dv.document_id%' then
    raise exception 'Document-version activity does not resolve its parent document';
  end if;
  if v_definition not ilike '%d.record_type%' then
    raise exception 'Restricted activity does not use the canonical record type';
  end if;
  if v_definition not ilike '%else%return false%' then
    raise exception 'Unknown activity entity types are not fail-closed';
  end if;

  select coalesce(qual, '')
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'social_activity_events'
    and policyname = 'social_activity_read';
  if v_policy not ilike '%social_activity_entity_visible%' then
    raise exception 'Activity read policy is missing entity visibility enforcement';
  end if;

  select coalesce(with_check, '')
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'social_activity_events'
    and policyname = 'social_activity_insert';
  if v_policy not ilike '%case_media_ai_access_changed%'
    or v_policy not ilike '%social_documents%'
  then
    raise exception 'Activity insert policy still permits arbitrary browser events';
  end if;

  select coalesce(with_check, '')
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'social_family_members'
    and policyname = 'social_family_members_write';
  if v_policy not ilike '%p.org_id = social_family_members.org_id%'
    or v_policy not ilike '%f.org_id = social_family_members.org_id%'
  then
    raise exception 'Family-member policy does not pin person and family to row organization';
  end if;

  select coalesce(with_check, '')
  into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'social_document_access_events'
    and policyname = 'social_document_access_events_insert';
  if (
    v_policy not ilike '%is not distinct from%'
    and v_policy not ilike
      '%not (d.social_case_id is distinct from social_document_access_events.social_case_id)%'
  )
    or v_policy not ilike '%d.org_id = social_document_access_events.org_id%'
  then
    raise exception 'Document access events can still be misattributed';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'social_consents'
      and policyname in ('social_consents_read', 'social_consents_update')
      and (
        coalesce(qual, '') ilike '%c.person_id = c.person_id%'
        or coalesce(qual, '') ilike '%c.family_id = c.family_id%'
      )
  ) then
    raise exception 'Consent access policy contains a self-comparison';
  end if;
end;
$verify$;

rollback;

