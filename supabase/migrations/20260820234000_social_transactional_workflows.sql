-- Transactional social-care creation paths and record-aware private storage.

create or replace function public.create_social_family(
  p_org uuid,p_name text,p_primary uuid,p_location jsonb,p_members uuid[]
) returns public.social_families
language plpgsql security invoker set search_path=public as $$
declare f public.social_families%rowtype; v_person uuid;
begin
  if not (public.can_manage_org(p_org,auth.uid()) or public.social_has_capability(p_org,'person.manage',auth.uid())) then
    raise exception 'Family creation denied';
  end if;
  if nullif(btrim(p_name),'') is null then raise exception 'Family name is required'; end if;
  if p_primary is not null and not exists(select 1 from public.social_people where id=p_primary and org_id=p_org) then
    raise exception 'Primary contact is outside this organization';
  end if;
  insert into public.social_families(org_id,family_number,family_name,primary_contact_person_id,current_location,created_by)
  values(p_org,null,btrim(p_name),p_primary,coalesce(p_location,'{}'::jsonb),auth.uid()) returning * into f;
  foreach v_person in array coalesce(p_members,'{}'::uuid[]) loop
    if not exists(select 1 from public.social_people where id=v_person and org_id=p_org) then
      raise exception 'Family member is outside this organization';
    end if;
    insert into public.social_family_members(org_id,family_id,person_id)
    values(p_org,f.id,v_person);
  end loop;
  return f;
end $$;

create or replace function public.create_social_consent(
  p_org uuid,p_person uuid,p_family uuid,p_type text,p_language text,
  p_consented_by text,p_guardian text,p_purposes text[],p_recipients text[],
  p_information text[],p_restrictions text,p_expires timestamptz,p_confirmation jsonb
) returns uuid
language plpgsql security invoker set search_path=public as $$
declare v_id uuid;
begin
  if (p_person is null)=(p_family is null) then
    raise exception 'Consent must belong to exactly one person or family';
  end if;
  if cardinality(coalesce(p_purposes,'{}'))=0 or cardinality(coalesce(p_recipients,'{}'))=0
     or cardinality(coalesce(p_information,'{}'))=0 then
    raise exception 'Consent purpose, recipients and information are required';
  end if;
  if p_expires is not null and p_expires<=now() then raise exception 'Consent expiration must be in the future'; end if;
  insert into public.social_consents(org_id,person_id,family_id,consent_type,status,expires_at,created_by)
  values(p_org,p_person,p_family,p_type,'active',p_expires,auth.uid()) returning id into v_id;
  insert into public.social_consent_versions(
    org_id,consent_id,version,language,consented_by_name,guardian_representative,
    permitted_purpose,permitted_recipients,permitted_information,restrictions,confirmation,created_by
  ) values(
    p_org,v_id,1,coalesce(nullif(p_language,''),'es'),p_consented_by,p_guardian,
    p_purposes,p_recipients,p_information,p_restrictions,coalesce(p_confirmation,'{}'::jsonb),auth.uid()
  );
  return v_id;
end $$;

create or replace function public.create_social_assessment_initial(
  p_case uuid,p_template uuid,p_risk text,p_evidence text,p_reason text,
  p_protective text,p_actions text,p_follow_up text,p_answers jsonb,
  p_review date,p_override boolean,p_override_explanation text
) returns uuid
language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype; v_id uuid;
begin
  select * into c from public.social_cases where id=p_case;
  if not found or not public.social_can_access_case(p_case,'general_case_record',true,auth.uid()) then
    raise exception 'Assessment access denied';
  end if;
  if p_risk not in ('unknown','low','moderate','high','critical') then raise exception 'Invalid risk level'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Assessment reason is required'; end if;
  if p_override and nullif(btrim(p_override_explanation),'') is null then raise exception 'Override explanation is required'; end if;
  insert into public.social_assessments(
    org_id,social_case_id,template_id,assessor_id,risk_level,professional_override,
    override_explanation,next_review_date
  ) values(c.org_id,p_case,p_template,auth.uid(),p_risk,p_override,p_override_explanation,p_review)
  returning id into v_id;
  insert into public.social_assessment_versions(
    org_id,assessment_id,version,evidence_observations,reason,protective_factors,
    immediate_actions,required_follow_up,answers,risk_level,created_by
  ) values(c.org_id,v_id,1,p_evidence,p_reason,p_protective,p_actions,p_follow_up,coalesce(p_answers,'{}'),p_risk,auth.uid());
  update public.social_cases set risk_level=p_risk,status=case when status='intake' then 'assessment' else status end,last_activity_at=now(),updated_at=now() where id=p_case;
  return v_id;
