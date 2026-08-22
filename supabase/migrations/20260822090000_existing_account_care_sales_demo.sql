begin;

create table if not exists public.social_sales_demo_records (
  id uuid primary key default gen_random_uuid(),
  fixture_version text not null,
  owner_user_id uuid not null references auth.users(id),
  org_id uuid not null references public.organizations(id),
  table_name text not null,
  record_id uuid not null,
  external_key text not null,
  original_state jsonb,
  synthetic boolean not null default true,
  sales_demo boolean not null default true,
  created_at timestamptz not null default now(),
  unique(fixture_version,owner_user_id,org_id,table_name,record_id),
  unique(fixture_version,owner_user_id,org_id,external_key),
  check(synthetic and sales_demo)
);
alter table public.social_sales_demo_records enable row level security;
drop policy if exists social_sales_demo_owner_read on public.social_sales_demo_records;
create policy social_sales_demo_owner_read on public.social_sales_demo_records for select to authenticated
using(owner_user_id=auth.uid());
revoke all on public.social_sales_demo_records from public,anon,authenticated;
grant select on public.social_sales_demo_records to authenticated;

create or replace function public.social_sales_demo_owner_allows(p_table text,p_id uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(
    select 1 from public.social_sales_demo_records d
    where d.table_name=p_table and d.record_id=p_id and d.synthetic and d.sales_demo
      and d.fixture_version='comprehensive-care-sales-demo-v1'
  ) or exists(
    select 1 from public.social_sales_demo_records d
    where d.table_name=p_table and d.record_id=p_id and d.synthetic and d.sales_demo
      and d.fixture_version='comprehensive-care-sales-demo-v1' and d.owner_user_id=p_user
  )
$$;
revoke all on function public.social_sales_demo_owner_allows(text,uuid,uuid) from public,anon;
grant execute on function public.social_sales_demo_owner_allows(text,uuid,uuid) to authenticated,service_role;

create or replace function public.social_can_access_case(
  p_case uuid,p_record_type text default 'general_case_record',
  p_write boolean default false,p_user uuid default auth.uid()
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with c as (select id,org_id,created_by from public.social_cases where id=p_case and deleted_at is null)
  select exists(select 1 from c
    where public.social_sales_demo_owner_allows('social_cases',c.id,p_user)
      and public.is_org_member(c.org_id,p_user)
      and (public.can_manage_org(c.org_id,p_user) or c.created_by=p_user
        or exists(select 1 from public.social_case_assignments a where a.social_case_id=c.id and a.user_id=p_user and a.active)
        or (not p_write and public.social_has_capability(c.org_id,'case.view_all',p_user)))
      and case p_record_type
        when 'general_case_record' then not p_write or public.can_manage_org(c.org_id,p_user)
          or public.social_has_capability(c.org_id,'case.update',p_user)
          or public.social_has_capability(c.org_id,'case.update_assigned',p_user)
        when 'social_work_record' then public.social_has_capability(c.org_id,'intervention.social_work',p_user)
          or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
        when 'legal_privileged_record' then public.social_has_capability(c.org_id,'restricted.legal',p_user)
          or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
        when 'psychosocial_restricted_record' then public.social_has_capability(c.org_id,'restricted.psychosocial',p_user)
          or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
        when 'medical_restricted_record' then public.social_has_capability(c.org_id,'restricted.medical',p_user)
          or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
        when 'child_protection_restricted_record' then public.social_has_capability(c.org_id,'restricted.child_protection',p_user)
          or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
        else false end)
$$;

create or replace function public.social_can_access_person(p_person uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.social_people p where p.id=p_person and p.deleted_at is null
  and public.social_sales_demo_owner_allows('social_people',p.id,p_user)
  and public.is_org_member(p.org_id,p_user)
  and (public.can_manage_org(p.org_id,p_user) or p.created_by=p_user or p.assigned_case_manager=p_user
   or exists(select 1 from public.social_cases c where
    (c.person_id=p.id or exists(select 1 from public.social_family_members fm where fm.person_id=p.id and fm.family_id=c.family_id and fm.left_at is null))
    and public.social_can_access_case(c.id,'general_case_record',false,p_user))))
$$;

alter policy social_families_read on public.social_families using (
 public.social_sales_demo_owner_allows('social_families',id,auth.uid())
 and public.is_org_member(org_id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid()) or created_by=auth.uid() or assigned_case_manager=auth.uid()
  or exists(select 1 from public.social_cases c where c.family_id=id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
 )
);

alter policy social_families_write on public.social_families
 using (public.social_sales_demo_owner_allows('social_families',id,auth.uid()) and public.is_org_member(org_id,auth.uid())
   and (public.can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'person.manage',auth.uid())))
 with check (public.social_sales_demo_owner_allows('social_families',id,auth.uid()) and public.is_org_member(org_id,auth.uid())
   and (public.can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'person.manage',auth.uid())));

alter policy social_institutions_read on public.social_institutions
 using (public.social_sales_demo_owner_allows('social_institutions',id,auth.uid())
   and (org_id is null or public.is_org_member(org_id,auth.uid())));
alter policy social_institutions_manage on public.social_institutions
 using (public.social_sales_demo_owner_allows('social_institutions',id,auth.uid())
   and org_id is not null and public.can_manage_org(org_id,auth.uid()))
 with check (public.social_sales_demo_owner_allows('social_institutions',id,auth.uid())
   and org_id is not null and public.can_manage_org(org_id,auth.uid()));

create or replace function public.social_sales_demo_any_owner_allows(p_id uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select not exists(select 1 from public.social_sales_demo_records d where d.record_id=p_id and d.synthetic and d.sales_demo)
 or exists(select 1 from public.social_sales_demo_records d where d.record_id=p_id and d.synthetic and d.sales_demo and d.owner_user_id=p_user)
$$;
revoke all on function public.social_sales_demo_any_owner_allows(uuid,uuid) from public,anon;
grant execute on function public.social_sales_demo_any_owner_allows(uuid,uuid) to authenticated,service_role;
alter policy social_activity_read on public.social_activity_events
 using (public.social_sales_demo_any_owner_allows(entity_id,auth.uid())
  and (social_case_id is null or public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()))
  and public.is_org_member(org_id,auth.uid())
  and (public.can_manage_org(org_id,auth.uid()) or actor_id=auth.uid() or public.social_has_capability(org_id,'audit.view',auth.uid())));

