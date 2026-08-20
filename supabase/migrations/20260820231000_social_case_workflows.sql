-- Atención Integral workflow invariants and privacy-safe reporting.

create or replace function public.normalize_social_search(value text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(
    translate(lower(coalesce(value,'')),
      'áéíóúüñàèìòùäëïöÿç','aeiouunaeiouaeiouyc'),
    '[^a-z0-9]+',' ','g'
  );
$$;

-- Approved/versioned artifacts and activity history are immutable.
create or replace function public.prevent_social_immutable_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Historical social-care versions are immutable';
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'social_assessment_versions','social_care_plan_versions',
    'social_consent_versions','social_document_versions'
  ] loop
    execute format('drop trigger if exists %I on public.%I','immutable_'||t,t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.prevent_social_immutable_mutation()','immutable_'||t,t);
  end loop;
end $$;

-- A consent must cover the exact recipient, purpose and information before
-- any referral packet, document or immigration link can be shared.
create or replace function public.validate_social_referral_share()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_information text[];
begin
  v_information := array(select jsonb_object_keys(new.shared_fields));
  if not public.social_consent_covers(
    new.consent_id,new.receiving_org_id::text,new.purpose,v_information
  ) then
    raise exception 'Consent does not cover this referral share';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_social_referral_share on public.social_referral_shared_packets;
create trigger validate_social_referral_share before insert or update
on public.social_referral_shared_packets for each row
execute function public.validate_social_referral_share();

create or replace function public.validate_social_document_share()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.social_consent_covers(
    new.consent_id,new.receiving_org_id::text,new.purpose,array['document']
  ) then
    raise exception 'Consent does not cover this document share';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_social_document_share on public.social_document_shares;
create trigger validate_social_document_share before insert or update
on public.social_document_shares for each row
execute function public.validate_social_document_share();

create or replace function public.validate_social_immigration_link()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_type text;
declare v_information text[];
begin
  select case_type into v_type from public.cases where id=new.immigration_case_id;
  if v_type is distinct from 'migratorio' then
    raise exception 'Linked legal matter must be a Mexican immigration matter';
  end if;
  v_information := new.shared_social_fields || array['immigration_status'];
  if not public.social_consent_covers(
    new.consent_id,new.immigration_case_id::text,'immigration_link',v_information
  ) then
    raise exception 'Consent does not cover this immigration link';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_social_immigration_link on public.social_immigration_links;
create trigger validate_social_immigration_link before insert or update
on public.social_immigration_links for each row
execute function public.validate_social_immigration_link();

-- A referral is not completed merely because it was sent.
create or replace function public.enforce_social_referral_completion()
returns trigger language plpgsql as $$
begin
  if new.status='completed' and (
    new.result_verified_at is null or new.result_verified_by is null
    or nullif(btrim(new.result),'') is null
  ) then
    raise exception 'Referral completion requires a verified result';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_social_referral_completion on public.social_referrals;
create trigger enforce_social_referral_completion before insert or update
on public.social_referrals for each row
execute function public.enforce_social_referral_completion();

-- Closed cases are read-only except for the controlled reopen fields.
create or replace function public.protect_closed_social_case()
returns trigger language plpgsql as $$
begin
  if old.status='closed' then
    if new.status='reopened'
      and new.case_number=old.case_number
      and new.org_id=old.org_id
      and new.person_id is not distinct from old.person_id
      and new.family_id is not distinct from old.family_id
    then
      return new;
    end if;
    raise exception 'Closed social cases are read-only; use the authorized reopening workflow';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_closed_social_case on public.social_cases;
create trigger protect_closed_social_case before update on public.social_cases
for each row execute function public.protect_closed_social_case();

-- Duplicate-person review. This returns candidates, never silently merges.
create or replace function public.find_possible_social_people(
  p_org uuid,
  p_name text,
  p_date_of_birth date default null,
  p_phone text default null,
  p_email text default null,
  p_limit integer default 10
)
returns table(
  person_id uuid,
  person_number text,
  display_name text,
  date_of_birth date,
  match_reasons text[]
)
language sql stable security invoker set search_path=public as $$
  select
    p.id,p.person_number,coalesce(p.preferred_name,p.legal_name),p.date_of_birth,
    array_remove(array[
      case when public.normalize_social_search(p.legal_name)=public.normalize_social_search(p_name)
             or exists(select 1 from unnest(p.aliases) a where public.normalize_social_search(a)=public.normalize_social_search(p_name))
           then 'name' end,
      case when p_date_of_birth is not null and p.date_of_birth=p_date_of_birth then 'date_of_birth' end,
      case when p_phone is not null and regexp_replace(coalesce(p.telephone,''),'\D','','g')=regexp_replace(p_phone,'\D','','g') then 'telephone' end,
      case when p_email is not null and lower(coalesce(p.email,''))=lower(p_email) then 'email' end
    ],null)
  from public.social_people p
  where p.org_id=p_org and p.deleted_at is null
    and public.social_can_access_person(p.id,auth.uid())
    and (
      public.normalize_social_search(p.legal_name)=public.normalize_social_search(p_name)
      or exists(select 1 from unnest(p.aliases) a where public.normalize_social_search(a)=public.normalize_social_search(p_name))
      or (p_date_of_birth is not null and p.date_of_birth=p_date_of_birth)
      or (p_phone is not null and regexp_replace(coalesce(p.telephone,''),'\D','','g')=regexp_replace(p_phone,'\D','','g'))
      or (p_email is not null and lower(coalesce(p.email,''))=lower(p_email))
    )
  order by
    (public.normalize_social_search(p.legal_name)=public.normalize_social_search(p_name)) desc,
    p.updated_at desc
  limit least(greatest(coalesce(p_limit,10),1),25);
$$;

create or replace function public.search_social_case_management(
  p_org uuid,
  p_query text default '',
  p_status text default null,
  p_risk text default null,
  p_assignee uuid default null,
  p_limit integer default 50
)
returns table(
  entity_type text,
  entity_id uuid,
  reference_number text,
  display_name text,
  status text,
  risk_level text,
  assigned_case_manager uuid,
  updated_at timestamptz
)
language sql stable security invoker set search_path=public as $$
  with tokens as (
    select token from unnest(string_to_array(public.normalize_social_search(p_query),' ')) token
    where token<>''
  ), people as (
    select
      'person'::text entity_type,p.id entity_id,p.person_number reference_number,
      coalesce(p.preferred_name,p.legal_name) display_name,p.record_status status,
      null::text risk_level,p.assigned_case_manager,p.updated_at,
      public.normalize_social_search(concat_ws(' ',p.legal_name,p.preferred_name,array_to_string(p.aliases,' '),p.person_number,p.telephone,p.email)) haystack
    from public.social_people p
    where p.org_id=p_org and p.deleted_at is null
      and public.social_can_access_person(p.id,auth.uid())
  ), families as (
    select
      'family'::text,f.id,f.family_number,f.family_name,'active'::text,null::text,
      f.assigned_case_manager,f.updated_at,
      public.normalize_social_search(concat_ws(' ',f.family_name,f.family_number)) haystack
    from public.social_families f
    where f.org_id=p_org and f.deleted_at is null
      and exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
  ), cases as (
    select
      'case'::text,c.id,c.case_number,
      coalesce(p.preferred_name,p.legal_name,f.family_name,c.case_number),
      c.status,c.risk_level,c.assigned_case_manager,c.updated_at,
      public.normalize_social_search(concat_ws(' ',c.case_number,c.case_type,array_to_string(c.service_areas,' '),array_to_string(c.tags,' '),p.legal_name,p.preferred_name,f.family_name)) haystack
    from public.social_cases c
    left join public.social_people p on p.id=c.person_id
    left join public.social_families f on f.id=c.family_id
    where c.org_id=p_org and c.deleted_at is null
      and public.social_can_access_case(c.id,'general_case_record',false,auth.uid())
      and (p_status is null or c.status=p_status)
      and (p_risk is null or c.risk_level=p_risk)
      and (p_assignee is null or c.assigned_case_manager=p_assignee)
  ), all_rows as (
    select * from people union all select * from families union all select * from cases
  )
  select entity_type,entity_id,reference_number,display_name,status,risk_level,assigned_case_manager,updated_at
  from all_rows a
  where not exists(select 1 from tokens t where a.haystack not like '%'||t.token||'%')
  order by updated_at desc
  limit least(greatest(coalesce(p_limit,50),1),100);
$$;

-- Assessment versioning. Risk is a professional classification backed by
-- observations/reason; no sensitive characteristic is scored automatically.
create or replace function public.record_social_assessment(
  p_assessment uuid,
  p_risk_level text,
  p_evidence text,
  p_reason text,
  p_protective_factors text,
  p_immediate_actions text,
  p_required_follow_up text,
  p_answers jsonb,
  p_next_review date,
  p_override boolean default false,
  p_override_explanation text default null
) returns integer
language plpgsql security invoker set search_path=public as $$
declare a public.social_assessments%rowtype;
declare v_next integer;
begin
  select * into a from public.social_assessments where id=p_assessment for update;
  if not found or not public.social_can_access_case(a.social_case_id,'general_case_record',true,auth.uid()) then
    raise exception 'Assessment not found or access denied';
  end if;
  if p_risk_level not in ('unknown','low','moderate','high','critical') then
    raise exception 'Invalid risk level';
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Assessment reason is required'; end if;
  if p_override and nullif(btrim(p_override_explanation),'') is null then
    raise exception 'Professional override requires an explanation';
  end if;
  v_next := a.current_version+1;
  insert into public.social_assessment_versions(
    org_id,assessment_id,version,evidence_observations,reason,protective_factors,
    immediate_actions,required_follow_up,answers,risk_level,created_by
  ) values(
    a.org_id,a.id,v_next,p_evidence,p_reason,p_protective_factors,
    p_immediate_actions,p_required_follow_up,coalesce(p_answers,'{}'::jsonb),
    p_risk_level,auth.uid()
  );
  update public.social_assessments set
    current_version=v_next,risk_level=p_risk_level,next_review_date=p_next_review,
    professional_override=p_override,override_explanation=p_override_explanation
  where id=a.id;
  update public.social_cases set risk_level=p_risk_level,last_activity_at=now(),updated_at=now()
  where id=a.social_case_id;
  return v_next;
end;
$$;

create or replace function public.approve_social_care_plan(
  p_plan uuid, p_version integer
) returns void
language plpgsql security invoker set search_path=public as $$
declare p public.social_care_plans%rowtype;
begin
  select * into p from public.social_care_plans where id=p_plan for update;
  if not found or not public.social_has_capability(p.org_id,'care_plan.approve',auth.uid()) then
    raise exception 'Care-plan approval denied';
  end if;
  if p_version<>p.current_version then raise exception 'Only the current plan version may be approved'; end if;
  update public.social_care_plan_versions
    set approved_by=auth.uid(),approved_at=now(),status='active'
    where care_plan_id=p.id and version=p_version and approved_at is null;
  if not found then raise exception 'Plan version not found or already approved'; end if;
  update public.social_care_plans
    set status='active',approved_by=auth.uid(),approved_at=now(),updated_at=now()
    where id=p.id;
end;
$$;

create or replace function public.close_social_case(
  p_case uuid,
  p_reason text,
  p_final_risk text,
  p_summary jsonb
) returns uuid
language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype;
declare v_id uuid;
declare v_version integer;
begin
  select * into c from public.social_cases where id=p_case for update;
  if not found or not (
    public.can_manage_org(c.org_id,auth.uid())
    or public.social_has_capability(c.org_id,'closure.approve',auth.uid())
  ) then raise exception 'Closure approval denied'; end if;
  if p_reason not in ('services_completed','client_withdrew','unable_to_contact','transferred','ineligible','relocated','duplicate_case','other') then
    raise exception 'Invalid closure reason';
  end if;
  if p_final_risk not in ('unknown','low','moderate','high','critical') then raise exception 'Invalid risk'; end if;
  select coalesce(max(closure_version),0)+1 into v_version
    from public.social_case_closures where social_case_id=p_case;
  insert into public.social_case_closures(
    org_id,social_case_id,closure_version,closure_reason,final_risk_level,
    goals_completed,goals_incomplete,referrals_completed,pending_referrals,
    outstanding_deadlines,client_notification,document_disposition,
    retention_status,closing_professional,supervisor_approval_by,
    supervisor_approved_at,closure_date
  ) values(
    c.org_id,c.id,v_version,p_reason,p_final_risk,
    p_summary->>'goals_completed',p_summary->>'goals_incomplete',
    p_summary->>'referrals_completed',p_summary->>'pending_referrals',
    p_summary->>'outstanding_deadlines',p_summary->>'client_notification',
    p_summary->>'document_disposition',p_summary->>'retention_status',
    auth.uid(),auth.uid(),now(),now()
  ) returning id into v_id;
  update public.social_cases set status='closed',closure_date=now(),updated_at=now() where id=c.id;
  return v_id;
end;
$$;

create or replace function public.reopen_social_case(
  p_case uuid, p_reason text
) returns void
language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype;
begin
  select * into c from public.social_cases where id=p_case for update;
  if not found or c.status<>'closed' or not (
    public.can_manage_org(c.org_id,auth.uid())
    or public.social_has_capability(c.org_id,'closure.approve',auth.uid())
  ) then raise exception 'Reopening denied'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Reopen reason is required'; end if;
  update public.social_case_closures set
    reopened_at=now(),reopened_by=auth.uid(),reopen_reason=p_reason
  where id=(select id from public.social_case_closures where social_case_id=p_case order by closure_version desc limit 1);
  update public.social_cases set status='reopened',closure_date=null,updated_at=now() where id=p_case;
  insert into public.social_activity_events(org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata)
  values(c.org_id,c.id,auth.uid(),'reopened','social_cases',c.id,jsonb_build_object('reason',p_reason));
end;
$$;

create or replace function public.accept_social_transfer(
  p_transfer uuid
) returns void
language plpgsql security invoker set search_path=public as $$
declare t public.social_case_transfers%rowtype;
begin
  select * into t from public.social_case_transfers where id=p_transfer for update;
  if not found or t.status<>'sent' then raise exception 'Transfer is not awaiting receipt'; end if;
  if not (
    t.to_user_id=auth.uid()
    or (t.receiving_org_id is not null and public.can_manage_org(t.receiving_org_id,auth.uid()))
  ) then raise exception 'Transfer receipt denied'; end if;
  update public.social_case_transfers set status='received',received_at=now(),received_by=auth.uid()
  where id=t.id;
  if t.to_user_id is not null then
    update public.social_case_assignments set active=false,ended_at=now()
      where social_case_id=t.social_case_id and active;
    insert into public.social_case_assignments(org_id,social_case_id,user_id,assignment_role,assigned_by)
      values(t.org_id,t.social_case_id,t.to_user_id,'case_manager',auth.uid());
    update public.social_cases set assigned_case_manager=t.to_user_id,status='active',transfer_date=now(),updated_at=now()
      where id=t.social_case_id;
  else
    update public.social_cases set status='transferred',transfer_date=now(),updated_at=now()
      where id=t.social_case_id;
  end if;
end;
$$;

-- Privacy-safe institutional indicators. Any grouped count below five is
-- suppressed; callers receive no identifying rows.
create or replace function public.social_indicator_summary(
  p_org uuid, p_from date, p_to date
)
returns table(indicator_code text,dimension text,value bigint,suppressed boolean)
language plpgsql stable security invoker set search_path=public as $$
begin
  if not (
    public.can_manage_org(p_org,auth.uid())
    or public.social_has_capability(p_org,'indicators.view',auth.uid())
    or public.social_has_capability(p_org,'indicators.deidentified',auth.uid())
  ) then raise exception 'Indicator access denied'; end if;
  return query
  with metrics as (
    select 'cases_by_status'::text code,c.status::text dim,count(*)::bigint n
    from public.social_cases c
    where c.org_id=p_org and c.created_at::date between p_from and p_to and c.deleted_at is null
    group by c.status
    union all
    select 'cases_by_risk',c.risk_level,count(*)::bigint
    from public.social_cases c
    where c.org_id=p_org and c.created_at::date between p_from and p_to and c.deleted_at is null
    group by c.risk_level
    union all
    select 'referrals_by_status',r.status,count(*)::bigint
    from public.social_referrals r
    where r.org_id=p_org and r.created_at::date between p_from and p_to
    group by r.status
    union all
    select 'services_delivered',i.service_type,count(*)::bigint
    from public.social_interventions i
    where i.org_id=p_org and i.occurred_at::date between p_from and p_to
      and public.social_can_access_case(i.social_case_id,i.record_type,false,auth.uid())
    group by i.service_type
  )
  select m.code,m.dim,case when m.n<5 then 0 else m.n end,m.n<5 from metrics m;
end;
$$;

revoke all on function public.find_possible_social_people(uuid,text,date,text,text,integer) from public;
revoke all on function public.search_social_case_management(uuid,text,text,text,uuid,integer) from public;
revoke all on function public.record_social_assessment(uuid,text,text,text,text,text,text,jsonb,date,boolean,text) from public;
revoke all on function public.approve_social_care_plan(uuid,integer) from public;
revoke all on function public.close_social_case(uuid,text,text,jsonb) from public;
revoke all on function public.reopen_social_case(uuid,text) from public;
revoke all on function public.accept_social_transfer(uuid) from public;
revoke all on function public.social_indicator_summary(uuid,date,date) from public;
grant execute on function public.find_possible_social_people(uuid,text,date,text,text,integer) to authenticated;
grant execute on function public.search_social_case_management(uuid,text,text,text,uuid,integer) to authenticated;
grant execute on function public.record_social_assessment(uuid,text,text,text,text,text,text,jsonb,date,boolean,text) to authenticated;
grant execute on function public.approve_social_care_plan(uuid,integer) to authenticated;
grant execute on function public.close_social_case(uuid,text,text,jsonb) to authenticated;
grant execute on function public.reopen_social_case(uuid,text) to authenticated;
grant execute on function public.accept_social_transfer(uuid) to authenticated;
grant execute on function public.social_indicator_summary(uuid,date,date) to authenticated;
