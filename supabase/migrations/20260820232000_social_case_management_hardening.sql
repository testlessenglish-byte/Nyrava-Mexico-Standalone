-- Social case-management hardening: identifiers, least privilege, retention,
-- private storage, explicit support access, and complete transfer/indicator data.

create table if not exists public.social_identifier_counters (
  org_id uuid not null references public.organizations(id),
  entity_type text not null check (entity_type in ('person','family','referral')),
  calendar_year integer not null,
  last_number bigint not null default 0,
  primary key (org_id,entity_type,calendar_year)
);
alter table public.social_identifier_counters enable row level security;
revoke all on public.social_identifier_counters from authenticated;

create or replace function public.assign_social_entity_number()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_next bigint; v_prefix text; v_year integer := extract(year from current_date);
begin
  if tg_table_name='social_people' then
    if new.person_number is not null and btrim(new.person_number)<>'' then return new; end if;
    v_prefix := 'PER'; 
  elsif tg_table_name='social_families' then
    if new.family_number is not null and btrim(new.family_number)<>'' then return new; end if;
    v_prefix := 'FAM';
  elsif tg_table_name='social_referrals' then
    if new.referral_number is not null and btrim(new.referral_number)<>'' then return new; end if;
    v_prefix := 'REF';
  else raise exception 'Unsupported social identifier entity';
  end if;
  insert into public.social_identifier_counters(org_id,entity_type,calendar_year,last_number)
  values(new.org_id,replace(tg_table_name,'social_','')::text,v_year,1)
  on conflict(org_id,entity_type,calendar_year) do update
    set last_number=public.social_identifier_counters.last_number+1
  returning last_number into v_next;
  new := jsonb_populate_record(new,to_jsonb(new) ||
    case tg_table_name
      when 'social_people' then jsonb_build_object('person_number',v_prefix||'-'||v_year||'-'||lpad(v_next::text,6,'0'))
      when 'social_families' then jsonb_build_object('family_number',v_prefix||'-'||v_year||'-'||lpad(v_next::text,6,'0'))
      else jsonb_build_object('referral_number',v_prefix||'-'||v_year||'-'||lpad(v_next::text,6,'0'))
    end);
  return new;
end $$;

-- Fix counter entity names used by the trigger without widening accepted values.
create or replace function public.assign_social_entity_number()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_next bigint; v_prefix text; v_entity text;
declare v_year integer := extract(year from current_date);
begin
  if tg_table_name='social_people' then
    if new.person_number is not null and btrim(new.person_number)<>'' then return new; end if;
    v_prefix := 'PER'; v_entity := 'person';
  elsif tg_table_name='social_families' then
    if new.family_number is not null and btrim(new.family_number)<>'' then return new; end if;
    v_prefix := 'FAM'; v_entity := 'family';
  elsif tg_table_name='social_referrals' then
    if new.referral_number is not null and btrim(new.referral_number)<>'' then return new; end if;
    v_prefix := 'REF'; v_entity := 'referral';
  else raise exception 'Unsupported social identifier entity';
  end if;
  insert into public.social_identifier_counters(org_id,entity_type,calendar_year,last_number)
  values(new.org_id,v_entity,v_year,1)
  on conflict(org_id,entity_type,calendar_year) do update
    set last_number=public.social_identifier_counters.last_number+1
  returning last_number into v_next;
  if tg_table_name='social_people' then new.person_number := v_prefix||'-'||v_year||'-'||lpad(v_next::text,6,'0'); end if;
  if tg_table_name='social_families' then new.family_number := v_prefix||'-'||v_year||'-'||lpad(v_next::text,6,'0'); end if;
  if tg_table_name='social_referrals' then new.referral_number := v_prefix||'-'||v_year||'-'||lpad(v_next::text,6,'0'); end if;
  return new;
end $$;

create or replace function public.prevent_social_identifier_change()
returns trigger language plpgsql as $$
begin
  if (tg_table_name='social_people' and new.person_number is distinct from old.person_number)
    or (tg_table_name='social_families' and new.family_number is distinct from old.family_number)
    or (tg_table_name='social_referrals' and new.referral_number is distinct from old.referral_number)
  then raise exception 'Social identifier is immutable'; end if;
  return new;
end $$;

