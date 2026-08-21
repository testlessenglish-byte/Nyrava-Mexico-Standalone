-- Atención Integral y Gestión Social
-- Separate social-care domain. Reuses organizations/authentication but never
-- enters the legal case pipeline or exposes restricted records by default.

create table if not exists public.social_programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  code text not null,
  case_prefix text not null default 'NYR-SOC',
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code),
  check (case_prefix ~ '^[A-Z0-9-]{2,20}$')
);

create table if not exists public.social_offices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  program_id uuid references public.social_programs(id),
  name text not null,
  code text not null,
  address jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table if not exists public.social_role_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  scope_type text not null default 'organization',
  scope_id uuid,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role, scope_type, scope_id),
  check (role in (
    'organization_owner','program_director','case_management_supervisor',
    'case_manager','social_worker','attorney','legal_assistant','psychologist',
    'medical_professional','referral_coordinator','data_analyst','auditor',
    'read_only_reviewer','external_partner'
  )),
  check (scope_type in ('organization','program','office','case')),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.social_role_capabilities (
  role text not null,
  capability text not null,
  created_at timestamptz not null default now(),
  primary key (role, capability)
);

insert into public.social_role_capabilities(role, capability)
values
  ('organization_owner','social.admin'),
  ('program_director','social.admin'),
  ('program_director','case.view_all'),
  ('program_director','indicators.view'),
  ('case_management_supervisor','case.view_all'),
  ('case_management_supervisor','case.create'),
  ('case_management_supervisor','case.update'),
  ('case_management_supervisor','care_plan.approve'),
  ('case_management_supervisor','transfer.approve'),
  ('case_management_supervisor','closure.approve'),
  ('case_management_supervisor','restricted.child_protection'),
  ('case_manager','case.create'),
  ('case_manager','case.update_assigned'),
  ('case_manager','person.manage'),
  ('case_manager','assessment.manage'),
  ('case_manager','care_plan.manage'),
  ('case_manager','intervention.general'),
  ('case_manager','referral.manage'),
  ('social_worker','case.update_assigned'),
  ('social_worker','person.manage'),
  ('social_worker','assessment.manage'),
  ('social_worker','care_plan.manage'),
  ('social_worker','intervention.social_work'),
  ('social_worker','restricted.child_protection'),
  ('attorney','restricted.legal'),
  ('attorney','intervention.legal'),
  ('legal_assistant','restricted.legal'),
  ('psychologist','restricted.psychosocial'),
  ('psychologist','intervention.psychosocial'),
  ('medical_professional','restricted.medical'),
  ('referral_coordinator','referral.manage'),
  ('data_analyst','indicators.deidentified'),
  ('auditor','audit.view'),
  ('read_only_reviewer','case.read_assigned'),
  ('external_partner','referral.shared_only')
on conflict do nothing;

create table if not exists public.social_people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  person_number text not null,
  legal_name text not null,
  preferred_name text,
  aliases text[] not null default '{}',
  date_of_birth date,
  approximate_age smallint,
  sex text,
  gender_identity text,
  nationality text,
  country_of_origin text,
  place_of_origin text,
  languages text[] not null default '{}',
  interpreter_required boolean not null default false,
  accessibility_needs text,
  telephone text,
  email text,
  current_location jsonb not null default '{}'::jsonb,
  emergency_contact jsonb not null default '{}'::jsonb,
  identity_documents jsonb not null default '[]'::jsonb,
  immigration_identifiers jsonb not null default '{}'::jsonb,
  is_minor boolean,
  unaccompanied_minor boolean not null default false,
  separated_minor boolean not null default false,
  assigned_case_manager uuid references auth.users(id),
  office_id uuid references public.social_offices(id),
  consent_status text not null default 'pending',
  data_sharing_restrictions text,
  safety_restrictions text,
  record_status text not null default 'active',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, person_number),
  check (approximate_age is null or approximate_age between 0 and 130),
  check (record_status in ('active','inactive','deceased','duplicate','archived')),
  check (consent_status in ('pending','granted','limited','revoked','emergency_basis','not_required'))
);

create table if not exists public.social_families (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  family_number text not null,
  family_name text not null,
  primary_contact_person_id uuid references public.social_people(id),
  current_location jsonb not null default '{}'::jsonb,
  shared_needs jsonb not null default '[]'::jsonb,
  shared_risks jsonb not null default '[]'::jsonb,
  assigned_case_manager uuid references auth.users(id),
  office_id uuid references public.social_offices(id),
  data_sharing_permissions jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, family_number)
);

