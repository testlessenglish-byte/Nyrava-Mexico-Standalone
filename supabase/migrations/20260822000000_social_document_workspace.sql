-- Complete case-scoped Documents and Consent workspace.
-- Originals remain private in Social Care and never enter Legal Intelligence automatically.

alter table public.social_documents
  add column if not exists description text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists document_status text not null default 'active',
  add column if not exists classification_status text not null default 'classified',
  add column if not exists expires_at timestamptz,
  add column if not exists external_shareable boolean not null default false,
  add column if not exists superseded_by uuid references public.social_documents(id),
  add column if not exists linked_entities jsonb not null default '{}'::jsonb;

do $document_constraints$
begin
  alter table public.social_documents add constraint social_documents_status_check
    check(document_status in ('active','superseded','archived'));
exception when duplicate_object then null;
end
$document_constraints$;

do $classification_constraints$
begin
  alter table public.social_documents add constraint social_documents_classification_check
    check(classification_status in ('suggested','classified','needs_review'));
exception when duplicate_object then null;
end
$classification_constraints$;

create table if not exists public.social_document_access_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  document_id uuid not null references public.social_documents(id),
  version integer not null,
  action text not null check(action in ('preview','download','share','send_to_legal','move_case','metadata_update','archive')),
  reason text,
  actor_id uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);

create index if not exists social_document_access_case_idx
  on public.social_document_access_events(social_case_id,occurred_at desc);
create index if not exists social_document_access_document_idx
  on public.social_document_access_events(document_id,occurred_at desc);
create index if not exists social_documents_dashboard_idx
  on public.social_documents(social_case_id,document_status,classification_status,created_at desc);

create table if not exists public.social_case_document_requirements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  document_type text not null,
  status text not null default 'missing' check(status in ('missing','received','waived')),
  due_at timestamptz,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(social_case_id,document_type)
);

alter table public.social_document_access_events enable row level security;
alter table public.social_case_document_requirements enable row level security;

drop policy if exists social_case_document_requirements_access on public.social_case_document_requirements;
create policy social_case_document_requirements_access on public.social_case_document_requirements for all to authenticated
using (public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()))
with check (public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid()));

drop policy if exists social_document_access_events_read on public.social_document_access_events;
create policy social_document_access_events_read on public.social_document_access_events for select to authenticated
using (
  public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid())
  or public.social_can_manage_org(org_id,auth.uid())
);

drop policy if exists social_document_access_events_insert on public.social_document_access_events;
create policy social_document_access_events_insert on public.social_document_access_events for insert to authenticated
with check (
  actor_id=auth.uid()
  and exists(
    select 1 from public.social_documents d
    where d.id=document_id and d.social_case_id=social_case_id and d.org_id=org_id
      and public.social_can_access_case(d.social_case_id,d.record_type,false,auth.uid())
  )
);

drop trigger if exists audit_social_document_access_events on public.social_document_access_events;
create trigger audit_social_document_access_events
after insert or update or delete on public.social_document_access_events
for each row execute function public.audit_social_change();

create or replace function public.social_media_upload_allowed(
  p_case uuid,p_mime text,p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path=public,pg_temp
as $media_upload$
  select
    lower(coalesce(p_mime,'')) not like 'audio/%'
    and lower(coalesce(p_mime,'')) not like 'video/%'
    or exists(
      select 1 from public.social_cases c
      join public.social_programs p on p.id=c.program_id and p.org_id=c.org_id
      where c.id=p_case and c.deleted_at is null and p.active
        and coalesce((p.settings->>'allow_media_uploads')::boolean,false)
        and public.social_is_org_member(c.org_id,p_user)
    )
$media_upload$;

revoke all on function public.social_media_upload_allowed(uuid,text,uuid) from public,anon;
grant execute on function public.social_media_upload_allowed(uuid,text,uuid) to authenticated;

-- Storage authorization must use the record type embedded in the third path segment.
-- Object paths remain <org>/<case>/<record_type>/<uuid>-<filename>.
drop policy if exists social_case_files_read on storage.objects;
create policy social_case_files_read on storage.objects for select to authenticated using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],false,auth.uid()
  )
);

drop policy if exists social_case_files_insert on storage.objects;
create policy social_case_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
  and public.social_media_upload_allowed(
    ((storage.foldername(name))[2])::uuid,metadata->>'mimetype',auth.uid()
  )
);

drop policy if exists social_case_files_update on storage.objects;
create policy social_case_files_update on storage.objects for update to authenticated using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
) with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
  and public.social_media_upload_allowed(
    ((storage.foldername(name))[2])::uuid,metadata->>'mimetype',auth.uid()
  )
);

drop trigger if exists audit_social_case_document_requirements on public.social_case_document_requirements;
create trigger audit_social_case_document_requirements
after insert or update or delete on public.social_case_document_requirements
for each row execute function public.audit_social_change();

update storage.buckets
set file_size_limit=104857600,
    allowed_mime_types=array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg','image/png','image/webp','image/tiff',
      'application/zip',
      'audio/mpeg','audio/wav','audio/mp4','video/mp4','video/quicktime','video/webm'
    ]
where id='social-case-files';