drop trigger if exists social_person_number_assign on public.social_people;
create trigger social_person_number_assign before insert on public.social_people
for each row execute function public.assign_social_entity_number();
drop trigger if exists social_person_number_immutable on public.social_people;
create trigger social_person_number_immutable before update on public.social_people
for each row execute function public.prevent_social_identifier_change();
drop trigger if exists social_family_number_assign on public.social_families;
create trigger social_family_number_assign before insert on public.social_families
for each row execute function public.assign_social_entity_number();
drop trigger if exists social_family_number_immutable on public.social_families;
create trigger social_family_number_immutable before update on public.social_families
for each row execute function public.prevent_social_identifier_change();
drop trigger if exists social_referral_number_assign on public.social_referrals;
create trigger social_referral_number_assign before insert on public.social_referrals
for each row execute function public.assign_social_entity_number();
drop trigger if exists social_referral_number_immutable on public.social_referrals;
create trigger social_referral_number_immutable before update on public.social_referrals
for each row execute function public.prevent_social_identifier_change();

-- PostgreSQL UNIQUE treats null scope ids as distinct. This closes duplicate
-- organization-level active role assignments while preserving role history.
create unique index if not exists social_roles_one_active_scope
on public.social_role_assignments(org_id,user_id,role,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid))
where active;

create table if not exists public.social_indicator_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  code text not null,
  name_es text not null,
  name_en text not null,
  description_es text,
  description_en text,
  aggregation text not null check (aggregation in ('count','sum','average','rate','duration')),
  source_entity text not null,
  numerator_filter jsonb not null default '{}'::jsonb,
  denominator_filter jsonb,
  small_group_threshold integer not null default 5 check (small_group_threshold between 3 and 50),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists social_indicator_definitions_unique
on public.social_indicator_definitions(coalesce(org_id,'00000000-0000-0000-0000-000000000000'::uuid),code);

alter table public.social_indicator_snapshots
  add column if not exists definition_id uuid references public.social_indicator_definitions(id);

create table if not exists public.social_case_transfer_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  transfer_id uuid not null references public.social_case_transfers(id),
  item_type text not null check (item_type in ('case_summary','task','deadline','document','referral','care_plan','assessment','contact')),
  item_id uuid,
  description text,
  record_type text not null default 'general_case_record',
  included boolean not null default true,
  exclusion_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (record_type in ('general_case_record','social_work_record','legal_privileged_record','psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'))
);

create table if not exists public.social_retention_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  action_type text not null check (action_type in ('review','legal_hold','archive','anonymize','secure_delete_requested','secure_delete_approved','secure_delete_completed')),
  reason text not null,
  retention_until date,
  requested_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  completed_by uuid references auth.users(id),
  approved_at timestamptz,
  completed_at timestamptz,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.social_support_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  support_user_id uuid not null references auth.users(id),
  social_case_ids uuid[] not null,
  record_types text[] not null default array['general_case_record'],
  reason text not null,
  approved_by uuid not null references auth.users(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (cardinality(social_case_ids)>0),
  check (expires_at>starts_at and expires_at<=starts_at+interval '8 hours'),
  check (record_types <@ array['general_case_record','social_work_record','legal_privileged_record','psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'])
);

create or replace function public.social_support_access_active(
  p_case uuid,p_record_type text,p_user uuid default auth.uid()
) returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.social_support_access_grants g
    join public.social_cases c on c.id=p_case and c.org_id=g.org_id
    where g.support_user_id=p_user and p_case=any(g.social_case_ids)
      and p_record_type=any(g.record_types)
      and g.revoked_at is null and g.starts_at<=now() and g.expires_at>now()
  )
$$;

-- Case access remains membership-first except for an explicit, scoped,
-- time-limited support grant. Support grants are read-only.
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
        public.is_org_member(c.org_id,p_user)
        and (
          public.can_manage_org(c.org_id,p_user)
          or c.created_by=p_user
          or exists(select 1 from public.social_case_assignments a where a.social_case_id=c.id and a.user_id=p_user and a.active)
          or (not p_write and public.social_has_capability(c.org_id,'case.view_all',p_user))
        )
        and case p_record_type
          when 'general_case_record' then not p_write
            or public.can_manage_org(c.org_id,p_user)
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

revoke all on function public.social_support_access_active(uuid,text,uuid) from public;
grant execute on function public.social_support_access_active(uuid,text,uuid) to authenticated;

alter table public.social_indicator_definitions enable row level security;
alter table public.social_case_transfer_items enable row level security;
alter table public.social_retention_actions enable row level security;
alter table public.social_support_access_grants enable row level security;