create table if not exists public.social_family_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  family_id uuid not null references public.social_families(id),
  person_id uuid not null references public.social_people(id),
  relationship text,
  is_dependent boolean not null default false,
  is_child boolean not null default false,
  is_guardian boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (family_id, person_id)
);

create table if not exists public.social_case_number_counters (
  org_id uuid not null references public.organizations(id),
  program_id uuid not null references public.social_programs(id),
  calendar_year integer not null,
  last_number bigint not null default 0,
  primary key (org_id, program_id, calendar_year)
);

create table if not exists public.social_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  program_id uuid not null references public.social_programs(id),
  office_id uuid references public.social_offices(id),
  case_number text not null,
  person_id uuid references public.social_people(id),
  family_id uuid references public.social_families(id),
  case_type text not null,
  intake_date date not null default current_date,
  referral_source text,
  assigned_case_manager uuid references auth.users(id),
  supervising_manager uuid references auth.users(id),
  service_areas text[] not null default '{}',
  status text not null default 'intake',
  priority text not null default 'normal',
  risk_level text not null default 'unknown',
  confidentiality_level text not null default 'standard',
  consent_status text not null default 'pending',
  opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  next_required_action text,
  transfer_date timestamptz,
  closure_date timestamptz,
  tags text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, case_number),
  check (person_id is not null or family_id is not null),
  check (status in ('intake','assessment','active','monitoring','pending_referral','transferred','closed','reopened','archived')),
  check (priority in ('low','normal','high','urgent')),
  check (risk_level in ('unknown','low','moderate','high','critical')),
  check (confidentiality_level in ('standard','confidential','restricted','highly_restricted'))
);

create table if not exists public.social_case_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  user_id uuid not null references auth.users(id),
  assignment_role text not null,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  active boolean not null default true
);

create unique index if not exists social_case_assignments_one_active
  on public.social_case_assignments(social_case_id,user_id,assignment_role)
  where active;

create table if not exists public.social_record_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  user_id uuid references auth.users(id),
  team_role text,
  record_type text not null,
  can_read boolean not null default true,
  can_write boolean not null default false,
  expires_at timestamptz,
  granted_by uuid not null references auth.users(id),
  reason text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_id is not null or team_role is not null),
  check (record_type in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record',
    'child_protection_restricted_record'
  ))
);

create table if not exists public.social_assessment_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  code text not null,
  version integer not null default 1,
  name_es text not null,
  name_en text not null,
  schema jsonb not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, code, version)
);

create table if not exists public.social_assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  template_id uuid references public.social_assessment_templates(id),
  current_version integer not null default 1,
  assessment_date timestamptz not null default now(),
  assessor_id uuid not null references auth.users(id),
  risk_level text not null default 'unknown',
  professional_override boolean not null default false,
  override_explanation text,
  next_review_date date,
  created_at timestamptz not null default now(),
  check (risk_level in ('unknown','low','moderate','high','critical')),
  check (not professional_override or nullif(btrim(override_explanation),'') is not null)
);

create table if not exists public.social_assessment_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  assessment_id uuid not null references public.social_assessments(id),
  version integer not null,
  evidence_observations text,
  reason text not null,
  protective_factors text,
  immediate_actions text,
  required_follow_up text,
  answers jsonb not null default '{}'::jsonb,
  risk_level text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (assessment_id, version),
  check (risk_level in ('unknown','low','moderate','high','critical'))
);

create table if not exists public.social_care_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  family_id uuid references public.social_families(id),
  current_version integer not null default 1,
  status text not null default 'draft',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('draft','active','under_review','completed','partially_completed','cancelled','superseded'))
);

create table if not exists public.social_care_plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  care_plan_id uuid not null references public.social_care_plans(id),
  version integer not null,
  summary text,
  status text not null,
  submitted_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (care_plan_id, version)
);

