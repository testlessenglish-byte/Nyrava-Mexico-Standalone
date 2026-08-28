-- Mexico Case Forms & Document System Migration
-- Establishes template registry, official forms metadata, and document lifecycle enhancements.

create table if not exists public.social_case_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  template_type text not null check(template_type in ('nyrava_template', 'organization_template', 'official_mexican_form')),
  category text not null check(category in (
    'intake','consent','risk_safety','housing','psychosocial','legal',
    'family_children','health','immigration_refugee','general_assistance'
  )),
  code text not null unique,
  name_es text not null,
  name_en text not null,
  description_es text,
  description_en text,
  record_type text not null default 'general_case_record' check (record_type in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record',
    'child_protection_restricted_record'
  )),
  version integer not null default 1,
  fields jsonb not null default '[]'::jsonb,
  schema_template jsonb not null default '{}'::jsonb,
  official_authority text,
  jurisdiction text check (jurisdiction is null or jurisdiction in ('federal','estatal','municipal')),
  source_url text,
  last_verified_at timestamptz,
  effective_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.social_case_templates enable row level security;

create policy social_case_templates_read on public.social_case_templates
  for select to authenticated
  using (org_id is null or org_id in (
    select org_id from public.social_organization_members where user_id = auth.uid() and status = 'active'
  ));

create policy social_case_templates_manage on public.social_case_templates
  for all to authenticated
  using (
    public.social_is_platform_admin(auth.uid()) or
    (org_id is not null and exists (
      select 1 from public.social_organization_members
      where org_id = social_case_templates.org_id
        and user_id = auth.uid()
        and status = 'active'
        and role in ('organization_owner', 'program_director', 'case_management_supervisor')
    ))
  );

-- Add document lifecycle, template tracking and recipient columns to social_documents
alter table public.social_documents
  add column if not exists template_id uuid references public.social_case_templates(id),
  add column if not exists template_code text,
  add column if not exists template_version integer,
  add column if not exists purpose text check (purpose is null or purpose in (
    'intake','consent_privacy','risk_safety','care_plan','referral','housing',
    'psychosocial','legal','medical_health','child_family','immigration','follow_up','closure'
  )),
  add column if not exists lifecycle_status text not null default 'finalized' check(
    lifecycle_status in ('draft','ready_for_review','finalized','sent','received','superseded','archived')
  ),
  add column if not exists language_code text not null default 'es' check(language_code in ('es','en')),
  add column if not exists draft_payload jsonb not null default '{}'::jsonb,
  add column if not exists recipient_info jsonb not null default '{}'::jsonb,
  add column if not exists disclosure_check jsonb not null default '{}'::jsonb,
  add column if not exists referral_id uuid references public.social_referrals(id),
  add column if not exists care_plan_goal_id uuid,
  add column if not exists finalized_at timestamptz,
  add column if not exists finalized_by uuid references auth.users(id),
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text;

create or replace function public.social_document_inventory(p_case uuid)
returns table(
  id uuid,title text,document_type text,record_type text,sensitivity text,current_version integer,
  checksum text,mime_type text,size_bytes bigint,description text,tags text[],document_status text,
  classification_status text,expires_at timestamptz,external_shareable boolean,linked_entities jsonb,uploaded_by uuid,
  created_at timestamptz,updated_at timestamptz,content_access boolean,restricted_metadata boolean,
  template_id uuid,template_code text,template_version integer,purpose text,lifecycle_status text,
  language_code text,draft_payload jsonb,recipient_info jsonb,disclosure_check jsonb,referral_id uuid,
  care_plan_goal_id uuid,finalized_at timestamptz,finalized_by uuid,sent_at timestamptz,sent_to text
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
    d.uploaded_by,d.created_at,d.updated_at,a.allowed,not a.allowed,
    d.template_id,d.template_code,d.template_version,d.purpose,d.lifecycle_status,
    d.language_code,
    case when a.allowed then d.draft_payload else '{}'::jsonb end,
    case when a.allowed then d.recipient_info else '{}'::jsonb end,
    case when a.allowed then d.disclosure_check else '{}'::jsonb end,
    d.referral_id,d.care_plan_goal_id,d.finalized_at,d.finalized_by,d.sent_at,d.sent_to
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