drop policy if exists social_family_members_access on public.social_family_members;
create policy social_family_members_read on public.social_family_members for select using (
  public.can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_families f where f.id=family_id and (
    f.created_by=auth.uid() or f.assigned_case_manager=auth.uid()
    or exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
  ))
);
create policy social_family_members_write on public.social_family_members for all using (
  public.can_manage_org(org_id,auth.uid())
  or (public.social_has_capability(org_id,'person.manage',auth.uid())
      and exists(select 1 from public.social_families f where f.id=family_id and (
        f.created_by=auth.uid() or f.assigned_case_manager=auth.uid()
        or exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
      )))
) with check (
  public.is_org_member(org_id,auth.uid())
  and (public.can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'person.manage',auth.uid()))
  and exists(select 1 from public.social_people p where p.id=person_id and p.org_id=org_id)
  and exists(select 1 from public.social_families f where f.id=family_id and f.org_id=org_id)
);

drop policy if exists social_consents_access on public.social_consents;
create policy social_consents_read on public.social_consents for select using (
  public.can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
);
create policy social_consents_insert on public.social_consents for insert with check (
  created_by=auth.uid() and public.is_org_member(org_id,auth.uid())
  and (public.can_manage_org(org_id,auth.uid())
    or public.social_has_capability(org_id,'case.update_assigned',auth.uid())
    or public.social_has_capability(org_id,'case.update',auth.uid()))
  and ((person_id is null or public.social_can_access_person(person_id,auth.uid()))
    and (family_id is null or exists(select 1 from public.social_families f where f.id=family_id and (
      f.created_by=auth.uid() or f.assigned_case_manager=auth.uid()
      or exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
    ))))
);
create policy social_consents_update on public.social_consents for update using (
  public.can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
) with check (
  public.can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
);

create policy social_indicator_definitions_read on public.social_indicator_definitions for select
using (org_id is null or public.is_org_member(org_id,auth.uid()));
create policy social_indicator_definitions_manage on public.social_indicator_definitions for all
using (org_id is not null and public.can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.can_manage_org(org_id,auth.uid()));

create policy social_transfer_items_access on public.social_case_transfer_items for all
using (exists(select 1 from public.social_case_transfers t where t.id=transfer_id
  and public.social_can_access_case(t.social_case_id,record_type,false,auth.uid())))
with check (exists(select 1 from public.social_case_transfers t where t.id=transfer_id
  and public.social_can_access_case(t.social_case_id,record_type,true,auth.uid())));

create policy social_retention_read on public.social_retention_actions for select
using (public.can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'audit.view',auth.uid()));
create policy social_retention_write on public.social_retention_actions for insert
with check (requested_by=auth.uid() and public.can_manage_org(org_id,auth.uid())
  and public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid()));

create policy social_support_grants_read on public.social_support_access_grants for select
using (support_user_id=auth.uid() or public.can_manage_org(org_id,auth.uid()));
create policy social_support_grants_manage on public.social_support_access_grants for all
using (public.can_manage_org(org_id,auth.uid()))
with check (approved_by=auth.uid() and public.can_manage_org(org_id,auth.uid()));

-- Keep the existing storage system, but isolate social-care originals in a
-- private bucket. Object paths are: <org_uuid>/<social_case_uuid>/<version-file>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('social-case-files','social-case-files',false,52428800,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg','image/png','image/webp','application/zip'])
on conflict(id) do update set public=false;

drop policy if exists social_case_files_read on storage.objects;
create policy social_case_files_read on storage.objects for select to authenticated using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',false,auth.uid())
);
drop policy if exists social_case_files_insert on storage.objects;
create policy social_case_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',true,auth.uid())
);
drop policy if exists social_case_files_update on storage.objects;
create policy social_case_files_update on storage.objects for update to authenticated using (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',true,auth.uid())
) with check (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',true,auth.uid())
);
-- No authenticated DELETE policy: originals are preserved. Retention deletion
-- is a separately approved server-side workflow and must leave its manifest.

-- Append-only audit coverage for every newly security-sensitive area.
do $$ declare t text; begin
  foreach t in array array['social_case_transfer_items','social_retention_actions','social_support_access_grants'] loop
    execute format('drop trigger if exists %I on public.%I','audit_'||t,t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_social_change()','audit_'||t,t);
  end loop;
end $$;

insert into public.social_indicator_definitions
(org_id,code,name_es,name_en,aggregation,source_entity)
values
(null,'people_served','Personas atendidas','People served','count','social_people'),
(null,'families_served','Familias atendidas','Families served','count','social_families'),
(null,'active_cases','Casos activos','Active cases','count','social_cases'),
(null,'closed_cases','Casos cerrados','Closed cases','count','social_cases'),
(null,'referral_completion_rate','Tasa de conclusión de canalizaciones','Referral completion rate','rate','social_referrals'),
(null,'case_manager_workload','Carga de trabajo por gestor','Case-manager workload','count','social_case_assignments')
on conflict do nothing;