create table if not exists public.social_care_plan_goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  care_plan_version_id uuid not null references public.social_care_plan_versions(id),
  identified_need text not null,
  goal text not null,
  planned_action text not null,
  responsible_person uuid references auth.users(id),
  responsible_service_area text,
  external_institution_id uuid,
  target_date date,
  priority text not null default 'normal',
  required_consent text,
  expected_outcome text,
  status text not null default 'draft',
  completion_evidence text,
  review_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.social_interventions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  person_id uuid references public.social_people(id),
  family_id uuid references public.social_families(id),
  occurred_at timestamptz not null,
  service_type text not null,
  professional_id uuid not null references auth.users(id),
  location_method text,
  reason text not null,
  actions_taken text not null,
  outcome text,
  follow_up_required boolean not null default false,
  care_plan_goal_id uuid references public.social_care_plan_goals(id),
  confidentiality_level text not null default 'standard',
  record_type text not null default 'general_case_record',
  next_appointment timestamptz,
  created_at timestamptz not null default now(),
  check (record_type in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record',
    'child_protection_restricted_record'
  ))
);

create table if not exists public.social_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  person_id uuid references public.social_people(id),
  family_id uuid references public.social_families(id),
  consent_type text not null,
  current_version integer not null default 1,
  status text not null default 'active',
  valid_from timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (person_id is not null or family_id is not null),
  check (status in ('draft','active','expired','revoked','superseded','emergency_basis'))
);

create table if not exists public.social_consent_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  consent_id uuid not null references public.social_consents(id),
  version integer not null,
  language text not null default 'es',
  consented_by_name text not null,
  guardian_representative text,
  permitted_purpose text[] not null default '{}',
  permitted_recipients text[] not null default '{}',
  permitted_information text[] not null default '{}',
  restrictions text,
  confirmation jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (consent_id, version)
);

create table if not exists public.social_institutions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  name text not null,
  institution_type text not null,
  jurisdiction_level text,
  contact jsonb not null default '{}'::jsonb,
  services text[] not null default '{}',
  active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.social_referrals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  referral_number text not null,
  person_id uuid references public.social_people(id),
  family_id uuid references public.social_families(id),
  receiving_institution_id uuid not null references public.social_institutions(id),
  receiving_org_id uuid references public.organizations(id),
  contact_person text,
  service_requested text not null,
  reason text not null,
  urgency text not null default 'normal',
  consent_id uuid references public.social_consents(id),
  authorized_information text[] not null default '{}',
  authorized_document_ids uuid[] not null default '{}',
  referral_date timestamptz,
  appointment_at timestamptz,
  status text not null default 'draft',
  response text,
  result text,
  result_verified_at timestamptz,
  result_verified_by uuid references auth.users(id),
  follow_up_date date,
  closure_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, referral_number),
  check (status in ('draft','awaiting_consent','sent','received','appointment_scheduled','in_progress','completed','rejected','unable_to_contact','cancelled')),
  check (status <> 'completed' or (result_verified_at is not null and result_verified_by is not null))
);

create table if not exists public.social_referral_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  referral_id uuid not null references public.social_referrals(id),
  status text not null,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.social_referral_shared_packets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  receiving_org_id uuid not null references public.organizations(id),
  referral_id uuid not null references public.social_referrals(id),
  consent_id uuid not null references public.social_consents(id),
  purpose text not null,
  shared_fields jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.social_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  person_id uuid references public.social_people(id),
  family_id uuid references public.social_families(id),
  title text not null,
  document_type text,
  record_type text not null default 'general_case_record',
  sensitivity text not null default 'confidential',
  consent_id uuid references public.social_consents(id),
  current_version integer not null default 1,
  checksum text,
  mime_type text,
  size_bytes bigint,
  storage_path text not null,
  extracted_text text,
  extraction_authorized boolean not null default false,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (record_type in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record',
    'child_protection_restricted_record'
  ))
);

create unique index if not exists social_documents_exact_duplicate
  on public.social_documents(social_case_id, checksum)
  where deleted_at is null and checksum is not null;

create table if not exists public.social_document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  document_id uuid not null references public.social_documents(id),
  version integer not null,
  checksum text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table if not exists public.social_document_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  document_id uuid not null references public.social_documents(id),
  receiving_org_id uuid not null references public.organizations(id),
  consent_id uuid not null references public.social_consents(id),
  purpose text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.social_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  title text not null,
  description text,
  assignee_id uuid references auth.users(id),
  priority text not null default 'normal',
  status text not null default 'todo',
  due_at timestamptz,
  reminder_at timestamptz,
  recurrence jsonb,
  supervisor_escalation_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (priority in ('low','normal','high','urgent')),
  check (status in ('todo','in_progress','blocked','done','cancelled'))
);

