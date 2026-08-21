begin;

-- Social helpers intentionally query memberships directly. Legacy organization
-- helpers have changed argument conventions over time and cannot safely inspect
-- a different user (for example, when assigning a case manager).
create or replace function public.social_is_org_member(p_org uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select public.social_is_platform_admin(p_user) or exists (
    select 1 from public.org_memberships m
    join public.organizations o on o.id=m.org_id
    where m.org_id=p_org and m.user_id=p_user and m.status='active' and o.status='active'
  );
$$;

create or replace function public.social_can_manage_org(p_org uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select public.social_is_platform_admin(p_user) or exists (
    select 1 from public.org_memberships m
    join public.organizations o on o.id=m.org_id
    where m.org_id=p_org and m.user_id=p_user and m.status='active'
      and m.role_in_org in ('owner','admin') and o.status='active'
  );
$$;

create or replace function public.social_can_contribute_org(p_org uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select public.social_is_platform_admin(p_user) or exists (
    select 1 from public.org_memberships m
    join public.organizations o on o.id=m.org_id
    where m.org_id=p_org and m.user_id=p_user and m.status='active'
      and m.role_in_org in ('owner','admin','lawyer','paralegal') and o.status='active'
  );
$$;

-- OLD is not assigned on INSERT and NEW is not assigned on DELETE. Selecting a
-- single operation-appropriate row prevents audit logging from rolling back
-- otherwise valid Social writes.
create or replace function public.audit_social_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_row jsonb;
  v_org uuid;
  v_case uuid;
  v_id uuid;
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  v_org:=nullif(v_row->>'org_id','')::uuid;
  if tg_table_name='social_cases' then
    v_case:=nullif(v_row->>'id','')::uuid;
  else
    v_case:=nullif(v_row->>'social_case_id','')::uuid;
  end if;
  v_id:=nullif(v_row->>'id','')::uuid;
  insert into public.social_activity_events(
    org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_org,v_case,auth.uid(),lower(tg_op),tg_table_name,v_id,
    jsonb_build_object('operation',tg_op)
  );
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.create_social_person(
  p_org uuid,p_legal_name text,p_preferred_name text default null,
  p_aliases text[] default '{}',p_date_of_birth date default null,
  p_approximate_age smallint default null,p_nationality text default null,
  p_languages text[] default '{}',p_telephone text default null,
  p_email text default null,p_current_location jsonb default '{}'::jsonb,
  p_immigration_identifiers jsonb default '{}'::jsonb,p_is_minor boolean default null,
  p_unaccompanied_minor boolean default false,p_separated_minor boolean default false
) returns public.social_people
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_person public.social_people%rowtype;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not (public.social_can_manage_org(p_org,v_user) or public.social_has_capability(p_org,'person.manage',v_user)) then
    raise exception 'Person creation denied for this organization' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_legal_name,'')))<2 then raise exception 'Legal name is required'; end if;
  if p_approximate_age is not null and (p_approximate_age<0 or p_approximate_age>130) then raise exception 'Approximate age is invalid'; end if;
  if not coalesce(p_is_minor,false) and (coalesce(p_unaccompanied_minor,false) or coalesce(p_separated_minor,false)) then
    raise exception 'Minor protection flags require the person to be marked as a minor';
  end if;
  insert into public.social_people(
    org_id,person_number,legal_name,preferred_name,aliases,date_of_birth,approximate_age,
    nationality,languages,telephone,email,current_location,immigration_identifiers,is_minor,
    unaccompanied_minor,separated_minor,assigned_case_manager,created_by
  ) values(
    p_org,null,btrim(p_legal_name),nullif(btrim(coalesce(p_preferred_name,'')),''),coalesce(p_aliases,'{}'),
    p_date_of_birth,p_approximate_age,nullif(btrim(coalesce(p_nationality,'')),''),coalesce(p_languages,'{}'),
    nullif(btrim(coalesce(p_telephone,'')),''),nullif(btrim(coalesce(p_email,'')),''),coalesce(p_current_location,'{}'),
    coalesce(p_immigration_identifiers,'{}'),p_is_minor,coalesce(p_unaccompanied_minor,false),
    coalesce(p_separated_minor,false),v_user,v_user
  ) returning * into v_person;
  return v_person;