create or replace function public.assert_existing_account_care_demo_owner()
returns void language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare v_owner constant uuid:='d1c91a8d-de47-48c9-95b4-519c60ae8e04';
v_org constant uuid:='121250d0-c4bd-49ff-8a9e-e9557b0f88fb';
begin
 if auth.uid() is distinct from v_owner then raise exception 'Sales demonstration owner authorization required'; end if;
 if not exists(select 1 from auth.users where id=v_owner and lower(email)=lower('h.g4972@gmail.com')) then raise exception 'Resolved owner no longer matches'; end if;
 if not exists(select 1 from public.org_memberships where user_id=v_owner and org_id=v_org and status='active' and deleted_at is null) then raise exception 'Active Nyrava membership not found'; end if;
 if not exists(select 1 from public.organizations where id=v_org and name='Nyrava' and status='active' and deleted_at is null) then raise exception 'Existing Nyrava organization not found'; end if;
end $$;

create or replace function public.demo_manifest(p_table text,p_id uuid,p_key text)
returns void language sql security definer set search_path=public,pg_temp as $$
 insert into public.social_sales_demo_records(fixture_version,owner_user_id,org_id,table_name,record_id,external_key)
 values('comprehensive-care-sales-demo-v1','d1c91a8d-de47-48c9-95b4-519c60ae8e04','121250d0-c4bd-49ff-8a9e-e9557b0f88fb',p_table,p_id,p_key)
 on conflict(fixture_version,owner_user_id,org_id,external_key) do update set table_name=excluded.table_name,record_id=excluded.record_id
$$;

create or replace function public.existing_account_care_demo_dry_run()
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v jsonb;begin perform public.assert_existing_account_care_demo_owner();
 select jsonb_build_object(
  'dry_run',true,'owner_user_id',auth.uid(),'organization_id','121250d0-c4bd-49ff-8a9e-e9557b0f88fb',
  'organization_name','Nyrava','fixture_version','comprehensive-care-sales-demo-v1',
  'existing_manifest_records',(select count(*) from public.social_sales_demo_records where owner_user_id=auth.uid() and org_id='121250d0-c4bd-49ff-8a9e-e9557b0f88fb'),
  'would_create',jsonb_build_object('people',8,'families',1,'cases',4,'assessments',5,'care_plans',4,'goals',8,'interventions',9,'consents',3,'institutions',14,'referrals',8,'tasks',12,'appointments',4,'alerts',5,'knowledge',16,'documents',18)
 ) into v;return v;end $$;

create or replace function public.populate_existing_account_comprehensive_care_demo()
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare
 o constant uuid:='121250d0-c4bd-49ff-8a9e-e9557b0f88fb';u constant uuid:='d1c91a8d-de47-48c9-95b4-519c60ae8e04';
 p uuid;f constant uuid:='d3000000-0000-4000-8000-000000000041';
 c1 constant uuid:='d3000000-0000-4000-8000-000000000417';c2 constant uuid:='d3000000-0000-4000-8000-000000000318';
 c3 constant uuid:='d3000000-0000-4000-8000-000000000271';c4 constant uuid:='d3000000-0000-4000-8000-000000000199';
 a1 constant uuid:='d3000000-0000-4000-8001-000000000001';a2 constant uuid:='d3000000-0000-4000-8001-000000000002';
 cp constant uuid:='d3000000-0000-4000-8002-000000000001';cpv constant uuid:='d3000000-0000-4000-8002-000000000002';
 i integer;
 co constant uuid:='d3000000-0000-4000-8003-000000000001';