create table if not exists public.social_appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  person_id uuid references public.social_people(id),
  title text not null,
  scheduled_at timestamptz not null,
  duration_minutes integer,
  location_method text,
  professional_id uuid references auth.users(id),
  status text not null default 'scheduled',
  missed_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (status in ('scheduled','confirmed','completed','missed','cancelled','rescheduled'))
);

create table if not exists public.social_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid references public.social_cases(id),
  alert_type text not null,
  severity text not null default 'info',
  title_es text not null,
  title_en text not null,
  due_at timestamptz,
  assigned_to uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (severity in ('info','warning','high','critical'))
);

create table if not exists public.social_case_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  transfer_type text not null,
  from_user_id uuid references auth.users(id),
  to_user_id uuid references auth.users(id),
  from_office_id uuid references public.social_offices(id),
  to_office_id uuid references public.social_offices(id),
  receiving_org_id uuid references public.organizations(id),
  consent_id uuid references public.social_consents(id),
  selected_information jsonb not null default '{}'::jsonb,
  restricted_information jsonb not null default '{}'::jsonb,
  transfer_summary text not null,
  deadlines jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  sent_at timestamptz,
  received_at timestamptz,
  received_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (status in ('draft','pending_approval','approved','sent','received','rejected','cancelled'))
);

create table if not exists public.social_case_closures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  closure_version integer not null default 1,
  closure_reason text not null,
  goals_completed text,
  goals_incomplete text,
  final_risk_level text not null,
  referrals_completed text,
  pending_referrals text,
  outstanding_deadlines text,
  client_notification text,
  document_disposition text,
  retention_status text,
  closing_professional uuid not null references auth.users(id),
  supervisor_approval_by uuid references auth.users(id),
  supervisor_approved_at timestamptz,
  closure_date timestamptz,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  created_at timestamptz not null default now(),
  unique (social_case_id, closure_version),
  check (closure_reason in ('services_completed','client_withdrew','unable_to_contact','transferred','ineligible','relocated','duplicate_case','other')),
  check (final_risk_level in ('unknown','low','moderate','high','critical'))
);

create table if not exists public.social_immigration_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  immigration_case_id uuid not null references public.cases(id),
  consent_id uuid not null references public.social_consents(id),
  permitted_status_fields text[] not null default '{}',
  shared_social_fields text[] not null default '{}',
  shared_document_ids uuid[] not null default '{}',
  non_refoulement_concern boolean not null default false,
  detention_deportation_risk boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (social_case_id, immigration_case_id)
);

create table if not exists public.social_activity_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid references public.social_cases(id),
  actor_id uuid references auth.users(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.social_indicator_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  program_id uuid references public.social_programs(id),
  office_id uuid references public.social_offices(id),
  period_start date not null,
  period_end date not null,
  indicator_code text not null,
  filters jsonb not null default '{}'::jsonb,
  value numeric not null,
  suppressed boolean not null default false,
  suppression_reason text,
  generated_at timestamptz not null default now(),
  unique (org_id, program_id, office_id, period_start, period_end, indicator_code, filters)
);

create index if not exists social_people_search_idx on public.social_people using gin (
  to_tsvector('simple', coalesce(legal_name,'') || ' ' || coalesce(preferred_name,'') || ' ' || array_to_string(aliases,' '))
);
create index if not exists social_cases_queue_idx on public.social_cases(org_id,status,risk_level,last_activity_at);
create index if not exists social_assignments_user_idx on public.social_case_assignments(user_id,social_case_id) where active;
create index if not exists social_tasks_due_idx on public.social_tasks(org_id,status,due_at);
create index if not exists social_alerts_open_idx on public.social_alerts(org_id,severity,due_at) where resolved_at is null;
create index if not exists social_activity_org_time_idx on public.social_activity_events(org_id,occurred_at desc);

-- Immutable, non-reusable case numbers.
create or replace function public.assign_social_case_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_year integer;
  v_next bigint;
begin
  if new.case_number is not null and btrim(new.case_number) <> '' then
    return new;
  end if;
  select case_prefix into v_prefix
  from public.social_programs
  where id = new.program_id and org_id = new.org_id and active;
  if v_prefix is null then raise exception 'Invalid or inactive social program'; end if;
  v_year := extract(year from coalesce(new.intake_date,current_date));
  insert into public.social_case_number_counters(org_id,program_id,calendar_year,last_number)
  values(new.org_id,new.program_id,v_year,1)
  on conflict(org_id,program_id,calendar_year)
  do update set last_number = public.social_case_number_counters.last_number + 1
  returning last_number into v_next;
  new.case_number := v_prefix || '-' || v_year::text || '-' || lpad(v_next::text,6,'0');
  return new;