end;
$$;

create or replace function public.create_social_family(
  p_org uuid,p_name text,p_primary uuid,p_location jsonb,p_members uuid[]
) returns public.social_families
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); f public.social_families%rowtype; v_person uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not (public.social_can_manage_org(p_org,v_user) or public.social_has_capability(p_org,'person.manage',v_user)) then
    raise exception 'Family creation denied for this organization' using errcode='42501';
  end if;
  if nullif(btrim(coalesce(p_name,'')),'') is null then raise exception 'Family name is required'; end if;
  if p_primary is not null and not exists(select 1 from public.social_people where id=p_primary and org_id=p_org and deleted_at is null) then
    raise exception 'Primary contact is outside this organization';
  end if;
  if exists(
    select 1 from unnest(coalesce(p_members,'{}'::uuid[])) x
    where not exists(select 1 from public.social_people p where p.id=x and p.org_id=p_org and p.deleted_at is null)
  ) then raise exception 'A family member is outside this organization'; end if;
  insert into public.social_families(org_id,family_number,family_name,primary_contact_person_id,current_location,assigned_case_manager,created_by)
  values(p_org,null,btrim(p_name),p_primary,coalesce(p_location,'{}'),v_user,v_user) returning * into f;
  foreach v_person in array coalesce(p_members,'{}'::uuid[]) loop
    insert into public.social_family_members(org_id,family_id,person_id) values(p_org,f.id,v_person) on conflict(family_id,person_id) do nothing;
  end loop;
  return f;
end;
$$;

create or replace function public.create_social_case(
  p_org uuid,p_program uuid,p_person uuid,p_family uuid,p_case_type text,
  p_referral_source text default null,p_service_areas text[] default '{}',
  p_priority text default 'normal',p_risk_level text default 'unknown',
  p_confidentiality_level text default 'standard',p_tags text[] default '{}'
) returns public.social_cases
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_case public.social_cases%rowtype;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not (public.social_can_manage_org(p_org,v_user) or public.social_has_capability(p_org,'case.create',v_user)) then
    raise exception 'Case creation denied for this organization' using errcode='42501';
  end if;
  if (p_person is null)=(p_family is null) then raise exception 'Choose exactly one person or family'; end if;
  if not exists(select 1 from public.social_programs where id=p_program and org_id=p_org and active) then raise exception 'Invalid or inactive Social program'; end if;
  if p_person is not null and not exists(select 1 from public.social_people where id=p_person and org_id=p_org and deleted_at is null) then raise exception 'Person is outside this organization'; end if;
  if p_family is not null and not exists(select 1 from public.social_families where id=p_family and org_id=p_org and deleted_at is null) then raise exception 'Family is outside this organization'; end if;
  if length(btrim(coalesce(p_case_type,'')))<2 then raise exception 'Case type is required'; end if;
  if p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
  if p_risk_level not in ('unknown','low','moderate','high','critical') then raise exception 'Invalid risk level'; end if;
  if p_confidentiality_level not in ('standard','confidential','restricted','highly_restricted') then raise exception 'Invalid confidentiality level'; end if;
  insert into public.social_cases(
    org_id,program_id,case_number,person_id,family_id,case_type,referral_source,
    assigned_case_manager,service_areas,priority,risk_level,confidentiality_level,tags,created_by
  ) values(
    p_org,p_program,null,p_person,p_family,btrim(p_case_type),nullif(btrim(coalesce(p_referral_source,'')),''),
    v_user,coalesce(p_service_areas,'{}'),p_priority,p_risk_level,p_confidentiality_level,coalesce(p_tags,'{}'),v_user
  ) returning * into v_case;
  return v_case;
end;
$$;

