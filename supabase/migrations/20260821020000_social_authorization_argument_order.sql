-- Correct Social authorization helper argument order and preserve tenant isolation.
-- Core organization helpers are defined as (user_id, organization_id). Earlier
-- Social migrations called them as (organization_id, user_id), denying valid access.

create or replace function public.social_is_platform_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user
      and ur.role::text in ('super_admin','platform_admin')
  );
$$;

create or replace function public.social_is_org_member(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(p_user,p_org)
    or public.social_is_platform_admin(p_user);
$$;

create or replace function public.social_can_manage_org(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_org(p_user,p_org)
    or public.social_is_platform_admin(p_user);
$$;

create or replace function public.social_can_contribute_org(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_contribute_org(p_user,p_org)
    or public.social_is_platform_admin(p_user);
$$;

revoke all on function public.social_is_platform_admin(uuid) from public;
revoke all on function public.social_is_org_member(uuid,uuid) from public;
revoke all on function public.social_can_manage_org(uuid,uuid) from public;
revoke all on function public.social_can_contribute_org(uuid,uuid) from public;
grant execute on function public.social_is_platform_admin(uuid) to authenticated, service_role;
grant execute on function public.social_is_org_member(uuid,uuid) to authenticated, service_role;
grant execute on function public.social_can_manage_org(uuid,uuid) to authenticated, service_role;
grant execute on function public.social_can_contribute_org(uuid,uuid) to authenticated, service_role;

-- Recompile the latest affected Social security and workflow functions.

-- Latest definition from supabase/migrations/20260820230000_social_case_management_foundation.sql
create or replace function public.social_has_capability(
  p_org uuid, p_capability text, p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.social_is_org_member(p_org,p_user) and (
    public.social_can_manage_org(p_org,p_user)
    or exists (
      select 1
      from public.social_role_assignments ra
      join public.social_role_capabilities rc on rc.role = ra.role
      where ra.org_id=p_org and ra.user_id=p_user and ra.active
        and (ra.ends_at is null or ra.ends_at>now())
        and rc.capability=p_capability
    )
  );
$$;

-- Latest definition from supabase/migrations/20260820232000_social_case_management_hardening.sql
create or replace function public.social_can_access_case(
  p_case uuid,
  p_record_type text default 'general_case_record',
  p_write boolean default false,
  p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path=public as $$
  with c as (
    select id,org_id,created_by from public.social_cases
    where id=p_case and deleted_at is null
  )
  select exists(
    select 1 from c where
      (not p_write and public.social_support_access_active(c.id,p_record_type,p_user))
      or (
        public.social_is_org_member(c.org_id,p_user)
        and (
          public.social_can_manage_org(c.org_id,p_user)
          or c.created_by=p_user
          or exists(select 1 from public.social_case_assignments a where a.social_case_id=c.id and a.user_id=p_user and a.active)
          or (not p_write and public.social_has_capability(c.org_id,'case.view_all',p_user))
        )
        and case p_record_type
          when 'general_case_record' then not p_write
            or public.social_can_manage_org(c.org_id,p_user)
            or public.social_has_capability(c.org_id,'case.update',p_user)
            or public.social_has_capability(c.org_id,'case.update_assigned',p_user)
          when 'social_work_record' then
            public.social_has_capability(c.org_id,'intervention.social_work',p_user)
            or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
          when 'legal_privileged_record' then
            public.social_has_capability(c.org_id,'restricted.legal',p_user)
            or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
          when 'psychosocial_restricted_record' then
            public.social_has_capability(c.org_id,'restricted.psychosocial',p_user)
            or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
          when 'medical_restricted_record' then
            public.social_has_capability(c.org_id,'restricted.medical',p_user)
            or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
          when 'child_protection_restricted_record' then
            public.social_has_capability(c.org_id,'restricted.child_protection',p_user)
            or exists(select 1 from public.social_record_grants g where g.social_case_id=c.id and g.user_id=p_user and g.record_type=p_record_type and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()) and g.can_read and (not p_write or g.can_write))
          else false end
      )
  )
$$;

-- Latest definition from supabase/migrations/20260820230000_social_case_management_foundation.sql
create or replace function public.social_can_access_person(
  p_person uuid, p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.social_people p
    where p.id=p_person and p.deleted_at is null
      and public.social_is_org_member(p.org_id,p_user)
      and (
        public.social_can_manage_org(p.org_id,p_user)
        or p.created_by=p_user
        or p.assigned_case_manager=p_user
        or exists (
          select 1 from public.social_cases c
          where (c.person_id=p.id or exists(
            select 1 from public.social_family_members fm
            where fm.person_id=p.id and fm.family_id=c.family_id and fm.left_at is null
          )) and public.social_can_access_case(c.id,'general_case_record',false,p_user)
        )
      )
  );
$$;

-- Latest definition from supabase/migrations/20260820231000_social_case_workflows.sql
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
    public.social_can_manage_org(c.org_id,auth.uid())
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

-- Latest definition from supabase/migrations/20260820231000_social_case_workflows.sql
create or replace function public.reopen_social_case(
  p_case uuid, p_reason text
) returns void
language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype;
begin
  select * into c from public.social_cases where id=p_case for update;
  if not found or c.status<>'closed' or not (
    public.social_can_manage_org(c.org_id,auth.uid())
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

-- Latest definition from supabase/migrations/20260820236000_social_operational_completion.sql
create or replace function public.accept_social_transfer(p_transfer uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t public.social_case_transfers%rowtype;
begin
  select * into t from public.social_case_transfers where id=p_transfer for update;
  if not found or t.status<>'sent' then raise exception 'Transfer is not awaiting receipt'; end if;
  if not (
    t.to_user_id=auth.uid()
    or (t.receiving_org_id is not null and public.social_can_manage_org(t.receiving_org_id,auth.uid()))
  ) then raise exception 'Transfer receipt denied'; end if;
  update public.social_case_transfers set status='received',received_at=now(),received_by=auth.uid() where id=t.id;
  if t.to_user_id is not null then
    update public.social_case_assignments set active=false,ended_at=now() where social_case_id=t.social_case_id and active;
    insert into public.social_case_assignments(org_id,social_case_id,user_id,assignment_role,assigned_by)
    values(t.org_id,t.social_case_id,t.to_user_id,'case_manager',auth.uid());
    update public.social_cases set assigned_case_manager=t.to_user_id,status='active',transfer_date=now(),updated_at=now() where id=t.social_case_id;
  else
    update public.social_cases set status='transferred',transfer_date=now(),updated_at=now() where id=t.social_case_id;
  end if;
end $$;

-- Latest definition from supabase/migrations/20260820231000_social_case_workflows.sql
create or replace function public.social_indicator_summary(
  p_org uuid, p_from date, p_to date
)
returns table(indicator_code text,dimension text,value bigint,suppressed boolean)
language plpgsql stable security invoker set search_path=public as $$
begin
  if not (
    public.social_can_manage_org(p_org,auth.uid())
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

-- Latest definition from supabase/migrations/20260820234000_social_transactional_workflows.sql
create or replace function public.create_social_family(
  p_org uuid,p_name text,p_primary uuid,p_location jsonb,p_members uuid[]
) returns public.social_families
language plpgsql security invoker set search_path=public as $$
declare f public.social_families%rowtype; v_person uuid;
begin
  if not (public.social_can_manage_org(p_org,auth.uid()) or public.social_has_capability(p_org,'person.manage',auth.uid())) then
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

-- Latest definition from supabase/migrations/20260820235000_social_first_run_setup.sql
create or replace function public.ensure_social_program_for_org(
  p_org uuid,p_name_es text default 'Atención Integral',
  p_name_en text default 'Comprehensive Care',p_prefix text default 'NYR-SOC'
) returns public.social_programs
language plpgsql security invoker set search_path=public as $$
declare p public.social_programs%rowtype;
begin
  if not public.social_can_manage_org(p_org,auth.uid()) then raise exception 'Program administration denied'; end if;
  if p_prefix!~'^[A-Z0-9-]{2,20}$' then raise exception 'Invalid case prefix'; end if;
  insert into public.social_programs(org_id,name,name_es,name_en,code,case_prefix,created_by)
  values(p_org,p_name_es,p_name_es,p_name_en,'atencion_integral',p_prefix,auth.uid())
  on conflict(org_id,code) do update set name=excluded.name,name_es=excluded.name_es,
    name_en=excluded.name_en,case_prefix=excluded.case_prefix,active=true,updated_at=now()
  returning * into p;
  return p;
end $$;

-- Latest definition from supabase/migrations/20260820236000_social_operational_completion.sql
create or replace function public.assign_social_case_manager(
  p_case uuid,p_user uuid,p_role text default 'case_manager'
) returns void language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype;
begin
  select * into c from public.social_cases where id=p_case for update;
  if not found or not (
    public.social_can_manage_org(c.org_id,auth.uid())
    or public.social_has_capability(c.org_id,'case.view_all',auth.uid())
  ) then raise exception 'Case assignment denied'; end if;
  if not public.social_is_org_member(c.org_id,p_user) then raise exception 'Assignee is not an active organization member'; end if;
  update public.social_case_assignments set active=false,ended_at=now()
    where social_case_id=p_case and assignment_role=p_role and active;
  insert into public.social_case_assignments(org_id,social_case_id,user_id,assignment_role,assigned_by)
  values(c.org_id,c.id,p_user,p_role,auth.uid());
  if p_role='case_manager' then
    update public.social_cases set assigned_case_manager=p_user,updated_at=now() where id=p_case;
  elsif p_role='supervisor' then
    update public.social_cases set supervising_manager=p_user,updated_at=now() where id=p_case;
  end if;
end $$;

-- Latest definition from supabase/migrations/20260820236000_social_operational_completion.sql
create or replace function public.advance_social_transfer(
  p_transfer uuid,p_action text
) returns void language plpgsql security invoker set search_path=public as $$
declare t public.social_case_transfers%rowtype; declare info text[];
begin
  select * into t from public.social_case_transfers where id=p_transfer for update;
  if not found then raise exception 'Transfer not found'; end if;
  if p_action='approve' then
    if t.status<>'pending_approval' or not (
      public.social_can_manage_org(t.org_id,auth.uid())
      or public.social_has_capability(t.org_id,'transfer.approve',auth.uid())
    ) then raise exception 'Transfer approval denied'; end if;
    update public.social_case_transfers set status='approved' where id=t.id;
  elsif p_action='send' then
    if t.status<>'approved' or not public.social_can_access_case(t.social_case_id,'general_case_record',true,auth.uid()) then
      raise exception 'Transfer send denied';
    end if;
    if t.receiving_org_id is not null then
      info:=array(select jsonb_object_keys(coalesce(t.selected_information,'{}')));
      if t.consent_id is null or not public.social_consent_covers(
        t.consent_id,t.receiving_org_id::text,'case_transfer',info
      ) then raise exception 'External transfer requires matching consent'; end if;
    end if;
    update public.social_case_transfers set status='sent',sent_at=now() where id=t.id;
  elsif p_action='reject' then
    if t.status not in ('pending_approval','approved','sent') then raise exception 'Transfer cannot be rejected now'; end if;
    update public.social_case_transfers set status='rejected' where id=t.id;
  else raise exception 'Invalid transfer action'; end if;
end $$;

-- Recreate only policies still active after all prior Social migrations.

drop policy if exists social_programs_read on public.social_programs;
create policy social_programs_read on public.social_programs for select
using (public.social_is_org_member(org_id,auth.uid()));

drop policy if exists social_programs_manage on public.social_programs;
create policy social_programs_manage on public.social_programs for all
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_offices_read on public.social_offices;
create policy social_offices_read on public.social_offices for select
using (public.social_is_org_member(org_id,auth.uid()));

drop policy if exists social_offices_manage on public.social_offices;
create policy social_offices_manage on public.social_offices for all
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_roles_self_read on public.social_role_assignments;
create policy social_roles_self_read on public.social_role_assignments for select
using (user_id=auth.uid() or public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_roles_manage on public.social_role_assignments;
create policy social_roles_manage on public.social_role_assignments for all
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_people_create on public.social_people;
create policy social_people_create on public.social_people for insert
with check (public.social_is_org_member(org_id,auth.uid()) and created_by=auth.uid()
  and (public.social_has_capability(org_id,'person.manage',auth.uid()) or public.social_can_manage_org(org_id,auth.uid())));

drop policy if exists social_people_update on public.social_people;
create policy social_people_update on public.social_people for update
using (public.social_can_access_person(id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
))
with check (public.social_can_access_person(id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
));

drop policy if exists social_families_read on public.social_families;
create policy social_families_read on public.social_families for select
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid()) or created_by=auth.uid()
  or assigned_case_manager=auth.uid()
  or exists(select 1 from public.social_cases c where c.family_id=id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
));

drop policy if exists social_families_write on public.social_families;
create policy social_families_write on public.social_families for all
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
))
with check (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
));

drop policy if exists social_cases_create on public.social_cases;
create policy social_cases_create on public.social_cases for insert
with check (public.social_is_org_member(org_id,auth.uid()) and created_by=auth.uid()
  and (public.social_has_capability(org_id,'case.create',auth.uid()) or public.social_can_manage_org(org_id,auth.uid())));

drop policy if exists social_assignments_manage on public.social_case_assignments;
create policy social_assignments_manage on public.social_case_assignments for all
using (public.social_can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'case.view_all',auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'case.view_all',auth.uid()));

drop policy if exists social_grants_read on public.social_record_grants;
create policy social_grants_read on public.social_record_grants for select
using (user_id=auth.uid() or public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_grants_manage on public.social_record_grants;
create policy social_grants_manage on public.social_record_grants for all
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_institutions_read on public.social_institutions;
create policy social_institutions_read on public.social_institutions for select
using (org_id is null or public.social_is_org_member(org_id,auth.uid()));

drop policy if exists social_institutions_manage on public.social_institutions;
create policy social_institutions_manage on public.social_institutions for all
using (org_id is not null and public.social_can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_templates_read on public.social_assessment_templates;
create policy social_templates_read on public.social_assessment_templates for select
using (org_id is null or public.social_is_org_member(org_id,auth.uid()));

drop policy if exists social_templates_manage on public.social_assessment_templates;
create policy social_templates_manage on public.social_assessment_templates for all
using (org_id is not null and public.social_can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_packets_sender on public.social_referral_shared_packets;
create policy social_packets_sender on public.social_referral_shared_packets for all
using (public.social_is_org_member(org_id,auth.uid()))
with check (public.social_is_org_member(org_id,auth.uid()) and public.social_consent_covers(consent_id,receiving_org_id::text,purpose,array(select jsonb_object_keys(shared_fields))));

drop policy if exists social_packets_receiver_read on public.social_referral_shared_packets;
create policy social_packets_receiver_read on public.social_referral_shared_packets for select
using (public.social_is_org_member(receiving_org_id,auth.uid()) and revoked_at is null and (expires_at is null or expires_at>now()));

drop policy if exists social_document_shares_sender on public.social_document_shares;
create policy social_document_shares_sender on public.social_document_shares for all
using (public.social_is_org_member(org_id,auth.uid()))
with check (public.social_is_org_member(org_id,auth.uid()) and public.social_consent_covers(consent_id,receiving_org_id::text,purpose,array['document']));

drop policy if exists social_document_shares_receiver_read on public.social_document_shares;
create policy social_document_shares_receiver_read on public.social_document_shares for select
using (public.social_is_org_member(receiving_org_id,auth.uid()) and revoked_at is null and (expires_at is null or expires_at>now()));

drop policy if exists social_activity_read on public.social_activity_events;
create policy social_activity_read on public.social_activity_events for select
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or actor_id=auth.uid()
  or public.social_has_capability(org_id,'audit.view',auth.uid())
));

drop policy if exists social_activity_insert on public.social_activity_events;
create policy social_activity_insert on public.social_activity_events for insert
with check (public.social_is_org_member(org_id,auth.uid()) and actor_id=auth.uid());

drop policy if exists social_indicators_read on public.social_indicator_snapshots;
create policy social_indicators_read on public.social_indicator_snapshots for select
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'indicators.view',auth.uid())
  or public.social_has_capability(org_id,'indicators.deidentified',auth.uid())
));