begin
 perform public.assert_existing_account_care_demo_owner();
 select id into p from public.social_programs where org_id=o and active order by created_at limit 1;
 if p is null then raise exception 'Existing Comprehensive Care program not found'; end if;
 if exists(select 1 from public.social_cases where org_id=o and case_number in ('NYR-SOC-2026-000417','NYR-SOC-2026-000318','NYR-SOC-2026-000271','NYR-SOC-2026-000199') and id not in(c1,c2,c3,c4)) then raise exception 'A requested case number already belongs to non-demo data'; end if;

 insert into public.social_people(id,org_id,person_number,legal_name,preferred_name,date_of_birth,nationality,country_of_origin,languages,telephone,current_location,is_minor,separated_minor,assigned_case_manager,consent_status,record_status,created_by)
 values
 ('d3000000-0000-4000-8100-000000000001',o,'PER-2026-000417','María Elena Hernández López','María Elena','1991-04-18','Guatemalan','Guatemala',array['Spanish'],'961-000-0417',jsonb_build_object('city','Tapachula','state','Chiapas'),false,false,u,'limited','active',u),
 ('d3000000-0000-4000-8100-000000000002',o,'PER-2026-000418','José Daniel Hernández López','José Daniel','2014-09-06','Guatemalan','Guatemala',array['Spanish'],null,jsonb_build_object('city','Tapachula','state','Chiapas'),true,true,u,'limited','active',u),
 ('d3000000-0000-4000-8100-000000000003',o,'PER-2026-000419','Sofía Isabel Hernández López','Sofía Isabel','2018-11-22','Guatemalan','Guatemala',array['Spanish'],null,jsonb_build_object('city','Tapachula','state','Chiapas'),true,true,u,'limited','active',u),
 ('d3000000-0000-4000-8100-000000000004',o,'PER-2026-000420','Carlos Estuardo Pérez Morales','Carlos Estuardo','1988-02-03','Guatemalan','Guatemala',array['Spanish'],null,jsonb_build_object('status','current location unknown'),false,false,u,'pending','active',u),
 ('d3000000-0000-4000-8100-000000000005',o,'PER-2026-000421','Maria Elena Hernandez Lopez','María','1991-04-18','Guatemalan','Guatemala',array['Spanish'],'961-000-0417',jsonb_build_object('possible_duplicate_of','PER-2026-000417'),false,false,u,'pending','duplicate',u),
 ('d3000000-0000-4000-8100-000000000006',o,'PER-2026-000318','Luis Alberto Méndez García','Luis Alberto','1987-07-09','Mexican','Mexico',array['Spanish'],null,jsonb_build_object('city','Mérida','state','Yucatán'),false,false,u,'granted','active',u),
 ('d3000000-0000-4000-8100-000000000007',o,'PER-2026-000271','Rosa Amalia Castillo Hernández','Rosa Amalia','1979-01-12','Mexican','Mexico',array['Spanish'],null,jsonb_build_object('city','Mérida','state','Yucatán'),false,false,u,'granted','inactive',u),
 ('d3000000-0000-4000-8100-000000000008',o,'PER-2026-000199','Miguel Ángel Choc Ramírez','Miguel Ángel','1995-06-15','Guatemalan','Guatemala',array['Spanish'],null,jsonb_build_object('city','Tapachula','state','Chiapas'),false,false,u,'limited','active',u)
 on conflict(id) do update set legal_name=excluded.legal_name,current_location=excluded.current_location,record_status=excluded.record_status,updated_at=now();

 insert into public.social_families(id,org_id,family_number,family_name,primary_contact_person_id,current_location,shared_needs,shared_risks,assigned_case_manager,created_by)
 values(f,o,'FAM-2026-000041','Familia Hernández López','d3000000-0000-4000-8100-000000000001',jsonb_build_object('city','Tapachula','state','Chiapas','status','active'),
 '["safe shelter","medical follow-up","school enrollment","immigration legal orientation","family tracing"]',
 '["family separation","unstable housing","child protection","documentation gaps"]',u,u)
 on conflict(id) do update set current_location=excluded.current_location,shared_needs=excluded.shared_needs,shared_risks=excluded.shared_risks,updated_at=now();

 insert into public.social_family_members(id,org_id,family_id,person_id,relationship,is_dependent,is_child,is_guardian)
 values
 ('d3000000-0000-4000-8200-000000000001',o,f,'d3000000-0000-4000-8100-000000000001','mother',false,false,true),
 ('d3000000-0000-4000-8200-000000000002',o,f,'d3000000-0000-4000-8100-000000000002','child',true,true,false),
 ('d3000000-0000-4000-8200-000000000003',o,f,'d3000000-0000-4000-8100-000000000003','child',true,true,false),
 ('d3000000-0000-4000-8200-000000000004',o,f,'d3000000-0000-4000-8100-000000000004','spouse/father - current location unknown',false,false,true)
 on conflict(family_id,person_id) do update set relationship=excluded.relationship,is_child=excluded.is_child;

 insert into public.social_cases(id,org_id,program_id,case_number,person_id,family_id,case_type,intake_date,referral_source,assigned_case_manager,supervising_manager,service_areas,status,priority,risk_level,confidentiality_level,consent_status,opened_at,last_activity_at,next_required_action,tags,created_by)
 values
 (c1,o,p,'NYR-SOC-2026-000417','d3000000-0000-4000-8100-000000000001',f,'Protección Integral y Estabilización','2026-07-28','Community intake',u,u,array['social_work','child_protection','legal','psychosocial','medical'],'active','urgent','high','highly_restricted','limited','2026-07-28','2026-08-22','Complete family-tracing consent review',array['sales_demo','sales_demo_private','comprehensive-care-sales-demo-v1'],u),
 (c2,o,p,'NYR-SOC-2026-000318','d3000000-0000-4000-8100-000000000006',null,'Transferencia interinstitucional','2026-06-08','Tapachula office',u,u,array['social_work'],'transferred','normal','moderate','highly_restricted','granted','2026-06-08','2026-08-11','Transfer accepted in Mérida',array['sales_demo','sales_demo_private','comprehensive-care-sales-demo-v1'],u),
 (c3,o,p,'NYR-SOC-2026-000271','d3000000-0000-4000-8100-000000000007',null,'Estabilización y cierre','2026-05-12','Direct request',u,u,array['social_work'],'closed','low','low','highly_restricted','granted','2026-05-12','2026-08-02','Services completed',array['sales_demo','sales_demo_private','comprehensive-care-sales-demo-v1'],u),
 (c4,o,p,'NYR-SOC-2026-000199','d3000000-0000-4000-8100-000000000008',null,'Seguimiento reabierto','2026-03-18','Community referral',u,u,array['social_work'],'monitoring','normal','moderate','highly_restricted','limited','2026-03-18','2026-08-20','Reopened after client returned',array['sales_demo','sales_demo_private','comprehensive-care-sales-demo-v1'],u)
 on conflict(id) do update set status=excluded.status,priority=excluded.priority,risk_level=excluded.risk_level,last_activity_at=excluded.last_activity_at,next_required_action=excluded.next_required_action,tags=excluded.tags,updated_at=now();

 insert into public.social_case_assignments(id,org_id,social_case_id,user_id,assignment_role,assigned_by,active)
 select gen_random_uuid(),o,x,u,'demo_owner',u,true from unnest(array[c1,c2,c3,c4]) x
 where not exists(select 1 from public.social_case_assignments a where a.social_case_id=x and a.user_id=u and a.active);

 insert into public.social_record_grants(id,org_id,social_case_id,user_id,record_type,can_read,can_write,granted_by,reason)
 select gen_random_uuid(),o,c1,u,x,true,true,u,'Private owner-only synthetic sales demonstration'
 from unnest(array['social_work_record','legal_privileged_record','psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record']) x
 where not exists(select 1 from public.social_record_grants g where g.social_case_id=c1 and g.user_id=u and g.record_type=x and g.revoked_at is null);

 insert into public.social_assessments(id,org_id,social_case_id,current_version,assessment_date,assessor_id,risk_level,professional_override,next_review_date)
 values(a1,o,c1,1,'2026-07-28',u,'high',false,'2026-08-04'),(a2,o,c1,2,'2026-08-18',u,'high',false,'2026-08-25')
 on conflict(id) do update set current_version=excluded.current_version,risk_level=excluded.risk_level,next_review_date=excluded.next_review_date;
 insert into public.social_assessment_versions(id,org_id,assessment_id,version,evidence_observations,reason,protective_factors,immediate_actions,required_follow_up,answers,risk_level,created_by)
 values
 ('d3000000-0000-4000-8001-000000000011',o,a1,1,'Unstable housing, separated family, two children and incomplete identity records.','Initial emergency screening','Mother engaged; children remain together.','Shelter placement and medical screening.','Legal orientation, school enrollment and tracing consent.','{"emergency_screening":"complete"}','high',u),
 ('d3000000-0000-4000-8001-000000000012',o,a2,1,'Shelter stabilized; medical visit completed; family separation unresolved.','Updated risk review','Stable temporary address and active case engagement.','Continue child-protection monitoring.','Obtain limited family-tracing consent and missing documents.','{"changed_since_initial":["housing stabilized","medical attendance confirmed"],"unresolved":["family separation","documents"]}','high',u),
 ('d3000000-0000-4000-8001-000000000013',o,a2,2,'Supervisor-reviewed update; no immediate life-safety threat identified.','Versioned supervisor review','Service network responding.','Seven-day coordinated action plan.','Review overdue education and tracing tasks.','{"professional_review":true}','high',u)
 on conflict(assessment_id,version) do update set evidence_observations=excluded.evidence_observations,required_follow_up=excluded.required_follow_up,answers=excluded.answers;

 insert into public.social_care_plans(id,org_id,social_case_id,family_id,current_version,status,approved_by,approved_at,created_by)
 values(cp,o,c1,f,1,'active',u,'2026-07-30',u) on conflict(id) do update set status='active',updated_at=now();
 insert into public.social_care_plan_versions(id,org_id,care_plan_id,version,summary,status,submitted_by,approved_by,approved_at)
 values(cpv,o,cp,1,'Stabilize shelter, health, documentation, education, legal orientation and family tracing.','approved',u,u,'2026-07-30')
 on conflict(care_plan_id,version) do update set summary=excluded.summary,status=excluded.status;
 insert into public.social_care_plan_goals(id,org_id,care_plan_version_id,identified_need,goal,planned_action,responsible_service_area,target_date,priority,required_consent,expected_outcome,status,review_date)
 values
 ('d3000000-0000-4000-8002-000000000011',o,cpv,'Safe housing','Maintain safe family shelter','Coordinate shelter and address evidence','social_work','2026-08-05','urgent','general_service','Stable temporary placement','completed','2026-08-18'),
 ('d3000000-0000-4000-8002-000000000012',o,cpv,'Medical follow-up','Complete primary medical assessment','Referral and attendance confirmation','medical','2026-08-07','high','medical','Attendance documented','completed','2026-08-18'),
 ('d3000000-0000-4000-8002-000000000013',o,cpv,'Education','Enroll both children in school','Collect school documents and submit enrollment','child_protection','2026-08-15','high','general_service','Enrollment appointment scheduled','in_progress','2026-08-25'),
 ('d3000000-0000-4000-8002-000000000014',o,cpv,'Family separation','Assess safe family tracing','Confirm limited consent and initiate tracing referral','referral','2026-08-12','high','family_tracing','Consent verified and referral sent','blocked','2026-08-25'),
 ('d3000000-0000-4000-8002-000000000015',o,cpv,'Immigration orientation','Obtain Mexican immigration/refugee legal orientation','Consent-gated legal referral','legal','2026-08-10','high','legal_service','Options explained','in_progress','2026-08-25')
 on conflict(id) do update set status=excluded.status,review_date=excluded.review_date;

 insert into public.social_consents(id,org_id,person_id,family_id,consent_type,status,valid_from,expires_at,created_by)
 values
 (co,o,'d3000000-0000-4000-8100-000000000001',f,'general_service','active','2026-07-28','2027-07-28',u),
 ('d3000000-0000-4000-8003-000000000002',o,'d3000000-0000-4000-8100-000000000001',f,'psychosocial_service','active','2026-07-29','2027-01-29',u),
 ('d3000000-0000-4000-8003-000000000003',o,'d3000000-0000-4000-8100-000000000001',f,'limited_external_sharing','active','2026-07-30','2026-10-30',u)
 on conflict(id) do update set status=excluded.status,expires_at=excluded.expires_at;
 insert into public.social_consent_versions(id,org_id,consent_id,version,language,consented_by_name,guardian_representative,permitted_purpose,permitted_recipients,permitted_information,restrictions,confirmation,created_by)
 values
 ('d3000000-0000-4000-8300-000000000001',o,co,1,'es','María Elena Hernández López',null,array['case_management'],array['authorized_case_team'],array['service_information'],'No unrestricted external sharing','{"signed":true,"synthetic":true}',u),
 ('d3000000-0000-4000-8300-000000000002',o,'d3000000-0000-4000-8003-000000000002',1,'es','María Elena Hernández López',null,array['psychosocial_support'],array['authorized_psychosocial_team'],array['minimum_necessary'],'Restricted clinical content','{"signed":true,"synthetic":true}',u),
 ('d3000000-0000-4000-8300-000000000003',o,'d3000000-0000-4000-8003-000000000003',1,'es','María Elena Hernández López',null,array['medical_referral','education_referral','family_tracing_review'],array['named_receiving_institutions'],array['minimum_necessary'],'Family tracing requires staff confirmation before sending','{"signed":true,"synthetic":true}',u)
 on conflict(consent_id,version) do update set permitted_purpose=excluded.permitted_purpose,restrictions=excluded.restrictions;

 insert into public.social_interventions(id,org_id,social_case_id,person_id,family_id,occurred_at,service_type,professional_id,location_method,reason,actions_taken,outcome,follow_up_required,confidentiality_level,record_type,next_appointment)
 values
 ('d3000000-0000-4000-8400-000000000001',o,c1,null,f,'2026-07-28 10:00+00','intake',u,'in_person','Emergency intake','Completed family intake and immediate safety screen','Urgent stabilization plan opened',true,'confidential','social_work_record','2026-07-30'),
 ('d3000000-0000-4000-8400-000000000002',o,c1,null,f,'2026-07-30 15:00+00','legal_service',u,'in_person','Immigration legal orientation','Reviewed Mexico-only immigration and refugee referral options','Legal referral authorized; no legal matter created automatically',true,'restricted','legal_privileged_record',null),
 ('d3000000-0000-4000-8400-000000000003',o,c1,'d3000000-0000-4000-8100-000000000001',null,'2026-08-01 16:00+00','psychosocial',u,'in_person','Support assessment','Completed consented psychosocial screening','Follow-up recommended; clinical details restricted',true,'restricted','psychosocial_restricted_record','2026-08-15'),
 ('d3000000-0000-4000-8400-000000000004',o,c1,null,f,'2026-08-03 12:00+00','medical',u,'external_referral','Primary care screening','Issued medical referral','Attendance later confirmed',false,'restricted','medical_restricted_record',null),
 ('d3000000-0000-4000-8400-000000000005',o,c1,null,f,'2026-08-18 11:00+00','case_review',u,'video','Updated risk review','Compared initial and updated risks with supervisor','Housing and medical risks improved; separation and documents unresolved',true,'confidential','social_work_record','2026-08-25')
 on conflict(id) do update set outcome=excluded.outcome,follow_up_required=excluded.follow_up_required;

 insert into public.social_institutions(id,org_id,name,official_name,institution_type,jurisdiction_level,contact,services,active,description,state_code,municipality,phone,email,hours,languages,populations,cost_type,walk_in_available,emergency_available,remote_available,referral_methods,coverage_levels,coverage_states,capacity_status,confidentiality_level,verification_status,verification_source,verified_by,verified_at,status,approved_at,approved_by,internal_notes)
 values
 ('d3000000-0000-4000-8500-000000000001',o,'Centro Integral Frontera Sur','Centro Integral Frontera Sur','social_service','municipal','{}',array['shelter','food support','case management'],true,'Synthetic demonstration resource; no real contact information.','CHP','Tapachula',null,null,'{"weekdays":"24 hours"}',array['Spanish'],array['families','children'],'free',true,true,false,array['internal_referral'],array['municipal'],array['CHP'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000002',o,'Clínica Comunitaria del Soconusco','Clínica Comunitaria del Soconusco','medical','municipal','{}',array['medical care'],true,'Synthetic demonstration resource; no real contact information.','CHP','Tapachula',null,null,'{"weekdays":"08:00-18:00"}',array['Spanish'],array['families','children'],'free',false,false,false,array['internal_referral'],array['municipal'],array['CHP'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000003',o,'Red Educativa Puentes','Red Educativa Puentes','education','state','{}',array['education','school enrollment'],true,'Synthetic demonstration resource; no real contact information.','CHP','Tapachula',null,null,'{}',array['Spanish'],array['children'],'free',false,false,true,array['internal_referral'],array['state'],array['CHP'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000004',o,'Enlace Familiar Mesoamericano','Enlace Familiar Mesoamericano','family_tracing','nationwide','{}',array['family tracing','interpreters'],true,'Synthetic demonstration resource; no real contact information.','CHP','Tapachula',null,null,'{}',array['Spanish'],array['families'],'free',false,false,true,array['internal_referral'],array['nationwide'],array['CHP','YUC'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000005',o,'Asistencia Jurídica Horizonte','Asistencia Jurídica Horizonte','legal_aid','state','{}',array['immigration assistance','refugee assistance','legal aid'],true,'Synthetic demonstration resource; Mexico-only legal orientation.','CHP','Tuxtla Gutiérrez',null,null,'{}',array['Spanish'],array['migrants','refugees'],'free',false,false,true,array['internal_referral'],array['state'],array['CHP'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000006',o,'Apoyo Psicosocial Ceiba','Apoyo Psicosocial Ceiba','psychosocial','state','{}',array['psychosocial care','women assistance'],true,'Synthetic demonstration resource; no real contact information.','CHP','Tuxtla Gutiérrez',null,null,'{}',array['Spanish'],array['women','families'],'free',false,false,true,array['internal_referral'],array['state'],array['CHP'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000007',o,'Protección Infantil Yucatán Demo','Protección Infantil Yucatán Demo','child_protection','state','{}',array['child protection','education'],true,'Synthetic demonstration resource; no real contact information.','YUC','Mérida',null,null,'{}',array['Spanish'],array['children'],'free',false,true,true,array['internal_referral'],array['state'],array['YUC'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000008',o,'Red Inclusiva Peninsular','Red Inclusiva Peninsular','disability_support','state','{}',array['disability support','interpreters'],true,'Synthetic demonstration resource; no real contact information.','YUC','Mérida',null,null,'{}',array['Spanish'],array['people with disabilities'],'free',false,false,true,array['internal_referral'],array['state'],array['YUC'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true'),
 ('d3000000-0000-4000-8500-000000000009',o,'Línea Nacional Segura Demo','Línea Nacional Segura Demo','emergency','nationwide','{}',array['human trafficking assistance','women assistance','remote assistance'],true,'Synthetic demonstration resource; no real contact information.',null,null,null,null,'{"availability":"24/7"}',array['Spanish'],array['women','trafficking survivors'],'free',false,true,true,array['internal_referral'],array['nationwide'],array['CHP','YUC'],'available','restricted','verified','synthetic demo directory',u,now(),'verified',now(),u,'synthetic=true; sales_demo=true')
 on conflict(id) do update set services=excluded.services,description=excluded.description,status=excluded.status,updated_at=now();

 insert into public.social_referrals(id,org_id,social_case_id,referral_number,person_id,family_id,receiving_institution_id,service_requested,reason,urgency,consent_id,authorized_information,referral_date,status,response,follow_up_date,created_by)
 values
 ('d3000000-0000-4000-8600-000000000001',o,c1,'REF-2026-000417-01',null,f,'d3000000-0000-4000-8500-000000000001','Family shelter','Urgent safe accommodation','urgent',co,array['family composition','minimum needs'],'2026-07-28','received','Placement confirmed','2026-08-05',u),
 ('d3000000-0000-4000-8600-000000000002',o,c1,'REF-2026-000417-02',null,f,'d3000000-0000-4000-8500-000000000002','Medical care','Primary care screening','high','d3000000-0000-4000-8003-000000000003',array['minimum medical referral'],'2026-08-03','received','Attendance confirmed','2026-08-10',u),
 ('d3000000-0000-4000-8600-000000000003',o,c1,'REF-2026-000417-03',null,f,'d3000000-0000-4000-8500-000000000005','Immigration legal orientation','Mexico-only legal and refugee options','high',co,array['identity summary','intake summary'],'2026-07-30','in_progress',null,'2026-08-25',u),
 ('d3000000-0000-4000-8600-000000000004',o,c1,'REF-2026-000417-04',null,f,'d3000000-0000-4000-8500-000000000004','Family tracing','Assess safe tracing of spouse/father','high','d3000000-0000-4000-8003-000000000003',array['minimum tracing facts'],'2026-08-08','awaiting_consent',null,'2026-08-25',u),
 ('d3000000-0000-4000-8600-000000000005',o,c1,'REF-2026-000417-05',null,f,'d3000000-0000-4000-8500-000000000003','Education','School enrollment for two children','normal',co,array['child identity summary'],'2026-08-05','sent',null,'2026-08-22',u)
 on conflict(id) do update set status=excluded.status,response=excluded.response,follow_up_date=excluded.follow_up_date,updated_at=now();

 insert into public.social_tasks(id,org_id,social_case_id,title,description,assignee_id,priority,status,due_at,supervisor_escalation_at,created_by)
 values
 ('d3000000-0000-4000-8700-000000000001',o,c1,'Verify limited family-tracing consent','Confirm purpose, recipient and information scope.',u,'urgent','blocked','2026-08-12','2026-08-13',u),
 ('d3000000-0000-4000-8700-000000000002',o,c1,'Follow up school enrollment','Obtain response from education referral.',u,'high','in_progress','2026-08-18','2026-08-20',u),
 ('d3000000-0000-4000-8700-000000000003',o,c1,'Collect missing identity document','Request readable identity evidence.',u,'high','todo','2026-08-26',null,u),
 ('d3000000-0000-4000-8700-000000000004',o,c1,'Review updated risk assessment','Supervisor review of changed conditions.',u,'high','done','2026-08-19',null,u),
 ('d3000000-0000-4000-8700-000000000005',o,c1,'Confirm legal referral response','Check immigration legal orientation appointment.',u,'normal','in_progress','2026-08-25',null,u)
 on conflict(id) do update set status=excluded.status,due_at=excluded.due_at,updated_at=now();

 insert into public.social_appointments(id,org_id,social_case_id,person_id,title,scheduled_at,duration_minutes,location_method,professional_id,status,created_by)
 values
 ('d3000000-0000-4000-8800-000000000001',o,c1,'d3000000-0000-4000-8100-000000000001','Case follow-up','2026-08-25 16:00+00',60,'in_person',u,'scheduled',u),
 ('d3000000-0000-4000-8800-000000000002',o,c1,'d3000000-0000-4000-8100-000000000001','Legal orientation follow-up','2026-08-27 17:00+00',45,'video',u,'confirmed',u)
 on conflict(id) do update set scheduled_at=excluded.scheduled_at,status=excluded.status;

 insert into public.social_alerts(id,org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,assigned_to,metadata)
 values
 ('d3000000-0000-4000-8900-000000000001',o,c1,'overdue_task','high','Consentimiento de rastreo pendiente','Family-tracing consent pending','2026-08-12',u,'{"synthetic":true,"sales_demo":true}'),
 ('d3000000-0000-4000-8900-000000000002',o,c1,'referral_no_response','warning','Canalización educativa sin respuesta','Education referral has not responded','2026-08-22',u,'{"synthetic":true,"sales_demo":true}'),
 ('d3000000-0000-4000-8900-000000000003',o,c1,'review_due','warning','Revisión de riesgo próxima','Risk review due soon','2026-08-25',u,'{"synthetic":true,"sales_demo":true}')
 on conflict(id) do update set due_at=excluded.due_at,resolved_at=null;

 insert into public.social_case_transfers(id,org_id,social_case_id,transfer_type,from_user_id,to_user_id,selected_information,restricted_information,transfer_summary,deadlines,status,sent_at,received_at,received_by,created_by)
 values('d3000000-0000-4000-8a00-000000000001',o,c2,'internal_office',u,u,'{"case_summary":true,"tasks":true}','{"restricted_records":"excluded"}','Transferred from Tapachula to Mérida; receiving office accepted.','[]','received','2026-08-10','2026-08-11',u,u)
 on conflict(id) do update set status='received',received_at=excluded.received_at;

 insert into public.social_case_closures(id,org_id,social_case_id,closure_version,closure_reason,goals_completed,goals_incomplete,final_risk_level,referrals_completed,pending_referrals,outstanding_deadlines,client_notification,document_disposition,retention_status,closing_professional,supervisor_approval_by,supervisor_approved_at,closure_date,created_at)
 values
 ('d3000000-0000-4000-8b00-000000000001',o,c3,1,'services_completed','All planned services completed','None','low','All referrals completed','None','None','Client notified','Retained under policy','active retention',u,u,'2026-08-02','2026-08-02','2026-08-02'),
 ('d3000000-0000-4000-8b00-000000000002',o,c4,1,'unable_to_contact','Initial stabilization completed','Follow-up interrupted','moderate','Initial referral closed','Monitoring required','Re-contact if client returns','Notice attempted','Retained under policy','reopened',u,u,'2026-06-01','2026-06-01','2026-06-01')
 on conflict(social_case_id,closure_version) do update set reopened_at=case when excluded.social_case_id=c4 then '2026-08-20' else null end,reopened_by=case when excluded.social_case_id=c4 then u else null end,reopen_reason=case when excluded.social_case_id=c4 then 'Client returned and requested continued support' else null end;
 update public.social_case_closures set reopened_at='2026-08-20',reopened_by=u,reopen_reason='Client returned and requested continued support' where id='d3000000-0000-4000-8b00-000000000002';

 insert into public.resource_knowledge_records(id,org_id,title_es,title_en,summary_es,summary_en,knowledge_type,service_categories,state_codes,municipality,population_tags,version,approval_status,approved_by,approved_at,effective_at,review_due_at,internal_only,created_by)
 select ('d3000000-0000-4000-8c00-'||lpad(n::text,12,'0'))::uuid,o,es,en,es,en,kind,cats,states,muni,pops,1,status,u,'2026-07-01','2026-07-01','2027-01-01',true,u
 from (values
 (1,'Protocolo de ingreso','Intake protocol','protocol',array['case_management'],array['CHP','YUC'],null,array['staff'],'approved'),
 (2,'Escalamiento de alto riesgo','High-risk escalation protocol','protocol',array['risk'],array['CHP','YUC'],null,array['staff'],'approved'),
 (3,'Tamizaje de protección infantil','Child-protection screening','protocol',array['child_protection'],array['CHP','YUC'],null,array['children'],'approved'),
 (4,'Procedimiento de consentimiento','Consent procedure','procedure',array['consent'],array['CHP','YUC'],null,array['staff'],'approved'),
 (5,'Registros restringidos','Restricted-record procedure','procedure',array['privacy'],array['CHP','YUC'],null,array['staff'],'approved'),
 (6,'Protocolo de canalización','Referral protocol','protocol',array['referrals'],array['CHP','YUC'],null,array['staff'],'approved'),
 (7,'Lista de transferencia','Transfer checklist','form',array['transfer'],array['CHP','YUC'],null,array['staff'],'approved'),
 (8,'Lista de cierre','Closure checklist','form',array['closure'],array['CHP','YUC'],null,array['staff'],'approved'),
 (9,'Canalización jurídica migratoria','Immigration legal-referral protocol','protocol',array['legal'],array['CHP','YUC'],null,array['migrants'],'approved'),
 (10,'Canalización psicosocial','Psychosocial referral protocol','protocol',array['psychosocial'],array['CHP','YUC'],null,array['staff'],'approved'),
 (11,'Guía de separación familiar','Family-separation guide','service_guide',array['family_tracing'],array['CHP','YUC'],null,array['families'],'approved'),
 (12,'Canalización médica de emergencia','Emergency medical referral','protocol',array['medical'],array['CHP','YUC'],null,array['staff'],'approved'),
 (13,'Guía de recursos Chiapas','Chiapas resource guide','service_guide',array['resources'],array['CHP'],'Tapachula',array['staff'],'approved'),
 (14,'Guía de recursos Yucatán','Yucatán resource guide','service_guide',array['resources'],array['YUC'],'Mérida',array['staff'],'approved'),
 (15,'Política Consultar Caso de Atención','Talk to Care Case policy','procedure',array['ai_governance'],array['CHP','YUC'],null,array['staff'],'approved'),
 (16,'Guía de minimización de datos','Data-minimization guide','procedure',array['privacy'],array['CHP','YUC'],null,array['staff'],'approved')
 ) x(n,es,en,kind,cats,states,muni,pops,status)
 on conflict(id) do update set summary_es=excluded.summary_es,approval_status=excluded.approval_status,review_due_at=excluded.review_due_at,updated_at=now();

 insert into public.social_care_assistant_runs(id,org_id,social_case_id,actor_id,language,question,response,retrieval_manifest,health_check,created_at)
 values('d3000000-0000-4000-8d00-000000000001',o,c1,u,'en','Run Case Health Check',
 jsonb_build_object('current_case_status',jsonb_build_object('summary','Active urgent high-risk family case; shelter and medical steps completed.','last_activity','Updated risk assessment reviewed 2026-08-18.'),
 'missing_or_incomplete',jsonb_build_array(jsonb_build_object('code','identity_document','message','Readable identity evidence remains missing.','source','Missing-document checklist')),
 'risks_requiring_review',jsonb_build_array(jsonb_build_object('code','family_separation','message','Family separation remains unresolved.','source','Updated risk assessment v2')),
 'recommended_next_steps',jsonb_build_array(jsonb_build_object('action','Verify limited family-tracing consent','responsible_role','case_manager','suggested_due_date','2026-08-25','consent_required',true,'supporting_record','Consent version 1')),
 'sources',jsonb_build_array('Updated risk assessment v2','Care plan v1','Tasks','Referrals','Consent version 1'),
 'professional_review_notice','Synthetic demonstration output; professional review required.'),
 jsonb_build_object('fixture_version','comprehensive-care-sales-demo-v1','case_id',c1,'authorized_record_types',array['general_case_record','social_work_record'],'synthetic',true),true,'2026-08-22')
 on conflict(id) do update set response=excluded.response,retrieval_manifest=excluded.retrieval_manifest;

 perform public.demo_manifest('social_families',f,'family-hernandez-lopez');
 perform public.demo_manifest('social_cases',c1,'case-417');perform public.demo_manifest('social_cases',c2,'case-318');
 perform public.demo_manifest('social_cases',c3,'case-271');perform public.demo_manifest('social_cases',c4,'case-199');
 for i in 1..8 loop perform public.demo_manifest('social_people',('d3000000-0000-4000-8100-'||lpad(i::text,12,'0'))::uuid,'person-'||i);end loop;
 for i in 1..9 loop perform public.demo_manifest('social_institutions',('d3000000-0000-4000-8500-'||lpad(i::text,12,'0'))::uuid,'resource-'||i);end loop;
 for i in 1..16 loop perform public.demo_manifest('resource_knowledge_records',('d3000000-0000-4000-8c00-'||lpad(i::text,12,'0'))::uuid,'knowledge-'||i);end loop;
 perform public.demo_manifest('social_care_assistant_runs','d3000000-0000-4000-8d00-000000000001','assistant-health-check');
 return jsonb_build_object('populated',true,'owner_user_id',u,'organization_id',o,'primary_case','NYR-SOC-2026-000417','fixture_version','comprehensive-care-sales-demo-v1');
end $$;

create or replace function public.register_existing_account_care_demo_document(p_key text,p_title text,p_type text,p_record_type text,p_path text,p_checksum text,p_size bigint)
returns uuid language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare d uuid:=('d3000000-0000-4000-8e00-'||substr(md5(p_key),1,12))::uuid;o constant uuid:='121250d0-c4bd-49ff-8a9e-e9557b0f88fb';u constant uuid:='d1c91a8d-de47-48c9-95b4-519c60ae8e04';c constant uuid:='d3000000-0000-4000-8000-000000000417';
begin perform public.assert_existing_account_care_demo_owner();
 if p_path not like o::text||'/'||c::text||'/%' then raise exception 'Invalid demo storage path';end if;
 insert into public.social_documents(id,org_id,social_case_id,family_id,title,document_type,record_type,sensitivity,current_version,checksum,mime_type,size_bytes,storage_path,extracted_text,extraction_authorized,uploaded_by,description,tags,document_status,classification_status,external_shareable,linked_entities)
 values(d,o,c,'d3000000-0000-4000-8000-000000000041',p_title,p_type,p_record_type,'confidential',1,p_checksum,'application/pdf',p_size,p_path,p_title||'. '||'Synthetic demonstration document - not valid for official use.',true,u,'Demonstration case — all identifying information and documents are synthetic.',array['sales_demo','synthetic','comprehensive-care-sales-demo-v1'],'active','classified',false,jsonb_build_object('synthetic',true,'sales_demo',true,'demo_owner_user_id',u,'demo_fixture_version','comprehensive-care-sales-demo-v1'))
 on conflict(id) do update set title=excluded.title,checksum=excluded.checksum,size_bytes=excluded.size_bytes,storage_path=excluded.storage_path,updated_at=now();
 insert into public.social_document_versions(id,org_id,document_id,version,checksum,storage_path,mime_type,size_bytes,uploaded_by,notes)
 values(('d3100000-0000-4000-8e00-'||substr(md5(p_key),1,12))::uuid,o,d,1,p_checksum,p_path,'application/pdf',p_size,u,'Synthetic demonstration original')
 on conflict(document_id,version) do update set checksum=excluded.checksum,storage_path=excluded.storage_path,size_bytes=excluded.size_bytes;
 perform public.demo_manifest('social_documents',d,'document-'||p_key);return d;end $$;

create or replace function public.register_existing_account_care_demo_document_version(p_key text,p_path text,p_checksum text,p_size bigint)
returns uuid language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare d uuid:=('d3000000-0000-4000-8e00-'||substr(md5(p_key),1,12))::uuid;v uuid:=('d3200000-0000-4000-8e00-'||substr(md5(p_key),1,12))::uuid;o constant uuid:='121250d0-c4bd-49ff-8a9e-e9557b0f88fb';u constant uuid:='d1c91a8d-de47-48c9-95b4-519c60ae8e04';
begin perform public.assert_existing_account_care_demo_owner();
 update public.social_documents set current_version=2,checksum=p_checksum,storage_path=p_path,size_bytes=p_size,updated_at=now() where id=d;
 insert into public.social_document_versions(id,org_id,document_id,version,checksum,storage_path,mime_type,size_bytes,uploaded_by,notes)
 values(v,o,d,2,p_checksum,p_path,'application/pdf',p_size,u,'Revised synthetic demonstration version')
 on conflict(document_id,version) do update set checksum=excluded.checksum,storage_path=excluded.storage_path,size_bytes=excluded.size_bytes;
 return v;end $$;

create or replace function public.existing_account_care_demo_storage_paths()
returns text[] language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare r text[];begin perform public.assert_existing_account_care_demo_owner();
 select coalesce(array_agg(distinct v.storage_path),'{}') into r from public.social_document_versions v
 join public.social_sales_demo_records d on d.table_name='social_documents' and d.record_id=v.document_id
 where d.owner_user_id=auth.uid() and d.org_id='121250d0-c4bd-49ff-8a9e-e9557b0f88fb' and d.synthetic and d.sales_demo and d.fixture_version='comprehensive-care-sales-demo-v1';
 return r;end $$;

create or replace function public.prevent_social_activity_mutation()
returns trigger language plpgsql as $$
begin if current_setting('app.sales_demo_cleanup',true)='on' then return coalesce(new,old);end if;raise exception 'Social activity ledger is append-only';end $$;

create or replace function public.remove_existing_account_comprehensive_care_demo()
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare o constant uuid:='121250d0-c4bd-49ff-8a9e-e9557b0f88fb';u constant uuid:='d1c91a8d-de47-48c9-95b4-519c60ae8e04';ids uuid[];
begin perform public.assert_existing_account_care_demo_owner();perform set_config('app.sales_demo_cleanup','on',true);
 select array_agg(record_id) into ids from public.social_sales_demo_records where owner_user_id=u and org_id=o and fixture_version='comprehensive-care-sales-demo-v1' and synthetic and sales_demo and table_name='social_cases';
 delete from public.social_document_access_events where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_document_versions where document_id in(select record_id from public.social_sales_demo_records where owner_user_id=u and org_id=o and table_name='social_documents' and synthetic and sales_demo);
 delete from public.social_documents where id in(select record_id from public.social_sales_demo_records where owner_user_id=u and org_id=o and table_name='social_documents' and synthetic and sales_demo);
 delete from public.social_care_action_proposals where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_care_assistant_runs where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_referral_updates where referral_id in(select id from public.social_referrals where social_case_id=any(coalesce(ids,'{}')));
 delete from public.social_referrals where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_alerts where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_appointments where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_tasks where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_interventions where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_care_plan_goals where care_plan_version_id in(select v.id from public.social_care_plan_versions v join public.social_care_plans p on p.id=v.care_plan_id where p.social_case_id=any(coalesce(ids,'{}')));
 delete from public.social_care_plan_versions where care_plan_id in(select id from public.social_care_plans where social_case_id=any(coalesce(ids,'{}')));
 delete from public.social_care_plans where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_assessment_versions where assessment_id in(select id from public.social_assessments where social_case_id=any(coalesce(ids,'{}')));
 delete from public.social_assessments where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_case_transfers where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_case_closures where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_record_grants where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_case_assignments where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_activity_events where social_case_id=any(coalesce(ids,'{}'));
 delete from public.social_cases where id=any(coalesce(ids,'{}'));
 delete from public.social_consent_versions where consent_id in(select id from public.social_consents where created_by=u and org_id=o);
 delete from public.social_consents where created_by=u and org_id=o and id in('d3000000-0000-4000-8003-000000000001','d3000000-0000-4000-8003-000000000002','d3000000-0000-4000-8003-000000000003');
 delete from public.social_family_members where family_id='d3000000-0000-4000-8000-000000000041';
 delete from public.social_families where id='d3000000-0000-4000-8000-000000000041';
 delete from public.social_people where id in(select record_id from public.social_sales_demo_records where owner_user_id=u and org_id=o and table_name='social_people' and synthetic and sales_demo);
 delete from public.resource_knowledge_records where id in(select record_id from public.social_sales_demo_records where owner_user_id=u and org_id=o and table_name='resource_knowledge_records' and synthetic and sales_demo);
 delete from public.social_institutions where id in(select record_id from public.social_sales_demo_records where owner_user_id=u and org_id=o and table_name='social_institutions' and synthetic and sales_demo);
 delete from public.social_sales_demo_records where owner_user_id=u and org_id=o and fixture_version='comprehensive-care-sales-demo-v1' and synthetic and sales_demo;
 return jsonb_build_object('removed',true,'owner_user_id',u,'organization_id',o);end $$;

create or replace function public.reset_existing_account_comprehensive_care_demo()
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin perform public.remove_existing_account_comprehensive_care_demo();return public.populate_existing_account_comprehensive_care_demo();end $$;

revoke all on function public.assert_existing_account_care_demo_owner() from public,anon;
revoke all on function public.demo_manifest(text,uuid,text) from public,anon,authenticated;
revoke all on function public.existing_account_care_demo_dry_run() from public,anon;
revoke all on function public.populate_existing_account_comprehensive_care_demo() from public,anon;
revoke all on function public.register_existing_account_care_demo_document(text,text,text,text,text,text,bigint) from public,anon;
revoke all on function public.register_existing_account_care_demo_document_version(text,text,text,bigint) from public,anon;
revoke all on function public.existing_account_care_demo_storage_paths() from public,anon;
revoke all on function public.remove_existing_account_comprehensive_care_demo() from public,anon;
revoke all on function public.reset_existing_account_comprehensive_care_demo() from public,anon;
grant execute on function public.assert_existing_account_care_demo_owner() to authenticated,service_role;
grant execute on function public.existing_account_care_demo_dry_run() to authenticated;
grant execute on function public.populate_existing_account_comprehensive_care_demo() to authenticated;
grant execute on function public.register_existing_account_care_demo_document(text,text,text,text,text,text,bigint) to authenticated;
grant execute on function public.register_existing_account_care_demo_document_version(text,text,text,bigint) to authenticated;
grant execute on function public.existing_account_care_demo_storage_paths() to authenticated;
grant execute on function public.remove_existing_account_comprehensive_care_demo() to authenticated;
grant execute on function public.reset_existing_account_comprehensive_care_demo() to authenticated;

notify pgrst,'reload schema';
commit;