end $$;

create or replace function public.create_social_care_plan(
  p_case uuid,p_summary text,p_status text,p_goals jsonb
) returns uuid
language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype; v_plan uuid; v_version uuid; g jsonb;
begin
  select * into c from public.social_cases where id=p_case;
  if not found or not public.social_can_access_case(p_case,'general_case_record',true,auth.uid()) then
    raise exception 'Care-plan access denied';
  end if;
  if p_status not in ('draft','active','under_review') then raise exception 'Invalid initial plan status'; end if;
  if jsonb_typeof(p_goals)<>'array' or jsonb_array_length(p_goals)=0 then raise exception 'At least one goal is required'; end if;
  insert into public.social_care_plans(org_id,social_case_id,family_id,status,created_by)
  values(c.org_id,c.id,c.family_id,p_status,auth.uid()) returning id into v_plan;
  insert into public.social_care_plan_versions(org_id,care_plan_id,version,summary,status,submitted_by)
  values(c.org_id,v_plan,1,p_summary,p_status,auth.uid()) returning id into v_version;
  for g in select * from jsonb_array_elements(p_goals) loop
    if nullif(btrim(g->>'identifiedNeed'),'') is null or nullif(btrim(g->>'goal'),'') is null
       or nullif(btrim(g->>'plannedAction'),'') is null then raise exception 'Every care-plan goal requires need, goal and action'; end if;
    insert into public.social_care_plan_goals(
      org_id,care_plan_version_id,identified_need,goal,planned_action,target_date,
      priority,expected_outcome,review_date,status
    ) values(
      c.org_id,v_version,g->>'identifiedNeed',g->>'goal',g->>'plannedAction',
      nullif(g->>'targetDate','')::date,coalesce(nullif(g->>'priority',''),'normal'),
      nullif(g->>'expectedOutcome',''),nullif(g->>'reviewDate','')::date,'draft'
    );
  end loop;
  return v_plan;
end $$;

revoke all on function public.create_social_family(uuid,text,uuid,jsonb,uuid[]) from public;
revoke all on function public.create_social_consent(uuid,uuid,uuid,text,text,text,text,text[],text[],text[],text,timestamptz,jsonb) from public;
revoke all on function public.create_social_assessment_initial(uuid,uuid,text,text,text,text,text,text,jsonb,date,boolean,text) from public;
revoke all on function public.create_social_care_plan(uuid,text,text,jsonb) from public;
grant execute on function public.create_social_family(uuid,text,uuid,jsonb,uuid[]) to authenticated;
grant execute on function public.create_social_consent(uuid,uuid,uuid,text,text,text,text,text[],text[],text[],text,timestamptz,jsonb) to authenticated;
grant execute on function public.create_social_assessment_initial(uuid,uuid,text,text,text,text,text,text,jsonb,date,boolean,text) to authenticated;
grant execute on function public.create_social_care_plan(uuid,text,text,jsonb) to authenticated;

-- A storage path is <org>/<case>/<record_type>/<opaque-file-name>. Reads and
-- writes therefore use the same record boundary as the document metadata.
drop policy if exists social_case_files_read on storage.objects;
create policy social_case_files_read on storage.objects for select to authenticated using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]=any(array[
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record',
    'child_protection_restricted_record'
  ])
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],false,auth.uid()
  )
);
drop policy if exists social_case_files_insert on storage.objects;
create policy social_case_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]=any(array[
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record',
    'child_protection_restricted_record'
  ])
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
);
drop policy if exists social_case_files_update on storage.objects;
create policy social_case_files_update on storage.objects for update to authenticated using (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid())
) with check (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid())
);

-- Complete operational audit coverage without storing sensitive bodies.
do $$ declare t text; begin
  foreach t in array array[
    'social_people','social_families','social_family_members','social_case_assignments',
    'social_record_grants','social_assessment_versions','social_care_plan_versions',
    'social_care_plan_goals','social_referral_updates','social_document_versions',
    'social_document_shares','social_appointments','social_alerts',
    'social_case_transfer_items','social_retention_actions','social_support_access_grants'
  ] loop
    execute format('drop trigger if exists %I on public.%I','audit_'||t,t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_social_change()','audit_'||t,t);
  end loop;
end $$;