drop policy if exists social_indicators_manage on public.social_indicator_snapshots;
create policy social_indicators_manage on public.social_indicator_snapshots for all
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_family_members_read on public.social_family_members;
create policy social_family_members_read on public.social_family_members for select using (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_families f where f.id=family_id and (
    f.created_by=auth.uid() or f.assigned_case_manager=auth.uid()
    or exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
  ))
);

drop policy if exists social_family_members_write on public.social_family_members;
create policy social_family_members_write on public.social_family_members for all using (
  public.social_can_manage_org(org_id,auth.uid())
  or (public.social_has_capability(org_id,'person.manage',auth.uid())
      and exists(select 1 from public.social_families f where f.id=family_id and (
        f.created_by=auth.uid() or f.assigned_case_manager=auth.uid()
        or exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
      )))
) with check (
  public.social_is_org_member(org_id,auth.uid())
  and (public.social_can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'person.manage',auth.uid()))
  and exists(select 1 from public.social_people p where p.id=person_id and p.org_id=org_id)
  and exists(select 1 from public.social_families f where f.id=family_id and f.org_id=org_id)
);

drop policy if exists social_consents_read on public.social_consents;
create policy social_consents_read on public.social_consents for select using (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
);

drop policy if exists social_consents_insert on public.social_consents;
create policy social_consents_insert on public.social_consents for insert with check (
  created_by=auth.uid() and public.social_is_org_member(org_id,auth.uid())
  and (public.social_can_manage_org(org_id,auth.uid())
    or public.social_has_capability(org_id,'case.update_assigned',auth.uid())
    or public.social_has_capability(org_id,'case.update',auth.uid()))
  and ((person_id is null or public.social_can_access_person(person_id,auth.uid()))
    and (family_id is null or exists(select 1 from public.social_families f where f.id=family_id and (
      f.created_by=auth.uid() or f.assigned_case_manager=auth.uid()
      or exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
    ))))
);