end;
$$;

create or replace function public.prevent_social_case_number_change()
returns trigger language plpgsql as $$
begin
  if new.case_number is distinct from old.case_number then
    raise exception 'Social case number is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists social_case_number_assign on public.social_cases;
create trigger social_case_number_assign before insert on public.social_cases
for each row execute function public.assign_social_case_number();
drop trigger if exists social_case_number_immutable on public.social_cases;
create trigger social_case_number_immutable before update on public.social_cases
for each row execute function public.prevent_social_case_number_change();

-- Capability and record-boundary helpers. Existing organization membership is
-- always required; social roles never create a second authentication system.
create or replace function public.social_has_capability(
  p_org uuid, p_capability text, p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_org_member(p_org,p_user) and (
    public.can_manage_org(p_org,p_user)
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

create or replace function public.social_can_access_case(
  p_case uuid,
  p_record_type text default 'general_case_record',
  p_write boolean default false,
  p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path = public
as $$
  with c as (
    select id,org_id,created_by from public.social_cases
    where id=p_case and deleted_at is null
  )
  select exists (
    select 1 from c
    where public.is_org_member(c.org_id,p_user)
      and (
        public.can_manage_org(c.org_id,p_user)
        or c.created_by=p_user
        or exists (
          select 1 from public.social_case_assignments a
          where a.social_case_id=c.id and a.user_id=p_user and a.active
        )
        or (not p_write and public.social_has_capability(c.org_id,'case.view_all',p_user))
      )
      and case p_record_type
        when 'general_case_record' then
          not p_write
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
        else false
      end
  );
$$;

create or replace function public.social_can_access_person(
  p_person uuid, p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.social_people p
    where p.id=p_person and p.deleted_at is null
      and public.is_org_member(p.org_id,p_user)
      and (
        public.can_manage_org(p.org_id,p_user)
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

create or replace function public.social_consent_covers(
  p_consent uuid, p_recipient text, p_purpose text, p_information text[]
) returns boolean
language sql stable security definer set search_path=public
as $$
  select exists (
    select 1
    from public.social_consents c
    join public.social_consent_versions v
      on v.consent_id=c.id and v.version=c.current_version
    where c.id=p_consent and c.status in ('active','emergency_basis')
      and c.revoked_at is null and c.valid_from<=now()
      and (c.expires_at is null or c.expires_at>now())
      and (p_recipient=any(v.permitted_recipients) or '*'=any(v.permitted_recipients))
      and (p_purpose=any(v.permitted_purpose) or '*'=any(v.permitted_purpose))
      and p_information <@ v.permitted_information
  );
$$;

revoke all on function public.social_has_capability(uuid,text,uuid) from public;
revoke all on function public.social_can_access_case(uuid,text,boolean,uuid) from public;
revoke all on function public.social_can_access_person(uuid,uuid) from public;
revoke all on function public.social_consent_covers(uuid,text,text,text[]) from public;
grant execute on function public.social_has_capability(uuid,text,uuid) to authenticated;
grant execute on function public.social_can_access_case(uuid,text,boolean,uuid) to authenticated;
grant execute on function public.social_can_access_person(uuid,uuid) to authenticated;
grant execute on function public.social_consent_covers(uuid,text,text,text[]) to authenticated;

-- Automatic creator assignment.
create or replace function public.assign_social_case_creator()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.social_case_assignments(
    org_id,social_case_id,user_id,assignment_role,assigned_by
  ) values(new.org_id,new.id,new.created_by,'creator',new.created_by)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists social_case_assign_creator on public.social_cases;
create trigger social_case_assign_creator after insert on public.social_cases
for each row execute function public.assign_social_case_creator();

-- Append-only operational audit with no sensitive row bodies.
create or replace function public.audit_social_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_org uuid;
  v_case uuid;
  v_id uuid;
begin
  v_org := coalesce(new.org_id,old.org_id);
  v_case := case
    when tg_table_name='social_cases' then coalesce(
      (to_jsonb(new)->>'id')::uuid,
      (to_jsonb(old)->>'id')::uuid
    )
    else coalesce(
      nullif(to_jsonb(new)->>'social_case_id','')::uuid,
      nullif(to_jsonb(old)->>'social_case_id','')::uuid
    )
  end;
  v_id := coalesce(
    nullif(to_jsonb(new)->>'id','')::uuid,
    nullif(to_jsonb(old)->>'id','')::uuid
  );
  insert into public.social_activity_events(
    org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_org,v_case,auth.uid(),lower(tg_op),tg_table_name,v_id,
    jsonb_build_object('operation',tg_op)
  );
  return coalesce(new,old);
end;
$$;

create or replace function public.prevent_social_activity_mutation()
returns trigger language plpgsql as $$
begin raise exception 'Social activity ledger is append-only'; end;
$$;
drop trigger if exists social_activity_no_update on public.social_activity_events;
create trigger social_activity_no_update before update or delete on public.social_activity_events
for each row execute function public.prevent_social_activity_mutation();

do $$
declare t text;
begin
  foreach t in array array[
    'social_cases','social_assessments','social_care_plans','social_interventions',
    'social_consents','social_referrals','social_documents','social_tasks',
    'social_case_transfers','social_case_closures','social_immigration_links'
  ] loop
    execute format('drop trigger if exists %I on public.%I','audit_'||t,t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_social_change()','audit_'||t,t);
  end loop;
end $$;

-- RLS: configuration.
do $$
declare t text;
begin
  foreach t in array array[
    'social_programs','social_offices','social_role_assignments','social_people',
    'social_families','social_family_members','social_case_number_counters',
    'social_cases','social_case_assignments','social_record_grants',
    'social_assessment_templates','social_assessments','social_assessment_versions',
    'social_care_plans','social_care_plan_versions','social_care_plan_goals',
    'social_interventions','social_consents','social_consent_versions',
    'social_institutions','social_referrals','social_referral_updates',
    'social_referral_shared_packets','social_documents','social_document_versions',
    'social_document_shares','social_tasks','social_appointments','social_alerts',
    'social_case_transfers','social_case_closures','social_immigration_links',
    'social_activity_events','social_indicator_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

-- Managers configure programs, offices and social role assignments.
create policy social_programs_read on public.social_programs for select
using (public.is_org_member(org_id,auth.uid()));
create policy social_programs_manage on public.social_programs for all
using (public.can_manage_org(org_id,auth.uid()))
with check (public.can_manage_org(org_id,auth.uid()));
create policy social_offices_read on public.social_offices for select
using (public.is_org_member(org_id,auth.uid()));
create policy social_offices_manage on public.social_offices for all
using (public.can_manage_org(org_id,auth.uid()))
with check (public.can_manage_org(org_id,auth.uid()));
create policy social_roles_self_read on public.social_role_assignments for select
using (user_id=auth.uid() or public.can_manage_org(org_id,auth.uid()));
create policy social_roles_manage on public.social_role_assignments for all
using (public.can_manage_org(org_id,auth.uid()))
with check (public.can_manage_org(org_id,auth.uid()));

-- People and families: only managers, creators, assigned managers, or users
-- with an accessible linked social case.
create policy social_people_read on public.social_people for select
using (public.social_can_access_person(id,auth.uid()));
create policy social_people_create on public.social_people for insert
with check (public.is_org_member(org_id,auth.uid()) and created_by=auth.uid()
  and (public.social_has_capability(org_id,'person.manage',auth.uid()) or public.can_manage_org(org_id,auth.uid())));
create policy social_people_update on public.social_people for update
using (public.social_can_access_person(id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
))
with check (public.social_can_access_person(id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
));
create policy social_families_read on public.social_families for select
using (public.is_org_member(org_id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid()) or created_by=auth.uid()
  or assigned_case_manager=auth.uid()
  or exists(select 1 from public.social_cases c where c.family_id=id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
));
create policy social_families_write on public.social_families for all
using (public.is_org_member(org_id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
))
with check (public.is_org_member(org_id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
));
create policy social_family_members_access on public.social_family_members for all
using (public.is_org_member(org_id,auth.uid()) and exists(select 1 from public.social_families f where f.id=family_id))
with check (public.is_org_member(org_id,auth.uid()));

-- Social case access is assignment/capability based.
create policy social_cases_read on public.social_cases for select
using (public.social_can_access_case(id,'general_case_record',false,auth.uid()));
create policy social_cases_create on public.social_cases for insert
with check (public.is_org_member(org_id,auth.uid()) and created_by=auth.uid()
  and (public.social_has_capability(org_id,'case.create',auth.uid()) or public.can_manage_org(org_id,auth.uid())));
create policy social_cases_update on public.social_cases for update
using (public.social_can_access_case(id,'general_case_record',true,auth.uid()))
with check (public.social_can_access_case(id,'general_case_record',true,auth.uid()));
create policy social_assignments_read on public.social_case_assignments for select
using (public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()));
create policy social_assignments_manage on public.social_case_assignments for all
using (public.can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'case.view_all',auth.uid()))
with check (public.can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'case.view_all',auth.uid()));
create policy social_grants_read on public.social_record_grants for select
using (user_id=auth.uid() or public.can_manage_org(org_id,auth.uid()));
create policy social_grants_manage on public.social_record_grants for all
using (public.can_manage_org(org_id,auth.uid()))
with check (public.can_manage_org(org_id,auth.uid()));

-- Case child tables with general access.
do $$
declare t text;
begin
  foreach t in array array[
    'social_assessments','social_care_plans','social_tasks','social_appointments',
    'social_alerts','social_case_transfers','social_case_closures','social_immigration_links'
  ] loop
    execute format(
      'create policy %I on public.%I for all using (public.social_can_access_case(social_case_id,''general_case_record'',false,auth.uid())) with check (public.social_can_access_case(social_case_id,''general_case_record'',true,auth.uid()))',
      t||'_access',t
    );
  end loop;
end $$;

-- Restricted content checks record_type on every row.
create policy social_interventions_access on public.social_interventions for all
using (public.social_can_access_case(social_case_id,record_type,false,auth.uid()))
with check (public.social_can_access_case(social_case_id,record_type,true,auth.uid()));
create policy social_documents_access on public.social_documents for all
using (public.social_can_access_case(social_case_id,record_type,false,auth.uid()))
with check (public.social_can_access_case(social_case_id,record_type,true,auth.uid()));

-- Version rows inherit access from their parent.
create policy social_assessment_versions_access on public.social_assessment_versions for all
using (exists(select 1 from public.social_assessments a where a.id=assessment_id and public.social_can_access_case(a.social_case_id,'general_case_record',false,auth.uid())))
with check (exists(select 1 from public.social_assessments a where a.id=assessment_id and public.social_can_access_case(a.social_case_id,'general_case_record',true,auth.uid())));
create policy social_plan_versions_access on public.social_care_plan_versions for all
using (exists(select 1 from public.social_care_plans p where p.id=care_plan_id and public.social_can_access_case(p.social_case_id,'general_case_record',false,auth.uid())))
with check (exists(select 1 from public.social_care_plans p where p.id=care_plan_id and public.social_can_access_case(p.social_case_id,'general_case_record',true,auth.uid())));
create policy social_goals_access on public.social_care_plan_goals for all
using (exists(select 1 from public.social_care_plan_versions v join public.social_care_plans p on p.id=v.care_plan_id where v.id=care_plan_version_id and public.social_can_access_case(p.social_case_id,'general_case_record',false,auth.uid())))
with check (exists(select 1 from public.social_care_plan_versions v join public.social_care_plans p on p.id=v.care_plan_id where v.id=care_plan_version_id and public.social_can_access_case(p.social_case_id,'general_case_record',true,auth.uid())));
create policy social_document_versions_access on public.social_document_versions for all
using (exists(select 1 from public.social_documents d where d.id=document_id and public.social_can_access_case(d.social_case_id,d.record_type,false,auth.uid())))
with check (exists(select 1 from public.social_documents d where d.id=document_id and public.social_can_access_case(d.social_case_id,d.record_type,true,auth.uid())));

-- Consent is case-member accessible; sharing is validated again at write time.
create policy social_consents_access on public.social_consents for all
using (public.is_org_member(org_id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id) and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
))
with check (public.is_org_member(org_id,auth.uid()));
create policy social_consent_versions_access on public.social_consent_versions for all
using (exists(select 1 from public.social_consents c where c.id=consent_id))
with check (exists(select 1 from public.social_consents c where c.id=consent_id));

-- Directories are visible to members; global rows have null org.
create policy social_institutions_read on public.social_institutions for select
using (org_id is null or public.is_org_member(org_id,auth.uid()));
create policy social_institutions_manage on public.social_institutions for all
using (org_id is not null and public.can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.can_manage_org(org_id,auth.uid()));
create policy social_templates_read on public.social_assessment_templates for select
using (org_id is null or public.is_org_member(org_id,auth.uid()));
create policy social_templates_manage on public.social_assessment_templates for all
using (org_id is not null and public.can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.can_manage_org(org_id,auth.uid()));

-- Referrals remain internal. External partners see only consent-limited packets.
create policy social_referrals_access on public.social_referrals for all
using (public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()))
with check (public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid()));
create policy social_referral_updates_access on public.social_referral_updates for all
using (exists(select 1 from public.social_referrals r where r.id=referral_id and public.social_can_access_case(r.social_case_id,'general_case_record',false,auth.uid())))
with check (exists(select 1 from public.social_referrals r where r.id=referral_id and public.social_can_access_case(r.social_case_id,'general_case_record',true,auth.uid())));
create policy social_packets_sender on public.social_referral_shared_packets for all
using (public.is_org_member(org_id,auth.uid()))
with check (public.is_org_member(org_id,auth.uid()) and public.social_consent_covers(consent_id,receiving_org_id::text,purpose,array(select jsonb_object_keys(shared_fields))));
create policy social_packets_receiver_read on public.social_referral_shared_packets for select
using (public.is_org_member(receiving_org_id,auth.uid()) and revoked_at is null and (expires_at is null or expires_at>now()));

create policy social_document_shares_sender on public.social_document_shares for all
using (public.is_org_member(org_id,auth.uid()))
with check (public.is_org_member(org_id,auth.uid()) and public.social_consent_covers(consent_id,receiving_org_id::text,purpose,array['document']));
create policy social_document_shares_receiver_read on public.social_document_shares for select
using (public.is_org_member(receiving_org_id,auth.uid()) and revoked_at is null and (expires_at is null or expires_at>now()));

-- Audit and indicators never expose restricted bodies.
create policy social_activity_read on public.social_activity_events for select
using (public.is_org_member(org_id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid())
  or actor_id=auth.uid()
  or public.social_has_capability(org_id,'audit.view',auth.uid())
));
create policy social_activity_insert on public.social_activity_events for insert
with check (public.is_org_member(org_id,auth.uid()) and actor_id=auth.uid());
create policy social_indicators_read on public.social_indicator_snapshots for select
using (public.is_org_member(org_id,auth.uid()) and (
  public.can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'indicators.view',auth.uid())
  or public.social_has_capability(org_id,'indicators.deidentified',auth.uid())
));
create policy social_indicators_manage on public.social_indicator_snapshots for all
using (public.can_manage_org(org_id,auth.uid()))
with check (public.can_manage_org(org_id,auth.uid()));