create or replace function public.social_document_inventory(p_case uuid)
returns table(
  id uuid,title text,document_type text,record_type text,sensitivity text,current_version integer,
  checksum text,mime_type text,size_bytes bigint,description text,tags text[],document_status text,
  classification_status text,expires_at timestamptz,external_shareable boolean,linked_entities jsonb,uploaded_by uuid,
  created_at timestamptz,updated_at timestamptz,content_access boolean,restricted_metadata boolean
)
language sql stable security definer set search_path=public,pg_temp
as $document_inventory$
  select d.id,
    case when a.allowed then d.title else 'Restricted document' end,
    case when a.allowed then d.document_type else null end,
    case when a.allowed then d.record_type else 'restricted' end,
    case when a.allowed then d.sensitivity else 'restricted' end,
    d.current_version,
    case when a.allowed then d.checksum else null end,
    case when a.allowed then d.mime_type else null end,
    case when a.allowed then d.size_bytes else null end,
    case when a.allowed then d.description else null end,
    case when a.allowed then d.tags else '{}'::text[] end,
    d.document_status,d.classification_status,d.expires_at,
    case when a.allowed then d.external_shareable else false end,
    case when a.allowed then d.linked_entities else '{}'::jsonb end,
    d.uploaded_by,d.created_at,d.updated_at,a.allowed,not a.allowed
  from public.social_documents d
  cross join lateral (
    select public.social_can_access_case(d.social_case_id,d.record_type,false,auth.uid()) as allowed
  ) a
  where d.social_case_id=p_case and d.deleted_at is null
    and (
      a.allowed
      or public.social_can_manage_org(d.org_id,auth.uid())
      or public.social_has_capability(d.org_id,'case.view_all',auth.uid())
    )
  order by d.created_at desc
$document_inventory$;

revoke all on function public.social_document_inventory(uuid) from public,anon;
grant execute on function public.social_document_inventory(uuid) to authenticated;

create or replace function public.update_social_document_metadata(
  p_document uuid,p_title text,p_document_type text,p_record_type text,p_sensitivity text,
  p_description text,p_tags text[],p_status text,p_classification_status text,
  p_expires_at timestamptz,p_external_shareable boolean,p_linked_entities jsonb
) returns void
language plpgsql security invoker set search_path=public,pg_temp
as $update_document$
declare d public.social_documents%rowtype;
begin
  select * into d from public.social_documents where id=p_document for update;
  if not found then raise exception 'Document not found'; end if;
  if not public.social_can_access_case(d.social_case_id,d.record_type,true,auth.uid())
     or not public.social_can_access_case(d.social_case_id,p_record_type,true,auth.uid()) then
    raise exception 'Document metadata update denied';
  end if;
  if nullif(btrim(p_title),'') is null then raise exception 'Document title is required'; end if;
  update public.social_documents set
    title=btrim(p_title),document_type=p_document_type,record_type=p_record_type,
    sensitivity=p_sensitivity,description=nullif(btrim(p_description),''),
    tags=coalesce(p_tags,'{}'),document_status=p_status,
    classification_status=p_classification_status,expires_at=p_expires_at,
    external_shareable=p_external_shareable,linked_entities=coalesce(p_linked_entities,'{}'::jsonb),
    updated_at=now()
  where id=p_document;
  insert into public.social_document_access_events(
    org_id,social_case_id,document_id,version,action,reason,actor_id
  ) values(d.org_id,d.social_case_id,d.id,d.current_version,'metadata_update','Metadata or classification updated',auth.uid());
end
$update_document$;

revoke all on function public.update_social_document_metadata(uuid,text,text,text,text,text,text[],text,text,timestamptz,boolean,jsonb) from public,anon;
grant execute on function public.update_social_document_metadata(uuid,text,text,text,text,text,text[],text,text,timestamptz,boolean,jsonb) to authenticated;

create or replace function public.move_social_document(
  p_document uuid,p_target_case uuid,p_new_storage_path text,p_checksum text,
  p_mime text,p_size bigint,p_reason text
) returns void
language plpgsql security invoker set search_path=public,pg_temp
as $move_document$
declare d public.social_documents%rowtype; target_case public.social_cases%rowtype; next_version integer;
begin
  select * into d from public.social_documents where id=p_document for update;
  select * into target_case from public.social_cases where id=p_target_case;
  if not found or d.org_id<>target_case.org_id then raise exception 'Target case is not available'; end if;
  if not public.social_can_access_case(d.social_case_id,d.record_type,true,auth.uid())
     or not public.social_can_access_case(target_case.id,d.record_type,true,auth.uid()) then
    raise exception 'Document move denied';
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'Move reason is required'; end if;
  if p_new_storage_path not like d.org_id::text||'/'||target_case.id::text||'/'||d.record_type||'/%' then
    raise exception 'Target storage path boundary mismatch';
  end if;
  if lower(p_checksum)<>lower(d.checksum) then raise exception 'Moved original checksum mismatch'; end if;
  next_version:=d.current_version+1;
  insert into public.social_document_versions(org_id,document_id,version,checksum,storage_path,mime_type,size_bytes,uploaded_by,notes)
  values(d.org_id,d.id,next_version,lower(p_checksum),p_new_storage_path,p_mime,p_size,auth.uid(),'Case move: '||p_reason);
  update public.social_documents set social_case_id=target_case.id,person_id=target_case.person_id,
    family_id=target_case.family_id,current_version=next_version,storage_path=p_new_storage_path,
    mime_type=p_mime,size_bytes=p_size,updated_at=now() where id=d.id;
  insert into public.social_document_access_events(org_id,social_case_id,document_id,version,action,reason,actor_id)
  values(d.org_id,target_case.id,d.id,next_version,'move_case',p_reason,auth.uid());
end
$move_document$;

revoke all on function public.move_social_document(uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.move_social_document(uuid,uuid,text,text,text,bigint,text) to authenticated;

-- No function here creates a legal matter or sends files to Legal Intelligence.
-- Those actions remain explicit, consent-checked application workflows.