-- Five-argument overload matches the application and supports program/office filters.
create or replace function public.social_indicator_summary(
  p_org uuid,p_from date,p_to date,p_program uuid,p_office uuid
) returns table(indicator_code text,dimension text,value bigint,suppressed boolean)
language plpgsql stable security invoker set search_path=public as $$
begin
  if p_from>p_to then raise exception 'Indicator start date must not be after end date'; end if;
  if not (public.social_can_manage_org(p_org,auth.uid()) or public.social_has_capability(p_org,'indicators.view',auth.uid()) or public.social_has_capability(p_org,'indicators.deidentified',auth.uid())) then
    raise exception 'Indicator access denied' using errcode='42501';
  end if;
  return query with metrics as (
    select 'cases_by_status'::text code,c.status::text dim,count(*)::bigint n from public.social_cases c
      where c.org_id=p_org and c.created_at::date between p_from and p_to and c.deleted_at is null
        and (p_program is null or c.program_id=p_program) and (p_office is null or c.office_id=p_office) group by c.status
    union all
    select 'cases_by_risk',c.risk_level,count(*)::bigint from public.social_cases c
      where c.org_id=p_org and c.created_at::date between p_from and p_to and c.deleted_at is null
        and (p_program is null or c.program_id=p_program) and (p_office is null or c.office_id=p_office) group by c.risk_level
    union all
    select 'referrals_by_status',r.status,count(*)::bigint from public.social_referrals r
      join public.social_cases c on c.id=r.social_case_id
      where r.org_id=p_org and r.created_at::date between p_from and p_to
        and (p_program is null or c.program_id=p_program) and (p_office is null or c.office_id=p_office) group by r.status
    union all
    select 'services_delivered',i.service_type,count(*)::bigint from public.social_interventions i
      join public.social_cases c on c.id=i.social_case_id
      where i.org_id=p_org and i.occurred_at::date between p_from and p_to
        and (p_program is null or c.program_id=p_program) and (p_office is null or c.office_id=p_office)
        and public.social_can_access_case(i.social_case_id,i.record_type,false,auth.uid()) group by i.service_type
  ) select m.code,m.dim,case when m.n<5 then 0 else m.n end,m.n<5 from metrics m;
end;
$$;

revoke all on function public.social_is_org_member(uuid,uuid) from public;
revoke all on function public.social_can_manage_org(uuid,uuid) from public;
revoke all on function public.social_can_contribute_org(uuid,uuid) from public;
revoke all on function public.create_social_person(uuid,text,text,text[],date,smallint,text,text[],text,text,jsonb,jsonb,boolean,boolean,boolean) from public;
revoke all on function public.create_social_family(uuid,text,uuid,jsonb,uuid[]) from public;
revoke all on function public.create_social_case(uuid,uuid,uuid,uuid,text,text,text[],text,text,text,text[]) from public;
revoke all on function public.social_indicator_summary(uuid,date,date,uuid,uuid) from public;
grant execute on function public.social_is_org_member(uuid,uuid) to authenticated,service_role;
grant execute on function public.social_can_manage_org(uuid,uuid) to authenticated,service_role;
grant execute on function public.social_can_contribute_org(uuid,uuid) to authenticated,service_role;
grant execute on function public.create_social_person(uuid,text,text,text[],date,smallint,text,text[],text,text,jsonb,jsonb,boolean,boolean,boolean) to authenticated,service_role;
grant execute on function public.create_social_family(uuid,text,uuid,jsonb,uuid[]) to authenticated,service_role;
grant execute on function public.create_social_case(uuid,uuid,uuid,uuid,text,text,text[],text,text,text,text[]) to authenticated,service_role;
grant execute on function public.social_indicator_summary(uuid,date,date,uuid,uuid) to authenticated,service_role;

-- Folder one must be the same organization as folder two's case.
alter policy social_case_files_read on storage.objects using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and exists(select 1 from public.social_cases c where c.id=((storage.foldername(name))[2])::uuid and c.org_id=((storage.foldername(name))[1])::uuid)
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],false,auth.uid())
);
alter policy social_case_files_insert on storage.objects with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and exists(select 1 from public.social_cases c where c.id=((storage.foldername(name))[2])::uuid and c.org_id=((storage.foldername(name))[1])::uuid)
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid())
);
alter policy social_case_files_update on storage.objects
  using (
    bucket_id='social-case-files'
    and exists(select 1 from public.social_cases c where c.id=((storage.foldername(name))[2])::uuid and c.org_id=((storage.foldername(name))[1])::uuid)
    and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid())
  )
  with check (
    bucket_id='social-case-files'
    and exists(select 1 from public.social_cases c where c.id=((storage.foldername(name))[2])::uuid and c.org_id=((storage.foldername(name))[1])::uuid)
    and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid())
  );

notify pgrst,'reload schema';
commit;