-- Counter is server-only.
revoke all on public.social_case_number_counters from authenticated;

-- Seed bilingual baseline assessment template and official Mexican institutions.
insert into public.social_assessment_templates(org_id,code,version,name_es,name_en,schema)
values (
  null,'initial_comprehensive',1,
  'Evaluación inicial integral','Initial comprehensive assessment',
  '{"domains":["legal","immigration","refugee_protection","housing","food","medical","mental_health","personal_safety","violence","human_trafficking","child_protection","family_separation","education","employment","income","language","documentation","disability_accessibility","transportation","social_support","exploitation","detention_deportation","urgent_deadlines"],"risk_levels":["unknown","low","moderate","high","critical"],"requires_evidence":true,"requires_reason":true,"requires_protective_factors":true,"requires_follow_up":true}'::jsonb
) on conflict do nothing;

insert into public.social_institutions(org_id,name,institution_type,jurisdiction_level,services,verified_at)
values
  (null,'Instituto Nacional de Migración (INM)','federal_authority','federal',array['immigration'],now()),
  (null,'Comisión Mexicana de Ayuda a Refugiados (COMAR)','federal_authority','federal',array['refugee_protection'],now()),
  (null,'Secretaría de Relaciones Exteriores (SRE)','federal_authority','federal',array['nationality','consular'],now()),
  (null,'Sistema Nacional DIF','public_social_service','federal',array['child_protection','family_support'],now()),
  (null,'Comisión Nacional de los Derechos Humanos (CNDH)','human_rights_body','federal',array['human_rights'],now())
on conflict do nothing;