drop policy if exists social_consents_update on public.social_consents;
create policy social_consents_update on public.social_consents for update using (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
) with check (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
);

drop policy if exists social_indicator_definitions_read on public.social_indicator_definitions;
create policy social_indicator_definitions_read on public.social_indicator_definitions for select
using (org_id is null or public.social_is_org_member(org_id,auth.uid()));

drop policy if exists social_indicator_definitions_manage on public.social_indicator_definitions;
create policy social_indicator_definitions_manage on public.social_indicator_definitions for all
using (org_id is not null and public.social_can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_retention_read on public.social_retention_actions;
create policy social_retention_read on public.social_retention_actions for select
using (public.social_can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'audit.view',auth.uid()));

drop policy if exists social_retention_write on public.social_retention_actions;
create policy social_retention_write on public.social_retention_actions for insert
with check (requested_by=auth.uid() and public.social_can_manage_org(org_id,auth.uid())
  and public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid()));

drop policy if exists social_support_grants_read on public.social_support_access_grants;
create policy social_support_grants_read on public.social_support_access_grants for select
using (support_user_id=auth.uid() or public.social_can_manage_org(org_id,auth.uid()));

drop policy if exists social_support_grants_manage on public.social_support_access_grants;
create policy social_support_grants_manage on public.social_support_access_grants for all
using (public.social_can_manage_org(org_id,auth.uid()))
with check (approved_by=auth.uid() and public.social_can_manage_org(org_id,auth.uid()));

-- The correction deliberately adds no email-specific policy and no blanket
-- delete policy. Organization isolation, record restrictions, and audit/retention
-- controls remain enforced; platform super administrators use the explicit wrapper.


