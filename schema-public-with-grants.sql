-- NYRAVA MEXICO STANDALONE — DEPENDENCY-ORDERED BASELINE SCHEMA

-- Target Supabase Project: plyqpmrucbsyxybmkoeg

-- 1. EXTENSIONS

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. ENUM TYPES

CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TYPE public.case_status AS ENUM ('uploaded','extracting','analyzing','scoring','reporting','complete','failed');

CREATE TYPE public.doc_status AS ENUM ('pending','extracting','extracted','failed','skipped_duplicate');

CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'lawyer', 'paralegal', 'viewer');

CREATE TYPE public.matter_type AS ENUM (
  'litigation','criminal','civil','commercial','labor','family',
  'constitutional','administrative','corporate','tax','immigration',
  'contract','advisory','compliance','transaction'
);

CREATE TYPE public.matter_status AS ENUM ('intake','active','on_hold','closed','archived');

CREATE TYPE public.matter_priority AS ENUM ('low','normal','high','urgent');

CREATE TYPE public.membership_status AS ENUM ('active','invited','suspended');

CREATE TYPE public.task_status AS ENUM ('todo','in_progress','blocked','done','cancelled');

CREATE TYPE public.verification_status AS ENUM (
  'verified', 'pending', 'missing', 'issue_found'
);

CREATE TYPE public.lesson_validation_status AS ENUM (
  'unverified',
  'ai_supported',
  'evidence_verified',
  'multi_source_verified',
  'human_confirmed'
);

CREATE TYPE public.intelligence_pattern_status AS ENUM (
  'active',
  'monitoring',
  'retired'
);

-- 3. TABLES

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text, full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gemini_api_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status public.case_status NOT NULL DEFAULT 'uploaded',
  status_message text,
  progress int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  content_hash text NOT NULL,
  status public.doc_status NOT NULL DEFAULT 'pending',
  extracted_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id, content_hash)
);

CREATE TABLE public.analyses (
  case_id uuid PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timeline jsonb, contradictions jsonb, missing_evidence jsonb,
  procedural_issues jsonb, evidence_relationships jsonb, key_findings jsonb, scoring jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.reports (
  case_id uuid PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attorney_summary text, evidence_summary text, timeline_summary text,
  contradiction_report text, missing_evidence_report text, recommendations text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  model text NOT NULL, operation text NOT NULL,
  input_tokens int, output_tokens int, total_tokens int,
  latency_ms int, success boolean NOT NULL DEFAULT true, error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.case_work_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  document_type text NOT NULL,          -- 'motion_to_suppress','motion_to_dismiss','discovery_request','cross_exam_plan','witness_prep','trial_outline','case_summary'
  title text NOT NULL,
  body_markdown text NOT NULL,
  cited_finding_ids uuid[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_groq_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Primary',
  key_value text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type text NOT NULL CHECK (provider_type IN ('groq','openrouter','openai','anthropic','gemini','ollama','lmstudio')),
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  base_url text,
  default_model text,
  secret_name text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_task_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL UNIQUE CHECK (task IN ('extraction','analysis','reasoning','report','chat')),
  provider_id uuid REFERENCES public.ai_providers(id) ON DELETE SET NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  run_order int NOT NULL,
  timeout_ms int NOT NULL DEFAULT 120000,
  retries int NOT NULL DEFAULT 1,
  confidence_threshold int NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  stage text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pipeline_engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  engine text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','skipped')),
  started_at timestamptz,
  ended_at timestamptz,
  runtime_ms integer,
  generated integer NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  suppressed_ess integer NOT NULL DEFAULT 0,
  suppressed_validator integer NOT NULL DEFAULT 0,
  skipped_reason text,
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_domain_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  domain text NOT NULL,
  source text NOT NULL CHECK (source IN ('user','hybrid','evidence')),
  trigger_id text,
  reason text NOT NULL,
  evidence_finding_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  stage TEXT,
  action TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_log jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

CREATE TABLE IF NOT EXISTS public.agent_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  agent_key TEXT NOT NULL,
  agent_index INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','success','failed','skipped','blocked')),
  confidence NUMERIC,
  processing_time_ms INTEGER,
  tokens_used INTEGER,
  output_file TEXT,
  output JSONB,
  errors JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.case_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  canonical_id text NOT NULL,
  event_date text,
  description text,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_page int,
  superseded_by uuid REFERENCES public.case_timeline_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_timeline_events_case_canonical_key UNIQUE (case_id, canonical_id)
);

CREATE TABLE public.image_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  page_number int,
  summary text,
  objects jsonb NOT NULL DEFAULT '[]'::jsonb,
  text_found text,
  ocr_text text,
  confidence numeric,
  source_model text,
  face_count int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.canonical_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  status public.canonical_status NOT NULL DEFAULT 'orchestrating',
  pipeline_stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id)
);

CREATE TABLE IF NOT EXISTS public.user_ai_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider public.ai_provider NOT NULL,
  label TEXT,
  encrypted_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, key_fingerprint)
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan text CHECK (plan IN ('solo', 'firm', 'enterprise')),
  status text NOT NULL DEFAULT 'none'
    CHECK (status IN ('none', 'active', 'past_due', 'canceled', 'incomplete')),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  free_case_used boolean NOT NULL DEFAULT false,
  free_case_case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.billing_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  interval text NOT NULL DEFAULT 'month',
  stripe_price_id text,
  self_serve boolean NOT NULL DEFAULT true,
  contact_url text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.demo_case_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  demo_case_id uuid NOT NULL REFERENCES public.demo_cases(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'evidence', 'timeline', 'witness_analysis', 'motion',
    'attorney_report', 'final_report', 'other'
  )),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.firm_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('firm_admin', 'case_manager', 'user')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  redeemed_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.org_role NOT NULL,
  permission_code TEXT NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, permission_code)
);

CREATE TABLE IF NOT EXISTS public.intelligence_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id UUID REFERENCES public.matters(id) ON DELETE CASCADE,
  engine public.intelligence_engine NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending|running|complete|failed
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT,
  tokens_used INT,
  cost_cents INT,
  requested_by UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.legal_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id UUID NOT NULL REFERENCES public.legal_authorities(id) ON DELETE CASCADE,
  cited_authority_id UUID REFERENCES public.legal_authorities(id) ON DELETE SET NULL,
  citation_text TEXT NOT NULL,
  context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.billing_plans(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  quota INT,           -- null = unlimited
  UNIQUE(plan_id, permission_code)
);

CREATE TABLE IF NOT EXISTS public.org_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.billing_plans(id),
  status TEXT NOT NULL DEFAULT 'trialing',  -- trialing|active|past_due|canceled|paused
  provider TEXT NOT NULL DEFAULT 'mercadopago',
  provider_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.org_subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'mercadopago',
  provider_payment_id TEXT,
  amount_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.legal_authority_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES public.legal_authorities(id) ON DELETE CASCADE,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.legal_ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_code text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL CHECK (status IN ('completed','failed','completed_with_errors')),
  documents_fetched integer NOT NULL DEFAULT 0,
  documents_stored integer NOT NULL DEFAULT 0,
  documents_versioned integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.legal_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.legal_keyword_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id uuid NOT NULL REFERENCES public.legal_keywords(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('authority','article','precedent','jurisprudencia','thesis','regulation')),
  entity_id uuid NOT NULL,
  UNIQUE (keyword_id, entity_type, entity_id)
);

CREATE TABLE public.pipeline_trace (
  id BIGSERIAL PRIMARY KEY,
  case_id UUID NOT NULL,
  user_id UUID,
  correlation_id TEXT,
  phase TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  level TEXT NOT NULL DEFAULT 'info',
  provider TEXT,
  model TEXT,
  attempt INTEGER,
  duration_ms INTEGER,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.verification_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category public.verification_category NOT NULL,
  status public.verification_status NOT NULL DEFAULT 'pending',
  verification_mode public.verification_mode NOT NULL DEFAULT 'manual',
  evidence_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, category)
);

CREATE TABLE IF NOT EXISTS public.case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  event_type text NOT NULL DEFAULT 'other',
  scheduled_at timestamptz NOT NULL,
  location text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('user', 'admin')),
  sender_user_id uuid REFERENCES auth.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intelligence_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The correction event this lesson was derived from. A lesson never
  -- exists without a real, applied case_finding_patches row behind it.
  source_patch_id uuid NOT NULL REFERENCES public.case_finding_patches(id) ON DELETE CASCADE,

  -- The finding this lesson concerns. finding_id is nullable (a "create"
  -- patch's lesson concerns the NEW finding, referenced via
  -- canonical_finding_id once assigned, not a prior finding). Never a raw
  -- row id alone: canonical_finding_id (see canonical-id.ts) is the
  -- rerun-stable identity a lesson should actually anchor to.
  finding_id uuid REFERENCES public.case_findings(id) ON DELETE SET NULL,
  canonical_finding_id text,

  -- Jurisdiction/matter-type scoping — required so cross-case pattern
  -- aggregation (future work) never mixes lessons across incompatible
  -- legal systems or practice areas. matter_type mirrors cases.case_type's
  -- existing taxonomy (practice-areas.ts); jurisdiction_country is
  -- explicit (not assumed) so this table is ready for non-Mexican matters
  -- without a schema change.
  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  jurisdiction_state text,

  error_type public.intelligence_error_type,
  original_claim text NOT NULL,
  corrected_claim text,
  reason text NOT NULL,

  -- Same shape as case_finding_patches' source_document_id/source_page/
  -- source_quote, generalized to an array since a lesson may cite more than
  -- one grounding reference.
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- legal_authorities.id values only — never authority text/body. See
  -- header comment: this table must never become a second, unaudited copy
  -- of legal content.
  authority_refs jsonb NOT NULL DEFAULT '[]'::jsonb,

  validation_status public.lesson_validation_status NOT NULL DEFAULT 'ai_supported',
  confidence numeric,

  -- Retrieval-effectiveness counters for future retrieval-relevance ranking
  -- (Phase B). All start at 0; nothing here is backfilled or estimated.
  times_retrieved integer NOT NULL DEFAULT 0,
  times_successful integer NOT NULL DEFAULT 0,
  times_rejected integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intelligence_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  jurisdiction_state text,
  error_type public.intelligence_error_type NOT NULL,

  -- Short, human-readable summary — generated deterministically from the
  -- bucket's own dimensions (matter_type/error_type), never an LLM
  -- narrative that could drift from what the counts actually show.
  pattern_description text NOT NULL,

  sample_size integer NOT NULL DEFAULT 0,
  verified_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  -- verified_count / sample_size, computed alongside the counts — a plain
  -- ratio of real numbers, never a model-asserted confidence score.
  confidence numeric,
  tier public.intelligence_pattern_tier NOT NULL DEFAULT 'insufficient_sample',
  status public.intelligence_pattern_status NOT NULL DEFAULT 'monitoring',

  -- Every intelligence_lessons.id this aggregation is currently built from
  -- — lets a UI (Phase D) or an audit trail walk from a pattern back to
  -- its exact source lessons, and lets recordLesson's follow-up
  -- upsertIntelligencePattern call recompute in place rather than
  -- guessing what changed.
  supporting_lesson_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  -- Distinct case_findings.category values seen among this bucket's
  -- supporting lessons, computed at aggregation time. This is the self-
  -- audit match basis (auditFindingAgainstPatterns): a live finding under
  -- review is checked against these real, previously-corrected categories
  -- — never an invented category-to-error_type mapping table.
  category_samples text[] NOT NULL DEFAULT '{}'::text[],

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_recomputed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, matter_type, jurisdiction_country, jurisdiction_state, error_type)
);

CREATE TABLE IF NOT EXISTS public.intelligence_validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  error_type public.intelligence_error_type NOT NULL,

  -- Only candidate/strong/significant are audit-eligible tiers (see
  -- patterns.server.ts's AUDIT_ELIGIBLE_TIERS) — a rule for
  -- insufficient_sample/emerging could never fire, so it's rejected here.
  escalate_at_tier public.intelligence_pattern_tier NOT NULL
    CHECK (escalate_at_tier IN ('candidate', 'strong', 'significant')),
  recommended_action public.intelligence_recommended_action NOT NULL,

  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL,
  superseded_by_rule_id uuid REFERENCES public.intelligence_validation_rules(id),
  source_proposal_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intelligence_improvement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  error_type public.intelligence_error_type NOT NULL,
  supporting_pattern_id uuid NOT NULL REFERENCES public.intelligence_patterns(id) ON DELETE CASCADE,

  -- Deterministically generated from the pattern's own real counts
  -- (mirrors patterns.server.ts's describePattern) — never an LLM
  -- narrative that could drift from what the data actually shows.
  problem text NOT NULL,
  observed_failure text NOT NULL,

  proposed_escalate_at_tier public.intelligence_pattern_tier NOT NULL
    CHECK (proposed_escalate_at_tier IN ('candidate', 'strong', 'significant')),
  proposed_recommended_action public.intelligence_recommended_action NOT NULL,

  status public.intelligence_proposal_status NOT NULL DEFAULT 'proposed',

  -- { findings_evaluated, findings_would_change_action, insufficient_data, evaluated_at }
  historical_replay jsonb,
  -- { invariant_holds, reason, checked_at }
  regression_check jsonb,

  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  deployed_version integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intelligence_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,

  proposal_id uuid REFERENCES public.intelligence_improvement_proposals(id),

  -- Exact rule diff this version deployed: { rule_id, matter_type,
  -- jurisdiction_country, error_type, old: {...} | null, new: {...} }.
  -- A historical snapshot, not a source of truth — the live rule set is
  -- always intelligence_validation_rules.is_active = true.
  changes jsonb NOT NULL,
  supporting_lesson_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  supporting_pattern_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],

  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  deployment_status public.intelligence_version_deployment_status NOT NULL DEFAULT 'deployed',
  -- Set on a rollback version: the version it reverses. Also settable on
  -- the ORIGINAL version once rolled back, pointing forward at the
  -- rollback — either direction is fine, proposals.server.ts documents
  -- which it writes.
  rollback_reference uuid REFERENCES public.intelligence_versions(id),

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, version)
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

create table if not exists public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mercadopago','stripe')),
  enabled boolean not null,
  actor_id uuid references auth.users(id),
  occurred_at timestamptz not null default now()
);

create table if not exists public.resource_service_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  code text not null,
  name_es text not null,
  name_en text not null,
  description_es text,
  description_en text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (org_id,code)
);

create table if not exists public.resource_verifications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.social_institutions(id) on delete cascade,
  org_id uuid references public.organizations(id),
  status text not null check(status in ('verified','verification_due','unverified','temporarily_unavailable','at_capacity','closed','archived')),
  source text not null,
  evidence_url text,
  notes text,
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now(),
  next_verification_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_corrections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.social_institutions(id) on delete cascade,
  org_id uuid references public.organizations(id),
  field_name text,
  suggested_value text,
  reason text not null,
  status text not null default 'pending' check(status in ('pending','accepted','rejected')),
  submitted_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_internal_experiences (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.social_institutions(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  outcome text,
  wait_time_notes text,
  accessibility_notes text,
  staff_notes text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resource_knowledge_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id),
  title_es text not null,
  title_en text not null,
  summary_es text,
  summary_en text,
  knowledge_type text not null check(knowledge_type in ('procedure','protocol','manual','form','legal_update','service_guide','institution_note')),
  service_categories text[] not null default '{}',
  state_codes text[] not null default '{}',
  municipality text,
  population_tags text[] not null default '{}',
  source_url text,
  document_path text,
  version integer not null default 1,
  approval_status text not null default 'draft' check(approval_status in ('draft','in_review','approved','retired')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  effective_at timestamptz,
  review_due_at timestamptz,
  internal_only boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resource_knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references public.resource_knowledge_records(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  change_summary text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(knowledge_id,version)
);

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

create table if not exists public.resource_knowledge_corrections (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references public.resource_knowledge_records(id) on delete cascade,
  org_id uuid references public.organizations(id),
  suggestion text not null,
  status text not null default 'pending' check(status in ('pending','accepted','rejected')),
  submitted_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_knowledge_case_actions (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references public.resource_knowledge_records(id),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  action_type text not null check(action_type in (
    'attach_reference','add_required_form','create_checklist','create_task','find_related_resources',
    'start_referral','share_client_version','ask_talk_to_case'
  )),
  details jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint resource_knowledge_not_evidence check(coalesce(details->>'legal_evidence','false')='false')
);

create table if not exists public.resource_knowledge_usage (
  id uuid primary key default gen_random_uuid(),
  knowledge_id uuid not null references public.resource_knowledge_records(id) on delete cascade,
  org_id uuid references public.organizations(id),
  action text not null check(action in ('open','download','case_action')),
  actor_id uuid not null references auth.users(id),
  social_case_id uuid references public.social_cases(id),
  created_at timestamptz not null default now()
);

create table if not exists public.social_care_action_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  assistant_run_id uuid references public.social_care_assistant_runs(id),
  action_type text not null check(action_type in (
    'create_task','add_to_care_plan','request_document','start_risk_reassessment',
    'find_resource','create_referral','schedule_follow_up','supervisor_review',
    'request_legal_review','draft_case_summary','prepare_closure_checklist'
  )),
  preview jsonb not null,
  status text not null default 'proposed' check(status in ('proposed','confirmed','cancelled')),
  proposed_by uuid not null references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

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

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in (
    'firm_manager','supervisor','case_worker','legal_provider',
    'psychosocial_provider','read_only'
  )),
  token_hash text not null unique,
  status text not null default 'invited'
    check (status in ('invited','accepted','revoked','expired')),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.organization_entitlements (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  subscription_id uuid references public.org_subscriptions(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id),
  status text not null default 'inactive'
    check(status in ('active','trialing','past_due','canceled','inactive')),
  owner_seats integer not null default 1 check(owner_seats>=1),
  employee_seats integer not null default 0 check(employee_seats>=0),
  total_user_limit integer not null default 1 check(total_user_limit>=1),
  case_limit integer,
  ai_requests_monthly integer,
  talk_to_case_monthly integer,
  monthly_document_pages integer,
  storage_limit_bytes bigint,
  max_upload_size_bytes bigint,
  byok_allowed boolean not null default true,
  feature_flags jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  updated_at timestamptz not null default now(),
  check(total_user_limit>=owner_seats+employee_seats)
);

create table if not exists public.organization_usage_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid references public.org_subscriptions(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  ai_requests_used bigint not null default 0,
  talk_to_case_used bigint not null default 0,
  document_pages_used bigint not null default 0,
  storage_bytes_used bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,period_start,period_end),
  check(period_end>period_start)
);

create table if not exists public.organization_usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  social_case_id uuid references public.social_cases(id) on delete set null,
  usage_type text not null,
  quantity bigint not null default 1 check(quantity>0),
  provider text,
  model text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique(org_id,idempotency_key)
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('stripe','mercadopago')),
  provider_event_id text not null,
  event_type text,
  verified boolean not null default false,
  processing_status text not null default 'received'
    check(processing_status in ('received','processed','ignored','failed')),
  user_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.organizations(id) on delete set null,
  provider_subscription_id text,
  payload_hash text,
  error_detail text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,provider_event_id)
);

create table if not exists public.social_case_status_history(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  social_case_id uuid not null references public.social_cases(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid not null references auth.users(id),
  reason text not null,
  changed_at timestamptz not null default now()
);

create table if not exists public.social_intakes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid not null references public.social_programs(id),
  intake_number text not null,
  person_id uuid not null references public.social_people(id),
  family_id uuid references public.social_families(id),
  source text not null default 'direct',
  status text not null default 'draft',
  disposition text not null default 'pending',
  summary text not null,
  presenting_needs text[] not null default '{}'::text[],
  assigned_to uuid references auth.users(id),
  duplicate_check_completed_at timestamptz,
  duplicate_check_completed_by uuid references auth.users(id),
  disposition_reason text,
  social_case_id uuid references public.social_cases(id),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, intake_number),
  check (source in ('direct','phone','email','walk_in','outreach','referral','emergency','other')),
  check (status in ('draft','under_review','completed','cancelled')),
  check (disposition in ('pending','open_case','refer_only','information_only','ineligible','duplicate','no_follow_up')),
  check (
    (status <> 'completed')
    or (
      disposition <> 'pending'
      and completed_at is not null
      and completed_by is not null
    )
  ),
  check (
    disposition <> 'open_case'
    or social_case_id is not null
  )
);

create table if not exists public.social_intakes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid not null references public.social_programs(id),
  intake_number text not null,
  person_id uuid not null references public.social_people(id),
  family_id uuid references public.social_families(id),
  source text not null default 'direct',
  status text not null default 'draft',
  disposition text not null default 'pending',
  summary text not null,
  presenting_needs text[] not null default '{}'::text[],
  assigned_to uuid references auth.users(id),
  duplicate_check_completed_at timestamptz,
  duplicate_check_completed_by uuid references auth.users(id),
  disposition_reason text,
  social_case_id uuid references public.social_cases(id),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, intake_number),
  check (source in ('direct','phone','email','walk_in','outreach','referral','emergency','other')),
  check (status in ('draft','under_review','completed','cancelled')),
  check (disposition in ('pending','open_case','refer_only','information_only','ineligible','duplicate','no_follow_up')),
  check (
    (status <> 'completed')
    or (
      disposition <> 'pending'
      and completed_at is not null
      and completed_by is not null
    )
  ),
  check (
    disposition <> 'open_case'
    or social_case_id is not null
  )
);

CREATE TABLE IF NOT EXISTS public.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('INC-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6)),
  discovered_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz,
  severity public.security_incident_severity NOT NULL DEFAULT 'medium',
  status public.security_incident_status NOT NULL DEFAULT 'open',
  category text NOT NULL DEFAULT 'other',
  title text NOT NULL,
  description text,
  affected_systems text[] NOT NULL DEFAULT '{}',
  potentially_affected_users integer,
  potentially_affected_user_ids uuid[] NOT NULL DEFAULT '{}',
  containment_status text NOT NULL DEFAULT 'not_started',
  containment_notes text,
  investigation_status text NOT NULL DEFAULT 'not_started',
  investigation_notes text,
  notification_required boolean NOT NULL DEFAULT false,
  notification_status text NOT NULL DEFAULT 'not_required',
  notification_notes text,
  resolved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.arco_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('ARCO-' || to_char(now(),'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6)),
  request_type public.arco_request_type NOT NULL,
  status public.arco_request_status NOT NULL DEFAULT 'received',
  requester_name text NOT NULL,
  requester_email text NOT NULL,
  requester_phone text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  identity_verification_status text NOT NULL DEFAULT 'pending',
  identity_verification_notes text,
  request_details text,
  response_deadline date NOT NULL DEFAULT (current_date + interval '20 days')::date,
  assigned_reviewer uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution text,
  resolution_notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arco_identity_status_check CHECK (
    identity_verification_status IN ('pending','requested','verified','failed','waived')
  )
);

CREATE TABLE IF NOT EXISTS public.arco_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.arco_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  notes text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

create table if not exists public.resource_official_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  official_name text not null,
  institution_type text not null,
  jurisdiction_level text not null default 'federal',
  state_code text,
  services text[] not null default '{}',
  coverage_levels text[] not null default '{national}',
  populations text[] not null default '{}',
  source_urls text[] not null,
  source_type text not null default 'official_website',
  allowed_domains text[] not null default '{}',
  website text,
  refresh_interval_days integer not null default 30,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_type in ('official_api','official_website','official_directory','approved_authoritative'))
);

create table if not exists public.resource_contact_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  institution_id uuid references public.social_institutions(id) on delete set null,
  status text not null,
  source_url text,
  fields_updated text[] not null default '{}',
  detail text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (status in ('updated','unchanged','skipped','failed'))
);

CREATE TABLE IF NOT EXISTS public.social_community_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  social_case_id UUID REFERENCES public.social_cases(id) ON DELETE CASCADE,
  campaign_scope TEXT NOT NULL DEFAULT 'individual_case' CHECK (campaign_scope IN ('individual_case', 'organization_wide')),
  public_slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  public_description TEXT NOT NULL,
  internal_need_details TEXT,
  support_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  public_identity_mode TEXT NOT NULL DEFAULT 'anonymous' CHECK (public_identity_mode IN ('anonymous', 'first_name_only', 'family_description', 'full_name')),
  public_display_name TEXT,
  location_display TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft', 'pending_approval', 'approved', 'published', 'paused', 'closed', 'rejected')),
  financial_fundraiser_provider TEXT DEFAULT 'gofundme',
  financial_fundraiser_url TEXT,
  financial_target_amount NUMERIC(12, 2),
  financial_currency TEXT NOT NULL DEFAULT 'MXN',
  financial_beneficiary_type TEXT DEFAULT 'organization' CHECK (financial_beneficiary_type IN ('organization', 'client_external')),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_community_support_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.social_community_campaigns(id) ON DELETE CASCADE,
  offer_type TEXT NOT NULL CHECK (offer_type IN ('goods', 'service', 'financial_pledge', 'other')),
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_description TEXT NOT NULL,
  quantity TEXT,
  donor_name TEXT NOT NULL,
  donor_email TEXT,
  donor_phone TEXT,
  delivery_method TEXT NOT NULL DEFAULT 'dropoff_organization' CHECK (delivery_method IN ('dropoff_organization', 'collection_point', 'arrange_pickup', 'contact_to_coordinate')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'accepted', 'scheduled', 'received', 'cancelled')),
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_audit_report_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_donation_identity_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'verification_started',
    'verification_completed',
    'verification_failed',
    'identity_document_replaced',
    'rfc_changed',
    'fundraiser_url_changed',
    'bank_destination_added',
    'bank_destination_changed',
    'financial_fundraising_enabled',
    'financial_fundraising_disabled'
  )),
  event_description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. TABLE ALTERATIONS & CONSTRAINTS

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS investigator_summary text,
  ADD COLUMN IF NOT EXISTS discovery_analysis text,
  ADD COLUMN IF NOT EXISTS procedural_issues_report text,
  ADD COLUMN IF NOT EXISTS prosecution_theory_report text,
  ADD COLUMN IF NOT EXISTS defense_theory_report text,
  ADD COLUMN IF NOT EXISTS alternative_theory_report text,
  ADD COLUMN IF NOT EXISTS risk_analysis text,
  ADD COLUMN IF NOT EXISTS score_breakdown text,
  ADD COLUMN IF NOT EXISTS appendix_sources text,
  ADD COLUMN IF NOT EXISTS full_report jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS citations jsonb,
  ADD COLUMN IF NOT EXISTS evidence_index jsonb,
  ADD COLUMN IF NOT EXISTS contradictions_struct jsonb,
  ADD COLUMN IF NOT EXISTS missing_evidence_struct jsonb,
  ADD COLUMN IF NOT EXISTS strategy_recommendations jsonb,
  ADD COLUMN IF NOT EXISTS cross_examination jsonb,
  ADD COLUMN IF NOT EXISTS constitutional_issues_struct jsonb,
  ADD COLUMN IF NOT EXISTS motion_opportunities jsonb,
  ADD COLUMN IF NOT EXISTS next_actions jsonb,
  ADD COLUMN IF NOT EXISTS case_strength_score integer,
  ADD COLUMN IF NOT EXISTS risk_score integer,
  ADD COLUMN IF NOT EXISTS intelligence_version text;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS shared_brief jsonb;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS shared_brief_at timestamptz;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS analysis_mode text NOT NULL DEFAULT 'strict'
  CHECK (analysis_mode IN ('strict','balanced','exploratory'));

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS finding_type text
  CHECK (finding_type IN ('DIRECT_EVIDENCE','EVIDENCE_BASED_INFERENCE','AI_THEORY'));

ALTER TABLE public.case_findings ADD COLUMN IF NOT EXISTS source_document_id uuid;

ALTER TABLE public.case_findings ADD COLUMN IF NOT EXISTS source_page integer;

ALTER TABLE public.case_findings ADD COLUMN IF NOT EXISTS source_quote text;

ALTER TABLE public.case_theories
  ADD COLUMN IF NOT EXISTS finding_type text
  CHECK (finding_type IN ('DIRECT_EVIDENCE','EVIDENCE_BASED_INFERENCE','AI_THEORY'));

ALTER TABLE public.case_theories ADD COLUMN IF NOT EXISTS citations jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.case_opportunities
  ADD COLUMN IF NOT EXISTS finding_type text
  CHECK (finding_type IN ('DIRECT_EVIDENCE','EVIDENCE_BASED_INFERENCE','AI_THEORY'));

ALTER TABLE public.case_opportunities ADD COLUMN IF NOT EXISTS citations jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.case_perspectives
  ADD COLUMN IF NOT EXISTS finding_type text
  CHECK (finding_type IN ('DIRECT_EVIDENCE','EVIDENCE_BASED_INFERENCE','AI_THEORY'));

ALTER TABLE public.case_witnesses
  ADD COLUMN IF NOT EXISTS finding_type text
  CHECK (finding_type IN ('DIRECT_EVIDENCE','EVIDENCE_BASED_INFERENCE','AI_THEORY'));

ALTER TABLE public.case_witnesses ADD COLUMN IF NOT EXISTS citations jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS case_type TEXT;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS discovery_at timestamptz,
  ADD COLUMN IF NOT EXISTS contradiction_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_product_at timestamptz;

ALTER TABLE public.case_work_product
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS generation_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS canonical_finding_id uuid,
  ADD COLUMN IF NOT EXISTS derived_from_finding_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS evidence_type text,
  ADD COLUMN IF NOT EXISTS impact_direction text,
  ADD COLUMN IF NOT EXISTS strategic_significance text,
  ADD COLUMN IF NOT EXISTS priority integer;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS attack_surface jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_providers
  ADD COLUMN IF NOT EXISTS api_key_encrypted text;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS pipeline_progress jsonb NOT NULL DEFAULT jsonb_build_object(
    'extraction','locked','analyzers','locked','agents','locked','evidence_intel','locked',
    'contradictions','locked','witness_intel','locked','discovery_gaps','locked',
    'theories','locked','strategy','locked','scoring','locked','report','locked'
  );

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS scores_suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motions_suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engines_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS voice_continuous BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_pitch TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS voice_accent TEXT NOT NULL DEFAULT 'us',
  ADD COLUMN IF NOT EXISTS voice_gender TEXT NOT NULL DEFAULT 'female';

ALTER TABLE public.user_groq_keys ADD COLUMN IF NOT EXISTS priority integer;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS additional_domains text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extraction_retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_extraction_attempt_at TIMESTAMPTZ;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS change_log jsonb;

ALTER TABLE public.report_versions
  ADD COLUMN IF NOT EXISTS triggering_upload_id uuid,
  ADD COLUMN IF NOT EXISTS document_count integer,
  ADD COLUMN IF NOT EXISTS findings_count integer,
  ADD COLUMN IF NOT EXISTS contradiction_count integer,
  ADD COLUMN IF NOT EXISTS ess numeric,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS report_hash text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS quality_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_block_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.agent_logs
  ADD COLUMN IF NOT EXISTS documents_analyzed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_generated INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_suppressed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_promoted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_produced INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_items INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_output_reason TEXT;

ALTER TABLE public.evidence_classifications
  ADD COLUMN IF NOT EXISTS supports_finding_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contradicts_finding_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS referenced_by_doc_ids      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_witness_ids         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_timeline_event_ids  jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES public.firms(id) ON DELETE SET NULL;

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES public.firms(id) ON DELETE SET NULL;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS worker_lease_until TIMESTAMPTZ;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS next_stage TEXT;

ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS groq_key_id uuid NULL;

ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_type_check;

ALTER TABLE public.ai_providers ADD CONSTRAINT ai_providers_provider_type_check
  CHECK (provider_type = ANY (ARRAY['groq','openrouter','openai','anthropic','gemini','lovable','ollama','lmstudio']));

ALTER TABLE public.cases DROP COLUMN IF EXISTS pipeline_progress;

ALTER TABLE public.case_findings
  ALTER COLUMN canonical_finding_id TYPE text
  USING canonical_finding_id::text;

ALTER TABLE public.pipeline_engine_runs
  ADD CONSTRAINT pipeline_engine_runs_status_check
  CHECK (status = ANY (ARRAY['queued','running','completed','failed','skipped','blocked']));

ALTER TABLE public.pipeline_engine_runs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS tokens_in integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_out integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS db_write_confirmed boolean,
  ADD COLUMN IF NOT EXISTS rows_written integer,
  ADD COLUMN IF NOT EXISTS parent_engine text,
  ADD COLUMN IF NOT EXISTS blocking_engines text[],
  ADD COLUMN IF NOT EXISTS dependency_status text;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS stall_reason text;

ALTER TABLE public.pipeline_engine_runs
  DROP CONSTRAINT IF EXISTS pipeline_engine_runs_status_check;

ALTER TABLE public.pipeline_engine_runs
  ADD CONSTRAINT pipeline_engine_runs_status_check
  CHECK (status = ANY (ARRAY['queued','running','completed','completed_negative','failed','skipped','blocked']));

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS attorney_summary text,
  ADD COLUMN IF NOT EXISTS evidence_summary text,
  ADD COLUMN IF NOT EXISTS timeline_summary text,
  ADD COLUMN IF NOT EXISTS contradiction_report text,
  ADD COLUMN IF NOT EXISTS recommendations text,
  ADD COLUMN IF NOT EXISTS investigator_summary text,
  ADD COLUMN IF NOT EXISTS case_overview text,
  ADD COLUMN IF NOT EXISTS facts text,
  ADD COLUMN IF NOT EXISTS witness_analysis text,
  ADD COLUMN IF NOT EXISTS constitutional_issues text,
  ADD COLUMN IF NOT EXISTS discovery_analysis text,
  ADD COLUMN IF NOT EXISTS procedural_issues_report text,
  ADD COLUMN IF NOT EXISTS prosecution_theory_report text,
  ADD COLUMN IF NOT EXISTS defense_theory_report text,
  ADD COLUMN IF NOT EXISTS alternative_theory_report text,
  ADD COLUMN IF NOT EXISTS risk_analysis text,
  ADD COLUMN IF NOT EXISTS score_breakdown text,
  ADD COLUMN IF NOT EXISTS appendix_sources text,
  ADD COLUMN IF NOT EXISTS quality_block_reasons jsonb;

ALTER TABLE public.cases ALTER COLUMN analysis_mode SET DEFAULT 'balanced';

ALTER TABLE public.user_ai_keys ADD COLUMN IF NOT EXISTS last_test_latency_ms INTEGER;

ALTER TABLE public.user_ai_keys ADD COLUMN IF NOT EXISTS last_test_error TEXT;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS strategy_center_at timestamptz;

ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_key TEXT CHECK (plan_key IN ('solo', 'firm', 'enterprise')),
  ADD COLUMN IF NOT EXISTS seat_limit INTEGER;

ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS included_seats integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS per_seat_price_cents integer,
  ADD COLUMN IF NOT EXISTS per_seat_stripe_price_id text,
  ADD COLUMN IF NOT EXISTS internal_notes text;

ALTER TABLE public.matter_documents
  ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processing_status public.doc_processing_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS classification JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checksum TEXT,
  ADD COLUMN IF NOT EXISTS media_kind TEXT;

ALTER TABLE public.user_ai_keys
  ADD COLUMN IF NOT EXISTS priority integer,
  ADD COLUMN IF NOT EXISTS calls_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calls_month integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_month integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_date date,
  ADD COLUMN IF NOT EXISTS usage_month text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'es'
  CHECK (preferred_language IN ('es', 'en'));

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS case_language text
  CHECK (case_language IN ('es', 'en')),
  ADD COLUMN IF NOT EXISTS report_language text NOT NULL DEFAULT 'es'
  CHECK (report_language IN ('es', 'en'));

ALTER TABLE public.case_chat_messages
  ADD COLUMN IF NOT EXISTS message_language text
  CHECK (message_language IN ('es', 'en'));

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS generated_language text NOT NULL DEFAULT 'es'
  CHECK (generated_language IN ('es', 'en'));

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS case_language text
  CHECK (case_language IN ('es', 'en')),
  ADD COLUMN IF NOT EXISTS report_language text NOT NULL DEFAULT 'es'
  CHECK (report_language IN ('es', 'en'));

ALTER TABLE public.case_chat_messages
  ADD COLUMN IF NOT EXISTS message_language text
  CHECK (message_language IN ('es', 'en'));

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS generated_language text NOT NULL DEFAULT 'es'
  CHECK (generated_language IN ('es', 'en'));

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS extraction_report jsonb;

ALTER TABLE public.billing_plans DROP COLUMN internal_notes;

ALTER TABLE public.case_trial_prep ADD COLUMN IF NOT EXISTS penal_metrics jsonb;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_index jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS constitutional_issues_struct jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS motion_opportunities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cross_examination jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS strategy_recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS item_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS intelligence_version text;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS jurisdiction_profile jsonb,
  ADD COLUMN IF NOT EXISTS procedural_compliance jsonb,
  ADD COLUMN IF NOT EXISTS legal_qa_report jsonb;

ALTER TABLE public.legal_authorities
  ADD COLUMN IF NOT EXISTS verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repealed_at date,
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid REFERENCES public.legal_authorities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connector_code text;

ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_type_check;

ALTER TABLE public.ai_providers ADD CONSTRAINT ai_providers_provider_type_check
  CHECK (provider_type = ANY (ARRAY['groq','openrouter','openai','anthropic','gemini','ollama','lmstudio']));

ALTER TABLE public.legal_authorities
  ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE public.legal_authority_versions
  ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_type_check;

ALTER TABLE public.ai_providers ADD CONSTRAINT ai_providers_provider_type_check
  CHECK (provider_type = ANY (ARRAY['groq','openrouter','openai','anthropic','gemini','ollama','lmstudio']));

ALTER TABLE public.case_perspectives DROP CONSTRAINT IF EXISTS case_perspectives_perspective_check;

ALTER TABLE public.case_perspectives ADD CONSTRAINT case_perspectives_perspective_check
  CHECK (perspective = ANY (ARRAY[
    'ministerio_publico','defensa','juzgador','independiente',
    'quejoso','autoridad_responsable','parte_actora','parte_demandada',
    'victima','tercero_interesado',
    'defense','prosecution','plaintiff','respondent','appellate','jury','independent'
  ]));

ALTER TABLE public.case_work_product
  ADD CONSTRAINT case_work_product_case_doctype_key
  UNIQUE (case_id, document_type);

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS report_checkpoint_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_finding_status_check
  CHECK (finding_status IN ('candidate','verified','disputed','suppressed','promoted'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_authority_level_check
  CHECK (authority_level BETWEEN 0 AND 5);

ALTER TABLE public.report_versions  ADD COLUMN IF NOT EXISTS canonical_version integer;

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS matter_metadata jsonb;

ALTER TABLE public.case_domain_activations DROP CONSTRAINT IF EXISTS case_domain_activations_source_check;

ALTER TABLE public.case_domain_activations ADD CONSTRAINT case_domain_activations_source_check CHECK (source = ANY (ARRAY['user'::text, 'hybrid'::text, 'evidence'::text, 'charging_docs'::text]));

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS execution_id uuid;

ALTER TABLE public.case_tasks
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] NOT NULL DEFAULT ARRAY['browser']::TEXT[],
  ADD COLUMN IF NOT EXISTS reminder_fired_at TIMESTAMPTZ;

ALTER TABLE public.case_events
  ADD CONSTRAINT case_events_reminder_channels_check
  CHECK (reminder_channels <@ ARRAY['browser','email']::TEXT[]);

ALTER TABLE public.case_tasks DROP CONSTRAINT IF EXISTS case_tasks_reminder_channels_check;

ALTER TABLE public.case_tasks
  ADD CONSTRAINT case_tasks_reminder_channels_check
  CHECK (reminder_channels <@ ARRAY['browser','email']::TEXT[]);

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_speaker_role_check
    CHECK (speaker_role IS NULL OR speaker_role IN ('quejoso', 'autoridad', 'tribunal_colegiado', 'tribunal_local', 'scjn'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_proposition_type_check
    CHECK (proposition_type IS NULL OR proposition_type IN ('argument', 'holding', 'rejected_holding', 'procedural_fact', 'evidence', 'issue'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_adoption_status_check
    CHECK (adoption_status IS NULL OR adoption_status IN ('adopted', 'rejected', 'unresolved', 'historical'));

ALTER TABLE public.cases
  ADD CONSTRAINT cases_case_analysis_mode_check
    CHECK (case_analysis_mode IN ('ongoing', 'concluded_audit', 'judgment_audit', 'appeal_routes'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_audit_classification_check
    CHECK (
      audit_classification IS NULL OR audit_classification IN (
        'VERIFIED_FACT',
        'VERIFIED_COURT_HOLDING',
        'VERIFIED_LEGAL_RULE',
        'SUPPORTED_INFERENCE',
        'POTENTIAL_ISSUE',
        'EVIDENCE_GAP',
        'NOT_FOUND'
      )
    );

ALTER TABLE public.case_outcome_assessments
  ADD CONSTRAINT case_outcome_assessments_outcome_status_check
    CHECK (outcome_status IN ('ESTIMATED', 'INSUFFICIENT_DATA'));

ALTER TABLE public.cases
  ADD CONSTRAINT cases_case_type_source_check
    CHECK (case_type_source IS NULL OR case_type_source IN (
      'source_confirmed', 'manual_override', 'manual_override_conflicting', 'heuristic', 'unresolved'
    ));

ALTER TABLE public.cases
  ADD CONSTRAINT cases_case_type_verification_status_check
    CHECK (case_type_verification_status IS NULL OR case_type_verification_status IN (
      'CONFIRMED', 'INSUFFICIENT_DATA', 'CONFLICT'
    ));

ALTER TABLE public.documents
  ADD CONSTRAINT documents_evidence_scope_check
  CHECK (evidence_scope IN ('case_corpus', 'revision_context'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_lifecycle_status_check
  CHECK (
    lifecycle_status IS NULL OR lifecycle_status IN (
      'discovered',
      'supported',
      'verified',
      'active',
      'challenged',
      'corrected',
      'superseded',
      'rejected',
      'corroborated'
    )
  );

ALTER TABLE public.documents
  ADD CONSTRAINT documents_purpose_check
  CHECK (
    purpose IS NULL OR purpose IN (
      'case_evidence',
      'correction_support',
      'finding_correction',
      'report_correction',
      'context_only',
      'user_instruction',
      'counter_evidence',
      'duplicate',
      'irrelevant'
    )
  );

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_evidence_relationship_check
  CHECK (
    evidence_relationship IS NULL OR evidence_relationship IN (
      'SOURCE_HOLDING',
      'SOURCE_FACT',
      'SOURCE_ARGUMENT',
      'DERIVED_INFERENCE',
      'UNPROVEN_ABSENCE',
      'MISSING_EVIDENCE'
    )
  );

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS stall_auto_retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS starter_cases_seeded_at timestamptz NULL;

alter table public.case_findings
  drop constraint if exists case_findings_reconciliation_state_check;

alter table public.case_findings
  add constraint case_findings_reconciliation_state_check
  check (
    reconciliation_state is null
    or reconciliation_state in (
      'new',
      'duplicate',
      'supporting',
      'conflicting',
      'unresolved',
      'amended',
      'rejected'
    )
  );

alter table public.case_finding_patches
  add constraint case_finding_patches_action_check
  check (action in ('keep', 'amend', 'remove', 'merge', 'create', 'dispute_evidence'));

alter table public.cases
  drop constraint if exists cases_analysis_mode_check;

alter table public.cases
  alter column analysis_mode set default 'balanced';

alter table public.user_intelligence_features
  alter column mode set default 'balanced';

alter table public.cases
  alter column analysis_mode set default 'balanced';

alter table public.cases
  add constraint cases_analysis_mode_unified_check
  check (analysis_mode = 'balanced');

alter table public.social_indicator_snapshots
  add column if not exists definition_id uuid references public.social_indicator_definitions(id);

alter table public.social_programs add column if not exists name_en text;

alter table public.social_programs alter column name_es set not null;

alter table public.social_programs alter column name_en set not null;

alter table public.social_referrals drop constraint if exists social_referrals_status_check;

alter table public.social_referrals add constraint social_referrals_status_check check(status in
 ('draft','awaiting_consent','sent','received','appointment_scheduled','in_progress','service_in_progress','completed','rejected','unable_to_contact','cancelled'));

alter table public.resource_knowledge_records drop constraint if exists resource_knowledge_records_approval_status_check;

alter table public.resource_knowledge_records add constraint resource_knowledge_records_approval_status_check
  check(approval_status in ('draft','pending_review','approved','published','revision_required','expired','archived'));

alter table public.resource_knowledge_records drop constraint if exists resource_knowledge_records_knowledge_type_check;

alter table public.resource_knowledge_records add constraint resource_knowledge_records_knowledge_type_check
  check(knowledge_type in (
    'procedure','protocol','intake_manual','risk_guidance','care_plan_instruction','consent_template',
    'referral_instruction','emergency_procedure','immigration_guidance','state_municipal_guidance',
    'official_form','training_material','document_checklist','legal_update','institutional_policy','faq',
    'manual','form','service_guide','institution_note'
  ));

alter table public.resource_knowledge_records add constraint resource_knowledge_records_audience_check
  check(audience in ('internal_staff','official_government','client_facing','case_evidence_reference'));

alter table public.org_subscriptions
  add column if not exists provider_customer_id text,
  add column if not exists billing_interval text not null default 'month',
  add column if not exists currency text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists grace_period_ends_at timestamptz,
  add column if not exists primary_subscription boolean not null default true;

alter table public.social_cases alter column priority set default 'standard';

alter table public.social_cases add constraint social_cases_priority_check
  check(priority in ('standard','urgent','emergency'));

alter table public.organization_invitations
  add column if not exists invitee_name text,
  add column if not exists invitee_title text;

alter table public.social_case_status_history
  drop constraint if exists social_case_status_history_change_kind_check;

alter table public.social_case_status_history
  add constraint social_case_status_history_change_kind_check
  check (change_kind in ('status','priority','status_and_priority','created','reopened','closed','transferred'));

alter table public.social_case_status_history
  drop constraint if exists social_case_status_history_priority_check;

alter table public.social_case_status_history
  add constraint social_case_status_history_priority_check
  check (
    (from_priority is null or from_priority in ('standard','urgent','emergency'))
    and (to_priority is null or to_priority in ('standard','urgent','emergency'))
  );

alter table public.social_care_plan_versions
  disable trigger immutable_social_care_plan_versions;

alter table public.social_consent_versions
  disable trigger immutable_social_consent_versions;

alter table public.social_document_versions
  disable trigger immutable_social_document_versions;

alter table public.social_assessment_versions
  enable trigger immutable_social_assessment_versions;

alter table public.social_care_plan_versions
  enable trigger immutable_social_care_plan_versions;

alter table public.social_consent_versions
  enable trigger immutable_social_consent_versions;

alter table public.social_document_versions
  enable trigger immutable_social_document_versions;

alter table public.social_cases
  add column if not exists deleted_by uuid references auth.users(id),
  add column if not exists deletion_reason text;

ALTER TABLE public.case_findings
  DROP CONSTRAINT IF EXISTS case_findings_speaker_role_check,
  DROP CONSTRAINT IF EXISTS case_findings_proposition_type_check,
  DROP CONSTRAINT IF EXISTS case_findings_adoption_status_check,
  DROP CONSTRAINT IF EXISTS case_findings_benefited_party_check;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_speaker_role_check CHECK (
    speaker_role IS NULL OR speaker_role IN (
      'quejoso', 'tercero_interesado', 'autoridad', 'ministerio_publico', 'fiscal', 'defensa',
      'imputado', 'acusado', 'sentenciado', 'victima', 'ofendido',
      'testigo', 'perito', 'juez_control', 'tribunal_enjuiciamiento',
      'tribunal_alzada', 'tribunal_colegiado', 'tribunal_local', 'scjn'
    )
  ),
  ADD CONSTRAINT case_findings_proposition_type_check CHECK (
    proposition_type IS NULL OR proposition_type IN (
      'argument', 'holding', 'procedural_fact', 'evidence', 'issue',
      'case_fact', 'allegation', 'party_argument', 'prosecution_position',
      'defense_position', 'victim_position', 'witness_statement',
      'expert_opinion', 'physical_evidence', 'documentary_evidence',
      'digital_evidence', 'legal_rule', 'court_holding',
      'rejected_holding', 'procedural_event', 'evidence_gap', 'risk',
      'unresolved_question'
    )
  ),
  ADD CONSTRAINT case_findings_adoption_status_check CHECK (
    adoption_status IS NULL OR adoption_status IN (
      'adopted', 'rejected', 'not_reached', 'party_position', 'historical',
      'unknown', 'unresolved'
    )
  ),
  ADD CONSTRAINT case_findings_benefited_party_check CHECK (
    benefited_party IS NULL OR benefited_party IN (
      'defense', 'prosecution', 'both', 'neutral'
    )
  );

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_underlying_materia_check,
  DROP CONSTRAINT IF EXISTS cases_procedural_vehicle_nonempty_check;

ALTER TABLE public.cases
  ADD CONSTRAINT cases_underlying_materia_check CHECK (
    underlying_materia IS NULL OR underlying_materia IN (
      'penal', 'civil', 'mercantil', 'familiar', 'laboral',
      'administrativo', 'fiscal', 'amparo', 'electoral', 'agrario',
      'constitucional', 'inmobiliario', 'ambiental', 'migratorio',
      'propiedad_intelectual', 'competencia_economica',
      'responsabilidad_medica'
    )
  ),
  ADD CONSTRAINT cases_procedural_vehicle_nonempty_check CHECK (
    procedural_vehicle IS NULL OR length(btrim(procedural_vehicle)) > 0
  );

ALTER TABLE public.case_classification_evidence
  DROP CONSTRAINT IF EXISTS case_classification_evidence_field_check;

ALTER TABLE public.case_classification_evidence
  ADD CONSTRAINT case_classification_evidence_field_check CHECK (
    field IN (
      'case_type', 'proceeding_type', 'procedural_vehicle',
      'underlying_materia', 'jurisdiction', 'matter', 'procedural_stage',
      'expediente_number', 'court', 'parties', 'concluded_status'
    )
  );

ALTER TABLE public.case_timeline_events
  DROP CONSTRAINT IF EXISTS case_timeline_events_event_type_check;

ALTER TABLE public.case_timeline_events
  ADD CONSTRAINT case_timeline_events_event_type_check CHECK (
    event_type IN (
      'case_event', 'authority_date', 'legislative_history',
      'background_reference', 'unknown'
    )
  );

alter table public.social_referrals add column if not exists notes text;

alter table public.social_institutions
  add column if not exists source_slug text,
  add column if not exists source_url text,
  add column if not exists source_type text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists contact_verification text not null default 'unverified',
  add column if not exists source_verified_fields text[] not null default '{}',
  add column if not exists admin_locked_fields text[] not null default '{}';

ALTER TABLE public.resource_knowledge_records ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.resource_knowledge_case_actions DROP CONSTRAINT IF EXISTS resource_knowledge_case_actions_action_type_check;

ALTER TABLE public.resource_knowledge_case_actions ADD CONSTRAINT resource_knowledge_case_actions_action_type_check CHECK (action_type = ANY (ARRAY['attach_reference','add_required_form','create_checklist','create_task','find_related_resources','start_referral','share_client_version','ask_talk_to_case','add_to_case_work']));

ALTER TABLE public.case_theories
  ADD COLUMN IF NOT EXISTS theory_name text,
  ADD COLUMN IF NOT EXISTS execution_id uuid;

-- 5. OTHER DDL & DATA SEEDS

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;

GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;

GRANT ALL ON public.user_settings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;

GRANT ALL ON public.cases TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;

GRANT ALL ON public.documents TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyses TO authenticated;

GRANT ALL ON public.analyses TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;

GRANT ALL ON public.reports TO service_role;

GRANT SELECT, INSERT ON public.ai_usage TO authenticated;

GRANT ALL ON public.ai_usage TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_findings TO authenticated;

GRANT ALL ON public.case_findings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_theories TO authenticated;

GRANT ALL ON public.case_theories TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_opportunities TO authenticated;

GRANT ALL ON public.case_opportunities TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_witnesses TO authenticated;

GRANT ALL ON public.case_witnesses TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_chat_messages TO authenticated;

GRANT ALL ON public.case_chat_messages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_trial_prep TO authenticated;

GRANT ALL ON public.case_trial_prep TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_work_product TO authenticated;

GRANT ALL ON public.case_work_product TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tg_reports_updated_at') THEN
    CREATE TRIGGER tg_reports_updated_at BEFORE UPDATE ON public.reports
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'intelligence_running';

ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'intelligence_complete';

REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_findings TO authenticated;

GRANT ALL ON public.agent_findings TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_findings'
      AND policyname = 'users insert own agent_findings'
  ) THEN
    CREATE POLICY "users insert own agent_findings"
      ON public.agent_findings
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_findings'
      AND policyname = 'users update own agent_findings'
  ) THEN
    CREATE POLICY "users update own agent_findings"
      ON public.agent_findings
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
      WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_findings'
      AND policyname = 'users delete own agent_findings'
  ) THEN
    CREATE POLICY "users delete own agent_findings"
      ON public.agent_findings
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_scores TO authenticated;

GRANT ALL ON public.case_scores TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_scores'
      AND policyname = 'users insert own case_scores'
  ) THEN
    CREATE POLICY "users insert own case_scores"
      ON public.case_scores
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_scores'
      AND policyname = 'users update own case_scores'
  ) THEN
    CREATE POLICY "users update own case_scores"
      ON public.case_scores
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
      WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_scores'
      AND policyname = 'users delete own case_scores'
  ) THEN
    CREATE POLICY "users delete own case_scores"
      ON public.case_scores
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'cancelled';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_perspectives TO authenticated;

GRANT ALL ON public.case_perspectives TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_classifications TO authenticated;

GRANT ALL ON public.evidence_classifications TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_strategy TO authenticated;

GRANT ALL ON public.case_strategy TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_groq_keys TO authenticated;

GRANT ALL ON public.user_groq_keys TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_providers TO authenticated;

GRANT ALL ON public.ai_providers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_task_routing TO authenticated;

GRANT ALL ON public.ai_task_routing TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

GRANT SELECT ON public.agent_configs TO authenticated;

GRANT ALL ON public.agent_configs TO service_role;

DROP POLICY IF EXISTS "agent_configs read all auth" ON public.agent_configs;

DROP POLICY IF EXISTS "agent_configs admin write" ON public.agent_configs;

DROP TRIGGER IF EXISTS agent_configs_updated ON public.agent_configs;

INSERT INTO public.agent_configs (agent_key, display_name, run_order) VALUES
  ('extraction','Extraction Engine',1),
  ('analyzers','Analyzer Engine',2),
  ('agents','Agent Engine',3),
  ('evidence_intel','Evidence Intelligence',4),
  ('contradictions','Contradiction Engine',5),
  ('witness_intel','Witness Intelligence',6),
  ('discovery_gaps','Discovery Gap Engine',7),
  ('theories','Theory Generation',8),
  ('strategy','Strategy Synthesis',9),
  ('scoring','Scoring Engine',10),
  ('report','Report Generator',11)
ON CONFLICT (agent_key) DO NOTHING;

GRANT SELECT ON public.pipeline_events TO authenticated;

GRANT ALL ON public.pipeline_events TO service_role;

DROP POLICY IF EXISTS "pipeline_events read by case owner" ON public.pipeline_events;

GRANT SELECT ON public.feature_flags TO authenticated;

GRANT ALL ON public.feature_flags TO service_role;

DROP POLICY IF EXISTS "feature_flags read all auth" ON public.feature_flags;

DROP POLICY IF EXISTS "feature_flags admin write" ON public.feature_flags;

DROP TRIGGER IF EXISTS feature_flags_updated ON public.feature_flags;

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('intelligence_map', true,  'Interactive intelligence-map graph on case page'),
  ('live_feed',        true,  'Live processing feed on desktop'),
  ('ask_nyrava',       true,  'Floating Ask Nyrava button on mobile')
ON CONFLICT (key) DO NOTHING;

GRANT SELECT ON public.admin_audit_log TO authenticated;

GRANT ALL ON public.admin_audit_log TO service_role;

DROP POLICY IF EXISTS "admin_audit_log admin read" ON public.admin_audit_log;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;

GRANT USAGE ON SCHEMA private TO authenticated;

GRANT USAGE ON SCHEMA private TO service_role;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM anon;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO service_role;

DO $$
DECLARE
  pol record;
  new_qual text;
  new_check text;
  stmt text;
BEGIN
  FOR pol IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname,
      pg_get_expr(p.polqual, p.polrelid) AS qual,
      pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        pg_get_expr(p.polqual, p.polrelid) LIKE '%has_role(%'
        OR pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%has_role(%'
      )
  LOOP
    new_qual := CASE
      WHEN pol.qual IS NULL THEN NULL
      ELSE replace(
        regexp_replace(
          regexp_replace(pol.qual, 'public\.has_role\s*\(', 'private.has_role(', 'g'),
          '(^|[^[:alnum:]_.])has_role\s*\(',
          '\1private.has_role(',
          'g'
        ),
        '::app_role',
        '::public.app_role'
      )
    END;

    new_check := CASE
      WHEN pol.with_check IS NULL THEN NULL
      ELSE replace(
        regexp_replace(
          regexp_replace(pol.with_check, 'public\.has_role\s*\(', 'private.has_role(', 'g'),
          '(^|[^[:alnum:]_.])has_role\s*\(',
          '\1private.has_role(',
          'g'
        ),
        '::app_role',
        '::public.app_role'
      )
    END;

    stmt := format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    IF new_qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF new_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;
    EXECUTE stmt;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_pages TO authenticated;

GRANT ALL ON public.document_pages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_engine_runs TO authenticated;

GRANT ALL ON public.pipeline_engine_runs TO service_role;

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;

GRANT ALL ON public.user_settings TO service_role;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'firm_admin';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'case_manager';

UPDATE public.ai_providers SET enabled = false WHERE provider_type <> 'groq';

UPDATE public.ai_providers SET enabled = true, priority = 1 WHERE provider_type = 'groq';

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.is_case_manager(uuid) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.is_admin_tier(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_admin_tier(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON public.pipeline_events TO authenticated;

GRANT ALL ON public.pipeline_events TO service_role;

DROP POLICY IF EXISTS "pipeline_events insert by case owner" ON public.pipeline_events;

DROP POLICY IF EXISTS "pipeline_events read by case owner" ON public.pipeline_events;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_engine_runs TO authenticated;

GRANT ALL ON public.pipeline_engine_runs TO service_role;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.is_admin_tier(uuid) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.is_case_manager(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_admin_tier(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO authenticated, service_role;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY is_active DESC, created_at ASC) AS rn
  FROM public.user_groq_keys
)
UPDATE public.user_groq_keys k SET priority = ranked.rn FROM ranked WHERE ranked.id = k.id AND k.priority IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_domain_activations TO authenticated;

GRANT ALL ON public.case_domain_activations TO service_role;

DROP POLICY IF EXISTS "owners read activations" ON public.case_domain_activations;

DROP POLICY IF EXISTS "owners write activations" ON public.case_domain_activations;

UPDATE public.cases
   SET name = 'routing_benchmark_general_civil',
       description = COALESCE(description || E'\n\n', '') ||
         '[Fixture tier: routing benchmark. One-line placeholder documents. ' ||
         'Use for case-type routing and Release Gate checks only. For ' ||
         'evidence-depth checks, load tests/fixtures/corpora/general_civil/ ' ||
         'via loadCorpus().]'
 WHERE id = '24ace00e-e1bc-4fdb-aaa3-300478c44321'
   AND name = 'general civil';

/*
# Add document extraction control columns

1. New Columns on `documents` table
- `extraction_retry_count` (integer, default 0): Tracks how many times extraction has been retried for a failed document. Prevents infinite retry loops.
- `last_extraction_attempt_at` (timestamptz, nullable): When the most recent extraction attempt occurred. Used for rate-limiting retries.

2. Indexes
- `idx_documents_case_status`: Composite index on (case_id, status) for fast filtering of documents by case and extraction state.
- `idx_documents_content_hash`: Index on content_hash for fast duplicate detection during upload.

3. Security
- No RLS changes — existing policies on documents table remain in effect.
*/

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS extraction_retry_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_extraction_attempt_at timestamptz;

/*
# Secure has_role RPC endpoint

The `public.has_role(_user_id uuid, _role public.app_role)` function is a `SECURITY DEFINER`
function used internally by RLS policies to check whether a user has a given role (e.g. `admin`).
Because it is `SECURITY DEFINER`, it runs with elevated privileges. It was previously executable
by `anon` and `authenticated` roles via the PostgREST `/rest/v1/rpc/has_role` endpoint, which
allowed any client to probe role membership.

This migration revokes `EXECUTE` on the function from both `anon` and `authenticated` roles.
The function will continue to work inside RLS policies because those execute within the database
engine's policy evaluation context, not via the PostgREST RPC layer.

1. Security changes
- Revoke `EXECUTE` on `public.has_role` from `anon`.
- Revoke `EXECUTE` on `public.has_role` from `authenticated`.
*/

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

GRANT SELECT ON public.audit_logs TO authenticated;

GRANT ALL ON public.audit_logs TO service_role;

DROP POLICY IF EXISTS "service inserts audit logs" ON public.audit_logs;

REVOKE INSERT ON public.audit_logs FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_versions TO authenticated;

GRANT ALL ON public.report_versions TO service_role;

REVOKE UPDATE, DELETE ON public.report_versions FROM authenticated;

GRANT SELECT, INSERT ON public.report_versions TO authenticated;

GRANT ALL ON public.report_versions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_logs TO authenticated;

GRANT ALL ON public.agent_logs TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin_tier(uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.is_case_manager(uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

GRANT EXECUTE ON FUNCTION public.is_admin_tier(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin_tier(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

ALTER FUNCTION public.has_role(uuid, public.app_role) SECURITY DEFINER;

ALTER FUNCTION public.is_admin_tier(uuid) SECURITY DEFINER;

ALTER FUNCTION public.is_case_manager(uuid) SECURITY DEFINER;

ALTER FUNCTION public.is_super_admin(uuid) SECURITY DEFINER;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public;

ALTER FUNCTION public.is_admin_tier(uuid) SET search_path = public;

ALTER FUNCTION public.is_case_manager(uuid) SET search_path = public;

ALTER FUNCTION public.is_super_admin(uuid) SET search_path = public;

GRANT SELECT, INSERT, UPDATE ON public.case_timeline_events TO authenticated;

GRANT ALL ON public.case_timeline_events TO service_role;

GRANT SELECT, INSERT ON public.image_intelligence TO authenticated;

GRANT ALL ON public.image_intelligence TO service_role;

GRANT SELECT ON public.firms TO authenticated;

GRANT ALL ON public.firms TO service_role;

DROP POLICY IF EXISTS firms_read ON public.firms;

DROP POLICY IF EXISTS firms_admin_write ON public.firms;

DROP TRIGGER IF EXISTS firms_set_updated_at ON public.firms;

DROP TRIGGER IF EXISTS cases_stamp_firm ON public.cases;

REVOKE ALL ON public.worker_secrets FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.worker_secrets TO service_role;

REVOKE EXECUTE ON FUNCTION public.same_firm(uuid, uuid) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.tg_stamp_case_firm() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.resolve_firm_for_email(text) TO service_role;

GRANT EXECUTE ON FUNCTION public.tg_stamp_case_firm() TO service_role;

GRANT ALL ON public.worker_secrets TO service_role;

COMMENT ON TABLE public.worker_secrets IS 'Server-only secrets. Access via service_role only. Any additional policy MUST be admin-scoped; never grant broad authenticated access.';

DROP TRIGGER IF EXISTS protect_user_settings_firm_id ON public.user_settings;

REVOKE EXECUTE ON FUNCTION public.tg_protect_user_settings_firm_id() FROM PUBLIC, anon;

INSERT INTO public.ai_providers (provider_type, display_name, enabled, priority, base_url, default_model, secret_name)
SELECT 'lovable', 'Lovable AI Gateway (Gemini)', true, 10, 'https://ai.gateway.lovable.dev/v1', 'google/gemini-2.5-flash', 'LOVABLE_API_KEY'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_providers WHERE provider_type = 'lovable');

INSERT INTO public.ai_providers (provider_type, display_name, enabled, priority, base_url, default_model, secret_name)
SELECT 'gemini', 'Google Gemini', true, 15, 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.0-flash', 'GEMINI_API_KEY'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_providers WHERE provider_type = 'gemini');

UPDATE public.ai_providers SET enabled = false WHERE provider_type = 'openrouter';

DROP TRIGGER IF EXISTS protect_user_settings_firm_id ON public.user_settings;

REVOKE UPDATE (firm_id) ON public.user_settings FROM authenticated;

COMMENT ON COLUMN public.case_findings.canonical_finding_id IS
  'Stable post-merge finding identity, format cf_<fnv1a-hash>. Text, not UUID — see src/lib/intelligence/canonical-id.ts.';

COMMENT ON COLUMN public.case_findings.canonical_finding_id IS
  'Stable post-merge finding identity, format cf_<fnv1a-hash>. Text, not UUID — see src/lib/intelligence/canonical-id.ts.';

UPDATE public.ai_providers
SET default_model = 'deepseek/deepseek-chat-v3:free'
WHERE provider_type = 'openrouter'
  AND default_model = 'deepseek/deepseek-chat-v3';

DO $$ BEGIN
  ALTER TABLE public.pipeline_engine_runs REPLICA IDENTITY FULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.documents REPLICA IDENTITY FULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.agent_logs REPLICA IDENTITY FULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.cases REPLICA IDENTITY FULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_engine_runs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_logs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.cases;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'queued';

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'released';

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'needs_revision';

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'stalled';

DROP TABLE IF EXISTS public.reports CASCADE;

GRANT SELECT ON public.canonical_analysis TO authenticated;

GRANT ALL ON public.canonical_analysis TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_keys TO authenticated;

GRANT ALL ON public.user_ai_keys TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;

GRANT ALL ON public.reports TO service_role;

GRANT SELECT, INSERT ON public.report_versions TO authenticated;

GRANT ALL ON public.report_versions TO service_role;

REVOKE EXECUTE ON FUNCTION public.tg_mirror_reports_to_canonical() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tg_mirror_reports_to_canonical() TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_motion_drafts TO authenticated;

GRANT ALL ON public.case_motion_drafts TO service_role;

COMMENT ON COLUMN public.case_trial_prep.case_type IS
  'Practice area (see PracticeArea in practice-areas.ts) active when this trial prep / jury simulation was generated. Drives whether jury_conviction_pct/jury_acquittal_pct (criminal) or civil_metrics (civil) is populated.';

COMMENT ON COLUMN public.case_trial_prep.civil_metrics IS
  'Civil-track jury simulation metrics: { plaintiff_success_pct, defense_success_pct, settlement_probability_pct, comparative_fault_estimate_pct }. Null for criminal-track cases, which use jury_conviction_pct/jury_acquittal_pct/jury_appeal_pct instead.';

GRANT SELECT ON public.subscriptions TO authenticated;

GRANT ALL ON public.subscriptions TO service_role;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;

COMMENT ON TABLE public.subscriptions IS
  'One row per user: Stripe customer/subscription linkage, plan/status, and one-time free-case allowance. Status/plan written only by Stripe webhook (service_role); free_case_used written only by billing.functions.ts (service_role, scoped to verified caller).';

GRANT SELECT ON public.billing_plans TO anon;

GRANT SELECT ON public.billing_plans TO authenticated;

GRANT ALL ON public.billing_plans TO service_role;

COMMENT ON COLUMN public.subscriptions.is_beta_tester IS
  'Grants full billing access with no Stripe subscription and no free-case limit. Written only via admin beta-tester endpoints (service_role), gated by is_admin_tier/is_super_admin.';

GRANT SELECT ON public.webhook_events TO authenticated;

GRANT ALL ON public.webhook_events TO service_role;

DROP POLICY IF EXISTS "Admins can view webhook events" ON public.webhook_events;

COMMENT ON TABLE public.webhook_events IS
  'Append-only log of received Stripe webhook events, written by the webhook handler itself (service_role, unauthenticated route verified via Stripe signature). Admin-only read via RLS.';

REVOKE ALL ON FUNCTION public.admin_get_user_id_by_email(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_users_with_subscriptions() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO authenticated;

COMMENT ON TABLE public.beta_invites IS
  'Emails pre-authorized for beta access before the person has signed up. Redeemed automatically by handle_beta_invite_redemption() when a matching auth.users row is created. Admin-only read/write.';

DROP TRIGGER IF EXISTS on_auth_user_created_beta_redemption ON auth.users;

REVOKE ALL ON FUNCTION public.admin_list_pending_beta_invites() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_provider_order TO authenticated;

GRANT ALL ON public.user_provider_order TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_intelligence_features TO authenticated;

GRANT ALL ON public.user_intelligence_features TO service_role;

GRANT SELECT ON public.demo_cases TO anon;

GRANT SELECT ON public.demo_cases TO authenticated;

GRANT ALL ON public.demo_cases TO service_role;

GRANT SELECT ON public.demo_case_documents TO anon;

GRANT SELECT ON public.demo_case_documents TO authenticated;

GRANT ALL ON public.demo_case_documents TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_strategy_center TO authenticated;

GRANT ALL ON public.case_strategy_center TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_beta_invite_redemption() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_stamp_case_firm() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_protect_user_settings_firm_id() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_mirror_reports_to_canonical() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_validate_canonical_analysis() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_bump_canonical_version() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_firm_for_email(text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) FROM PUBLIC, anon;

COMMENT ON COLUMN public.firms.seat_limit IS
  'Total seats available to this firm. NULL is treated as the solo default (1) until a paying subscription sets it.';

GRANT SELECT ON public.firm_invites TO authenticated;

GRANT ALL ON public.firm_invites TO service_role;

DROP POLICY IF EXISTS firm_invites_read ON public.firm_invites;

GRANT EXECUTE ON FUNCTION public.firm_seat_usage(UUID) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.plan_seat_limit(TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_list_firms_with_seats() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_firms_with_seats() TO authenticated;

COMMENT ON COLUMN public.billing_plans.included_seats IS 'Number of seats covered by the base price_cents. 1 = no seat concept (e.g. Solo).';

COMMENT ON COLUMN public.billing_plans.per_seat_price_cents IS 'Price per additional seat beyond included_seats, in cents. NULL = no per-seat add-on.';

COMMENT ON COLUMN public.billing_plans.per_seat_stripe_price_id IS 'Stripe Price ID for the per-seat add-on line item (licensed, not metered). NULL until configured.';

COMMENT ON COLUMN public.billing_plans.internal_notes IS 'Admin-only notes (e.g. negotiation floors). Never rendered on the public /billing page.';

UPDATE public.billing_plans SET price_cents = 9900, included_seats = 1 WHERE key = 'solo';

UPDATE public.billing_plans SET price_cents = 29900, included_seats = 3, per_seat_price_cents = 7900 WHERE key = 'firm';

UPDATE public.billing_plans
   SET internal_notes = 'Negotiation floor: $99–125/seat/mo, 20-seat minimum. Anchor quote: $150-200/seat/mo. Never shown on /billing — reference only for sales.'
 WHERE key = 'enterprise' AND (internal_notes IS NULL OR internal_notes = '');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;

GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;

GRANT ALL ON public.organizations TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_memberships TO authenticated;

GRANT ALL ON public.org_memberships TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matters TO authenticated;

GRANT ALL ON public.matters TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_parties TO authenticated;

GRANT ALL ON public.matter_parties TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_events TO authenticated;

GRANT ALL ON public.matter_events TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_documents TO authenticated;

GRANT ALL ON public.matter_documents TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_notes TO authenticated;

GRANT ALL ON public.matter_notes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_tasks TO authenticated;

GRANT ALL ON public.matter_tasks TO service_role;

GRANT SELECT ON public.audit_log TO authenticated;

GRANT ALL ON public.audit_log TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.org_role_of(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.can_manage_org(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.can_contribute_org(uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.tg_org_bootstrap_owner() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'attorney';

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'associate_attorney';

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'legal_assistant';

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'client';

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'read_only';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'platform_admin';

GRANT SELECT ON public.permissions TO authenticated;

GRANT ALL ON public.permissions TO service_role;

GRANT SELECT ON public.role_permissions TO authenticated;

GRANT ALL ON public.role_permissions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_role_permissions TO authenticated;

GRANT ALL ON public.org_role_permissions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_versions TO authenticated;

GRANT ALL ON public.document_versions TO service_role;

GRANT SELECT ON public.document_processing_jobs TO authenticated;

GRANT ALL ON public.document_processing_jobs TO service_role;

GRANT SELECT, INSERT ON public.intelligence_runs TO authenticated;

GRANT ALL ON public.intelligence_runs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_knowledge TO authenticated;

GRANT ALL ON public.matter_knowledge TO service_role;

GRANT SELECT ON public.legal_authorities TO authenticated, anon;

GRANT ALL ON public.legal_authorities TO service_role;

GRANT SELECT ON public.legal_citations TO authenticated, anon;

GRANT ALL ON public.legal_citations TO service_role;

GRANT SELECT ON public.legal_source_connectors TO authenticated;

GRANT ALL ON public.legal_source_connectors TO service_role;

INSERT INTO public.legal_source_connectors (code, name, description, status) VALUES
  ('scjn','Suprema Corte de Justicia de la Nación','Jurisprudencia y tesis SCJN','planned'),
  ('dof','Diario Oficial de la Federación','Publicaciones oficiales federales','planned'),
  ('tfja','Tribunal Federal de Justicia Administrativa','Resoluciones administrativas','planned')
ON CONFLICT (code) DO NOTHING;

GRANT SELECT ON public.billing_plans TO authenticated, anon;

GRANT ALL ON public.billing_plans TO service_role;

GRANT SELECT ON public.plan_entitlements TO authenticated, anon;

GRANT ALL ON public.plan_entitlements TO service_role;

GRANT SELECT ON public.org_subscriptions TO authenticated;

GRANT ALL ON public.org_subscriptions TO service_role;

GRANT SELECT ON public.billing_payments TO authenticated;

GRANT ALL ON public.billing_payments TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "docjobs_contrib_write" ON public.document_processing_jobs;

DROP POLICY IF EXISTS "docjobs_contrib_update" ON public.document_processing_jobs;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_relationships TO authenticated;

GRANT ALL ON public.knowledge_relationships TO service_role;

GRANT SELECT ON public.legal_profiles TO authenticated, anon;

GRANT ALL ON public.legal_profiles TO service_role;

GRANT SELECT ON public.legal_authority_versions TO authenticated, anon;

GRANT ALL ON public.legal_authority_versions TO service_role;

DROP POLICY IF EXISTS "legal_authority_versions public read" ON public.legal_authority_versions;

GRANT SELECT ON public.legal_ingest_runs TO authenticated;

GRANT ALL ON public.legal_ingest_runs TO service_role;

DROP POLICY IF EXISTS "legal_ingest_runs admin read" ON public.legal_ingest_runs;

INSERT INTO public.worker_secrets (name, secret)
VALUES ('legal_ingest_worker', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

COMMENT ON COLUMN public.cases.case_language IS
  'Detected/set language of the case''s source documents. Null until detected — distinct from report_language, which is what the attorney wants OUTPUT in.';

COMMENT ON COLUMN public.cases.report_language IS
  'Language to generate this case''s reports/analysis in. Defaults to the case owner''s profiles.preferred_language at case-creation time.';

UPDATE public.billing_plans SET label = name WHERE label IS NULL AND name IS NOT NULL;

UPDATE public.profiles p SET email = u.email
  FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'analyzed';

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'agents_running';

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'agents_complete';

ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'scored';

GRANT SELECT ON public.legal_authority_versions TO authenticated, anon;

GRANT ALL ON public.legal_authority_versions TO service_role;

DROP POLICY IF EXISTS "legal_authority_versions public read" ON public.legal_authority_versions;

GRANT SELECT ON public.legal_ingest_runs TO authenticated;

GRANT ALL ON public.legal_ingest_runs TO service_role;

DROP POLICY IF EXISTS "legal_ingest_runs admin read" ON public.legal_ingest_runs;

COMMENT ON COLUMN public.cases.case_language IS
  'Detected/set language of the case''s source documents. Null until detected — distinct from report_language, which is what the attorney wants OUTPUT in.';

COMMENT ON COLUMN public.cases.report_language IS
  'Language to generate this case''s reports/analysis in. Defaults to the case owner''s profiles.preferred_language at case-creation time.';

GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated, anon, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_list_firms_with_seats() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() FROM authenticated;

DROP POLICY IF EXISTS "ai_providers admin update" ON public.ai_providers;

DROP POLICY IF EXISTS "ai_providers admin delete" ON public.ai_providers;

REVOKE EXECUTE ON FUNCTION public.tg_protect_user_settings_firm_id_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_user_settings_firm_id_insert ON public.user_settings;

REVOKE INSERT (firm_id) ON public.user_settings FROM authenticated;

REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean) FROM anon;

GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean) TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_scores TO authenticated;

GRANT ALL ON public.case_scores TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_plan_notes TO authenticated;

GRANT ALL ON public.billing_plan_notes TO service_role;

GRANT SELECT ON public.billing_plans TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_plans TO authenticated;

GRANT ALL ON public.billing_plans TO service_role;

DROP POLICY IF EXISTS "findings update" ON public.case_findings;

REVOKE ALL ON FUNCTION public.is_member_of_firm(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.is_member_of_firm(uuid, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.is_member_of_firm(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS firms_read ON public.firms;

COMMENT ON COLUMN public.case_trial_prep.penal_metrics IS 'Mexican sistema penal acusatorio (CNPP) outcome estimates: vinculacion_proceso_pct, sentencia_condenatoria_pct, sentencia_absolutoria_pct, procedimiento_abreviado_pct, recurso_exito_pct. No jury metrics exist in Mexican criminal procedure.';

COMMENT ON COLUMN public.case_trial_prep.jury_conviction_pct IS 'MX: sentencia condenatoria % before the Tribunal de Enjuiciamiento (legacy column name; no jury exists in MX criminal procedure).';

COMMENT ON COLUMN public.case_trial_prep.jury_acquittal_pct IS 'MX: sentencia absolutoria %.';

COMMENT ON COLUMN public.case_trial_prep.jury_appeal_pct IS 'MX: probability of success on recurso (apelacion / amparo directo).';

COMMENT ON COLUMN public.case_trial_prep.jury_settlement_pct IS 'MX penal: procedimiento abreviado / salida alterna %. Civil: settlement %.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reports'::regclass AND conname = 'reports_case_id_key'
  ) THEN
    DELETE FROM public.reports r
    USING public.reports r2
    WHERE r.case_id = r2.case_id
      AND r.created_at < r2.created_at;
    ALTER TABLE public.reports ADD CONSTRAINT reports_case_id_key UNIQUE (case_id);
  END IF;
END $$;

COMMENT ON COLUMN public.cases.jurisdiction_profile IS 'Perfil de jurisdiccion resuelto (pais, entidad, fuero, materia, codigos aplicables) - etapa jurisdiction_intel.';

COMMENT ON COLUMN public.cases.procedural_compliance IS 'Resultado del checklist de cumplimiento procesal por materia - etapa procedural_compliance.';

COMMENT ON COLUMN public.cases.legal_qa_report IS 'Auditoria del Control de Calidad Juridica - etapa legal_qa.';

DROP POLICY IF EXISTS connectors_authenticated_read ON public.legal_source_connectors;

DROP POLICY IF EXISTS connectors_admin_read ON public.legal_source_connectors;

COMMENT ON COLUMN public.legal_authorities.verification_status IS
  'AI may only cite verified authorities by default (see legal-authority-verify.server.ts). pending = ingested but not yet human/process-verified; failed_verification = a verification attempt found a discrepancy against the official source.';

GRANT SELECT ON public.legal_articles TO authenticated, anon;

GRANT ALL ON public.legal_articles TO service_role;

DROP POLICY IF EXISTS legal_articles_public_read ON public.legal_articles;

DROP TRIGGER IF EXISTS trg_legal_articles_updated ON public.legal_articles;

GRANT SELECT ON public.legal_amendments TO authenticated, anon;

GRANT ALL ON public.legal_amendments TO service_role;

DROP POLICY IF EXISTS legal_amendments_public_read ON public.legal_amendments;

GRANT SELECT ON public.legal_precedents TO authenticated, anon;

GRANT ALL ON public.legal_precedents TO service_role;

DROP POLICY IF EXISTS legal_precedents_public_read ON public.legal_precedents;

DROP TRIGGER IF EXISTS trg_legal_precedents_updated ON public.legal_precedents;

GRANT SELECT ON public.legal_jurisprudencia TO authenticated, anon;

GRANT ALL ON public.legal_jurisprudencia TO service_role;

DROP POLICY IF EXISTS legal_jurisprudencia_public_read ON public.legal_jurisprudencia;

DROP TRIGGER IF EXISTS trg_legal_jurisprudencia_updated ON public.legal_jurisprudencia;

GRANT SELECT ON public.legal_theses TO authenticated, anon;

GRANT ALL ON public.legal_theses TO service_role;

DROP POLICY IF EXISTS legal_theses_public_read ON public.legal_theses;

DROP TRIGGER IF EXISTS trg_legal_theses_updated ON public.legal_theses;

GRANT SELECT ON public.legal_regulations TO authenticated, anon;

GRANT ALL ON public.legal_regulations TO service_role;

DROP POLICY IF EXISTS legal_regulations_public_read ON public.legal_regulations;

DROP TRIGGER IF EXISTS trg_legal_regulations_updated ON public.legal_regulations;

GRANT SELECT ON public.legal_topics TO authenticated, anon;

GRANT ALL ON public.legal_topics TO service_role;

DROP POLICY IF EXISTS legal_topics_public_read ON public.legal_topics;

GRANT SELECT ON public.legal_keywords TO authenticated, anon;

GRANT ALL ON public.legal_keywords TO service_role;

DROP POLICY IF EXISTS legal_keywords_public_read ON public.legal_keywords;

GRANT SELECT ON public.legal_topic_links TO authenticated, anon;

GRANT ALL ON public.legal_topic_links TO service_role;

DROP POLICY IF EXISTS legal_topic_links_public_read ON public.legal_topic_links;

GRANT SELECT ON public.legal_keyword_links TO authenticated, anon;

GRANT ALL ON public.legal_keyword_links TO service_role;

DROP POLICY IF EXISTS legal_keyword_links_public_read ON public.legal_keyword_links;

GRANT SELECT ON public.authority_relationships TO authenticated, anon;

GRANT ALL ON public.authority_relationships TO service_role;

DROP POLICY IF EXISTS authority_relationships_public_read ON public.authority_relationships;

GRANT SELECT ON public.citation_cache TO authenticated, anon;

GRANT ALL ON public.citation_cache TO service_role;

DROP POLICY IF EXISTS citation_cache_public_read ON public.citation_cache;

DELETE FROM public.ai_providers p
USING (SELECT provider_type, min(id::text)::uuid AS keep_id FROM public.ai_providers GROUP BY provider_type) k
WHERE p.provider_type = k.provider_type AND p.id <> k.keep_id;

DELETE FROM public.ai_task_routing WHERE provider_id IN (SELECT id FROM public.ai_providers WHERE provider_type = 'lovable');

DELETE FROM public.ai_providers WHERE provider_type = 'lovable';

UPDATE public.ai_providers SET enabled = true WHERE provider_type IN ('gemini','openrouter');

DO $$
DECLARE
  _secret TEXT;
BEGIN
  SELECT secret INTO _secret FROM public.worker_secrets WHERE name = 'pipeline_worker';

  IF _secret IS NULL THEN
    RAISE EXCEPTION 'worker_secrets row for pipeline_worker not found — cannot reschedule cron job safely.';
  END IF;

  -- Remove any existing schedule for this job name (whether it was pointed
  -- at nyrava.com or anywhere else) before creating the correct one.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nyrava-pipeline-worker';

  PERFORM cron.schedule(
    'nyrava-pipeline-worker',
    '* * * * *', -- every minute
    format($cmd$
      SELECT net.http_post(
        url := 'https://nyravamexico.lovable.app/api/public/hooks/pipeline-worker',
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
    $cmd$, jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', _secret)::text)
  );
END $$;

GRANT SELECT ON public.pipeline_trace TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.pipeline_trace_id_seq TO authenticated;

GRANT ALL ON public.pipeline_trace TO service_role;

GRANT ALL ON SEQUENCE public.pipeline_trace_id_seq TO service_role;

DROP TRIGGER IF EXISTS tg_case_findings_normalize_finding_type ON public.case_findings;

DROP TRIGGER IF EXISTS tg_case_theories_normalize_finding_type ON public.case_theories;

DROP TRIGGER IF EXISTS tg_case_opportunities_normalize_finding_type ON public.case_opportunities;

DROP TRIGGER IF EXISTS tg_case_perspectives_normalize_finding_type ON public.case_perspectives;

DROP TRIGGER IF EXISTS tg_case_witnesses_normalize_finding_type ON public.case_witnesses;

DELETE FROM public.ai_task_routing
 WHERE provider_id IN (SELECT id FROM public.ai_providers WHERE provider_type = 'lovable');

DELETE FROM public.ai_providers WHERE provider_type = 'lovable';

GRANT EXECUTE ON FUNCTION public.can_contribute_org(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.can_manage_org(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.org_role_of(uuid, uuid) TO authenticated;

COMMENT ON COLUMN public.legal_authorities.authority_level IS
  'Legal authority ranking, 1 (lowest, secondary/academic) to 10 (highest, binding constitutional/SCJN authority). Used by report generation and Talk-to-Case to weight which sources to trust more heavily when multiple authorities are relevant. NULL until backfilled/set by ingestion.';

UPDATE public.legal_authorities SET authority_level = 9  WHERE kind IN ('code','law') AND jurisdiction = 'Federal';

UPDATE public.legal_authorities SET authority_level = 8  WHERE kind IN ('code','law') AND jurisdiction <> 'Federal';

COMMENT ON COLUMN public.legal_authorities.content_hash IS
  'SHA-256 hex digest of the body column, computed at ingestion time. Lets a future report-freshness check cheaply detect whether an authority has actually changed via a hash comparison instead of a full text diff. NULL until an ingestion or backfill computes it. Population logic is a separate, later change to versioning.server.ts — not included here, this migration only adds the column.';

DELETE FROM public.ai_providers WHERE provider_type = 'lovable';

UPDATE public.ai_providers SET default_model = 'gemini-2.5-flash' WHERE provider_type = 'gemini' AND default_model IN ('gemini-2.0-flash', 'gemini-1.5-flash');

UPDATE public.ai_providers SET default_model = 'gemini-flash-latest', updated_at = now() WHERE provider_type = 'gemini';

UPDATE public.ai_task_routing SET model = NULL WHERE model ILIKE 'gemini-2.%';

DROP POLICY IF EXISTS "feature_flags read all auth" ON public.feature_flags;

DROP POLICY IF EXISTS "role_perms_read_all" ON public.role_permissions;

REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.firm_seat_usage(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_case_manager(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.has_permission(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_permission(uuid, uuid, text) TO service_role;

UPDATE public.legal_source_connectors SET status = 'active' WHERE code = 'congreso';

DELETE FROM public.legal_authorities
WHERE source_url ILIKE '%diputados.gob.mx/LeyesBiblio/ref/%'
   OR (title = 'Años anteriores');

UPDATE public.legal_source_connectors SET status = 'active' WHERE code = 'tfja';

update public.legal_source_connectors
set name = 'Legislación Estatal (Orden Jurídico Nacional)',
    base_url = 'https://www.ordenjuridico.gob.mx',
    description = 'Constituciones, códigos y leyes de los 32 estados, vía el agregador oficial de SEGOB',
    status = 'active',
    updated_at = now()
where code = 'state_gazettes';

UPDATE public.legal_source_connectors
SET status = 'active',
    updated_at = now()
WHERE code = 'cjf';

UPDATE public.legal_source_connectors
SET name = 'Tribunales Superiores de Justicia Estatales (Coahuila · PJECZ)',
    status = 'active'
WHERE code = 'state_scj';

UPDATE public.legal_source_connectors
SET name = 'Justicia Electoral (TECDMX · Ciudad de México)',
    status = 'active',
    base_url = 'https://www.tecdmx.org.mx/index.php/sentencias_inicio/'
WHERE code = 'tepjf';

ALTER TYPE public.canonical_status ADD VALUE IF NOT EXISTS 'validated';

NOTIFY pgrst, 'reload schema';

DROP TRIGGER IF EXISTS trg_prevent_user_settings_firm_change ON public.user_settings;

REVOKE EXECUTE ON FUNCTION public.prevent_user_settings_firm_change() FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_records TO authenticated;

GRANT ALL ON public.property_records TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_items TO authenticated;

GRANT ALL ON public.verification_items TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_milestones TO authenticated;

GRANT ALL ON public.closing_milestones TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_parties TO authenticated;

GRANT ALL ON public.case_parties TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_tasks TO authenticated;

GRANT ALL ON public.case_tasks TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_events TO authenticated;

GRANT ALL ON public.case_events TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_communications TO authenticated;

GRANT ALL ON public.case_communications TO service_role;

REVOKE UPDATE ON public.user_settings FROM authenticated;

REVOKE UPDATE ON public.user_settings FROM anon;

REVOKE INSERT ON public.user_settings FROM anon;

GRANT UPDATE (user_id, gemini_api_key, created_at, updated_at, display_name, phone, firm_name, title, avatar_url, voice_id, voice_speed, voice_muted, voice_autoplay, notify_email, notify_pipeline_complete, notify_pipeline_failed, notify_new_evidence, ai_default_mode, ai_response_style, ai_max_response_chars, voice_continuous, voice_pitch, voice_accent, voice_gender) ON public.user_settings TO authenticated;

GRANT ALL ON public.user_settings TO service_role;

select cron.unschedule('nyrava-legal-ingest-daily');

UPDATE public.ai_providers SET api_key_encrypted = NULL WHERE provider_type = 'gemini';

REVOKE ALL ON FUNCTION public.project_case_findings(uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.project_case_findings(uuid, jsonb) TO service_role;

DELETE FROM public.case_findings WHERE source_module LIKE 'projection:%';

DROP POLICY IF EXISTS "audit_member_select" ON public.audit_log;

COMMENT ON COLUMN public.cases.matter_metadata IS 'Structured Mexican court-file metadata (expediente, juzgado, partes, etapa procesal, etc.). Populated automatically by seeded benchmark corpora and editable by the owner.';

COMMENT ON COLUMN public.billing_plans.ai_requests_monthly IS
  'Monthly allowance shared by Case Intelligence processing, AI document analysis, report generation, motion generation, strategic analysis, and future intelligence modules. NULL = unlimited.';

COMMENT ON COLUMN public.billing_plans.talk_to_case_monthly IS
  'Monthly allowance of Talk-to-Case turns, tracked separately because it performs continuous AI reasoning. NULL = unlimited.';

COMMENT ON COLUMN public.billing_plans.case_limit IS
  'Max non-archived cases a user on this plan may have open at once. NULL = unlimited.';

COMMENT ON COLUMN public.billing_plans.storage_gb_limit IS
  'Max evidence storage (GB) for a user on this plan. NULL = unlimited.';

COMMENT ON COLUMN public.billing_plans.team_member_limit IS
  'Max team/firm seats for this plan. NULL = unlimited.';

COMMENT ON COLUMN public.billing_plans.byok_allowed IS
  'Whether users on this plan may connect their own AI provider keys (BYOK) to bypass the platform allowance.';

COMMENT ON COLUMN public.billing_plans.overage_price_cents IS
  'Reserved for future pay-as-you-go overage pricing once included allowance is exhausted. Not charged yet.';

COMMENT ON COLUMN public.billing_plans.feature_flags IS
  'Free-form per-plan feature toggles (e.g. {"priority_processing": true}) read by the app without needing new columns for every future flag.';

UPDATE public.billing_plans SET
  ai_requests_monthly = 750,
  talk_to_case_monthly = 150,
  case_limit = 100,
  storage_gb_limit = 50,
  team_member_limit = 10,
  byok_allowed = true
WHERE key = 'firm' AND ai_requests_monthly IS NULL;

UPDATE public.billing_plans SET
  features = '["750 AI requests / month", "150 Talk-to-Case conversations / month", "Everything in Solo", "Multiple attorney seats", "Priority processing", "Priority support"]'::jsonb
WHERE key = 'firm' AND features = '["Everything in Solo","Multiple attorney seats","Priority processing","Priority support"]'::jsonb;

UPDATE public.billing_plans SET
  features = '["Custom monthly AI + Talk-to-Case allowance", "Everything in Firm", "Custom seat count & SSO", "Dedicated onboarding", "Custom contract & invoicing"]'::jsonb
WHERE key = 'enterprise' AND features = '["Everything in Firm","Custom seat count & SSO","Dedicated onboarding","Custom contract & invoicing"]'::jsonb;

GRANT SELECT ON public.usage_counters TO authenticated;

GRANT ALL ON public.usage_counters TO service_role;

DROP POLICY IF EXISTS "Users can view own usage" ON public.usage_counters;

COMMENT ON TABLE public.usage_counters IS
  'One row per user per calendar month. Written only via consume_usage()/service-role (never directly by a client). A new month simply has no row yet, which is how the monthly reset works without a cron job.';

GRANT SELECT ON public.usage_events TO authenticated;

GRANT ALL ON public.usage_events TO service_role;

DROP POLICY IF EXISTS "Users can view own usage events" ON public.usage_events;

COMMENT ON TABLE public.usage_events IS
  'Append-only detail log behind usage_counters — one row per metered AI call. Best-effort (fire-and-forget from the app); usage_counters is the source of truth for gating, this is for visibility/debugging only.';

REVOKE EXECUTE ON FUNCTION public.consume_usage(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_usage(uuid, text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.consume_usage IS
  'Atomically checks p_amount against p_limit for the current UTC month and, if allowed, increments the counter in the same statement. service_role only — called from usage.server.ts with a limit already resolved from the caller''s plan.';

REVOKE EXECUTE ON FUNCTION public.increment_reports_generated(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_reports_generated(uuid) TO service_role;

COMMENT ON COLUMN public.billing_plans.mercadopago_plan_id IS
  'Mercado Pago Preapproval Plan id (from POST /preapproval_plan). Replaces stripe_price_id, which is no longer read by the app but is left in place rather than dropped.';

COMMENT ON COLUMN public.subscriptions.mercadopago_preapproval_id IS
  'Mercado Pago Preapproval id — the subscription object itself. Replaces stripe_subscription_id.';

COMMENT ON COLUMN public.subscriptions.mercadopago_payer_id IS
  'Mercado Pago payer id, when returned. Informational only — the preapproval id is what the app keys off of.';

COMMENT ON COLUMN public.webhook_events.provider IS
  '''stripe'' for legacy rows (column default, preserves existing data as-is) or ''mercadopago'' for rows written by the new webhook handler.';

COMMENT ON COLUMN public.webhook_events.mp_event_id IS
  'Mercado Pago notification id (from the notification payload''s data.id + type), used the same way stripe_event_id is used for Stripe rows — de-duplicating retried webhook deliveries.';

REVOKE ALL ON FUNCTION public.admin_list_users_with_subscriptions() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO authenticated;

COMMENT ON COLUMN public.case_findings.confidence_dimensions IS
  'Per-dimension confidence (extraction, factual, evidence_quality, legal, procedural, corpus_completeness, classification), each {level: high|moderate|low|indeterminate, reason: string}. Supplements the single confidence float — never replaces it, existing scoring math is untouched. See src/lib/intelligence/confidence-dimensions.ts.';

COMMENT ON COLUMN public.case_findings.rationale IS
  'Auditable legal rationale: {supporting_evidence, contrary_evidence, assumptions, unresolved_questions, applicable_authority, attorney_review_required, unsupported_language_flagged}. A structured trace of why a conclusion was reached, not private model chain-of-thought.';

GRANT SELECT ON public.finding_version_snapshots TO authenticated;

GRANT ALL ON public.finding_version_snapshots TO service_role;

DROP POLICY IF EXISTS "Users can view their own case finding snapshots" ON public.finding_version_snapshots;

COMMENT ON TABLE public.finding_version_snapshots IS
  'One row per finding per report version. Written by snapshotFindingVersions() immediately before finalizeReportChangeLog runs its diff. Never updated or deleted — a plain append-only log, same immutability posture as report_versions.';

GRANT SELECT ON public.cross_agent_audit TO authenticated;

GRANT ALL ON public.cross_agent_audit TO service_role;

DROP POLICY IF EXISTS "Users can view their own case audits" ON public.cross_agent_audit;

COMMENT ON TABLE public.cross_agent_audit IS
  'One row per cross-agent validation pass. checks = every check performed (pass/fail + detail); conflicts = disagreements the validator could not resolve deterministically, surfaced for attorney review rather than silently resolved.';

GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO authenticated, service_role;

GRANT SELECT, INSERT ON public.user_feedback TO authenticated;

GRANT ALL ON public.user_feedback TO service_role;

DROP POLICY IF EXISTS "feedback_insert_own" ON public.user_feedback;

DROP POLICY IF EXISTS "feedback_select_own_or_admin" ON public.user_feedback;

DROP TRIGGER IF EXISTS trg_user_feedback_updated ON public.user_feedback;

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid, jobname, schedule, command FROM cron.job WHERE command LIKE '%nyravamexico.lovable.app%' LOOP
    PERFORM cron.alter_job(j.jobid, command := replace(j.command, 'https://nyravamexico.lovable.app', 'https://mexico.nyrava.com'));
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_grant_beta_access(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO authenticated, service_role;

GRANT INSERT ON public.user_settings TO authenticated;

GRANT UPDATE (
  cedula_profesional,
  state_practice,
  practice_focus,
  years_experience,
  profile_completed_at
) ON public.user_settings TO authenticated;

GRANT ALL ON public.user_settings TO service_role;

ALTER POLICY "Users delete timeline events for their own cases" ON public.case_timeline_events TO authenticated;

ALTER POLICY "pages owner all" ON public.document_pages TO authenticated;

ALTER POLICY "Users update image intelligence for their own cases" ON public.image_intelligence TO authenticated;

ALTER POLICY "Users delete image intelligence for their own cases" ON public.image_intelligence TO authenticated;

ALTER POLICY "Users manage own settings" ON public.user_settings TO authenticated;

ALTER POLICY "citation_cache_public_read" ON public.citation_cache TO authenticated;

ALTER POLICY "legal_amendments_public_read" ON public.legal_amendments TO authenticated;

ALTER POLICY "legal_articles_public_read" ON public.legal_articles TO authenticated;

ALTER POLICY "legal_auth_public_read" ON public.legal_authorities TO authenticated;

ALTER POLICY "legal_authority_versions public read" ON public.legal_authority_versions TO authenticated;

ALTER POLICY "legal_cite_public_read" ON public.legal_citations TO authenticated;

ALTER POLICY "legal_jurisprudencia_public_read" ON public.legal_jurisprudencia TO authenticated;

ALTER POLICY "legal_keyword_links_public_read" ON public.legal_keyword_links TO authenticated;

ALTER POLICY "legal_keywords_public_read" ON public.legal_keywords TO authenticated;

ALTER POLICY "legal_precedents_public_read" ON public.legal_precedents TO authenticated;

ALTER POLICY "legal_profiles_public_read" ON public.legal_profiles TO authenticated;

ALTER POLICY "legal_regulations_public_read" ON public.legal_regulations TO authenticated;

ALTER POLICY "legal_theses_public_read" ON public.legal_theses TO authenticated;

ALTER POLICY "legal_topic_links_public_read" ON public.legal_topic_links TO authenticated;

ALTER POLICY "legal_topics_public_read" ON public.legal_topics TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.tg_normalize_finding_type() FROM anon, authenticated, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.plan_seat_limit(text) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO service_role;

REVOKE SELECT ON public.plan_entitlements FROM anon;

GRANT SELECT ON public.plan_entitlements TO authenticated;

GRANT ALL ON public.plan_entitlements TO service_role;

REVOKE ALL ON FUNCTION private.owns_case(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.owns_case(uuid) TO authenticated;

DROP POLICY IF EXISTS "findings insert" ON public.case_findings;

DROP POLICY IF EXISTS "users insert own case_scores" ON public.case_scores;

DROP POLICY IF EXISTS "opps all" ON public.case_opportunities;

DROP POLICY IF EXISTS "witnesses all" ON public.case_witnesses;

DROP POLICY IF EXISTS "parties all" ON public.case_parties;

DROP POLICY IF EXISTS "tasks all" ON public.case_tasks;

DROP POLICY IF EXISTS "events all" ON public.case_events;

DROP POLICY IF EXISTS "communications all" ON public.case_communications;

DROP POLICY IF EXISTS "perspectives owner full" ON public.case_perspectives;

DROP POLICY IF EXISTS "strategy owner full" ON public.case_strategy;

DROP POLICY IF EXISTS "evidence_class owner full" ON public.evidence_classifications;

DROP POLICY IF EXISTS "motion drafts all" ON public.case_motion_drafts;

DROP POLICY IF EXISTS "strategy center all" ON public.case_strategy_center;

DROP POLICY IF EXISTS "property_records all" ON public.property_records;

DROP POLICY IF EXISTS "verification_items all" ON public.verification_items;

DROP POLICY IF EXISTS "closing_milestones all" ON public.closing_milestones;

REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_list_firms_with_seats() TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) TO authenticated;

GRANT SELECT, INSERT ON public.support_threads TO authenticated;

GRANT SELECT, INSERT ON public.support_messages TO authenticated;

GRANT ALL ON public.support_threads TO service_role;

GRANT ALL ON public.support_messages TO service_role;

DROP POLICY IF EXISTS "support_threads_select_own_or_admin" ON public.support_threads;

DROP POLICY IF EXISTS "support_messages_select_own_or_admin" ON public.support_messages;

DROP TRIGGER IF EXISTS trg_support_threads_updated ON public.support_threads;

DO $$
DECLARE
  _secret TEXT;
BEGIN
  SELECT secret INTO _secret FROM public.worker_secrets WHERE name = 'reminders_worker';
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nyrava-reminders-worker';
  PERFORM cron.schedule(
    'nyrava-reminders-worker',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := 'https://mexico.nyrava.com/api/public/hooks/reminders-worker',
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
    $cmd$, jsonb_build_object('Content-Type','application/json','x-worker-secret', _secret)::text)
  );
END $$;

COMMENT ON COLUMN public.case_findings.speaker_role IS
  'Who asserted this proposition in the source judicial resolution: quejoso|autoridad|tribunal_colegiado|tribunal_local|scjn. NULL when the extraction pass did not run judicial-hierarchy attribution (most non-precedent-review findings). Distinct from affected_party, which says who a finding BENEFITS, not who stated it.';

COMMENT ON COLUMN public.case_findings.proposition_type IS
  'argument|holding|rejected_holding|procedural_fact|evidence|issue. rejected_holding marks a lower instance''s ruling a higher instance expressly overturned or superseded — this and adoption_status=rejected are the two signals that keep a finding out of the Executive Dashboard.';

COMMENT ON COLUMN public.case_findings.adoption_status IS
  'adopted|rejected|unresolved|historical — whether the highest instance present in the case adopted this proposition. Drives Executive Dashboard / Hallazgos Principales / Resumen Ejecutivo / Puntajes / Recomendaciones eligibility; see src/lib/intelligence/judicial-hierarchy.ts.';

COMMENT ON COLUMN public.cases.case_analysis_mode IS
  'ongoing (default, case preparation) | concluded_audit (retrospective forensic audit) | judgment_audit (focused on the final resolution) | appeal_routes (focused on identifying legally supportable challenge routes). See src/lib/intelligence/case-analysis-mode.ts.';

COMMENT ON COLUMN public.case_findings.audit_classification IS
  'VERIFIED_FACT|VERIFIED_COURT_HOLDING|VERIFIED_LEGAL_RULE|SUPPORTED_INFERENCE|POTENTIAL_ISSUE|EVIDENCE_GAP|NOT_FOUND — strict finding classification used by completed-case analysis modes. NULL for findings generated outside those modes. See src/lib/intelligence/case-analysis-mode.ts.';

GRANT SELECT ON public.case_outcome_assessments TO authenticated;

GRANT ALL ON public.case_outcome_assessments TO service_role;

DROP POLICY IF EXISTS case_outcome_assessments_owner_select ON public.case_outcome_assessments;

COMMENT ON TABLE public.case_outcome_assessments IS
  'Completed Case Audit / Outcome Assessment — a final review layer over EXISTING completed-case findings/scores/report. Never regenerates or reprocesses documents; see src/lib/intelligence/completed-case-audit.server.ts.';

COMMENT ON COLUMN public.case_outcome_assessments.outcome_status IS
  'ESTIMATED: favorable_pct/unfavorable_pct/confidence reflect a real evidence-based assessment. INSUFFICIENT_DATA: the record does not support a meaningful probability — favorable_pct/unfavorable_pct/confidence are placeholders (0/0/LOW) and must not be displayed as a real estimate. See completed-case-audit.server.ts.';

GRANT SELECT ON public.case_classification_evidence TO authenticated;

GRANT ALL ON public.case_classification_evidence TO service_role;

DROP POLICY IF EXISTS case_classification_evidence_owner_select ON public.case_classification_evidence;

COMMENT ON TABLE public.case_classification_evidence IS
  'Evidence trail for automatic case classification (case type, jurisdiction, court, parties, expediente number, procedural stage, concluded status). Never guesses: CONFIRMED requires a located source quote, CONFLICT records every disagreeing source, INSUFFICIENT_DATA when the corpus does not establish the field. See case-classification.server.ts.';

COMMENT ON COLUMN public.cases.case_type_source IS
  'Provenance of the current case_type value: source_confirmed (from case_classification_evidence) | manual_override (attorney-set, no conflicting source) | manual_override_conflicting (attorney-set, but disagrees with a CONFIRMED source classification — see case_classification_evidence) | heuristic (legacy keyword guess, pre-dates this table) | unresolved.';

COMMENT ON COLUMN public.cases.case_type_verification_status IS
  'CONFIRMED | INSUFFICIENT_DATA | CONFLICT — mirrors case_classification_evidence.status for the case_type field, denormalized for cheap UI reads.';

COMMENT ON COLUMN public.case_findings.superseded_at IS
  'Set when a later, verified case-state update (a Talk-to-Case clarification, currently the only source) established that this finding no longer reflects the case record. NULL = still active. listFindings() excludes superseded rows by default — the row itself is NEVER deleted, preserving the audit trail.';

COMMENT ON COLUMN public.case_findings.superseded_reason IS
  'Human-readable explanation of why this finding was superseded and by what, including a verbatim quote from the superseding source. NULL whenever superseded_at is NULL.';

GRANT SELECT ON public.case_decision_reconstructions TO authenticated;

GRANT ALL ON public.case_decision_reconstructions TO service_role;

DROP POLICY IF EXISTS case_decision_reconstructions_owner_select ON public.case_decision_reconstructions;

COMMENT ON TABLE public.case_decision_reconstructions IS
  'Decision Reconstruction / Case Baseline — an independent reconstruction of what the case corpus establishes, built directly from documents rather than derived from prior findings/scores. See src/lib/intelligence/decision-reconstruction-extractor.server.ts.';

DROP POLICY IF EXISTS "analyses all" ON public.analyses;

DROP POLICY IF EXISTS "chat all" ON public.case_chat_messages;

DROP POLICY IF EXISTS "trial all" ON public.case_trial_prep;

DROP POLICY IF EXISTS "work all" ON public.case_work_product;

GRANT SELECT ON public.case_finding_patches TO authenticated;

GRANT ALL ON public.case_finding_patches TO service_role;

DROP POLICY IF EXISTS case_finding_patches_owner_select ON public.case_finding_patches;

COMMENT ON TABLE public.case_finding_patches IS
  'Structured, grounded audit trail of every Talk-to-Case "Push to Report" patch (keep/amend/remove/merge/create) applied to case_findings. Never a substitute for case_findings itself — case_findings.superseded_at/superseded_reason remains the source of truth for whether a finding is active; this table records WHY and from WHAT source each change was made.';

COMMENT ON COLUMN public.documents.evidence_scope IS
  'case_corpus = ordinary evidence, included in every full-pipeline analysis engine''s corpus read. revision_context = uploaded via Talk-to-Case; extracted and usable for grounding a correction, but excluded from the analysis corpus until explicitly promoted.';

COMMENT ON COLUMN public.case_finding_patches.report_version IS
  'The reports.version this patch''s application produced — groups patches into the "revision" they belong to. NULL until pushCaseChatCorrectionsToReport backfills it post-apply.';

GRANT SELECT ON public.intelligence_lessons TO authenticated;

GRANT ALL ON public.intelligence_lessons TO service_role;

DROP POLICY IF EXISTS intelligence_lessons_owner_select ON public.intelligence_lessons;

COMMENT ON TABLE public.intelligence_lessons IS
  'One row per verified Talk-to-Case correction, reshaped for cross-case learning. Always traceable to case_finding_patches.source_patch_id. Never stores legal_authorities content, only ids (authority_refs). validation_status starts at ai_supported (grounded + attorney-approved) and is never self-promoted by a model.';

COMMENT ON COLUMN public.case_findings.lifecycle_status IS
  'Descriptive lifecycle state (discovered/supported/verified/active/challenged/corrected/superseded/rejected/corroborated). NULL for findings generated before this column existed, or where nothing has set it yet. Never the gate for report/scoring inclusion — that remains superseded_at IS NULL, unchanged.';

COMMENT ON COLUMN public.documents.purpose IS
  'Why this document was uploaded, as classified by generateFindingPatchSet when it appears in a Talk-to-Case exchange. NULL for documents no chat exchange has classified (including ordinary Evidence-tab uploads, which do not need this). Never the corpus-inclusion gate — that remains evidence_scope, unchanged.';

GRANT SELECT ON public.intelligence_patterns TO authenticated;

GRANT ALL ON public.intelligence_patterns TO service_role;

DROP POLICY IF EXISTS intelligence_patterns_owner_select ON public.intelligence_patterns;

COMMENT ON TABLE public.intelligence_patterns IS
  'Cross-case aggregation over intelligence_lessons, grouped by (user_id, matter_type, jurisdiction, error_type). tier/confidence are always computed from real stored lesson counts (patterns.server.ts) — never asserted by a model. Self-auditing (auditFindingAgainstPatterns) only acts on tier >= candidate (>=5 verified lessons).';

GRANT SELECT ON public.intelligence_validation_rules TO authenticated;

GRANT ALL ON public.intelligence_validation_rules TO service_role;

DROP POLICY IF EXISTS intelligence_validation_rules_owner_select ON public.intelligence_validation_rules;

COMMENT ON TABLE public.intelligence_validation_rules IS
  'Data-encoded overrides of the self-audit tier->action escalation policy. Never edited in place (superseded_by_rule_id links history forward). Only ever written by proposals.server.ts''s deployProposal/rollbackVersion, which only run on an already-approved proposal.';

GRANT SELECT ON public.intelligence_improvement_proposals TO authenticated;

GRANT ALL ON public.intelligence_improvement_proposals TO service_role;

DROP POLICY IF EXISTS intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals;

COMMENT ON TABLE public.intelligence_improvement_proposals IS
  'One row per proposed change to the self-audit escalation policy for one bucket. Every transition (replay/regression/approve/deploy) is a separate function in proposals.server.ts — no path can skip a gate. historical_replay/regression_check always carry real integer counts, never a fabricated percentage.';

GRANT SELECT ON public.intelligence_versions TO authenticated;

GRANT ALL ON public.intelligence_versions TO service_role;

DROP POLICY IF EXISTS intelligence_versions_owner_select ON public.intelligence_versions;

COMMENT ON TABLE public.intelligence_versions IS
  'Append-only deployment history for intelligence_validation_rules changes. Every reports.adaptive_intelligence_version stamp refers to a version number here, so a past report''s forensic record never silently changes when the rules improve later.';

COMMENT ON COLUMN public.reports.adaptive_intelligence_version IS
  'The intelligence_versions.version (per this report''s user) that was the latest DEPLOYED version at report-generation time, or NULL if none had been deployed yet. Distinct from reports.intelligence_version (the pipeline/engine tag) — this tracks the adaptive validation-rule layer specifically.';

COMMENT ON COLUMN public.case_findings.evidence_relationship IS
  'What KIND of relationship this finding has to its cited evidence (SOURCE_HOLDING/SOURCE_FACT/SOURCE_ARGUMENT/DERIVED_INFERENCE/UNPROVEN_ABSENCE/MISSING_EVIDENCE) — distinct from finding_type''s evidentiary-strength axis. Only SOURCE_HOLDING/SOURCE_FACT are ever eligible to back a DIRECT_EVIDENCE finding_type (enforced in evidence-gate.server.ts, not by this constraint). NULL for findings generated before this taxonomy existed, or persisted through a path that does not run the evidence gate.';

DROP POLICY IF EXISTS intelligence_versions_owner_select ON public.intelligence_versions;

DROP POLICY IF EXISTS intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals;

DROP POLICY IF EXISTS intelligence_validation_rules_owner_select ON public.intelligence_validation_rules;

DROP POLICY IF EXISTS intelligence_patterns_owner_select ON public.intelligence_patterns;

DROP POLICY IF EXISTS case_finding_patches_owner_select ON public.case_finding_patches;

DROP POLICY IF EXISTS intelligence_lessons_owner_select ON public.intelligence_lessons;

REVOKE ALL ON public.intelligence_versions FROM anon;

REVOKE ALL ON public.intelligence_improvement_proposals FROM anon;

REVOKE ALL ON public.intelligence_validation_rules FROM anon;

REVOKE ALL ON public.intelligence_patterns FROM anon;

REVOKE ALL ON public.case_finding_patches FROM anon;

REVOKE ALL ON public.intelligence_lessons FROM anon;

comment on column public.case_findings.reconciliation_state is
  'Canonical Reconciliation Design state. NULL = ordinary path (no cross-producer disagreement detected). "unresolved"/"conflicting" = two different producers affirmatively asserted incompatible conclusions about the same canonical claim; see metadata.conflict for both sides.';

DROP POLICY IF EXISTS "mk_contrib_update" ON public.matter_knowledge;

drop trigger if exists trg_nyrava_verified_analysis_mode on public.cases;

comment on function public.nyrava_enforce_verified_analysis_mode() is
  'Canonicalizes the retired strict/exploratory user choice to the single Nyrava Verified Legal Intelligence storage mode. Case analysis purpose remains controlled by case_analysis_mode.';

REVOKE EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) FROM authenticated, anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) FROM authenticated, anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO service_role;

drop trigger if exists trg_nyrava_verified_analysis_mode on public.cases;

comment on column public.cases.analysis_mode is
  'LEGACY compatibility token. Always normalized to balanced, which represents the single Nyrava Verified evidence policy. Never branch product behavior or UI on this field; use case_analysis_mode only for procedural posture.';

comment on function public.nyrava_enforce_verified_analysis_mode() is
  'Prevents historical strict/balanced/exploratory values from reintroducing different evidence-gate behavior. balanced is a compatibility token only, not a user mode.';

comment on column public.user_intelligence_features.mode is
  'Legacy compatibility metadata. balanced is the single verified-policy token and must not control case analysis depth or engine selection.';

commit;

drop trigger if exists mirror_reports_to_canonical on public.reports;

drop function if exists public.tg_mirror_reports_to_canonical();

comment on table public.canonical_analysis is
  'Canonical analysis state. Legacy reports-to-canonical mirror retired 2026-08-19; canonical state must be written explicitly by the current pipeline/application path.';

comment on table public.reports is
  'Rendered/report artifact store. Must not implicitly overwrite public.canonical_analysis.';

commit;

revoke execute on function public.project_case_findings(uuid, jsonb) from PUBLIC, anon, authenticated;

grant execute on function public.project_case_findings(uuid, jsonb) to service_role;

comment on function public.project_case_findings(uuid, jsonb) is
  'Projection-only writer for case_findings. Requires source_module=projection:<projected_from.table>; cannot create canonical engine/analyzer rows.';

comment on column public.cases.analysis_mode is
  'LEGACY compatibility token only. Unified verified pipeline always stores balanced; user-facing Strict/Balanced/Exploratory modes are retired. Procedural posture lives in case_analysis_mode.';

drop trigger if exists trg_nyrava_force_unified_analysis_mode on public.cases;

drop trigger if exists trg_nyrava_enforce_score_provenance on public.case_scores;

comment on function public.nyrava_sanitize_score_breakdowns(uuid, jsonb) is
  'Removes LLM score contributors that are not backed by a case_findings row for the same case. Prevents cross-materia/fabricated score explanations.';

drop trigger if exists trg_nyrava_enforce_released_case_state on public.cases;

comment on function public.nyrava_enforce_released_case_state() is
  'Canonical terminal-state invariant: status=released implies progress=100, completion/report timestamps present, lifecycle released, and no active execution/lease.';

commit;

comment on function public.nyrava_guard_release_snapshot() is
  'Prevents stale gate success from releasing a newer report: QA, hallucination and judge must all succeed in one post-snapshot final-review run.';

commit;

drop trigger if exists trg_nyrava_report_legal_integrity_guard on public.reports;

comment on function public.nyrava_report_legal_integrity_guard() is
  'Canonical final-report guard: controlling holding posture, contradiction authority, canonical timeline propagation, and deterministic risk ownership.';

DROP TRIGGER IF EXISTS trg_nyrava_guard_case_finding_personal_notice ON public.case_findings;

DROP TRIGGER IF EXISTS trg_nyrava_sanitize_analysis_personal_notice ON public.analyses;

DROP TRIGGER IF EXISTS trg_nyrava_sanitize_agent_finding_personal_notice ON public.agent_findings;

DROP TRIGGER IF EXISTS trg_nyrava_sanitize_agent_log_personal_notice ON public.agent_logs;

DROP TRIGGER IF EXISTS trg_nyrava_enforce_released_case_terminal_state ON public.cases;

REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) TO service_role;

COMMIT;

insert into public.legal_source_connectors (code, name, description, base_url, status, config)
values
  (
    'inm_official',
    'Instituto Nacional de Migración',
    'Official Mexican immigration requirements, procedures and publications.',
    'https://www.inm.gob.mx/',
    'active',
    '{"jurisdiction":"MX","materias":["migratorio"],"fail_open_with_verified_cache":true}'::jsonb
  ),
  (
    'sre_consular_official',
    'Secretaría de Relaciones Exteriores',
    'Official Mexican visa, nationality, naturalization and consular requirements.',
    'https://www.gob.mx/sre',
    'active',
    '{"jurisdiction":"MX","materias":["migratorio"],"fail_open_with_verified_cache":true}'::jsonb
  ),
  (
    'comar_official',
    'Comisión Mexicana de Ayuda a Refugiados',
    'Official refugee-status and complementary-protection information.',
    'https://www.gob.mx/comar',
    'active',
    '{"jurisdiction":"MX","materias":["migratorio"],"fail_open_with_verified_cache":true}'::jsonb
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  base_url = excluded.base_url,
  config = public.legal_source_connectors.config || excluded.config,
  updated_at = now();

revoke all on function public.search_immigration_cases(text, integer) from public;

grant execute on function public.search_immigration_cases(text, integer) to authenticated;

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

drop trigger if exists social_case_number_assign on public.social_cases;

drop trigger if exists social_case_number_immutable on public.social_cases;

revoke all on function public.social_has_capability(uuid,text,uuid) from public;

revoke all on function public.social_can_access_case(uuid,text,boolean,uuid) from public;

revoke all on function public.social_can_access_person(uuid,uuid) from public;

revoke all on function public.social_consent_covers(uuid,text,text,text[]) from public;

grant execute on function public.social_has_capability(uuid,text,uuid) to authenticated;

grant execute on function public.social_can_access_case(uuid,text,boolean,uuid) to authenticated;

grant execute on function public.social_can_access_person(uuid,uuid) to authenticated;

grant execute on function public.social_consent_covers(uuid,text,text,text[]) to authenticated;

drop trigger if exists social_case_assign_creator on public.social_cases;

drop trigger if exists social_activity_no_update on public.social_activity_events;

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

insert into public.social_institutions(org_id,name,institution_type,jurisdiction_level,services,verified_at)
values
  (null,'Instituto Nacional de Migración (INM)','federal_authority','federal',array['immigration'],now()),
  (null,'Comisión Mexicana de Ayuda a Refugiados (COMAR)','federal_authority','federal',array['refugee_protection'],now()),
  (null,'Secretaría de Relaciones Exteriores (SRE)','federal_authority','federal',array['nationality','consular'],now()),
  (null,'Sistema Nacional DIF','public_social_service','federal',array['child_protection','family_support'],now()),
  (null,'Comisión Nacional de los Derechos Humanos (CNDH)','human_rights_body','federal',array['human_rights'],now())
on conflict do nothing;

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

drop trigger if exists validate_social_referral_share on public.social_referral_shared_packets;

drop trigger if exists validate_social_document_share on public.social_document_shares;

drop trigger if exists validate_social_immigration_link on public.social_immigration_links;

drop trigger if exists enforce_social_referral_completion on public.social_referrals;

drop trigger if exists protect_closed_social_case on public.social_cases;

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

revoke all on public.social_identifier_counters from authenticated;

drop trigger if exists social_person_number_assign on public.social_people;

drop trigger if exists social_person_number_immutable on public.social_people;

drop trigger if exists social_family_number_assign on public.social_families;

drop trigger if exists social_family_number_immutable on public.social_families;

drop trigger if exists social_referral_number_assign on public.social_referrals;

drop trigger if exists social_referral_number_immutable on public.social_referrals;

revoke all on function public.social_support_access_active(uuid,text,uuid) from public;

grant execute on function public.social_support_access_active(uuid,text,uuid) to authenticated;

drop policy if exists social_family_members_access on public.social_family_members;

drop policy if exists social_consents_access on public.social_consents;

drop policy if exists social_case_files_read on storage.objects;

drop policy if exists social_case_files_insert on storage.objects;

drop policy if exists social_case_files_update on storage.objects;

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

revoke all on public.billing_provider_settings from anon, authenticated;

insert into public.billing_provider_settings(provider,enabled)
values ('mercadopago',true),('stripe',false)
on conflict(provider) do nothing;

drop trigger if exists billing_provider_keep_one_enabled on public.billing_provider_settings;

revoke all on public.billing_provider_events from anon, authenticated;

drop trigger if exists billing_provider_toggle_audit on public.billing_provider_settings;

revoke all on function public.create_social_family(uuid,text,uuid,jsonb,uuid[]) from public;

revoke all on function public.create_social_consent(uuid,uuid,uuid,text,text,text,text,text[],text[],text[],text,timestamptz,jsonb) from public;

revoke all on function public.create_social_assessment_initial(uuid,uuid,text,text,text,text,text,text,jsonb,date,boolean,text) from public;

revoke all on function public.create_social_care_plan(uuid,text,text,jsonb) from public;

grant execute on function public.create_social_family(uuid,text,uuid,jsonb,uuid[]) to authenticated;

grant execute on function public.create_social_consent(uuid,uuid,uuid,text,text,text,text,text[],text[],text[],text,timestamptz,jsonb) to authenticated;

grant execute on function public.create_social_assessment_initial(uuid,uuid,text,text,text,text,text,text,jsonb,date,boolean,text) to authenticated;

grant execute on function public.create_social_care_plan(uuid,text,text,jsonb) to authenticated;

drop policy if exists social_case_files_insert on storage.objects;

drop policy if exists social_case_files_update on storage.objects;

update public.social_programs
set name_es=coalesce(name_es,name),name_en=coalesce(name_en,name)
where name_es is null or name_en is null;

insert into public.social_programs(org_id,name,name_es,name_en,code,case_prefix,settings)
select o.id,'Atención Integral','Atención Integral','Comprehensive Care',
       'atencion_integral','NYR-SOC','{"default_language":"es"}'::jsonb
from public.organizations o
where not exists(select 1 from public.social_programs p where p.org_id=o.id);

revoke all on function public.ensure_social_program_for_org(uuid,text,text,text) from public;

grant execute on function public.ensure_social_program_for_org(uuid,text,text,text) to authenticated;

revoke all on function public.assign_social_case_manager(uuid,uuid,text) from public;

revoke all on function public.send_social_referral(uuid,text,jsonb,timestamptz) from public;

revoke all on function public.verify_social_referral_result(uuid,text,text,text) from public;

revoke all on function public.advance_social_transfer(uuid,text) from public;

revoke all on function public.accept_social_transfer(uuid) from public;

revoke all on function public.register_social_document(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,bigint,boolean) from public;

revoke all on function public.add_social_document_version(uuid,text,text,text,bigint,text) from public;

revoke all on function public.refresh_social_case_alerts(uuid) from public;

grant execute on function public.assign_social_case_manager(uuid,uuid,text) to authenticated;

grant execute on function public.send_social_referral(uuid,text,jsonb,timestamptz) to authenticated;

grant execute on function public.verify_social_referral_result(uuid,text,text,text) to authenticated;

grant execute on function public.advance_social_transfer(uuid,text) to authenticated;

grant execute on function public.accept_social_transfer(uuid) to authenticated;

grant execute on function public.register_social_document(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,bigint,boolean) to authenticated;

grant execute on function public.add_social_document_version(uuid,text,text,text,bigint,text) to authenticated;

grant execute on function public.refresh_social_case_alerts(uuid) to authenticated;

revoke all on function public.create_account_organization(text,text,text) from public;

grant execute on function public.create_account_organization(text,text,text) to authenticated;

begin;

revoke all on function public.social_is_platform_admin(uuid) from public;

revoke all on function public.social_is_org_member(uuid,uuid) from public;

revoke all on function public.social_can_manage_org(uuid,uuid) from public;

revoke all on function public.social_can_contribute_org(uuid,uuid) from public;

grant execute on function public.social_is_platform_admin(uuid) to authenticated, service_role;

grant execute on function public.social_is_org_member(uuid,uuid) to authenticated, service_role;

grant execute on function public.social_can_manage_org(uuid,uuid) to authenticated, service_role;

grant execute on function public.social_can_contribute_org(uuid,uuid) to authenticated, service_role;

alter policy social_programs_manage on public.social_programs
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

alter policy social_offices_read on public.social_offices
using (public.social_is_org_member(org_id,auth.uid()));

alter policy social_offices_manage on public.social_offices
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

alter policy social_roles_self_read on public.social_role_assignments
using (user_id=auth.uid() or public.social_can_manage_org(org_id,auth.uid()));

alter policy social_roles_manage on public.social_role_assignments
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

alter policy social_people_create on public.social_people
with check (public.social_is_org_member(org_id,auth.uid()) and created_by=auth.uid()
  and (public.social_has_capability(org_id,'person.manage',auth.uid()) or public.social_can_manage_org(org_id,auth.uid())));

alter policy social_people_update on public.social_people
using (public.social_can_access_person(id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
))
with check (public.social_can_access_person(id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
));

alter policy social_families_read on public.social_families
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid()) or created_by=auth.uid()
  or assigned_case_manager=auth.uid()
  or exists(select 1 from public.social_cases c where c.family_id=id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
));

alter policy social_families_write on public.social_families
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
))
with check (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'person.manage',auth.uid())
));

alter policy social_cases_create on public.social_cases
with check (public.social_is_org_member(org_id,auth.uid()) and created_by=auth.uid()
  and (public.social_has_capability(org_id,'case.create',auth.uid()) or public.social_can_manage_org(org_id,auth.uid())));

alter policy social_assignments_manage on public.social_case_assignments
using (public.social_can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'case.view_all',auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'case.view_all',auth.uid()));

alter policy social_grants_read on public.social_record_grants
using (user_id=auth.uid() or public.social_can_manage_org(org_id,auth.uid()));

alter policy social_grants_manage on public.social_record_grants
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

alter policy social_institutions_read on public.social_institutions
using (org_id is null or public.social_is_org_member(org_id,auth.uid()));

alter policy social_institutions_manage on public.social_institutions
using (org_id is not null and public.social_can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.social_can_manage_org(org_id,auth.uid()));

alter policy social_templates_read on public.social_assessment_templates
using (org_id is null or public.social_is_org_member(org_id,auth.uid()));

alter policy social_templates_manage on public.social_assessment_templates
using (org_id is not null and public.social_can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.social_can_manage_org(org_id,auth.uid()));

alter policy social_packets_sender on public.social_referral_shared_packets
using (public.social_is_org_member(org_id,auth.uid()))
with check (public.social_is_org_member(org_id,auth.uid()) and public.social_consent_covers(consent_id,receiving_org_id::text,purpose,array(select jsonb_object_keys(shared_fields))));

alter policy social_packets_receiver_read on public.social_referral_shared_packets
using (public.social_is_org_member(receiving_org_id,auth.uid()) and revoked_at is null and (expires_at is null or expires_at>now()));

alter policy social_document_shares_sender on public.social_document_shares
using (public.social_is_org_member(org_id,auth.uid()))
with check (public.social_is_org_member(org_id,auth.uid()) and public.social_consent_covers(consent_id,receiving_org_id::text,purpose,array['document']));

alter policy social_document_shares_receiver_read on public.social_document_shares
using (public.social_is_org_member(receiving_org_id,auth.uid()) and revoked_at is null and (expires_at is null or expires_at>now()));

alter policy social_activity_read on public.social_activity_events
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or actor_id=auth.uid()
  or public.social_has_capability(org_id,'audit.view',auth.uid())
));

alter policy social_activity_insert on public.social_activity_events
with check (public.social_is_org_member(org_id,auth.uid()) and actor_id=auth.uid());

alter policy social_indicators_read on public.social_indicator_snapshots
using (public.social_is_org_member(org_id,auth.uid()) and (
  public.social_can_manage_org(org_id,auth.uid())
  or public.social_has_capability(org_id,'indicators.view',auth.uid())
  or public.social_has_capability(org_id,'indicators.deidentified',auth.uid())
));

alter policy social_indicators_manage on public.social_indicator_snapshots
using (public.social_can_manage_org(org_id,auth.uid()))
with check (public.social_can_manage_org(org_id,auth.uid()));

alter policy social_family_members_read on public.social_family_members
using (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_families f where f.id=family_id and (
    f.created_by=auth.uid() or f.assigned_case_manager=auth.uid()
    or exists(select 1 from public.social_cases c where c.family_id=f.id and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
  ))
);

alter policy social_family_members_write on public.social_family_members
using (
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

alter policy social_consents_read on public.social_consents
using (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',false,auth.uid()))
);

alter policy social_consents_insert on public.social_consents
with check (
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

alter policy social_consents_update on public.social_consents
using (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
) with check (
  public.social_can_manage_org(org_id,auth.uid())
  or exists(select 1 from public.social_cases c where (c.person_id=person_id or c.family_id=family_id)
      and public.social_can_access_case(c.id,'general_case_record',true,auth.uid()))
);

alter policy social_indicator_definitions_read on public.social_indicator_definitions
using (org_id is null or public.social_is_org_member(org_id,auth.uid()));

alter policy social_indicator_definitions_manage on public.social_indicator_definitions
using (org_id is not null and public.social_can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.social_can_manage_org(org_id,auth.uid()));

alter policy social_retention_read on public.social_retention_actions
using (public.social_can_manage_org(org_id,auth.uid()) or public.social_has_capability(org_id,'audit.view',auth.uid()));

alter policy social_retention_write on public.social_retention_actions
with check (requested_by=auth.uid() and public.social_can_manage_org(org_id,auth.uid())
  and public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid()));

alter policy social_support_grants_read on public.social_support_access_grants
using (support_user_id=auth.uid() or public.social_can_manage_org(org_id,auth.uid()));

alter policy social_support_grants_manage on public.social_support_access_grants
using (public.social_can_manage_org(org_id,auth.uid()))
with check (approved_by=auth.uid() and public.social_can_manage_org(org_id,auth.uid()));

begin;

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

update public.social_institutions set official_name=coalesce(official_name,name) where official_name is null;

do $$ begin
  alter table public.social_institutions add constraint social_institutions_geo_check
    check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.social_institutions add constraint social_institutions_status_check
    check (status in ('verified','verification_due','unverified','temporarily_unavailable','at_capacity','closed','archived'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.social_institutions add constraint social_institutions_cost_check
    check (cost_type in ('free','sliding_scale','paid','public_coverage','unknown'));
exception when duplicate_object then null; end $$;

drop policy if exists social_institutions_read on public.social_institutions;

drop policy if exists social_institutions_manage on public.social_institutions;

revoke all on function public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer) from public,anon;

grant execute on function public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer) to authenticated;

revoke all on function public.verify_resource(uuid,text,text,text,text,timestamptz) from public,anon;

grant execute on function public.verify_resource(uuid,text,text,text,text,timestamptz) to authenticated;

insert into public.resource_service_categories(org_id,code,name_es,name_en,sort_order) values
 (null,'legal_aid','Asistencia jurídica','Legal aid',10),(null,'shelter','Albergue','Shelter',20),
 (null,'health','Salud','Health',30),(null,'mental_health','Salud mental','Mental health',40),
 (null,'social_support','Apoyo social','Social support',50),(null,'interpretation','Interpretación','Interpretation',60),
 (null,'court','Tribunales','Courts',70),(null,'notary','Notarías','Notaries',80),
 (null,'government','Instituciones públicas','Government agencies',90)
on conflict (org_id,code) do update set name_es=excluded.name_es,name_en=excluded.name_en,active=true;

comment on function public.search_resource_network is 'Neutral directory search only. Never accepts person, family, case, document, or client-identifying data.';

comment on column public.social_institutions.internal_notes is 'Organization-only operational knowledge; never include in public or referral payloads.';

comment on column public.social_institutions.location_confidential is 'General search suppresses address and coordinates for protected facilities.';

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

drop policy if exists social_case_document_requirements_access on public.social_case_document_requirements;

drop policy if exists social_document_access_events_read on public.social_document_access_events;

drop policy if exists social_document_access_events_insert on public.social_document_access_events;

drop trigger if exists audit_social_document_access_events on public.social_document_access_events;

revoke all on function public.social_media_upload_allowed(uuid,text,uuid) from public,anon;

grant execute on function public.social_media_upload_allowed(uuid,text,uuid) to authenticated;

drop policy if exists social_case_files_insert on storage.objects;

drop policy if exists social_case_files_update on storage.objects;

drop trigger if exists audit_social_case_document_requirements on public.social_case_document_requirements;

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

revoke all on function public.social_document_inventory(uuid) from public,anon;

grant execute on function public.social_document_inventory(uuid) to authenticated;

revoke all on function public.update_social_document_metadata(uuid,text,text,text,text,text,text[],text,text,timestamptz,boolean,jsonb) from public,anon;

grant execute on function public.update_social_document_metadata(uuid,text,text,text,text,text,text[],text,text,timestamptz,boolean,jsonb) to authenticated;

revoke all on function public.move_social_document(uuid,uuid,text,text,text,bigint,text) from public,anon;

grant execute on function public.move_social_document(uuid,uuid,text,text,text,bigint,text) to authenticated;

update public.resource_knowledge_records set approval_status='archived' where approval_status='retired';

update public.resource_knowledge_records set approval_status='pending_review' where approval_status='in_review';

drop policy if exists resource_knowledge_read on public.resource_knowledge_records;

drop policy if exists knowledge_corrections_access on public.resource_knowledge_corrections;

drop policy if exists knowledge_case_actions_access on public.resource_knowledge_case_actions;

drop policy if exists knowledge_usage_insert on public.resource_knowledge_usage;

drop policy if exists knowledge_usage_manage on public.resource_knowledge_usage;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('social-knowledge-files','social-knowledge-files',false,52428800,array[
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg','image/png','text/plain','text/markdown'
])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists social_knowledge_files_read on storage.objects;

drop policy if exists social_knowledge_files_write on storage.objects;

comment on table public.resource_knowledge_case_actions is
'Case-scoped workflow references only. Rows do not create evidence or enter Legal Intelligence.';

drop policy if exists social_care_assistant_runs_access on public.social_care_assistant_runs;

drop policy if exists social_care_action_proposals_access on public.social_care_action_proposals;

comment on table public.social_care_assistant_runs is
'Permission-first Talk to Care Case audit. Retrieval is case/org scoped and excludes restricted record types by default.';

comment on table public.social_care_action_proposals is
'Preview-and-confirm actions. Assistant output alone never mutates material case state.';

begin;

drop policy if exists social_sales_demo_owner_read on public.social_sales_demo_records;

revoke all on public.social_sales_demo_records from public,anon,authenticated;

grant select on public.social_sales_demo_records to authenticated;

revoke all on function public.social_sales_demo_owner_allows(text,uuid,uuid) from public,anon;

grant execute on function public.social_sales_demo_owner_allows(text,uuid,uuid) to authenticated,service_role;

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

revoke all on function public.social_sales_demo_any_owner_allows(uuid,uuid) from public,anon;

grant execute on function public.social_sales_demo_any_owner_allows(uuid,uuid) to authenticated,service_role;

alter policy social_activity_read on public.social_activity_events
 using (public.social_sales_demo_any_owner_allows(entity_id,auth.uid())
  and (social_case_id is null or public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()))
  and public.is_org_member(org_id,auth.uid())
  and (public.can_manage_org(org_id,auth.uid()) or actor_id=auth.uid() or public.social_has_capability(org_id,'audit.view',auth.uid())));

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

begin;

revoke all on function public.social_can_access_case(uuid,text,boolean,uuid) from public,anon;

grant execute on function public.social_can_access_case(uuid,text,boolean,uuid) to authenticated,service_role;

notify pgrst,'reload schema';

commit;

begin;

alter type public.org_role add value if not exists 'firm_manager';

alter type public.org_role add value if not exists 'supervisor';

alter type public.org_role add value if not exists 'case_worker';

alter type public.org_role add value if not exists 'legal_provider';

alter type public.org_role add value if not exists 'psychosocial_provider';

drop policy if exists organization_invitations_manage on public.organization_invitations;

revoke all on function public.social_org_seat_limit(uuid) from public,anon;

revoke all on function public.social_org_seats_used(uuid) from public,anon;

revoke all on function public.invite_social_organization_member(uuid,text,text) from public,anon;

revoke all on function public.accept_social_organization_invitation(text) from public,anon;

revoke all on function public.set_social_organization_member(uuid,uuid,text,text) from public,anon;

revoke all on function public.get_social_organization_account(uuid) from public,anon;

grant execute on function public.social_org_seat_limit(uuid) to authenticated,service_role;

grant execute on function public.social_org_seats_used(uuid) to authenticated,service_role;

grant execute on function public.invite_social_organization_member(uuid,text,text) to authenticated;

grant execute on function public.accept_social_organization_invitation(text) to authenticated;

grant execute on function public.set_social_organization_member(uuid,uuid,text,text) to authenticated;

grant execute on function public.get_social_organization_account(uuid) to authenticated;

notify pgrst,'reload schema';

commit;

begin;

revoke all on public.organization_entitlements from anon,authenticated;

revoke all on public.organization_usage_periods from anon,authenticated;

revoke all on public.organization_usage_events from anon,authenticated;

revoke all on public.billing_webhook_events from anon,authenticated;

grant all on public.organization_entitlements to service_role;

grant all on public.organization_usage_periods to service_role;

grant all on public.organization_usage_events to service_role;

grant all on public.billing_webhook_events to service_role;

drop trigger if exists organization_invitations_require_subscription
  on public.organization_invitations;

revoke all on function public.provision_organization_subscription_from_webhook(
  text,text,text,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text
) from public,anon,authenticated;

grant execute on function public.provision_organization_subscription_from_webhook(
  text,text,text,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text
) to service_role;

revoke all on function public.social_org_subscription_active(uuid) from public,anon;

revoke all on function public.social_org_employee_seat_limit(uuid) from public,anon;

revoke all on function public.social_org_employee_seats_used(uuid) from public,anon;

grant execute on function public.social_org_subscription_active(uuid) to authenticated,service_role;

grant execute on function public.social_org_employee_seat_limit(uuid) to authenticated,service_role;

grant execute on function public.social_org_employee_seats_used(uuid) to authenticated,service_role;

notify pgrst,'reload schema';

commit;

revoke all on table public.social_role_capabilities from anon;

revoke all on table public.social_role_capabilities from public;

grant select on table public.social_role_capabilities to authenticated;

grant all on table public.social_role_capabilities to service_role;

drop policy if exists social_role_capabilities_read on public.social_role_capabilities;

drop policy if exists social_role_capabilities_admin_write on public.social_role_capabilities;

drop policy if exists billing_plans_public_read on public.billing_plans;

revoke all on table public.billing_plans from anon;

revoke all on table public.billing_plans from public;

grant select, insert, update, delete on table public.billing_plans to authenticated;

grant all on table public.billing_plans to service_role;

revoke all on function public.list_public_billing_plans() from public;

grant execute on function public.list_public_billing_plans() to anon, authenticated, service_role;

revoke all on table public.demo_case_documents from anon;

revoke all on table public.demo_case_documents from public;

grant select, insert, update, delete on table public.demo_case_documents to authenticated;

grant all on table public.demo_case_documents to service_role;

drop policy if exists demo_case_documents_authenticated_read on public.demo_case_documents;

drop policy if exists "Public can read demo-cases storage objects" on storage.objects;

revoke all on table public.plan_entitlements from public;

grant all on table public.plan_entitlements to service_role;

revoke all on table public.feature_flags from anon;

revoke all on table public.feature_flags from public;

grant all on table public.feature_flags to service_role;

begin;

update public.social_cases
set priority=case
  when priority in ('low','normal') then 'standard'
  when priority in ('high','urgent') then 'urgent'
  else priority
end
where priority in ('low','normal','high','urgent');

revoke all on public.social_case_status_history from anon,public;

grant select on public.social_case_status_history to authenticated;

grant all on public.social_case_status_history to service_role;

drop policy if exists social_case_status_history_read on public.social_case_status_history;

revoke all on function public.create_and_assign_care_case(
  uuid,uuid,uuid,text,uuid,text,text,uuid
) from public,anon;

grant execute on function public.create_and_assign_care_case(
  uuid,uuid,uuid,text,uuid,text,text,uuid
) to authenticated,service_role;

revoke all on function public.invite_social_organization_member(uuid,text,text) from authenticated,anon,public;

revoke all on function public.invite_social_organization_member(uuid,text,text,text,text) from public,anon;

grant execute on function public.invite_social_organization_member(uuid,text,text,text,text) to authenticated,service_role;

revoke all on function public.get_social_organization_account(uuid) from public,anon;

grant execute on function public.get_social_organization_account(uuid) to authenticated,service_role;

notify pgrst,'reload schema';

commit;

begin;

drop trigger if exists social_intake_number_assign on public.social_intakes;

drop trigger if exists social_intake_number_immutable on public.social_intakes;

revoke all on public.social_intake_number_counters from anon, public, authenticated;

revoke all on public.social_intakes from anon, public;

grant select on public.social_intakes to authenticated;

grant all on public.social_intake_number_counters, public.social_intakes to service_role;

drop policy if exists social_intakes_read on public.social_intakes;

revoke all on function public.create_social_intake(
  uuid, uuid, uuid, uuid, text, text, text[], uuid
) from public, anon;

revoke all on function public.complete_social_intake(
  uuid, text, text
) from public, anon;

revoke all on function public.open_care_case_from_intake(
  uuid, text, text, uuid
) from public, anon;

grant execute on function public.create_social_intake(
  uuid, uuid, uuid, uuid, text, text, text[], uuid
) to authenticated, service_role;

grant execute on function public.complete_social_intake(
  uuid, text, text
) to authenticated, service_role;

grant execute on function public.open_care_case_from_intake(
  uuid, text, text, uuid
) to authenticated, service_role;

update public.social_case_assignments
set assignment_role = 'case_manager'
where assignment_role = 'primary_case_manager';

with ranked as (
  select id,
    row_number() over (
      partition by social_case_id, assignment_role
      order by assigned_at desc, id desc
    ) as position
  from public.social_case_assignments
  where active
    and assignment_role in ('case_manager', 'supervisor')
)
update public.social_case_assignments a
set active = false,
    ended_at = coalesce(a.ended_at, now())
from ranked r
where a.id = r.id
  and r.position > 1;

drop trigger if exists canonicalize_social_assignment_role
  on public.social_case_assignments;

notify pgrst, 'reload schema';

commit;

begin;

drop trigger if exists social_intake_number_assign on public.social_intakes;

drop trigger if exists social_intake_number_immutable on public.social_intakes;

revoke all on public.social_intake_number_counters from anon, public, authenticated;

revoke all on public.social_intakes from anon, public;

grant select on public.social_intakes to authenticated;

grant all on public.social_intake_number_counters, public.social_intakes to service_role;

drop policy if exists social_intakes_read on public.social_intakes;

revoke all on function public.create_social_intake(
  uuid, uuid, uuid, uuid, text, text, text[], uuid
) from public, anon;

revoke all on function public.complete_social_intake(
  uuid, text, text
) from public, anon;

revoke all on function public.open_care_case_from_intake(
  uuid, text, text, uuid
) from public, anon;

grant execute on function public.create_social_intake(
  uuid, uuid, uuid, uuid, text, text, text[], uuid
) to authenticated, service_role;

grant execute on function public.complete_social_intake(
  uuid, text, text
) to authenticated, service_role;

grant execute on function public.open_care_case_from_intake(
  uuid, text, text, uuid
) to authenticated, service_role;

update public.social_case_assignments
set assignment_role = 'case_manager'
where assignment_role = 'primary_case_manager';

with ranked as (
  select id,
    row_number() over (
      partition by social_case_id, assignment_role
      order by assigned_at desc, id desc
    ) as position
  from public.social_case_assignments
  where active
    and assignment_role in ('case_manager', 'supervisor')
)
update public.social_case_assignments a
set active = false,
    ended_at = coalesce(a.ended_at, now())
from ranked r
where a.id = r.id
  and r.position > 1;

drop trigger if exists canonicalize_social_assignment_role
  on public.social_case_assignments;

notify pgrst, 'reload schema';

commit;

begin;

revoke all on function public.update_care_case_state(
  uuid, text, text, text
) from public, anon;

grant execute on function public.update_care_case_state(
  uuid, text, text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

begin;

do $cleanup$
declare
  v_owner constant uuid := 'd1c91a8d-de47-48c9-95b4-519c60ae8e04';
  v_org constant uuid := '121250d0-c4bd-49ff-8a9e-e9557b0f88fb';
  v_fixture constant text := 'comprehensive-care-sales-demo-v1';
  v_result jsonb;
begin
  if to_regclass('public.social_sales_demo_records') is null then
    raise exception 'Demo manifest table is missing; cleanup cannot be safely scoped';
  end if;

  if to_regprocedure('public.remove_existing_account_comprehensive_care_demo()') is null then
    raise exception 'Scoped demo cleanup function is missing';
  end if;

  -- The original cleanup function intentionally requires the fixture owner.
  -- Supply that identity only inside this transaction so its existing safety
  -- checks and manifest-scoped deletion path remain authoritative.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  execute 'select public.remove_existing_account_comprehensive_care_demo()'
    into v_result;

  if coalesce((v_result ->> 'removed')::boolean, false) is not true then
    raise exception 'Comprehensive Care demo cleanup did not confirm removal';
  end if;

  if exists (
    select 1
    from public.social_sales_demo_records
    where fixture_version = v_fixture
      and owner_user_id = v_owner
      and org_id = v_org
  ) then
    raise exception 'Comprehensive Care demo manifest rows remain after cleanup';
  end if;

  if exists (
    select 1
    from public.social_cases
    where id in (
      'd3000000-0000-4000-8000-000000000417',
      'd3000000-0000-4000-8000-000000000318',
      'd3000000-0000-4000-8000-000000000271',
      'd3000000-0000-4000-8000-000000000199'
    )
       or (
         org_id = v_org
         and case_number in (
           'NYR-SOC-2026-000417',
           'NYR-SOC-2026-000318',
           'NYR-SOC-2026-000271',
           'NYR-SOC-2026-000199'
         )
         and tags @> array[v_fixture]::text[]
       )
  ) then
    raise exception 'Synthetic Comprehensive Care cases remain after cleanup';
  end if;
end
$cleanup$;

drop function if exists public.register_existing_account_care_demo_document_version(
  text, text, text, bigint
);

drop function if exists public.register_existing_account_care_demo_document(
  text, text, text, text, text, text, bigint
);

drop function if exists public.existing_account_care_demo_storage_paths();

drop function if exists public.existing_account_care_demo_dry_run();

drop function if exists public.populate_existing_account_comprehensive_care_demo();

drop function if exists public.remove_existing_account_comprehensive_care_demo();

drop function if exists public.demo_manifest(text, uuid, text);

drop function if exists public.assert_existing_account_care_demo_owner();

notify pgrst, 'reload schema';

commit;

revoke all on function public.close_social_case(uuid,text,text,jsonb) from public;

grant execute on function public.close_social_case(uuid,text,text,jsonb) to authenticated;

begin;

revoke all on function public.activate_existing_social_invitee(uuid) from public,anon;

grant execute on function public.activate_existing_social_invitee(uuid) to authenticated,service_role;

revoke all on function public.accept_matching_social_organization_invitations() from public,anon;

grant execute on function public.accept_matching_social_organization_invitations() to authenticated,service_role;

revoke all on function public.accept_social_organization_invitation(text) from public,anon;

grant execute on function public.accept_social_organization_invitation(text) to authenticated,service_role;

notify pgrst,'reload schema';

commit;

begin;

revoke all on function public.get_social_organization_account(uuid) from public,anon;

grant execute on function public.get_social_organization_account(uuid) to authenticated,service_role;

notify pgrst,'reload schema';

commit;

begin;

revoke all on function public.enforce_social_case_manager_creation() from public,anon,authenticated;

grant execute on function public.enforce_social_case_manager_creation() to service_role;

drop trigger if exists social_cases_manager_only_insert on public.social_cases;

comment on function public.enforce_social_case_manager_creation() is
'Rejects interactive Comprehensive Care case creation unless the authenticated user manages the target organization.';

notify pgrst,'reload schema';

commit;

begin;

with existing_maximums as (
  select
    c.org_id,
    c.program_id,
    coalesce(
      substring(c.case_number from '-([0-9]{4})-[0-9]+$')::integer,
      extract(year from coalesce(c.intake_date,current_date))::integer
    ) as calendar_year,
    max(substring(c.case_number from '([0-9]+)$')::bigint) as last_number
  from public.social_cases c
  where c.case_number ~ '[0-9]+$'
  group by
    c.org_id,
    c.program_id,
    coalesce(
      substring(c.case_number from '-([0-9]{4})-[0-9]+$')::integer,
      extract(year from coalesce(c.intake_date,current_date))::integer
    )
)
insert into public.social_case_number_counters(org_id,program_id,calendar_year,last_number)
select org_id,program_id,calendar_year,last_number
from existing_maximums
where last_number is not null
on conflict(org_id,program_id,calendar_year)
do update set last_number=greatest(
  public.social_case_number_counters.last_number,
  excluded.last_number
);

revoke all on function public.assign_social_case_number() from public,anon,authenticated;

grant execute on function public.assign_social_case_number() to service_role;

drop trigger if exists social_case_number_assign on public.social_cases;

comment on function public.assign_social_case_number() is
'Atomically allocates a unique immutable organization case number independent of client name and case type.';

notify pgrst,'reload schema';

commit;

revoke all on function public.social_org_unlimited_seats(uuid) from public, anon;

grant execute on function public.social_org_unlimited_seats(uuid) to authenticated, service_role;

begin;

revoke all on function public.social_can_access_case(uuid,text,boolean,uuid) from public, anon;

grant execute on function public.social_can_access_case(uuid,text,boolean,uuid)
  to authenticated, service_role;

drop policy if exists social_cases_direct_participant_read on public.social_cases;

revoke all on function public.get_social_case_core(uuid) from public, anon;

grant execute on function public.get_social_case_core(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

begin;

revoke all on function public.delete_social_case_by_assigning_manager(uuid,text)
  from public, anon;

grant execute on function public.delete_social_case_by_assigning_manager(uuid,text)
  to authenticated, service_role;

notify pgrst,'reload schema';

commit;

begin;

revoke all on function public.social_media_upload_allowed(uuid,text,uuid) from public,anon;

grant execute on function public.social_media_upload_allowed(uuid,text,uuid) to authenticated;

drop policy if exists social_case_files_update on storage.objects;

notify pgrst,'reload schema';

commit;

drop policy if exists social_consents_update on public.social_consents;

drop policy if exists social_document_access_events_read on public.social_document_access_events;

revoke all on function public.social_activity_entity_visible(text, uuid, uuid, uuid) from public;

revoke all on function public.social_activity_entity_visible(text, uuid, uuid, uuid) from anon;

grant execute on function public.social_activity_entity_visible(text, uuid, uuid, uuid) to authenticated;

grant execute on function public.social_activity_entity_visible(text, uuid, uuid, uuid) to service_role;

drop policy if exists social_activity_read on public.social_activity_events;

drop policy if exists social_activity_insert on public.social_activity_events;

begin;

revoke all on function public.social_activity_entity_visible(text, uuid, uuid, uuid)
  from public, anon;

grant execute on function public.social_activity_entity_visible(text, uuid, uuid, uuid)
  to authenticated, service_role;

drop policy if exists social_activity_read on public.social_activity_events;

commit;

begin;

drop policy if exists billing_plans_public_marketing_read
  on public.billing_plans;

revoke all on table public.billing_plans from anon;

grant select (
  key,
  label,
  tagline,
  features,
  price_cents,
  currency,
  "interval",
  self_serve,
  contact_url,
  included_seats,
  per_seat_price_cents,
  sort_order
) on table public.billing_plans to anon;

alter function public.list_public_billing_plans()
  security invoker;

alter function public.list_public_billing_plans()
  set search_path = public, pg_temp;

revoke all on function public.list_public_billing_plans()
  from public;

grant execute on function public.list_public_billing_plans()
  to anon, authenticated, service_role;

commit;

DO $$ BEGIN
  CREATE TYPE public.security_incident_status AS ENUM ('open','triage','contained','investigating','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.security_incidents TO authenticated;

GRANT ALL ON public.security_incidents TO service_role;

DROP POLICY IF EXISTS security_incidents_admin_select ON public.security_incidents;

DROP POLICY IF EXISTS security_incidents_admin_insert ON public.security_incidents;

DROP POLICY IF EXISTS security_incidents_admin_update ON public.security_incidents;

DROP TRIGGER IF EXISTS trg_security_incidents_updated_at ON public.security_incidents;

GRANT SELECT ON public.legal_document_versions TO authenticated;

GRANT INSERT, UPDATE ON public.legal_document_versions TO authenticated;

GRANT ALL ON public.legal_document_versions TO service_role;

DROP POLICY IF EXISTS legal_document_versions_read_active ON public.legal_document_versions;

DROP POLICY IF EXISTS legal_document_versions_admin_insert ON public.legal_document_versions;

DROP POLICY IF EXISTS legal_document_versions_admin_update ON public.legal_document_versions;

DROP TRIGGER IF EXISTS trg_legal_document_versions_updated_at ON public.legal_document_versions;

GRANT SELECT, INSERT, UPDATE ON public.user_consents TO authenticated;

GRANT ALL ON public.user_consents TO service_role;

DROP POLICY IF EXISTS user_consents_select_own ON public.user_consents;

DROP POLICY IF EXISTS user_consents_insert_own ON public.user_consents;

DROP POLICY IF EXISTS user_consents_update_own ON public.user_consents;

DROP TRIGGER IF EXISTS trg_user_consents_updated_at ON public.user_consents;

DO $$ BEGIN
  CREATE TYPE public.arco_request_status AS ENUM ('received','identity_pending','in_review','awaiting_information','resolved','rejected','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.arco_requests TO authenticated;

GRANT ALL ON public.arco_requests TO service_role;

DROP POLICY IF EXISTS arco_requests_select_own ON public.arco_requests;

DROP POLICY IF EXISTS arco_requests_insert_own ON public.arco_requests;

DROP POLICY IF EXISTS arco_requests_admin_update ON public.arco_requests;

DROP TRIGGER IF EXISTS trg_arco_requests_updated_at ON public.arco_requests;

GRANT SELECT, INSERT ON public.arco_request_events TO authenticated;

GRANT ALL ON public.arco_request_events TO service_role;

DROP POLICY IF EXISTS arco_request_events_select ON public.arco_request_events;

DROP POLICY IF EXISTS arco_request_events_insert ON public.arco_request_events;

REVOKE ALL ON public.security_incidents FROM anon;

REVOKE ALL ON public.legal_document_versions FROM anon;

REVOKE ALL ON public.user_consents FROM anon;

REVOKE ALL ON public.arco_requests FROM anon;

REVOKE ALL ON public.arco_request_events FROM anon;

COMMENT ON COLUMN public.case_findings.benefited_party IS
  'Party benefiting from a separately sourced legal-effect mapping. Distinct from speaker_role and affected_party.';

COMMENT ON COLUMN public.case_findings.score_dimension IS
  'Score dimension affected by an explicit, sourced legal-effect mapping. NULL means the legal proposition is score-neutral.';

COMMENT ON COLUMN public.case_findings.reason_for_score_effect IS
  'Auditable reason why the finding affects score_dimension; required by application invariants for non-neutral adopted holdings.';

COMMENT ON COLUMN public.cases.procedural_vehicle IS
  'Grounded procedural vehicle, e.g. amparo_directo_revision or apelacion; independent from underlying_materia.';

COMMENT ON COLUMN public.cases.underlying_materia IS
  'Grounded underlying legal materia. A case may be procedurally Amparo while this remains penal.';

COMMENT ON COLUMN public.case_timeline_events.event_type IS
  'Context classification for the date. Canonical primary chronology persists case_event only.';

COMMENT ON COLUMN public.case_timeline_events.source_quote IS
  'Grounded passage used to classify the date and event context.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_penal_dispositions TO authenticated;

GRANT ALL ON public.case_penal_dispositions TO service_role;

DROP POLICY IF EXISTS case_penal_dispositions_owner_all
  ON public.case_penal_dispositions;

COMMENT ON TABLE public.case_penal_dispositions IS
  'Grounded structured dispositive for Penal-origin cases. Rebuilt on rerun so prior outcomes cannot leak into a new report.';

drop policy if exists social_resource_communications_read on public.social_resource_communications;

drop policy if exists social_resource_communications_insert on public.social_resource_communications;

drop policy if exists social_resource_communications_update on public.social_resource_communications;

drop trigger if exists validate_social_resource_communication on public.social_resource_communications;

drop trigger if exists log_social_resource_communication on public.social_resource_communications;

comment on table public.social_resource_communications is
  'Case-linked audit record for explicit resource contact; sending is never automatic.';

do $$ begin
  alter table public.social_institutions add constraint social_institutions_contact_verification_check
    check (contact_verification in ('source_verified','manually_verified','unverified'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.social_institutions add constraint social_institutions_source_type_check
    check (source_type is null or source_type in ('official_api','official_website','official_directory','approved_authoritative','manual'));
exception when duplicate_object then null; end $$;

comment on column public.social_institutions.contact_verification is
  'source_verified = obtained directly from an approved official source; manually_verified = confirmed by an authorized administrator; unverified = present but reliability not established. Never set from AI-generated content.';

comment on column public.social_institutions.admin_locked_fields is
  'Fields corrected by an administrator. The automated refresh never overwrites these.';

grant select on public.resource_official_sources to authenticated;

grant all on public.resource_official_sources to service_role;

grant select on public.resource_contact_refresh_runs to authenticated;

grant all on public.resource_contact_refresh_runs to service_role;

drop policy if exists resource_official_sources_read on public.resource_official_sources;

drop policy if exists resource_official_sources_manage on public.resource_official_sources;

drop policy if exists resource_refresh_runs_read on public.resource_contact_refresh_runs;

insert into public.resource_official_sources
  (slug, official_name, institution_type, state_code, services, populations, source_urls, source_type, allowed_domains, website)
values
  ('comar','Comisión Mexicana de Ayuda a Refugiados (COMAR)','government',null,'{legal_aid,social_support,government}','{refugees,migrants}','{https://www.gob.mx/comar,https://www.gob.mx/comar/documentos}','official_website','{gob.mx,comar.gob.mx}','https://www.gob.mx/comar'),
  ('cndh','Comisión Nacional de los Derechos Humanos (CNDH)','government',null,'{legal_aid,government}','{general}','{https://www.cndh.org.mx/}','official_website','{cndh.org.mx}','https://www.cndh.org.mx/'),
  ('inm','Instituto Nacional de Migración (INM)','government',null,'{government,social_support}','{migrants}','{https://www.gob.mx/inm,https://www.gob.mx/inm/acciones-y-programas}','official_website','{gob.mx,inami.gob.mx,inm.gob.mx}','https://www.gob.mx/inm'),
  ('ceav','Comisión Ejecutiva de Atención a Víctimas (CEAV)','government',null,'{legal_aid,psychosocial,social_support}','{victims}','{https://www.gob.mx/ceav,https://www.gob.mx/ceav/acciones-y-programas}','official_website','{gob.mx,ceav.gob.mx}','https://www.gob.mx/ceav'),
  ('difnacional','Sistema Nacional para el Desarrollo Integral de la Familia (DIF)','government',null,'{social_support,psychosocial,shelter}','{children,families}','{https://www.gob.mx/difnacional,https://www.gob.mx/difnacional/acciones-y-programas}','official_website','{gob.mx,dif.gob.mx}','https://www.gob.mx/difnacional'),
  ('conavim','Comisión Nacional para Prevenir y Erradicar la Violencia contra las Mujeres (CONAVIM)','government',null,'{legal_aid,psychosocial,shelter}','{women,victims}','{https://www.gob.mx/conavim}','official_website','{gob.mx,conavim.gob.mx}','https://www.gob.mx/conavim'),
  ('inmujeres','Instituto Nacional de las Mujeres (INMUJERES)','government',null,'{social_support,legal_aid}','{women}','{https://www.gob.mx/inmujeres}','official_website','{gob.mx,inmujeres.gob.mx}','https://www.gob.mx/inmujeres'),
  ('profedet','Procuraduría Federal de la Defensa del Trabajo (PROFEDET)','government',null,'{legal_aid,government}','{workers}','{https://www.gob.mx/profedet}','official_website','{gob.mx,profedet.gob.mx,stps.gob.mx}','https://www.gob.mx/profedet'),
  ('profeco','Procuraduría Federal del Consumidor (PROFECO)','government',null,'{legal_aid,government}','{general}','{https://www.gob.mx/profeco}','official_website','{gob.mx,profeco.gob.mx}','https://www.gob.mx/profeco'),
  ('sipinna','Sistema Nacional de Protección de Niñas, Niños y Adolescentes (SIPINNA)','government',null,'{social_support,government}','{children}','{https://www.gob.mx/sipinna}','official_website','{gob.mx,sipinna.gob.mx}','https://www.gob.mx/sipinna')
on conflict (slug) do update set
  official_name=excluded.official_name,
  source_urls=excluded.source_urls,
  allowed_domains=excluded.allowed_domains,
  website=excluded.website,
  updated_at=now();

insert into public.social_institutions
  (org_id, name, official_name, institution_type, jurisdiction_level, services, populations,
   coverage_levels, website, source_slug, source_url, source_type, contact_verification,
   source_verified_fields, active, status, verification_status)
select null, s.official_name, s.official_name, s.institution_type, s.jurisdiction_level,
       s.services, s.populations, s.coverage_levels, s.website, s.slug, s.website, s.source_type,
       'source_verified', array['website']::text[], true, 'unverified', 'unverified'
from public.resource_official_sources s
where s.active
  and not exists (select 1 from public.social_institutions i where i.source_slug = s.slug);

update public.social_institutions i
set website = coalesce(nullif(i.website,''), s.website),
    source_url = coalesce(i.source_url, s.website),
    source_type = coalesce(i.source_type, s.source_type)
from public.resource_official_sources s
where i.source_slug = s.slug;

drop function if exists public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer);

comment on function public.search_resource_network is 'Neutral directory search only. Never accepts person, family, case, document, or client-identifying data.';

revoke all on function public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer) from public,anon;

grant execute on function public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer) to authenticated;

update public.resource_official_sources
set source_urls = array['https://www.gob.mx/inm','https://www.gob.mx/inm/acciones-y-programas']
where slug = 'inm';

update public.resource_official_sources
set source_urls = array['https://www.gob.mx/difnacional','https://www.gob.mx/difnacional/articulos']
where slug = 'difnacional';

update public.resource_official_sources
set source_urls = array['https://www.gob.mx/cndh','https://www.cndh.org.mx/'],
    allowed_domains = array['cndh.org.mx','gob.mx','www.gob.mx']
where slug = 'cndh';

DELETE FROM public.resource_knowledge_records WHERE org_id IS NULL AND 'nyrava_approved_library' = ANY(population_tags);

INSERT INTO public.resource_knowledge_records
 (org_id,title_es,title_en,summary_es,summary_en,content_es,content_en,knowledge_type,service_categories,state_codes,population_tags,authority,source_url,approval_status,approved_at,effective_at,last_verified_at,review_due_at,audience,language_codes,purpose,when_to_use,applicable_programs,required_steps,official_sources,internal_only)
VALUES
(NULL,'Procedimiento de atención a personas migrantes y solicitantes de refugio','Immigration and refugee intake procedure',
 'Guía operativa para la primera atención de personas migrantes, solicitantes de la condición de refugiado y personas con necesidades de protección internacional.',
 'Operational guidance for first contact with migrants, asylum seekers and people with international protection needs.',
 'Verifique situación migratoria declarada, riesgo de retorno y necesidades inmediatas. Documente el relato en las propias palabras de la persona. Informe plazos: la solicitud de la condición de refugiado ante la COMAR debe presentarse, por regla general, dentro de los 30 días hábiles siguientes al ingreso al país; existen excepciones por causa justificada. Nunca asesore sobre el fondo del caso si no es persona abogada: canalice a servicios jurídicos.',
 'Verify declared migration situation, risk on return and immediate needs. Record the account in the person''s own words. Explain deadlines: refugee status applications before COMAR are generally filed within 30 business days of entry, with justified exceptions. Never give substantive legal advice unless you are a lawyer: refer to legal services.',
 'procedure',ARRAY['immigration_refugees','referrals','case_management'],'{}',ARRAY['nyrava_approved_library','migrants','asylum_seekers'],'COMAR / INM','https://www.gob.mx/comar','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Estandarizar la primera atención y evitar la pérdida de plazos de protección internacional.','Al abrir un caso donde la persona declara ser migrante, refugiada o solicitante de asilo.',ARRAY['immigration'],
 '["Registrar identidad, nacionalidad, idioma y fecha aproximada de ingreso.","Detectar necesidades urgentes: salud, alimentación, alojamiento, protección de niñez.","Explicar plazos y alcance del trámite ante COMAR e INM sin ofrecer asesoría jurídica de fondo.","Recabar consentimiento informado antes de compartir información con cualquier institución.","Canalizar a servicios jurídicos y, si aplica, a albergue mediante la Red de Recursos.","Registrar la actuación en el expediente y programar seguimiento."]'::jsonb,
 '[{"title":"COMAR - Comisión Mexicana de Ayuda a Refugiados","url":"https://www.gob.mx/comar"},{"title":"Instituto Nacional de Migración","url":"https://www.gob.mx/inm"}]'::jsonb,true),

(NULL,'Cuándo canalizar a servicios jurídicos','When to refer to legal services',
 'Criterios para identificar cuándo un caso requiere asistencia jurídica y cómo canalizarlo.',
 'Criteria for identifying when a case requires legal assistance and how to refer it.',
 'El personal de atención no debe interpretar normas ni redactar promociones. Canalice cuando exista: riesgo de detención o deportación, procedimiento administrativo o judicial en curso, plazos legales corriendo, necesidad de representación de niñez, violencia con posible denuncia penal, o solicitud de reconocimiento de la condición de refugiado.',
 'Care staff must not interpret statutes or draft legal filings. Refer when there is: detention or removal risk, an open administrative or judicial procedure, running legal deadlines, a child needing representation, violence with a possible criminal complaint, or a refugee status application.',
 'procedure',ARRAY['legal_services','referrals','case_management'],'{}',ARRAY['nyrava_approved_library'],'Instituto Federal de Defensoría Pública','https://www.gob.mx/defensoriapublica','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Evitar la práctica no autorizada del derecho y asegurar acceso oportuno a defensa.','Cuando se detecte cualquier necesidad legal identificada en la guía.',ARRAY['legal'],
 '["Documentar el hecho y la necesidad jurídica identificada, sin calificarla jurídicamente.","Verificar consentimiento para compartir información con la instancia jurídica.","Buscar en la Red de Recursos la defensoría o clínica jurídica competente.","Crear la canalización y registrar acuse o número de referencia.","Programar seguimiento a 5 días hábiles."]'::jsonb,
 '[{"title":"Instituto Federal de Defensoría Pública","url":"https://www.gob.mx/defensoriapublica"}]'::jsonb,true),

(NULL,'Protocolo de protección de niñas, niños y adolescentes','Child protection safeguarding protocol',
 'Señales de alerta, medidas de protección y ruta de escalamiento ante posible vulneración de derechos de la niñez.',
 'Warning signs, protective measures and escalation route for possible child rights violations.',
 'Toda sospecha razonable de maltrato, abuso, abandono, explotación o niñez no acompañada debe escalarse el mismo día a supervisión y a la Procuraduría de Protección de Niñas, Niños y Adolescentes correspondiente. El interés superior de la niñez rige toda decisión (art. 4 constitucional; Ley General de los Derechos de Niñas, Niños y Adolescentes).',
 'Any reasonable suspicion of abuse, neglect, exploitation or an unaccompanied child must be escalated the same day to supervision and to the competent child protection authority. The best interests of the child govern every decision.',
 'protocol',ARRAY['child_protection','referrals','case_management'],'{}',ARRAY['nyrava_approved_library','children'],'SIPINNA / DIF / Procuraduría de Protección','https://www.gob.mx/sipinna','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Garantizar respuesta inmediata y trazable ante riesgos para la niñez.','Ante cualquier indicio de riesgo o vulneración de derechos de una persona menor de 18 años.',ARRAY['child_protection'],
 '["Asegurar la seguridad inmediata de la niña, niño o adolescente.","Registrar hechos observados de forma objetiva, sin inducir el relato.","Notificar a supervisión el mismo día y dejar constancia de la hora.","Reportar a la Procuraduría de Protección o al DIF competente.","Crear tarea de seguimiento y alerta de revisión a 24 y 72 horas.","Restringir el acceso al expediente conforme al nivel de confidencialidad."]'::jsonb,
 '[{"title":"SIPINNA","url":"https://www.gob.mx/sipinna"},{"title":"SNDIF","url":"https://www.gob.mx/difnacional"}]'::jsonb,true),

(NULL,'Metodología de trabajo social: valoración, plan y notas de caso','Social work practice: assessment, care plan and case notes',
 'Estructura mínima de la valoración social, del plan de atención y de las notas de seguimiento.',
 'Minimum structure for social assessment, care plan and follow-up notes.',
 'La valoración documenta necesidades, factores protectores y riesgos con evidencia observada. El plan de atención define objetivo, acción, responsable, fecha objetivo y resultado esperado. Las notas se registran en las 48 horas siguientes al contacto y describen hechos, no juicios.',
 'The assessment documents needs, protective factors and risks with observed evidence. The care plan sets goal, action, owner, target date and expected outcome. Notes are recorded within 48 hours of contact and describe facts, not opinions.',
 'intake_manual',ARRAY['social_work','case_management'],'{}',ARRAY['nyrava_approved_library'],'Nyrava México','','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Unificar la calidad y trazabilidad del expediente social.','En cada apertura de caso y en cada revisión periódica.',ARRAY['social_work'],
 '["Realizar la valoración inicial dentro de los 5 días hábiles de la apertura.","Registrar nivel de riesgo con justificación escrita.","Elaborar plan de atención con al menos un objetivo medible por necesidad.","Documentar cada contacto en nota de caso dentro de 48 horas.","Revisar el plan al menos cada 30 días o al cambiar el riesgo."]'::jsonb,'[]'::jsonb,true),

(NULL,'Valoración y canalización psicosocial','Psychosocial assessment and referral guidance',
 'Criterios de canalización psicosocial y escalamiento en crisis emocional.',
 'Psychosocial referral criteria and escalation in emotional crisis.',
 'Ante ideación suicida, autolesión, desorganización severa o crisis aguda, no deje sola a la persona, escale de inmediato a supervisión y active servicios de emergencia o la Línea de la Vida (800 911 2000). El personal no clínico no realiza diagnóstico.',
 'For suicidal ideation, self-harm, severe disorganization or acute crisis, do not leave the person alone, escalate immediately to supervision and activate emergency services or the national crisis line (800 911 2000). Non-clinical staff do not diagnose.',
 'risk_guidance',ARRAY['psychosocial_services','medical_emergency','referrals'],'{}',ARRAY['nyrava_approved_library'],'Secretaría de Salud - Línea de la Vida','https://www.gob.mx/salud/conadic','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Responder con seguridad ante crisis y canalizar a atención especializada.','Cuando se identifiquen indicadores emocionales de riesgo durante cualquier contacto.',ARRAY['psychosocial'],
 '["Aplicar contención básica y verificar seguridad inmediata.","Escalar a supervisión y registrar la hora de escalamiento.","Activar emergencia o línea de crisis si hay riesgo de vida.","Canalizar a servicio psicológico verificado mediante la Red de Recursos.","Crear alerta de seguimiento a 24 horas."]'::jsonb,
 '[{"title":"Línea de la Vida (800 911 2000)","url":"https://www.gob.mx/salud/conadic"}]'::jsonb,true),

(NULL,'Procedimiento de emergencia médica y activación externa','Medical emergency and external activation procedure',
 'Cuándo se requiere asistencia externa inmediata y cómo documentarla.',
 'When immediate outside assistance is required and how to document it.',
 'Llame al 911 ante pérdida de conciencia, hemorragia, dificultad respiratoria, lesión por violencia reciente, intoxicación o riesgo de vida. En violencia sexual reciente, la atención médica es urgente por plazos de profilaxis; no condicione la atención a la presentación de denuncia (NOM-046-SSA2-2005).',
 'Call 911 for loss of consciousness, bleeding, breathing difficulty, recent violence injury, poisoning or life risk. After recent sexual violence, medical care is urgent due to prophylaxis windows; never condition care on filing a criminal complaint (NOM-046-SSA2-2005).',
 'emergency_procedure',ARRAY['medical_emergency','domestic_violence','referrals'],'{}',ARRAY['nyrava_approved_library'],'Secretaría de Salud - NOM-046-SSA2-2005','https://www.gob.mx/salud','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Evitar demoras en atención de urgencia y dejar constancia de la actuación.','En cualquier situación con riesgo para la vida o la integridad física.',ARRAY['health'],
 '["Llamar al 911 y permanecer con la persona hasta la llegada de auxilio.","Notificar a supervisión y registrar hora de llamada y unidad receptora.","Registrar hechos observados en nota de caso sin diagnóstico clínico.","Canalizar a unidad de salud verificada para seguimiento.","Programar seguimiento a 24 horas."]'::jsonb,
 '[{"title":"NOM-046-SSA2-2005","url":"https://www.gob.mx/salud"}]'::jsonb,true),

(NULL,'Canalización a albergues y alojamiento temporal','Shelter and temporary housing referral guidance',
 'Elegibilidad, documentación y procedimiento para canalizar a albergue.',
 'Eligibility, documentation and procedure for shelter referrals.',
 'Confirme disponibilidad por teléfono antes de trasladar a la persona. Verifique si el albergue admite familias, hombres, niñez no acompañada o personas con discapacidad. No divulgue la ubicación de refugios para víctimas de violencia.',
 'Confirm availability by phone before moving anyone. Check whether the shelter admits families, men, unaccompanied children or people with disabilities. Never disclose the location of violence shelters.',
 'referral_instruction',ARRAY['housing_shelters','referrals','domestic_violence'],'{}',ARRAY['nyrava_approved_library'],'DIF / CONAVIM','https://www.gob.mx/conavim','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Asegurar alojamiento seguro y evitar traslados fallidos.','Cuando la persona carece de alojamiento seguro esa misma noche.',ARRAY['housing'],
 '["Valorar riesgo y composición del grupo familiar.","Confirmar cupo y requisitos por teléfono con el albergue.","Recabar consentimiento para compartir datos con el albergue.","Registrar la canalización con fecha, hora y persona contactada.","Confirmar el ingreso efectivo y registrar el resultado."]'::jsonb,
 '[{"title":"CONAVIM - Refugios","url":"https://www.gob.mx/conavim"}]'::jsonb,true),

(NULL,'Identificación y seguridad ante trata de personas','Human trafficking identification and safety guidance',
 'Indicadores de identificación, medidas de seguridad y ruta de escalamiento.',
 'Identification indicators, safety measures and escalation route.',
 'Indicadores: control de documentos por terceros, deuda impuesta, restricción de movimiento, jornada extrema, aislamiento, temor a hablar frente a acompañantes. Entreviste siempre a solas, nunca en presencia del posible tratante. Escale a supervisión y a la fiscalía especializada; existe la línea 800 5533 000.',
 'Indicators: third parties holding documents, imposed debt, movement restriction, extreme hours, isolation, fear of speaking in front of companions. Always interview alone, never with the possible trafficker present. Escalate to supervision and the specialized prosecutor; national line 800 5533 000.',
 'protocol',ARRAY['human_trafficking','child_protection','referrals'],'{}',ARRAY['nyrava_approved_library'],'FEVIMTRA / CNDH','https://www.gob.mx/fgr','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Identificar posibles víctimas sin poner en riesgo su seguridad.','Ante cualquier indicador de explotación laboral o sexual o de control coercitivo.',ARRAY['protection'],
 '["Separar a la persona de acompañantes y entrevistar en espacio privado.","No confrontar ni alertar a posibles responsables.","Registrar indicadores observados de forma objetiva.","Escalar el mismo día a supervisión y a la autoridad especializada.","Canalizar a refugio y atención a víctimas.","Restringir el expediente al personal estrictamente necesario."]'::jsonb,
 '[{"title":"FGR - FEVIMTRA","url":"https://www.gob.mx/fgr"},{"title":"CEAV","url":"https://www.gob.mx/ceav"}]'::jsonb,true),

(NULL,'Valoración de seguridad y canalización en violencia familiar','Domestic violence safety assessment and referral guide',
 'Valoración de riesgo, plan de seguridad, documentación y escalamiento.',
 'Risk assessment, safety planning, documentation and escalation.',
 'Valore riesgo letal: amenazas de muerte, armas en casa, estrangulamiento previo, separación reciente, acoso persistente, violencia durante embarazo. Ante riesgo alto, active plan de seguridad, informe sobre órdenes de protección y canalice a refugio y a la instancia de atención a mujeres. Línea nacional 800 108 4053.',
 'Assess lethality risk: death threats, weapons at home, prior strangulation, recent separation, persistent stalking, violence during pregnancy. For high risk, activate the safety plan, inform about protection orders, and refer to shelter and the women''s assistance authority. National line 800 108 4053.',
 'risk_guidance',ARRAY['domestic_violence','housing_shelters','legal_services','referrals'],'{}',ARRAY['nyrava_approved_library','women'],'CONAVIM / INMUJERES','https://www.gob.mx/conavim','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Reducir riesgo letal y conectar con protección y servicios especializados.','Cuando la persona reporte violencia por parte de pareja o familiar.',ARRAY['gbv'],
 '["Entrevistar a solas y verificar seguridad para hablar.","Aplicar la valoración de riesgo y registrar el nivel resultante.","Elaborar plan de seguridad con la persona usuaria.","Informar sobre órdenes de protección sin dar asesoría jurídica de fondo.","Canalizar a refugio, servicios jurídicos y atención médica según el riesgo.","Programar seguimiento a 24-72 horas y crear alerta."]'::jsonb,
 '[{"title":"CONAVIM","url":"https://www.gob.mx/conavim"},{"title":"INMUJERES","url":"https://www.gob.mx/inmujeres"}]'::jsonb,true),

(NULL,'Consentimiento informado y compartición de información','Informed consent and information sharing procedure',
 'Reglas para recabar consentimiento y compartir información del caso.',
 'Rules for obtaining consent and sharing case information.',
 'Recabe consentimiento informado por escrito antes de compartir datos con cualquier tercero, indicando finalidad, destinatarios, información autorizada y vigencia. Los datos de salud, origen étnico, situación migratoria y violencia son datos sensibles conforme a la LFPDPPP. Sin consentimiento vigente solo procede compartir ante riesgo inminente para la vida o mandato legal, dejando constancia.',
 'Obtain written informed consent before sharing data with any third party, stating purpose, recipients, authorized information and validity. Health, ethnicity, migration status and violence data are sensitive data under Mexican data protection law. Without valid consent, sharing is only allowed for imminent life risk or legal mandate, and must be recorded.',
 'consent_template',ARRAY['consent_privacy','referrals','case_management'],'{}',ARRAY['nyrava_approved_library'],'LFPDPPP / INAI','https://home.inai.org.mx','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Proteger datos personales sensibles y sustentar cada compartición.','Antes de cualquier canalización, envío de documentos o contacto con instituciones.',ARRAY['compliance'],
 '["Explicar finalidad y alcance en el idioma de la persona usuaria.","Registrar consentimiento con fecha, vigencia e información autorizada.","Compartir únicamente la información autorizada, nunca el expediente completo.","Registrar cada acceso o envío de documentos.","Revocar o actualizar el consentimiento cuando la persona lo solicite."]'::jsonb,
 '[{"title":"INAI","url":"https://home.inai.org.mx"}]'::jsonb,true),

(NULL,'Cómo crear, enviar, documentar y dar seguimiento a una canalización','How to create, send, document and follow up a referral',
 'Ciclo completo de canalización, desde la identificación hasta el cierre.',
 'Full referral cycle, from identification to closure.',
 'Una canalización solo procede con consentimiento vigente y con recurso verificado en la Red de Recursos. Registre acuse, persona receptora y fecha compromiso. Sin respuesta en 5 días hábiles, reintente y escale a supervisión a los 10.',
 'A referral requires valid consent and a verified resource from the Resource Network. Record acknowledgement, receiving contact and commitment date. With no answer in 5 business days, retry, and escalate to supervision at 10.',
 'referral_instruction',ARRAY['referrals','case_management'],'{}',ARRAY['nyrava_approved_library'],'Nyrava México','','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Evitar canalizaciones perdidas y documentar resultados.','Cada vez que el caso requiera un servicio externo.',ARRAY['case_management'],
 '["Identificar el servicio requerido a partir del plan de atención.","Verificar consentimiento e información autorizada.","Seleccionar el recurso verificado en la Red de Recursos.","Enviar la canalización y registrar acuse.","Crear tarea de seguimiento a 5 días hábiles.","Registrar el resultado: aceptada, rechazada, sin respuesta o concluida."]'::jsonb,'[]'::jsonb,true),

(NULL,'Procedimiento integral de gestión de casos','End-to-end case-management procedure',
 'Ruta completa: recepción, valoración, plan de atención, canalización, seguimiento y cierre.',
 'Full route: intake, assessment, care plan, referral, follow-up and closure.',
 'Cada etapa tiene un producto documental obligatorio. No se cierra un caso con canalizaciones abiertas, riesgo alto vigente o consentimiento no resuelto. El cierre requiere justificación y revisión de supervisión.',
 'Each stage has a mandatory documentary output. A case cannot be closed with open referrals, active high risk or unresolved consent. Closure requires justification and supervisory review.',
 'procedure',ARRAY['case_management','social_work','referrals'],'{}',ARRAY['nyrava_approved_library'],'Nyrava México','','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Homologar el ciclo de vida del caso y sus controles.','Desde la apertura del caso hasta su cierre o transferencia.',ARRAY['case_management'],
 '["Recepción: registrar identidad, motivo y necesidades inmediatas.","Valoración: determinar riesgo y factores protectores con evidencia.","Plan de atención: objetivos, acciones, responsables y fechas.","Canalización: servicios externos con consentimiento y acuse.","Seguimiento: notas, tareas y alertas hasta lograr el objetivo.","Cierre: verificar pendientes, justificar y enviar a revisión."]'::jsonb,'[]'::jsonb,true),

(NULL,'Guía de competencia estatal y municipal','State and municipal competence guidance',
 'Cómo identificar la autoridad competente según el estado y municipio de la persona usuaria.',
 'How to identify the competent authority based on the client''s state and municipality.',
 'Los servicios de protección de niñez, atención a víctimas y refugios operan por competencia estatal; migración y refugio son federales. Confirme siempre la oficina con cobertura en el municipio de la persona antes de canalizar y registre la delegación o sede exacta.',
 'Child protection, victim assistance and shelters operate at state level; migration and asylum are federal. Always confirm the office covering the client''s municipality before referring, and record the exact branch.',
 'state_municipal_guidance',ARRAY['state_guidance','referrals','case_management'],'{}',ARRAY['nyrava_approved_library'],'Nyrava México','','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Evitar canalizaciones a instancias sin competencia territorial.','Antes de crear cualquier canalización local.',ARRAY['case_management'],
 '["Confirmar estado y municipio actuales de la persona usuaria.","Determinar si la materia es federal o estatal.","Buscar la sede con cobertura en la Red de Recursos.","Verificar horario y requisitos de atención presencial.","Registrar la sede exacta en la canalización."]'::jsonb,'[]'::jsonb,true),

(NULL,'Formatos y listas de verificación aprobados','Approved forms and checklists',
 'Contenido mínimo de los formatos de recepción, consentimiento, canalización y cierre.',
 'Minimum content for intake, consent, referral and closure forms.',
 'Formato de recepción: identidad, contacto, composición familiar, necesidades, riesgo inicial. Consentimiento: finalidad, destinatarios, información autorizada, vigencia, firma. Canalización: servicio solicitado, motivo, urgencia, información autorizada. Cierre: objetivos alcanzados, pendientes, motivo y revisión.',
 'Intake form: identity, contact, household, needs, initial risk. Consent: purpose, recipients, authorized information, validity, signature. Referral: service requested, reason, urgency, authorized information. Closure: goals achieved, pending items, reason and review.',
 'document_checklist',ARRAY['forms_templates','case_management','consent_privacy'],'{}',ARRAY['nyrava_approved_library'],'Nyrava México','','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Asegurar expedientes completos y auditables.','Al abrir, canalizar o cerrar un caso.',ARRAY['case_management'],
 '["Usar el formato correspondiente a la etapa del caso.","Verificar que no existan campos obligatorios vacíos.","Adjuntar el documento al expediente del caso.","Registrar la versión del formato utilizada."]'::jsonb,'[]'::jsonb,true),

(NULL,'Capacitación básica del personal de atención integral','Core comprehensive care staff training',
 'Contenidos mínimos de inducción: enfoque de derechos, atención sin daño y límites profesionales.',
 'Minimum induction content: rights-based approach, do-no-harm practice and professional boundaries.',
 'La atención se brinda con enfoque de derechos humanos, perspectiva de género, interés superior de la niñez y atención sin daño. El personal no clínico no diagnostica y el personal no jurídico no asesora sobre el fondo legal. Toda persona usuaria puede negarse a un servicio sin perder el acceso a otros.',
 'Care is delivered with a human rights approach, gender perspective, best interests of the child and do-no-harm practice. Non-clinical staff do not diagnose and non-legal staff do not give substantive legal advice. Clients may decline a service without losing access to others.',
 'training_material',ARRAY['training','social_work','consent_privacy'],'{}',ARRAY['nyrava_approved_library'],'Nyrava México','','published',now(),date '2026-01-01',now(),now()+interval '12 months','internal_staff',ARRAY['es','en'],
 'Establecer la base común de práctica profesional.','Durante la inducción y en la revisión anual del personal.',ARRAY['training'],
 '["Revisar principios de atención y límites profesionales.","Practicar entrevista segura y registro objetivo.","Revisar rutas de escalamiento de riesgo.","Confirmar comprensión y registrar la capacitación."]'::jsonb,'[]'::jsonb,true),

(NULL,'Actualizaciones normativas relevantes para atención integral','Regulatory updates relevant to comprehensive care',
 'Marco vigente aplicable a la operación de atención integral y control de cambios.',
 'Current framework applicable to comprehensive care operations and change control.',
 'Marco base: Ley sobre Refugiados, Protección Complementaria y Asilo Político; Ley de Migración; Ley General de los Derechos de Niñas, Niños y Adolescentes; Ley General de Acceso de las Mujeres a una Vida Libre de Violencia; Ley General de Víctimas; LFPDPPP. Cualquier cambio normativo debe verificarse en el DOF antes de modificar un procedimiento aprobado.',
 'Baseline framework: Refugee, Complementary Protection and Political Asylum Act; Migration Act; General Act on the Rights of Children and Adolescents; General Act on Women''s Access to a Life Free of Violence; General Victims Act; Federal Data Protection Act. Any regulatory change must be verified in the official gazette before amending an approved procedure.',
 'legal_update',ARRAY['legal_updates','legal_services','consent_privacy'],'{}',ARRAY['nyrava_approved_library'],'Diario Oficial de la Federación','https://www.dof.gob.mx','published',now(),date '2026-01-01',now(),now()+interval '6 months','internal_staff',ARRAY['es','en'],
 'Mantener los procedimientos alineados al marco vigente.','Al revisar procedimientos o ante aviso de reforma legal.',ARRAY['compliance'],
 '["Verificar la publicación en el DOF y su fecha de entrada en vigor.","Identificar los procedimientos afectados.","Enviar la propuesta de actualización a revisión.","Publicar la nueva versión y archivar la anterior."]'::jsonb,
 '[{"title":"Diario Oficial de la Federación","url":"https://www.dof.gob.mx"}]'::jsonb,true);

revoke all on function public.social_document_inventory(uuid) from public,anon;

grant execute on function public.social_document_inventory(uuid) to authenticated;

alter function public.claim_next_queued_case(integer, text) set search_path = public, pg_temp;

alter function public.renew_execution_lease(uuid, uuid, integer) set search_path = public, pg_temp;

revoke all on function public.claim_case_for_execution(uuid, integer, text) from public, anon;

revoke all on function public.claim_next_queued_case(integer, text) from public, anon;

revoke all on function public.renew_execution_lease(uuid, uuid, integer) from public, anon;

grant execute on function public.claim_case_for_execution(uuid, integer, text) to authenticated, service_role;

grant execute on function public.claim_next_queued_case(integer, text) to authenticated, service_role;

grant execute on function public.renew_execution_lease(uuid, uuid, integer) to authenticated, service_role;

drop policy if exists "case-files: users insert own" on storage.objects;

drop policy if exists "case-files: users read own" on storage.objects;

drop policy if exists "case-files: users update own" on storage.objects;

drop policy if exists "Users can update their own case files" on storage.objects;

drop policy if exists "case files own update" on storage.objects;

alter function public.log_social_resource_communication() set search_path = public, pg_temp;

revoke all on function public.log_social_resource_communication() from public, anon, authenticated;

DROP TABLE IF EXISTS public.matter_tasks CASCADE;

DROP TABLE IF EXISTS public.matter_events CASCADE;

DROP TABLE IF EXISTS public.matter_notes CASCADE;

DROP TABLE IF EXISTS public.matters CASCADE;

DROP TABLE IF EXISTS public.social_sales_demo_records CASCADE;

revoke all on function public.social_sales_demo_any_owner_allows(uuid, uuid) from public, anon;

grant execute on function public.social_sales_demo_any_owner_allows(uuid, uuid) to authenticated, service_role;

revoke all on function public.social_sales_demo_owner_allows(text, uuid, uuid) from public, anon;

grant execute on function public.social_sales_demo_owner_allows(text, uuid, uuid) to authenticated, service_role;

revoke all on function public.social_can_access_case(uuid, text, boolean, uuid) from public, anon;

grant execute on function public.social_can_access_case(uuid, text, boolean, uuid) to authenticated, service_role;

drop policy if exists social_activity_read on public.social_activity_events;

commit;

UPDATE public.cases
SET procedural_vehicle = 'amparo_indirecto'
WHERE case_type = 'amparo'
  AND procedural_vehicle IS NULL
  AND (name ILIKE '%indirecto%' OR description ILIKE '%amparo indirecto%');

UPDATE public.cases
SET procedural_vehicle = 'amparo_directo'
WHERE case_type = 'amparo'
  AND procedural_vehicle IS NULL
  AND (name ILIKE '%directo%' OR description ILIKE '%amparo directo%');

UPDATE public.cases
SET procedural_vehicle = 'inmobiliario_litigio'
WHERE case_type = 'inmobiliario'
  AND procedural_vehicle IS NULL
  AND (name ILIKE '%litigio%' OR name ILIKE '%juicio%' OR name ILIKE '%reivindicatorio%' OR name ILIKE '%usucapion%');

UPDATE public.cases
SET procedural_vehicle = 'inmobiliario_transaccional'
WHERE case_type = 'inmobiliario'
  AND procedural_vehicle IS NULL;

grant execute on function public.is_primary_subscriber(uuid) to authenticated, service_role;

revoke all on function public.tg_enforce_org_created_by_immutable() from public, anon, authenticated;

revoke all on function public.finalize_report_release(uuid,uuid,uuid,jsonb,jsonb,boolean,jsonb,text) from public;

grant execute on function public.finalize_report_release(uuid,uuid,uuid,jsonb,jsonb,boolean,jsonb,text) to authenticated, service_role;

-- 6. FUNCTIONS & RPCS

CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_admin_tier(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = _user_id AND role IN ('admin','super_admin','firm_admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_case_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = _user_id AND role IN ('case_manager','admin','super_admin','firm_admin'))
$$;

CREATE OR REPLACE FUNCTION public.plan_seat_limit(_plan TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _plan
    WHEN 'solo' THEN 1
    WHEN 'firm' THEN 10
    WHEN 'enterprise' THEN 50
    ELSE 1
  END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _firm_id UUID;
  _invite RECORD;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;

  SELECT * INTO _invite
  FROM public.firm_invites
  WHERE lower(email) = lower(NEW.email) AND status = 'pending'
  ORDER BY invited_at DESC
  LIMIT 1;

  IF _invite.id IS NOT NULL THEN
    _firm_id := _invite.firm_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _invite.role::public.app_role) ON CONFLICT DO NOTHING;
    UPDATE public.firm_invites
      SET status = 'accepted', accepted_at = now(), redeemed_user_id = NEW.id
      WHERE id = _invite.id;
  ELSE
    _firm_id := public.resolve_firm_for_email(NEW.email);
  END IF;

  INSERT INTO public.user_settings (user_id, firm_id)
  VALUES (NEW.id, _firm_id)
  ON CONFLICT (user_id) DO UPDATE SET firm_id = COALESCE(public.user_settings.firm_id, EXCLUDED.firm_id);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.firm_seat_usage(_firm_id UUID)
RETURNS TABLE (seats_used INTEGER, seat_limit INTEGER, plan_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      (SELECT count(*)::int FROM public.user_settings us
        JOIN public.profiles p ON p.id = us.user_id
        WHERE us.firm_id = _firm_id AND COALESCE(p.is_blocked, false) = false)
      +
      (SELECT count(*)::int FROM public.firm_invites fi
        WHERE fi.firm_id = _firm_id AND fi.status = 'pending')
    ) AS seats_used,
    COALESCE(f.seat_limit, public.plan_seat_limit('solo')) AS seat_limit,
    f.plan_key
  FROM public.firms f WHERE f.id = _firm_id;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_user uuid, _org uuid)
RETURNS public.org_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role_in_org FROM public.org_memberships
  WHERE user_id = _user AND org_id = _org
    AND status = 'active' AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_org(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.org_role_of(_user, _org) IN ('owner','admin');
$$;

CREATE OR REPLACE FUNCTION public.can_contribute_org(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.org_role_of(_user, _org) IN ('owner','admin','lawyer','paralegal');
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user UUID, _org UUID, _perm TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH guarded AS (
    SELECT _user AS u WHERE _user = auth.uid()
  ),
  user_role AS (
    SELECT role_in_org AS r FROM public.org_memberships, guarded
    WHERE user_id = guarded.u AND org_id = _org AND status = 'active' AND deleted_at IS NULL
    LIMIT 1
  ),
  override AS (
    SELECT granted FROM public.org_role_permissions orp, user_role
    WHERE orp.org_id = _org AND orp.role = user_role.r AND orp.permission_code = _perm
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT granted FROM override),
    EXISTS(SELECT 1 FROM public.role_permissions rp, user_role
           WHERE rp.role = user_role.r AND rp.permission_code = _perm)
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_factory_reset_case_data(
  p_include_demo boolean DEFAULT false,
  p_include_audit boolean DEFAULT false,
  p_include_ai_usage boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t text;
  n bigint;
  result jsonb := '{}'::jsonb;
  targets text[] := ARRAY[
    'pipeline_events','pipeline_engine_runs','agent_findings','agent_logs',
    'case_chat_messages','case_domain_activations','case_findings','case_motion_drafts',
    'case_opportunities','case_perspectives','case_scores','case_strategy',
    'case_strategy_center','case_theories','case_timeline_events','case_trial_prep',
    'case_witnesses','case_work_product','evidence_classifications','image_intelligence',
    'intelligence_runs','knowledge_relationships','document_pages','document_versions',
    'document_processing_jobs','documents','report_versions','reports','canonical_analysis',
    'analyses','matter_documents','matter_events','matter_knowledge','matter_notes',
    'matter_parties','matter_tasks','matters','cases'
  ];
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden — super admin required.';
  END IF;

  IF p_include_demo THEN
    targets := targets || ARRAY['demo_case_documents','demo_cases'];
  END IF;
  IF p_include_audit THEN
    targets := targets || ARRAY['audit_log','audit_logs'];
  END IF;
  IF p_include_ai_usage THEN
    targets := targets || ARRAY['ai_usage'];
  END IF;

  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DELETE FROM public.%I', t);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        result := result || jsonb_build_object(t, n);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (actor_user_id, action, target_type, details)
  VALUES (auth.uid(), 'factory_reset_case_data', 'database',
          jsonb_build_object('deleted', result,
                             'include_demo', p_include_demo,
                             'include_audit', p_include_audit,
                             'include_ai_usage', p_include_ai_usage));

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_factory_reset_case_data(
  p_include_demo boolean DEFAULT false,
  p_include_audit boolean DEFAULT false,
  p_include_ai_usage boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t text;
  n bigint;
  result jsonb := '{}'::jsonb;
  targets text[] := ARRAY[
    'pipeline_events','pipeline_engine_runs','agent_findings','agent_logs',
    'case_chat_messages','case_domain_activations','case_findings','case_motion_drafts',
    'case_opportunities','case_perspectives','case_scores','case_strategy',
    'case_strategy_center','case_theories','case_timeline_events','case_trial_prep',
    'case_witnesses','case_work_product','evidence_classifications','image_intelligence',
    'intelligence_runs','knowledge_relationships','document_pages','document_versions',
    'document_processing_jobs','documents','report_versions','reports','canonical_analysis',
    'analyses','matter_documents','matter_events','matter_knowledge','matter_notes',
    'matter_parties','matter_tasks','matters','cases'
  ];
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden — super admin required.';
  END IF;

  IF p_include_demo THEN
    targets := targets || ARRAY['demo_case_documents','demo_cases'];
  END IF;
  IF p_include_audit THEN
    targets := targets || ARRAY['audit_log','audit_logs'];
  END IF;
  IF p_include_ai_usage THEN
    targets := targets || ARRAY['ai_usage'];
  END IF;

  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DELETE FROM public.%I', t);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        result := result || jsonb_build_object(t, n);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (actor_id, action, target, meta)
  VALUES (auth.uid(), 'factory_reset_case_data', 'operational_case_data',
          jsonb_build_object('deleted', result,
                             'include_demo', p_include_demo,
                             'include_audit', p_include_audit,
                             'include_ai_usage', p_include_ai_usage));

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_factory_reset_case_data(
  p_include_demo boolean DEFAULT false,
  p_include_audit boolean DEFAULT false,
  p_include_ai_usage boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t text;
  n bigint;
  result jsonb := '{}'::jsonb;
  targets text[] := ARRAY[
    'pipeline_events','pipeline_engine_runs','agent_findings','agent_logs',
    'case_chat_messages','case_domain_activations','case_findings','case_motion_drafts',
    'case_opportunities','case_perspectives','case_scores','case_strategy',
    'case_strategy_center','case_theories','case_timeline_events','case_trial_prep',
    'case_witnesses','case_work_product','evidence_classifications','image_intelligence',
    'intelligence_runs','knowledge_relationships','document_pages','document_versions',
    'document_processing_jobs','documents','report_versions','reports','canonical_analysis',
    'analyses','matter_documents','matter_events','matter_knowledge','matter_notes',
    'matter_parties','matter_tasks','matters','cases'
  ];
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden — super admin required.';
  END IF;

  IF p_include_demo THEN
    targets := targets || ARRAY['demo_case_documents','demo_cases'];
  END IF;
  IF p_include_audit THEN
    targets := targets || ARRAY['audit_log','audit_logs'];
  END IF;
  IF p_include_ai_usage THEN
    targets := targets || ARRAY['ai_usage'];
  END IF;

  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      -- WHERE true keeps the statement compatible with the safe-delete guard.
      EXECUTE format('DELETE FROM public.%I WHERE true', t);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        result := result || jsonb_build_object(t, n);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (actor_id, action, target, meta)
  VALUES (auth.uid(), 'factory_reset_case_data', 'operational_case_data',
          jsonb_build_object('deleted', result,
                             'include_demo', p_include_demo,
                             'include_audit', p_include_audit,
                             'include_ai_usage', p_include_ai_usage));

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_normalize_finding_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v text;
BEGIN
  IF NEW.finding_type IS NULL OR btrim(NEW.finding_type) = '' THEN
    RETURN NEW;
  END IF;

  v := upper(regexp_replace(btrim(NEW.finding_type), '[\s-]+', '_', 'g'));

  NEW.finding_type := CASE
    WHEN v IN ('DIRECT_EVIDENCE','DIRECT','EVIDENCE','FACT','FACTUAL','PRUEBA_DIRECTA','DATO_DE_PRUEBA','DATO_PRUEBA') THEN 'DIRECT_EVIDENCE'
    WHEN v IN ('EVIDENCE_BASED_INFERENCE','EVIDENCE_INFERENCE','INFERENCE','INFERRED','INFERENCIA','INFERENCIA_BASADA_EN_PRUEBA','INFERENCIA_PROBATORIA') THEN 'EVIDENCE_BASED_INFERENCE'
    WHEN v IN ('AI_THEORY','THEORY','AI','SPECULATION','TEORIA','TEORIA_IA','HIPOTESIS','HIPÓTESIS') THEN 'AI_THEORY'
    ELSE 'AI_THEORY'
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_factory_reset_case_data(
  p_include_demo boolean DEFAULT false,
  p_include_audit boolean DEFAULT false,
  p_include_ai_usage boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t text;
  n bigint;
  v_actor uuid;
  result jsonb := '{}'::jsonb;
  targets text[] := ARRAY[
    'pipeline_events','pipeline_engine_runs','agent_findings','agent_logs',
    'case_chat_messages','case_domain_activations','case_findings','case_motion_drafts',
    'case_opportunities','case_perspectives','case_scores','case_strategy',
    'case_strategy_center','case_theories','case_timeline_events','case_trial_prep',
    'case_witnesses','case_work_product','evidence_classifications','image_intelligence',
    'intelligence_runs','knowledge_relationships','document_pages','document_versions',
    'document_processing_jobs','documents','report_versions','reports','canonical_analysis',
    'analyses','matter_documents','matter_events','matter_knowledge','matter_notes',
    'matter_parties','matter_tasks','matters','cases'
  ];
BEGIN
  -- When a real end-user session is present, that session is the actor and no
  -- caller-supplied id is trusted. p_actor_id is only honored for trusted
  -- server-side (service_role) callers, which cannot be reached by signed-in
  -- users because EXECUTE is revoked from anon/authenticated below.
  v_actor := COALESCE(auth.uid(), p_actor_id);

  IF v_actor IS NULL OR NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Forbidden — super admin required.';
  END IF;

  IF p_include_demo THEN
    targets := targets || ARRAY['demo_case_documents','demo_cases'];
  END IF;
  IF p_include_audit THEN
    targets := targets || ARRAY['audit_log','audit_logs'];
  END IF;
  IF p_include_ai_usage THEN
    targets := targets || ARRAY['ai_usage'];
  END IF;

  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DELETE FROM public.%I WHERE true', t);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        result := result || jsonb_build_object(t, n);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (actor_id, action, target, meta)
  VALUES (v_actor, 'factory_reset_case_data', 'operational_case_data',
          jsonb_build_object('deleted', result,
                             'include_demo', p_include_demo,
                             'include_audit', p_include_audit,
                             'include_ai_usage', p_include_ai_usage));

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_user_settings_firm_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id THEN
    -- service_role / internal jobs bypass; admins may reassign.
    IF auth.uid() IS NULL OR public.is_admin_tier(auth.uid()) THEN
      RETURN NEW;
    END IF;
    -- First-time assignment (no firm yet) is allowed.
    IF OLD.firm_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'No puede cambiar su firma directamente. Solicite el cambio a un administrador.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_beta_access(_email text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor_id uuid := auth.uid();
  target_id uuid;
  normalized_email text := lower(trim(_email));
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = actor_id
      AND ur.role IN ('admin'::public.app_role, 'super_admin'::public.app_role, 'platform_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden — admin required';
  END IF;

  IF normalized_email = '' OR normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'A valid email is required';
  END IF;

  SELECT u.id INTO target_id
  FROM auth.users u
  WHERE lower(u.email) = normalized_email
  LIMIT 1;

  IF target_id IS NULL THEN
    INSERT INTO public.beta_invites (
      email, note, invited_by, invited_at, redeemed_at, redeemed_user_id
    ) VALUES (
      normalized_email, nullif(trim(_note), ''), actor_id, now(), NULL, NULL
    )
    ON CONFLICT (email) DO UPDATE SET
      note = EXCLUDED.note,
      invited_by = EXCLUDED.invited_by,
      invited_at = EXCLUDED.invited_at,
      redeemed_at = NULL,
      redeemed_user_id = NULL;

    RETURN jsonb_build_object('ok', true, 'userId', NULL, 'pending', true);
  END IF;

  INSERT INTO public.subscriptions (
    user_id, is_beta_tester, beta_note, beta_granted_by, beta_granted_at
  ) VALUES (
    target_id, true, nullif(trim(_note), ''), actor_id, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_beta_tester = true,
    beta_note = EXCLUDED.beta_note,
    beta_granted_by = EXCLUDED.beta_granted_by,
    beta_granted_at = EXCLUDED.beta_granted_at;

  DELETE FROM public.beta_invites WHERE email = normalized_email;

  RETURN jsonb_build_object('ok', true, 'userId', target_id, 'pending', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_tier(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = _user_id AND role IN ('admin','super_admin','firm_admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_case_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = _user_id AND role IN ('case_manager','admin','super_admin','firm_admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user = auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.org_memberships
       WHERE user_id = _user AND org_id = _org
         AND status = 'active' AND deleted_at IS NULL
     )
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_user uuid, _org uuid)
RETURNS org_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT role_in_org FROM public.org_memberships
  WHERE user_id = _user AND org_id = _org
    AND status = 'active' AND deleted_at IS NULL
    AND (auth.uid() IS NULL OR _user = auth.uid())
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.claim_engine_run(_case_id uuid, _user_id uuid, _engine text, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = _case_id AND c.user_id = _user_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO public.pipeline_engine_runs (case_id, user_id, engine, status, started_at, meta)
  VALUES (_case_id, _user_id, _engine, 'running', now(), _meta)
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN
    RETURN NULL;
END;
$function$;

create or replace function public.nyrava_enforce_verified_analysis_mode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- `balanced` is now ONLY the compatibility token for the one Nyrava
  -- Verified evidence policy. It must never represent a selectable mode.
  new.analysis_mode := 'balanced';
  return new;
end;
$$;

create or replace function public.nyrava_force_unified_analysis_mode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.analysis_mode := 'balanced';
  return new;
end;
$$;

create or replace function public.nyrava_enforce_score_provenance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.dimension_breakdowns := public.nyrava_sanitize_score_breakdowns(
    new.case_id,
    new.dimension_breakdowns
  );
  return new;
end;
$$;

create or replace function public.nyrava_guard_release_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_snapshot_at timestamptz;
  v_gate_run_id uuid;
  v_gate_count integer := 0;
  v_gate_keys integer := 0;
begin
  if new.status::text <> 'released' then
    return new;
  end if;

  -- The immutable snapshot is created immediately before final release review.
  select rv.created_at
    into v_snapshot_at
    from public.report_versions rv
   where rv.case_id = new.id
   order by rv.created_at desc, rv.version desc
   limit 1;

  if v_snapshot_at is null then
    new.status := 'needs_revision';
    new.status_message := 'Release blocked: no immutable report snapshot exists for final review.';
    new.progress := least(coalesce(new.progress, 100), 99);
    return new;
  end if;

  -- Pick the newest post-snapshot successful gate run. All three authoritative
  -- gates must share that run_id; mixing success rows from separate/historical
  -- runs is explicitly forbidden.
  select al.run_id
    into v_gate_run_id
    from public.agent_logs al
   where al.case_id = new.id
     and al.agent_key in ('qa', 'hallucination', 'judge')
     and al.status = 'success'
     and coalesce(al.finished_at, al.created_at) >= v_snapshot_at
   order by coalesce(al.finished_at, al.created_at) desc
   limit 1;

  if v_gate_run_id is not null then
    select count(*), count(distinct al.agent_key)
      into v_gate_count, v_gate_keys
      from public.agent_logs al
     where al.case_id = new.id
       and al.run_id = v_gate_run_id
       and al.agent_key in ('qa', 'hallucination', 'judge')
       and al.status = 'success'
       and coalesce(al.finished_at, al.created_at) >= v_snapshot_at;
  end if;

  if v_gate_run_id is null or v_gate_count < 3 or v_gate_keys < 3 then
    new.status := 'needs_revision';
    new.status_message := 'Release blocked: QA, Hallucination, and Judge did not all pass against the latest saved report snapshot.';
    new.progress := least(coalesce(new.progress, 100), 99);
    return new;
  end if;

  return new;
end;
$$;

create or replace function public.nyrava_strip_personal_notice_inversion(input_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        coalesce(input_text, ''),
        '[^.!?\n]*(notificaci[oó]n defectuosa|irregularidad[^.!?\n]{0,80}notificaci[oó]n|error[^.!?\n]{0,80}notificaci[oó]n)[^.!?\n]*[.!?]?',
        '',
        'gi'
      ),
      '[^.!?\n]*(falta|ausencia|omisi[oó]n)[^.!?\n]{0,100}notificaci[oó]n[^.!?\n]{0,80}personal[^.!?\n]*(afecta|afectar|invalid|nulidad|procedencia|desestim|derecho de defensa)[^.!?\n]*[.!?]?',
      '',
      'gi'
    ),
    '[^.!?\n]*notificaci[oó]n personal[^.!?\n]*(es necesaria|era necesaria|debe ser|debi[oó] ser)[^.!?\n]*[.!?]?',
    '',
    'gi'
  ));
$$;

create or replace function public.nyrava_filter_notice_inversion_array(input_value jsonb)
returns jsonb
language sql
stable
as $$
  select case
    when input_value is null or jsonb_typeof(input_value) <> 'array' then coalesce(input_value, '[]'::jsonb)
    else coalesce(
      (
        select jsonb_agg(item order by ord)
        from jsonb_array_elements(input_value) with ordinality as x(item, ord)
        where not (
          item::text ~* 'notificaci[oó]n[^"}]{0,100}personal'
          and item::text ~* '(defectu|irregular|error|nulidad|invalid|procedencia|desestim|afect)'
        )
      ),
      '[]'::jsonb
    )
  end;
$$;

create or replace function public.nyrava_report_legal_integrity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fr jsonb := coalesce(new.full_report::jsonb, '{}'::jsonb);
  canonical_events jsonb;
  canonical_timeline_text text;
  canonical_contradiction_count integer := 0;
  deterministic_risk numeric;
  no_personal_notice_duty boolean := false;
begin
  -- 1) Canonical timeline -> the root timeline_summary consumed by exports.
  canonical_events := fr #> '{canonical_timeline,events}';
  if canonical_events is not null
     and jsonb_typeof(canonical_events) = 'array'
     and jsonb_array_length(canonical_events) > 0 then
    select string_agg(
      concat_ws(': ', nullif(e->>'date', ''), nullif(e->>'event', '')),
      E'\n'
      order by e->>'date', ord
    )
    into canonical_timeline_text
    from jsonb_array_elements(canonical_events) with ordinality as x(e, ord);

    if nullif(trim(coalesce(canonical_timeline_text, '')), '') is not null then
      new.timeline_summary := canonical_timeline_text;
    end if;
  end if;

  -- 2) Deterministic risk owns reports.risk_score.  LLM confidence is a
  -- separate metric and remains available in score_breakdown/scorecard.
  begin
    deterministic_risk := nullif(fr #>> '{deterministic_algorithms,risk,score}', '')::numeric;
  exception when invalid_text_representation then
    deterministic_risk := null;
  end;
  if deterministic_risk is not null and deterministic_risk between 0 and 100 then
    new.risk_score := deterministic_risk;
  end if;

  -- 3) A lower-court interpretation later reversed by the reviewing court is
  -- a judicial history/holding sequence, not a factual contradiction.  When
  -- canonical contradictions_struct is empty, free prose cannot create one.
  if new.contradictions_struct is null then
    canonical_contradiction_count := 0;
  elsif jsonb_typeof(new.contradictions_struct::jsonb) = 'array' then
    canonical_contradiction_count := jsonb_array_length(new.contradictions_struct::jsonb);
  end if;

  if canonical_contradiction_count = 0 then
    new.contradiction_report := case
      when coalesce(new.generated_language, 'es') = 'en'
        then 'No verified contradictions were identified in the supplied record.'
      else 'No se identificaron contradicciones verificadas en el expediente aportado.'
    end;
    new.executive_summary := public.nyrava_strip_false_contradiction_prose(new.executive_summary);
    new.attorney_summary := public.nyrava_strip_false_contradiction_prose(new.attorney_summary);
    new.investigator_summary := public.nyrava_strip_false_contradiction_prose(new.investigator_summary);
    new.evidence_summary := public.nyrava_strip_false_contradiction_prose(new.evidence_summary);
    new.risk_analysis := public.nyrava_strip_false_contradiction_prose(new.risk_analysis);
  end if;

  -- 4) A VERIFIED_COURT_HOLDING expressly rejecting a duty of personal notice
  -- controls over generated/lower-authority rows that try to turn the same
  -- absence of personal service into an extant defect, nullity, or new remedy.
  select exists (
    select 1
    from public.case_findings f
    where f.case_id = new.case_id
      and coalesce(f.finding_status, 'candidate') <> 'suppressed'
      and coalesce(f.verification_status, '') = 'verified'
      and coalesce(f.audit_classification, '') = 'VERIFIED_COURT_HOLDING'
      and (
        coalesce(f.source_quote, '') || ' ' ||
        coalesce(f.description, '') || ' ' ||
        coalesce(f.metadata::text, '')
      ) ~* '(no exist[ií]a[^.!?]{0,120}deber|no (era|es|fuera) necesario|no resultaba necesario)[^.!?]{0,160}notific[^.!?]{0,80}personal'
  ) into no_personal_notice_duty;

  if no_personal_notice_duty then
    -- Suppress only contrary findings whose claimed defect actually depends on
    -- PERSONAL notice.  Other service defects are not touched.
    update public.case_findings f
    set finding_status = 'suppressed',
        metadata = coalesce(f.metadata::jsonb, '{}'::jsonb) || jsonb_build_object(
          'posture_reconciled', true,
          'suppressed_reason', 'controlling_holding_no_personal_notice_duty'
        )
    where f.case_id = new.case_id
      and coalesce(f.finding_status, 'candidate') <> 'suppressed'
      and coalesce(f.audit_classification, '') <> 'VERIFIED_COURT_HOLDING'
      and (
        coalesce(f.title, '') || ' ' ||
        coalesce(f.description, '') || ' ' ||
        coalesce(f.legal_significance, '') || ' ' ||
        coalesce(f.potential_impact, '')
      ) ~* 'notific[^.!?]{0,100}personal'
      and (
        coalesce(f.title, '') || ' ' ||
        coalesce(f.description, '') || ' ' ||
        coalesce(f.legal_significance, '') || ' ' ||
        coalesce(f.potential_impact, '')
      ) ~* '(defectu|irregular|error|nulidad|invalid|procedencia|desestim|afect)';

    new.executive_summary := public.nyrava_strip_personal_notice_inversion(new.executive_summary);
    new.attorney_summary := public.nyrava_strip_personal_notice_inversion(new.attorney_summary);
    new.investigator_summary := public.nyrava_strip_personal_notice_inversion(new.investigator_summary);
    new.evidence_summary := public.nyrava_strip_personal_notice_inversion(new.evidence_summary);
    new.procedural_issues_report := public.nyrava_strip_personal_notice_inversion(new.procedural_issues_report);
    new.constitutional_issues := public.nyrava_strip_personal_notice_inversion(new.constitutional_issues);
    new.risk_analysis := public.nyrava_strip_personal_notice_inversion(new.risk_analysis);
    new.recommendations := public.nyrava_strip_personal_notice_inversion(new.recommendations);

    new.constitutional_issues_struct := public.nyrava_filter_notice_inversion_array(new.constitutional_issues_struct::jsonb);
    new.motion_opportunities := public.nyrava_filter_notice_inversion_array(new.motion_opportunities::jsonb);
    new.strategy_recommendations := public.nyrava_filter_notice_inversion_array(new.strategy_recommendations::jsonb);
    new.next_actions := public.nyrava_filter_notice_inversion_array(new.next_actions::jsonb);

    -- The legal memorandum is nested in full_report and can independently
    -- regenerate the same invalid remedy.  Filter its structured remedy lanes.
    if jsonb_typeof(fr #> '{legal_memorandum,risk_matrix}') = 'array' then
      fr := jsonb_set(fr, '{legal_memorandum,risk_matrix}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,risk_matrix}'), true);
    end if;
    if jsonb_typeof(fr #> '{legal_memorandum,recommended_motions}') = 'array' then
      fr := jsonb_set(fr, '{legal_memorandum,recommended_motions}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,recommended_motions}'), true);
    end if;
    if jsonb_typeof(fr #> '{legal_memorandum,next_actions}') = 'array' then
      fr := jsonb_set(fr, '{legal_memorandum,next_actions}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,next_actions}'), true);
    end if;
    new.full_report := fr;
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.nyrava_case_denies_personal_notice_duty(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documents d
    WHERE d.case_id = p_case_id
      AND d.status = 'extracted'
      AND regexp_replace(coalesce(d.extracted_text, ''), E'[\n\r]+', ' ', 'g') ~*
        '(no exist[ií]a|no era necesario|no resultaba necesario|no fue necesario|no hab[ií]a).{0,360}(deber|obligaci[oó]n|necesidad)?.{0,240}notific.{0,120}personal'
  );
$$;

CREATE OR REPLACE FUNCTION public.nyrava_is_personal_notice_defect_text(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_text, '') ~* '(notific.{0,180}personal|personal.{0,180}notific)'
    AND coalesce(p_text, '') ~*
      '(defect|irregular|error procesal|nulidad|invalid|afect.{0,100}(procedencia|defensa|debido proceso)|desestim|debilidad|riesgo|perjuicio|garanti[cz]|asegurar|deb[ií][oa].{0,100}realiz|motivo.{0,100}impug|incidente_de_nulidad)';
$$;

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_personal_notice_json_value(
  p_value jsonb,
  p_deny_personal_notice_duty boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type text;
  v_is_claim_object boolean;
  v_result jsonb;
BEGIN
  IF p_value IS NULL OR NOT p_deny_personal_notice_duty THEN
    RETURN p_value;
  END IF;

  v_type := jsonb_typeof(p_value);

  IF v_type = 'object' THEN
    v_is_claim_object := p_value ?| ARRAY[
      'title','item','description','legal_significance','potential_impact',
      'potential_avenue','why_it_may_apply','what_is_missing','rule'
    ];

    IF v_is_claim_object AND public.nyrava_is_personal_notice_defect_text(p_value::text) THEN
      RETURN NULL;
    END IF;

    SELECT coalesce(jsonb_object_agg(e.key, e.cleaned), '{}'::jsonb)
      INTO v_result
    FROM (
      SELECT j.key,
             coalesce(
               public.nyrava_sanitize_personal_notice_json_value(j.value, p_deny_personal_notice_duty),
               'null'::jsonb
             ) AS cleaned
      FROM jsonb_each(p_value) AS j(key, value)
    ) e;
    RETURN v_result;
  END IF;

  IF v_type = 'array' THEN
    SELECT coalesce(jsonb_agg(e.cleaned), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT public.nyrava_sanitize_personal_notice_json_value(a.value, p_deny_personal_notice_duty) AS cleaned
      FROM jsonb_array_elements(p_value) AS a(value)
    ) e
    WHERE e.cleaned IS NOT NULL;
    RETURN v_result;
  END IF;

  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.nyrava_guard_case_finding_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.nyrava_case_denies_personal_notice_duty(NEW.case_id)
     AND public.nyrava_is_personal_notice_defect_text(to_jsonb(NEW)::text) THEN
    IF TG_OP = 'UPDATE' THEN
      RETURN OLD;
    END IF;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_analysis_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deny boolean;
BEGIN
  v_deny := public.nyrava_case_denies_personal_notice_duty(NEW.case_id);
  IF NOT v_deny THEN RETURN NEW; END IF;

  NEW.procedural_issues := public.nyrava_sanitize_personal_notice_json_value(NEW.procedural_issues, true);
  NEW.key_findings := public.nyrava_sanitize_personal_notice_json_value(NEW.key_findings, true);
  NEW.contradictions := public.nyrava_sanitize_personal_notice_json_value(NEW.contradictions, true);
  NEW.missing_evidence := public.nyrava_sanitize_personal_notice_json_value(NEW.missing_evidence, true);
  NEW.scoring := public.nyrava_sanitize_personal_notice_json_value(NEW.scoring, true);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_agent_finding_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deny boolean;
BEGIN
  v_deny := public.nyrava_case_denies_personal_notice_duty(NEW.case_id);
  IF NOT v_deny THEN RETURN NEW; END IF;

  NEW.findings := public.nyrava_sanitize_personal_notice_json_value(NEW.findings, true);
  IF public.nyrava_is_personal_notice_defect_text(NEW.summary) THEN
    NEW.summary := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_agent_log_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.nyrava_case_denies_personal_notice_duty(NEW.case_id) THEN
    NEW.output := public.nyrava_sanitize_personal_notice_json_value(NEW.output, true);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nyrava_enforce_released_case_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'released' THEN
    NEW.progress := 100;
    NEW.completed_at := coalesce(NEW.completed_at, now());
    NEW.next_stage := NULL;
    NEW.worker_lease_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;

create or replace function public.normalize_mx_search(value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    translate(
      lower(coalesce(value, '')),
      'áéíóúüñàèìòùäëïöÿç',
      'aeiouunaeiouaeiouyc'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  );
$$;

create or replace function public.search_immigration_cases(
  p_query text,
  p_limit integer default 50
)
returns table (
  case_id uuid,
  case_name text,
  internal_matter_number text,
  client_name text,
  nationality text,
  immigration_subtype text,
  responsible_authority text,
  matter_status text,
  passport_masked text,
  matched_document_filename text,
  updated_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with access_context as (
    select exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role::text in ('super_admin','admin','firm_owner','firm_admin','attorney')
    ) as can_search_sensitive
  ),
  scoped as (
    select
      c.id,
      c.name,
      c.matter_metadata,
      c.updated_at,
      d.filename,
      public.normalize_mx_search(
        concat_ws(
          ' ',
          c.name,
          c.matter_metadata->>'internal_matter_number',
          c.matter_metadata->>'client_name',
          array_to_string(
            array(select jsonb_array_elements_text(coalesce(c.matter_metadata->'client_aliases', '[]'::jsonb))),
            ' '
          ),
          c.matter_metadata->>'nationality',
          c.matter_metadata->>'immigration_subtype',
          c.matter_metadata->>'responsible_authority',
          c.matter_metadata->>'matter_status',
          c.matter_metadata->>'responsible_attorney',
          c.matter_metadata->>'inm_expediente_number',
          c.matter_metadata->>'comar_expediente_number',
          c.matter_metadata->>'sre_consular_number',
          c.matter_metadata->>'tfja_court_case_number',
          array_to_string(
            array(select jsonb_array_elements_text(coalesce(c.matter_metadata->'tags', '[]'::jsonb))),
            ' '
          ),
          d.filename
        )
      ) as haystack,
      public.normalize_mx_search(c.matter_metadata->>'passport_number') as passport_search,
      ac.can_search_sensitive
    from public.cases c
    cross join access_context ac
    left join public.documents d
      on d.case_id = c.id
      and d.archived_at is null
    where c.case_type = 'migratorio'
      and c.deleted_at is null
  ),
  matched as (
    select *
    from scoped s
    where public.normalize_mx_search(p_query) = ''
       or not exists (
         select 1
         from unnest(string_to_array(public.normalize_mx_search(p_query), ' ')) token
         where token <> ''
           and s.haystack not like '%' || token || '%'
           and (not s.can_search_sensitive or s.passport_search not like '%' || token || '%')
       )
  )
  select distinct on (m.id)
    m.id,
    m.name,
    nullif(m.matter_metadata->>'internal_matter_number', ''),
    nullif(m.matter_metadata->>'client_name', ''),
    nullif(m.matter_metadata->>'nationality', ''),
    nullif(m.matter_metadata->>'immigration_subtype', ''),
    nullif(m.matter_metadata->>'responsible_authority', ''),
    nullif(m.matter_metadata->>'matter_status', ''),
    case
      when nullif(m.matter_metadata->>'passport_number', '') is null then null
      else repeat('•', least(8, greatest(4, length(m.matter_metadata->>'passport_number') - 4)))
        || right(m.matter_metadata->>'passport_number', 4)
    end,
    m.filename,
    m.updated_at
  from matched m
  order by m.id, m.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.social_people_search_document(
  p_legal_name text,
  p_preferred_name text,
  p_aliases text[]
) returns tsvector
language sql
immutable
parallel safe
set search_path = public
as $$1
  select to_tsvector(
    'simple'::regconfig,
    coalesce(p_legal_name,'') || ' ' ||
    coalesce(p_preferred_name,'') || ' ' ||
    coalesce(array_to_string(p_aliases,' '),'')
  );
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

create or replace function public.prevent_social_activity_mutation()
returns trigger language plpgsql as $$
begin raise exception 'Social activity ledger is append-only'; end;
$$;

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

create or replace function public.prevent_social_identifier_change()
returns trigger language plpgsql as $$
begin
  if (tg_table_name='social_people' and new.person_number is distinct from old.person_number)
    or (tg_table_name='social_families' and new.family_number is distinct from old.family_number)
    or (tg_table_name='social_referrals' and new.referral_number is distinct from old.referral_number)
  then raise exception 'Social identifier is immutable'; end if;
  return new;
end $$;

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

create or replace function public.prevent_disabling_all_billing_providers()
returns trigger language plpgsql as $$
begin
  if new.enabled=false and not exists(
    select 1 from public.billing_provider_settings
    where provider<>new.provider and enabled
  ) then raise exception 'At least one billing provider must remain enabled'; end if;
  new.updated_at:=now();
  return new;
end $$;

create or replace function public.audit_billing_provider_toggle()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.enabled is distinct from old.enabled then
    insert into public.billing_provider_events(provider,enabled,actor_id)
    values(new.provider,new.enabled,auth.uid());
  end if;
  return new;
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

create or replace function public.ensure_social_program_for_org(
  p_org uuid,p_name_es text default 'Atención Integral',
  p_name_en text default 'Comprehensive Care',p_prefix text default 'NYR-SOC'
) returns public.social_programs
language plpgsql security invoker set search_path=public as $$
declare p public.social_programs%rowtype;
begin
  if not public.can_manage_org(p_org,auth.uid()) then raise exception 'Program administration denied'; end if;
  if p_prefix!~'^[A-Z0-9-]{2,20}$' then raise exception 'Invalid case prefix'; end if;
  insert into public.social_programs(org_id,name,name_es,name_en,code,case_prefix,created_by)
  values(p_org,p_name_es,p_name_es,p_name_en,'atencion_integral',p_prefix,auth.uid())
  on conflict(org_id,code) do update set name=excluded.name,name_es=excluded.name_es,
    name_en=excluded.name_en,case_prefix=excluded.case_prefix,active=true,updated_at=now()
  returning * into p;
  return p;
end $$;

create or replace function public.send_social_referral(
  p_referral uuid,p_purpose text,p_shared_fields jsonb,p_expires timestamptz default null
) returns void language plpgsql security invoker set search_path=public as $$
declare r public.social_referrals%rowtype;
begin
  select * into r from public.social_referrals where id=p_referral for update;
  if not found or not public.social_can_access_case(r.social_case_id,'general_case_record',true,auth.uid()) then
    raise exception 'Referral access denied';
  end if;
  if r.consent_id is null then raise exception 'Referral consent is required'; end if;
  if r.receiving_org_id is not null then
    insert into public.social_referral_shared_packets(
      org_id,receiving_org_id,referral_id,consent_id,purpose,shared_fields,expires_at,created_by
    ) values(r.org_id,r.receiving_org_id,r.id,r.consent_id,p_purpose,coalesce(p_shared_fields,'{}'),p_expires,auth.uid());
  elsif not public.social_consent_covers(
    r.consent_id,r.receiving_institution_id::text,p_purpose,
    array(select jsonb_object_keys(coalesce(p_shared_fields,'{}')))
  ) then raise exception 'Consent does not cover this institution referral'; end if;
  update public.social_referrals set status='sent',referral_date=now(),updated_at=now() where id=r.id;
  insert into public.social_referral_updates(org_id,referral_id,status,note,created_by)
  values(r.org_id,r.id,'sent','Referral sent with consent-validated packet',auth.uid());
end $$;

create or replace function public.verify_social_referral_result(
  p_referral uuid,p_result text,p_response text,p_closure_reason text default null
) returns void language plpgsql security invoker set search_path=public as $$
declare r public.social_referrals%rowtype;
begin
  select * into r from public.social_referrals where id=p_referral for update;
  if not found or not public.social_can_access_case(r.social_case_id,'general_case_record',true,auth.uid()) then
    raise exception 'Referral verification denied';
  end if;
  if nullif(btrim(p_result),'') is null then raise exception 'Verified result is required'; end if;
  update public.social_referrals set status='completed',result=p_result,response=p_response,
    closure_reason=p_closure_reason,result_verified_at=now(),result_verified_by=auth.uid(),updated_at=now()
  where id=r.id;
  insert into public.social_referral_updates(org_id,referral_id,status,note,created_by)
  values(r.org_id,r.id,'completed','Result independently verified',auth.uid());
end $$;

create or replace function public.advance_social_transfer(
  p_transfer uuid,p_action text
) returns void language plpgsql security invoker set search_path=public as $$
declare t public.social_case_transfers%rowtype; declare info text[];
begin
  select * into t from public.social_case_transfers where id=p_transfer for update;
  if not found then raise exception 'Transfer not found'; end if;
  if p_action='approve' then
    if t.status<>'pending_approval' or not (
      public.can_manage_org(t.org_id,auth.uid())
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

create or replace function public.register_social_document(
  p_case uuid,p_person uuid,p_family uuid,p_title text,p_document_type text,
  p_record_type text,p_sensitivity text,p_consent uuid,p_storage_path text,
  p_checksum text,p_mime text,p_size bigint,p_extraction_authorized boolean
) returns uuid language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype; declare v_id uuid;
begin
  select * into c from public.social_cases where id=p_case;
  if not found or not public.social_can_access_case(p_case,p_record_type,true,auth.uid()) then
    raise exception 'Document registration denied';
  end if;
  if p_storage_path not like c.org_id::text||'/'||c.id::text||'/'||p_record_type||'/%' then
    raise exception 'Document storage path does not match its authorization boundary';
  end if;
  if p_checksum!~'^[a-fA-F0-9]{64}$' then raise exception 'SHA-256 checksum is required'; end if;
  insert into public.social_documents(
    org_id,social_case_id,person_id,family_id,title,document_type,record_type,
    sensitivity,consent_id,current_version,checksum,mime_type,size_bytes,
    storage_path,extraction_authorized,uploaded_by
  ) values(
    c.org_id,c.id,p_person,p_family,p_title,p_document_type,p_record_type,
    p_sensitivity,p_consent,1,lower(p_checksum),p_mime,p_size,p_storage_path,
    p_extraction_authorized,auth.uid()
  ) returning id into v_id;
  insert into public.social_document_versions(
    org_id,document_id,version,checksum,storage_path,mime_type,size_bytes,uploaded_by
  ) values(c.org_id,v_id,1,lower(p_checksum),p_storage_path,p_mime,p_size,auth.uid());
  return v_id;
end $$;

create or replace function public.add_social_document_version(
  p_document uuid,p_storage_path text,p_checksum text,p_mime text,p_size bigint,p_notes text
) returns integer language plpgsql security invoker set search_path=public as $$
declare d public.social_documents%rowtype; declare v integer;
begin
  select * into d from public.social_documents where id=p_document for update;
  if not found or not public.social_can_access_case(d.social_case_id,d.record_type,true,auth.uid()) then
    raise exception 'Document version denied'; end if;
  if p_storage_path not like d.org_id::text||'/'||d.social_case_id::text||'/'||d.record_type||'/%' then
    raise exception 'Document path boundary mismatch'; end if;
  if p_checksum!~'^[a-fA-F0-9]{64}$' then raise exception 'SHA-256 checksum is required'; end if;
  v:=d.current_version+1;
  insert into public.social_document_versions(org_id,document_id,version,checksum,storage_path,mime_type,size_bytes,uploaded_by,notes)
  values(d.org_id,d.id,v,lower(p_checksum),p_storage_path,p_mime,p_size,auth.uid(),p_notes);
  update public.social_documents set current_version=v,checksum=lower(p_checksum),storage_path=p_storage_path,
    mime_type=p_mime,size_bytes=p_size,updated_at=now() where id=d.id;
  return v;
end $$;

create or replace function public.refresh_social_case_alerts(p_case uuid)
returns integer language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype; declare n integer:=0;
begin
  select * into c from public.social_cases where id=p_case;
  if not found or not public.social_can_access_case(p_case,'general_case_record',false,auth.uid()) then
    raise exception 'Alert access denied'; end if;
  insert into public.social_alerts(org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,assigned_to,metadata)
  select c.org_id,c.id,'overdue_task',case when t.priority='urgent' then 'critical' else 'warning' end,
    'Tarea vencida: '||t.title,'Overdue task: '||t.title,t.due_at,t.assignee_id,jsonb_build_object('task_id',t.id)
  from public.social_tasks t where t.social_case_id=c.id and t.status not in ('done','cancelled')
    and t.due_at<now() and not exists(select 1 from public.social_alerts a where a.alert_type='overdue_task' and a.metadata->>'task_id'=t.id::text and a.resolved_at is null);
  get diagnostics n=row_count;
  insert into public.social_alerts(org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,assigned_to,metadata)
  select c.org_id,c.id,'consent_expiration','warning','Consentimiento próximo a vencer','Consent expiring soon',
    co.expires_at,c.assigned_case_manager,jsonb_build_object('consent_id',co.id)
  from public.social_consents co where (co.person_id=c.person_id or co.family_id=c.family_id)
    and co.status='active' and co.expires_at between now() and now()+interval '30 days'
    and not exists(select 1 from public.social_alerts a where a.alert_type='consent_expiration' and a.metadata->>'consent_id'=co.id::text and a.resolved_at is null);
  return n;
end $$;

create or replace function public.social_people_search_document(
  p_legal_name text,
  p_preferred_name text,
  p_aliases text[]
) returns tsvector
language sql
immutable
parallel safe
set search_path = public
as $$
  select to_tsvector(
    'simple'::regconfig,
    coalesce(p_legal_name,'') || ' ' ||
    coalesce(p_preferred_name,'') || ' ' ||
    coalesce(array_to_string(p_aliases,' '),'')
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

create or replace function public.search_resource_network(
  p_query text default null,p_state text default null,p_municipality text default null,
  p_latitude double precision default null,p_longitude double precision default null,p_radius_km double precision default null,
  p_service text default null,p_urgency text default null,p_population text default null,p_language text default null,
  p_cost_type text default null,p_availability text default null,p_limit integer default 50
) returns table(
  id uuid,official_name text,institution_type text,services text[],description text,state_code text,municipality text,
  address text,latitude double precision,longitude double precision,phone text,whatsapp text,email text,website text,
  hours jsonb,languages text[],populations text[],eligibility text,required_documents text[],cost_type text,
  appointment_required boolean,walk_in_available boolean,emergency_available boolean,remote_available boolean,
  referral_methods text[],coverage_levels text[],capacity_status text,verification_status text,verified_at timestamptz,
  next_verification_at timestamptz,status text,distance_km double precision,match_score integer,match_explanation text[]
) language sql stable security invoker set search_path=public as $$
  with ranked as (
    select i.*,
      case when p_latitude is not null and p_longitude is not null and i.latitude is not null and i.longitude is not null then
        6371 * 2 * asin(sqrt(power(sin(radians(i.latitude-p_latitude)/2),2)+cos(radians(p_latitude))*cos(radians(i.latitude))*power(sin(radians(i.longitude-p_longitude)/2),2)))
      end as km,
      (case when p_service is not null and p_service=any(i.services) then 35 else 0 end+
       case when p_state is not null and (upper(i.state_code)=upper(p_state) or upper(p_state)=any(i.coverage_states)) then 20 else 0 end+
       case when p_municipality is not null and (lower(i.municipality)=lower(p_municipality) or lower(p_municipality)=any(i.coverage_municipalities)) then 15 else 0 end+
       case when p_language is not null and lower(p_language)=any(select lower(x) from unnest(i.languages)x) then 10 else 0 end+
       case when p_population is not null and lower(p_population)=any(select lower(x) from unnest(i.populations)x) then 10 else 0 end+
       case when i.status='verified' then 10 else 0 end+
       case when p_urgency='emergency' and i.emergency_available then 20 else 0 end) as score
    from public.social_institutions i
    where i.active and i.status not in ('closed','archived')
      and (p_query is null or to_tsvector('spanish',coalesce(i.official_name,i.name,'')||' '||coalesce(i.description,'')||' '||array_to_string(i.services,' ')) @@ plainto_tsquery('spanish',p_query))
      and (p_state is null or upper(i.state_code)=upper(p_state) or upper(p_state)=any(i.coverage_states) or 'national'=any(i.coverage_levels) or i.remote_available)
      and (p_municipality is null or lower(i.municipality)=lower(p_municipality) or lower(p_municipality)=any(i.coverage_municipalities) or 'statewide'=any(i.coverage_levels) or 'national'=any(i.coverage_levels) or i.remote_available)
      and (p_service is null or p_service=any(i.services))
      and (p_language is null or lower(p_language)=any(select lower(x) from unnest(i.languages)x))
      and (p_population is null or lower(p_population)=any(select lower(x) from unnest(i.populations)x))
      and (p_cost_type is null or i.cost_type=p_cost_type)
      and (p_availability is null or i.capacity_status=p_availability)
      and (p_urgency is null or p_urgency<>'emergency' or i.emergency_available)
  )
  select r.id,coalesce(r.official_name,r.name),r.institution_type,r.services,r.description,r.state_code,r.municipality,
    case when r.location_confidential then null else r.address end,
    case when r.location_confidential then null else r.latitude end,
    case when r.location_confidential then null else r.longitude end,
    r.phone,r.whatsapp,r.email,r.website,r.hours,r.languages,r.populations,r.eligibility,r.required_documents,r.cost_type,
    r.appointment_required,r.walk_in_available,r.emergency_available,r.remote_available,r.referral_methods,r.coverage_levels,
    r.capacity_status,r.verification_status,r.verified_at,r.next_verification_at,r.status,r.km,r.score,
    array_remove(array[
      case when p_service is not null and p_service=any(r.services) then 'service_match' end,
      case when p_state is not null and (upper(r.state_code)=upper(p_state) or upper(p_state)=any(r.coverage_states)) then 'geographic_match' end,
      case when p_language is not null and lower(p_language)=any(select lower(x) from unnest(r.languages)x) then 'language_match' end,
      case when p_population is not null and lower(p_population)=any(select lower(x) from unnest(r.populations)x) then 'population_match' end,
      case when p_urgency='emergency' and r.emergency_available then 'emergency_available' end,
      case when r.status='verified' then 'verified_resource' end
    ],null)
  from ranked r
  where (p_radius_km is null or r.km is null or r.km<=p_radius_km)
  order by r.score desc,r.km nulls last,coalesce(r.official_name,r.name)
  limit least(greatest(p_limit,1),100)
$$;

create or replace function public.verify_resource(
  p_institution uuid,p_status text,p_source text,p_evidence_url text default null,p_notes text default null,p_next_verification timestamptz default null
) returns uuid language plpgsql security invoker set search_path=public as $$
declare i public.social_institutions%rowtype; v_id uuid;
begin
  select * into i from public.social_institutions where id=p_institution for update;
  if not found then raise exception 'Resource not found'; end if;
  if not (public.is_platform_admin(auth.uid()) or (i.org_id is not null and public.can_manage_org(i.org_id,auth.uid()))) then raise exception 'Resource verification denied'; end if;
  insert into public.resource_verifications(institution_id,org_id,status,source,evidence_url,notes,verified_by,next_verification_at)
  values(i.id,i.org_id,p_status,p_source,p_evidence_url,p_notes,auth.uid(),p_next_verification) returning id into v_id;
  update public.social_institutions set status=p_status,verification_status=p_status,verification_source=p_source,
    verification_evidence_url=p_evidence_url,verified_at=now(),verified_by=auth.uid(),next_verification_at=p_next_verification,
    approved_at=case when p_status='verified' then coalesce(approved_at,now()) else approved_at end,
    approved_by=case when p_status='verified' then coalesce(approved_by,auth.uid()) else approved_by end,updated_at=now()
  where id=i.id;
  return v_id;
end $$;

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
  if coalesce(p_linked_entities,'{}'::jsonb) - array['referral_id','assessment_id','care_plan_id'] <> '{}'::jsonb then
    raise exception 'Unsupported document link type';
  end if;
  if p_linked_entities ? 'referral_id' and not exists(
    select 1 from public.social_referrals r where r.id=(p_linked_entities->>'referral_id')::uuid and r.social_case_id=d.social_case_id
  ) then raise exception 'Referral link must belong to this case'; end if;
  if p_linked_entities ? 'assessment_id' and not exists(
    select 1 from public.social_assessments a where a.id=(p_linked_entities->>'assessment_id')::uuid and a.social_case_id=d.social_case_id
  ) then raise exception 'Assessment link must belong to this case'; end if;
  if p_linked_entities ? 'care_plan_id' and not exists(
    select 1 from public.social_care_plans p where p.id=(p_linked_entities->>'care_plan_id')::uuid and p.social_case_id=d.social_case_id
  ) then raise exception 'Care plan link must belong to this case'; end if;
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

create or replace function public.social_sales_demo_any_owner_allows(p_id uuid,p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select not exists(select 1 from public.social_sales_demo_records d where d.record_id=p_id and d.synthetic and d.sales_demo)
 or exists(select 1 from public.social_sales_demo_records d where d.record_id=p_id and d.synthetic and d.sales_demo and d.owner_user_id=p_user)
$$;

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
 on conflict(social_case_id,closure_version) do update set reopened_at=case when excluded.social_case_id=c4 then '2026-08-20'::timestamptz else null::timestamptz end,reopened_by=case when excluded.social_case_id=c4 then u else null::uuid end,reopen_reason=case when excluded.social_case_id=c4 then 'Client returned and requested continued support' else null end;
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

create or replace function public.social_can_manage_org(
  p_org uuid,p_user uuid default auth.uid()
) returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select public.social_is_platform_admin(p_user) or exists (
    select 1
    from public.org_memberships m
    join public.organizations o on o.id=m.org_id
    where m.org_id=p_org and m.user_id=p_user and m.status='active'
      and m.role_in_org::text in ('owner','admin','firm_administrator','firm_manager')
      and o.status='active' and o.deleted_at is null
  )
$$;

create or replace function public.social_can_contribute_org(
  p_org uuid,p_user uuid default auth.uid()
) returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select public.social_is_platform_admin(p_user) or exists (
    select 1
    from public.org_memberships m
    join public.organizations o on o.id=m.org_id
    where m.org_id=p_org and m.user_id=p_user and m.status='active'
      and m.role_in_org::text in (
        'owner','admin','firm_administrator','firm_manager','supervisor',
        'case_worker','legal_provider','psychosocial_provider','lawyer',
        'paralegal','attorney','associate_attorney','legal_assistant'
      )
      and o.status='active' and o.deleted_at is null
  )
$$;

create or replace function public.social_org_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select greatest(1,coalesce(
    (
      select coalesce(bp.team_member_limit,bp.included_seats)
      from public.org_subscriptions s
      join public.billing_plans bp on bp.id=s.plan_id
      where s.org_id=p_org and s.status in ('active','trialing')
      order by s.updated_at desc limit 1
    ),
    (
      select coalesce(bp.team_member_limit,bp.included_seats)
      from public.organizations o
      join public.billing_plans bp on bp.code=o.plan or bp.key=o.plan
      where o.id=p_org and bp.active
      order by bp.updated_at desc limit 1
    ),
    1
  ))
$$;

create or replace function public.social_org_seats_used(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select count(*)::integer from public.org_memberships
  where org_id=p_org and status='active' and deleted_at is null
$$;

create or replace function public.social_org_role_to_care_role(p_role text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case p_role
    when 'firm_manager' then 'program_director'
    when 'supervisor' then 'case_management_supervisor'
    when 'case_worker' then 'case_manager'
    when 'legal_provider' then 'attorney'
    when 'psychosocial_provider' then 'psychologist'
    when 'read_only' then 'read_only_reviewer'
    else 'read_only_reviewer'
  end
$$;

create or replace function public.invite_social_organization_member(
  p_org uuid,p_email text,p_role text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_email text:=lower(btrim(coalesce(p_email,'')));
  v_token text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  v_id uuid;
  v_limit integer;
  v_used integer;
begin
  if not public.social_can_manage_org(p_org,auth.uid()) then
    raise exception 'Organization manager authority required';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid email address is required';
  end if;
  if p_role not in ('firm_manager','supervisor','case_worker','legal_provider','psychosocial_provider','read_only') then
    raise exception 'Unsupported organization role';
  end if;
  if exists(select 1 from public.org_memberships m join public.profiles p on p.id=m.user_id
    where m.org_id=p_org and lower(p.email)=v_email and m.status='active' and m.deleted_at is null) then
    raise exception 'That person is already an active organization member';
  end if;
  update public.organization_invitations set status='expired'
    where org_id=p_org and status='invited' and expires_at<=now();
  v_limit:=public.social_org_seat_limit(p_org);
  v_used:=public.social_org_seats_used(p_org)
    +(select count(*)::integer from public.organization_invitations
      where org_id=p_org and status='invited' and expires_at>now());
  if v_used>=v_limit then raise exception 'Organization seat limit reached'; end if;

  update public.organization_invitations set status='revoked',revoked_at=now()
    where org_id=p_org and email=v_email and status='invited';
  insert into public.organization_invitations(
    org_id,email,role,token_hash,invited_by
  ) values(p_org,v_email,p_role,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid())
  returning id into v_id;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(p_org,auth.uid(),'member_invited','organization_membership',v_id,
    jsonb_build_object('role',p_role));

  return jsonb_build_object(
    'id',v_id,'email',v_email,'role',p_role,'token',v_token,
    'expires_at',now()+interval '7 days','seat_limit',v_limit,'seats_used',v_used+1
  );
end
$$;

create or replace function public.accept_social_organization_invitation(p_token text)
returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_inv public.organization_invitations%rowtype;
  v_org_role text;
  v_social_role text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select lower(email) into v_email from auth.users where id=v_user;
  select * into v_inv from public.organization_invitations
    where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and status='invited' and expires_at>now() for update;
  if not found then raise exception 'Invitation is invalid or expired'; end if;
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'Invitation email does not match the signed-in account';
  end if;
  if public.social_org_seats_used(v_inv.org_id)>=public.social_org_seat_limit(v_inv.org_id) then
    raise exception 'Organization seat limit reached';
  end if;

  v_org_role:=v_inv.role;
  insert into public.org_memberships(org_id,user_id,role_in_org,status,invited_by,deleted_at)
  values(v_inv.org_id,v_user,v_org_role::public.org_role,'active',v_inv.invited_by,null)
  on conflict (org_id,user_id) do update set
    role_in_org=excluded.role_in_org,status='active',invited_by=excluded.invited_by,
    deleted_at=null,updated_at=now();

  v_social_role:=public.social_org_role_to_care_role(v_inv.role);
  update public.social_role_assignments set active=false,ends_at=now()
    where org_id=v_inv.org_id and user_id=v_user and scope_type='organization' and active;
  insert into public.social_role_assignments(
    org_id,user_id,role,scope_type,active,assigned_by
  ) values(v_inv.org_id,v_user,v_social_role,'organization',true,v_inv.invited_by);

  update public.organization_invitations set
    status='accepted',accepted_by=v_user,accepted_at=now()
  where id=v_inv.id;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(v_inv.org_id,v_user,'member_joined','organization_membership',v_inv.id,
    jsonb_build_object('role',v_inv.role));

  return jsonb_build_object('organization_id',v_inv.org_id,'role',v_inv.role,'status','active');
end
$$;

create or replace function public.set_social_organization_member(
  p_org uuid,p_user uuid,p_role text,p_status text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_owner boolean; v_social_role text;
begin
  if not public.social_can_manage_org(p_org,v_actor) then
    raise exception 'Organization manager authority required';
  end if;
  if p_user=v_actor and p_status in ('suspended','removed') then
    raise exception 'Managers cannot remove or suspend their own account';
  end if;
  if p_role not in ('firm_manager','supervisor','case_worker','legal_provider','psychosocial_provider','read_only') then
    raise exception 'Unsupported organization role';
  end if;
  if p_status not in ('active','suspended','removed') then
    raise exception 'Unsupported membership status';
  end if;
  select role_in_org::text='owner' into v_owner from public.org_memberships
    where org_id=p_org and user_id=p_user and deleted_at is null;
  if coalesce(v_owner,false) then raise exception 'Organization owner cannot be changed here'; end if;

  update public.org_memberships set
    role_in_org=p_role::public.org_role,status=p_status::public.membership_status,
    deleted_at=case when p_status='removed' then now() else null end,updated_at=now()
  where org_id=p_org and user_id=p_user;
  if not found then raise exception 'Organization member not found'; end if;

  update public.social_case_assignments set active=false,ended_at=now()
    where org_id=p_org and user_id=p_user and active and p_status<>'active';
  update public.social_role_assignments set active=false,ends_at=now()
    where org_id=p_org and user_id=p_user and active;

  if p_status='active' then
    v_social_role:=public.social_org_role_to_care_role(p_role);
    insert into public.social_role_assignments(
      org_id,user_id,role,scope_type,active,assigned_by
    ) values(p_org,p_user,v_social_role,'organization',true,v_actor);
  end if;

  insert into public.social_activity_events(
    org_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(p_org,v_actor,'member_'||p_status,'organization_membership',p_user,
    jsonb_build_object('role',p_role,'status',p_status));

  return jsonb_build_object('user_id',p_user,'role',p_role,'status',p_status);
end
$$;

create or replace function public.get_social_organization_account(p_org uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if not public.social_is_org_member(p_org,auth.uid()) then
    raise exception 'Active organization membership required';
  end if;
  select jsonb_build_object(
    'can_manage',public.social_can_manage_org(p_org,auth.uid()),
    'seat_limit',public.social_org_seat_limit(p_org),
    'seats_used',public.social_org_seats_used(p_org),
    'members',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'user_id',m.user_id,'role',m.role_in_org::text,'status',m.status::text,
        'name',coalesce(p.display_name,p.full_name,p.email,'Member'),
        'email',case when public.social_can_manage_org(p_org,auth.uid()) then p.email else null end,
        'joined_at',m.created_at,
        'assigned_cases',(select count(*) from public.social_case_assignments a where a.org_id=p_org and a.user_id=m.user_id and a.active),
        'open_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assigned_to=m.user_id and t.status not in ('done','cancelled')),
        'overdue_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assigned_to=m.user_id and t.status not in ('done','cancelled') and t.due_at<now()),
        'completed_tasks',(select count(*) from public.social_tasks t where t.org_id=p_org and t.assigned_to=m.user_id and t.status='done'),
        'referrals',(select count(*) from public.social_referrals r where r.org_id=p_org and r.created_by=m.user_id),
        'last_activity',(select max(e.occurred_at) from public.social_activity_events e where e.org_id=p_org and e.actor_id=m.user_id)
      ) order by coalesce(p.display_name,p.full_name,p.email),m.created_at)
      from public.org_memberships m left join public.profiles p on p.id=m.user_id
      where m.org_id=p_org and m.deleted_at is null
    ),'[]'::jsonb),
    'invitations',case when public.social_can_manage_org(p_org,auth.uid()) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'email',i.email,'role',i.role,'status',
        case when i.status='invited' and i.expires_at<=now() then 'expired' else i.status end,
        'invited_at',i.invited_at,'expires_at',i.expires_at
      ) order by i.invited_at desc)
      from public.organization_invitations i where i.org_id=p_org
    ),'[]'::jsonb) else '[]'::jsonb end,
    'recent_activity',coalesce((
      select jsonb_agg(x.row order by x.occurred_at desc) from (
        select jsonb_build_object(
          'id',e.id,'actor_id',e.actor_id,'event_type',e.event_type,
          'entity_type',e.entity_type,'occurred_at',e.occurred_at,
          'case_number',c.case_number
        ) row,e.occurred_at
        from public.social_activity_events e
        left join public.social_cases c on c.id=e.social_case_id
        where e.org_id=p_org order by e.occurred_at desc limit 100
      ) x
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

create or replace function public.social_org_subscription_active(p_org uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select public.social_is_platform_admin(auth.uid()) or exists(
    select 1 from public.org_subscriptions s
    where s.org_id=p_org and s.primary_subscription
      and (
        s.status in ('active','trialing')
        or (s.status='past_due' and s.grace_period_ends_at>now())
      )
      and (s.current_period_end is null or s.current_period_end>now() or s.grace_period_ends_at>now())
  )
$$;

create or replace function public.social_org_employee_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select greatest(0,coalesce(
    (select e.employee_seats from public.organization_entitlements e
      where e.org_id=p_org and e.status in ('active','trialing','past_due')),
    (select bp.employee_seats
      from public.org_subscriptions s join public.billing_plans bp on bp.id=s.plan_id
      where s.org_id=p_org and s.primary_subscription
      order by s.updated_at desc limit 1),
    (select greatest(0,coalesce(bp.team_member_limit,bp.included_seats,1)-1)
      from public.organizations o join public.billing_plans bp
        on bp.code=o.plan or bp.key=o.plan
      where o.id=p_org and bp.active order by bp.updated_at desc limit 1),
    0
  ))
$$;

create or replace function public.social_org_employee_seats_used(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select count(*)::integer
  from public.org_memberships
  where org_id=p_org and status='active' and deleted_at is null
    and role_in_org::text<>'owner'
$$;

create or replace function public.social_org_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select greatest(1,coalesce(
    (select e.total_user_limit from public.organization_entitlements e
      where e.org_id=p_org and e.status in ('active','trialing','past_due')),
    1+public.social_org_employee_seat_limit(p_org)
  ))
$$;

create or replace function public.enforce_social_invitation_subscription()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $invitation$
begin
  if new.status in ('invited','accepted')
     and not public.social_org_subscription_active(new.org_id) then
    raise exception 'An active organization subscription is required to use employee seats';
  end if;
  return new;
end
$invitation$;

create or replace function public.provision_organization_subscription_from_webhook(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_user_id uuid,
  p_org_id uuid,
  p_plan_key text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_status text,
  p_billing_interval text default 'month',
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_payload_hash text default null
) returns jsonb language plpgsql security definer
set search_path=public,extensions,pg_temp as $$
declare
  v_event uuid;
  v_org uuid;
  v_plan public.billing_plans%rowtype;
  v_subscription uuid;
  v_name text;
  v_status text;
begin
  if p_provider not in ('stripe','mercadopago') then
    raise exception 'Unsupported billing provider';
  end if;
  if p_provider_event_id is null or btrim(p_provider_event_id)='' then
    raise exception 'Provider event id is required';
  end if;

  insert into public.billing_webhook_events(
    provider,provider_event_id,event_type,verified,processing_status,user_id,
    org_id,provider_subscription_id,payload_hash
  ) values(
    p_provider,p_provider_event_id,p_event_type,true,'received',p_user_id,
    p_org_id,p_provider_subscription_id,p_payload_hash
  )
  on conflict(provider,provider_event_id) do nothing
  returning id into v_event;

  if v_event is null then
    return jsonb_build_object('ok',true,'duplicate',true,'provider_event_id',p_provider_event_id);
  end if;
  if p_user_id is null then
    update public.billing_webhook_events set processing_status='ignored',
      error_detail='No user could be resolved',processed_at=now() where id=v_event;
    return jsonb_build_object('ok',false,'ignored',true,'reason','no_user');
  end if;

  if p_plan_key is not null then
    select * into v_plan from public.billing_plans
    where active and (key=p_plan_key or code=p_plan_key)
    order by updated_at desc limit 1;
  end if;
  if v_plan.id is null and p_provider_subscription_id is not null then
    select bp.* into v_plan
    from public.org_subscriptions s join public.billing_plans bp on bp.id=s.plan_id
    where s.provider=p_provider and s.provider_subscription_id=p_provider_subscription_id
    order by s.updated_at desc limit 1;
  end if;
  if v_plan.id is null then
    select bp.* into v_plan
    from public.org_memberships m
    join public.org_subscriptions s on s.org_id=m.org_id and s.primary_subscription
    join public.billing_plans bp on bp.id=s.plan_id
    where m.user_id=p_user_id and m.status='active' and m.deleted_at is null
    order by s.updated_at desc limit 1;
  end if;
  if v_plan.id is null then
    update public.billing_webhook_events set processing_status='failed',
      error_detail='Billing plan could not be resolved',processed_at=now() where id=v_event;
    raise exception 'Billing plan could not be resolved';
  end if;

  if p_org_id is not null and exists(
    select 1 from public.org_memberships
    where org_id=p_org_id and user_id=p_user_id and status='active' and deleted_at is null
  ) then v_org:=p_org_id; end if;

  if v_org is null then
    select m.org_id into v_org from public.org_memberships m
    where m.user_id=p_user_id and m.status='active' and m.deleted_at is null
    order by (m.role_in_org::text='owner') desc,m.created_at limit 1;
  end if;

  if v_org is null and p_status in ('active','trialing') then
    select coalesce(nullif(btrim(s.firm_name),''),
      split_part(coalesce(u.email,'Nyrava'),'@',1)||' Organization')
    into v_name
    from auth.users u left join public.user_settings s on s.user_id=u.id
    where u.id=p_user_id;
    insert into public.organizations(name,slug,created_by,plan,status)
    values(coalesce(v_name,'Nyrava Organization'),
      'org-'||replace(p_user_id::text,'-',''),p_user_id,
      coalesce(v_plan.key,v_plan.code),'active')
    returning id into v_org;
    insert into public.org_memberships(org_id,user_id,role_in_org,status,deleted_at)
    values(v_org,p_user_id,'owner','active',null)
    on conflict(org_id,user_id) do update set
      role_in_org='owner',status='active',deleted_at=null,updated_at=now();
  end if;

  if v_org is null then
    update public.billing_webhook_events set processing_status='ignored',
      error_detail='No organization exists for an inactive subscription',
      processed_at=now() where id=v_event;
    return jsonb_build_object('ok',false,'ignored',true,'reason','no_organization');
  end if;

  v_status:=case
    when p_status in ('active','trialing','past_due','canceled') then p_status
    when p_status='authorized' then 'active'
    when p_status in ('cancelled','cancelled_by_user') then 'canceled'
    else 'inactive' end;

  select id into v_subscription from public.org_subscriptions
  where provider=p_provider and provider_subscription_id=p_provider_subscription_id
  order by updated_at desc limit 1 for update;

  if v_subscription is null then
    select id into v_subscription from public.org_subscriptions
    where org_id=v_org and primary_subscription
    order by updated_at desc limit 1 for update;
  end if;

  if v_subscription is null then
    insert into public.org_subscriptions(
      org_id,plan_id,provider,provider_subscription_id,status,
      current_period_start,current_period_end,metadata,provider_customer_id,
      billing_interval,currency,primary_subscription,grace_period_ends_at
    ) values(
      v_org,v_plan.id,p_provider,p_provider_subscription_id,v_status,
      p_period_start,p_period_end,'{}'::jsonb,p_provider_customer_id,
      coalesce(p_billing_interval,'month'),v_plan.currency,true,
      case when v_status='past_due' then now()+interval '7 days' else null end
    ) returning id into v_subscription;
  else
    update public.org_subscriptions set
      plan_id=v_plan.id,provider=p_provider,
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_customer_id=coalesce(p_provider_customer_id,provider_customer_id),
      status=v_status,current_period_start=coalesce(p_period_start,current_period_start),
      current_period_end=coalesce(p_period_end,current_period_end),
      billing_interval=coalesce(p_billing_interval,billing_interval),
      currency=v_plan.currency,cancelled_at=case when v_status='canceled' then now() else null end,
      grace_period_ends_at=case when v_status='past_due' then
        coalesce(grace_period_ends_at,now()+interval '7 days') else null end,
      updated_at=now()
    where id=v_subscription;
  end if;

  update public.org_subscriptions set primary_subscription=false,updated_at=now()
  where org_id=v_org and id<>v_subscription and primary_subscription;

  insert into public.organization_entitlements(
    org_id,subscription_id,plan_id,status,owner_seats,employee_seats,total_user_limit,
    case_limit,ai_requests_monthly,talk_to_case_monthly,monthly_document_pages,
    storage_limit_bytes,max_upload_size_bytes,byok_allowed,feature_flags,
    valid_from,valid_until,updated_at
  ) values(
    v_org,v_subscription,v_plan.id,v_status,
    greatest(1,v_plan.owner_seats),greatest(0,v_plan.employee_seats),
    greatest(coalesce(v_plan.total_user_limit,1+v_plan.employee_seats),1+v_plan.employee_seats),
    v_plan.case_limit,v_plan.ai_requests_monthly,v_plan.talk_to_case_monthly,
    v_plan.monthly_document_pages,
    coalesce(v_plan.storage_limit_bytes,(v_plan.storage_gb_limit*1073741824)::bigint),
    v_plan.max_upload_size_bytes,v_plan.byok_allowed,v_plan.feature_flags,
    coalesce(p_period_start,now()),p_period_end,now()
  )
  on conflict(org_id) do update set
    subscription_id=excluded.subscription_id,plan_id=excluded.plan_id,status=excluded.status,
    owner_seats=excluded.owner_seats,employee_seats=excluded.employee_seats,
    total_user_limit=excluded.total_user_limit,case_limit=excluded.case_limit,
    ai_requests_monthly=excluded.ai_requests_monthly,
    talk_to_case_monthly=excluded.talk_to_case_monthly,
    monthly_document_pages=excluded.monthly_document_pages,
    storage_limit_bytes=excluded.storage_limit_bytes,
    max_upload_size_bytes=excluded.max_upload_size_bytes,
    byok_allowed=excluded.byok_allowed,feature_flags=excluded.feature_flags,
    valid_from=excluded.valid_from,valid_until=excluded.valid_until,updated_at=now();

  update public.organizations set plan=coalesce(v_plan.key,v_plan.code),
    status=case when v_status in ('active','trialing','past_due') then 'active' else status end,
    updated_at=now() where id=v_org;

  if p_period_start is not null and p_period_end is not null then
    insert into public.organization_usage_periods(
      org_id,subscription_id,period_start,period_end
    ) values(v_org,v_subscription,p_period_start,p_period_end)
    on conflict(org_id,period_start,period_end) do update set
      subscription_id=excluded.subscription_id,updated_at=now();
  end if;

  update public.billing_webhook_events set org_id=v_org,
    processing_status='processed',processed_at=now() where id=v_event;
  return jsonb_build_object(
    'ok',true,'duplicate',false,'organization_id',v_org,
    'subscription_id',v_subscription,'plan',coalesce(v_plan.key,v_plan.code),
    'owner_seats',v_plan.owner_seats,'employee_seats',v_plan.employee_seats
  );
exception when others then
  if v_event is not null then
    update public.billing_webhook_events set processing_status='failed',
      error_detail=left(sqlerrm,500),processed_at=now() where id=v_event;
  end if;
  raise;
end
$$;

create or replace function public.list_public_billing_plans()
returns table (
  key text,
  label text,
  tagline text,
  features jsonb,
  price_cents integer,
  currency text,
  "interval" text,
  self_serve boolean,
  contact_url text,
  included_seats integer,
  per_seat_price_cents integer,
  sort_order integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Marketing fields ONLY. Never returns stripe_price_id,
  -- mercadopago_plan_id, internal notes, quotas or limits.
  select p.key, p.label, p.tagline, p.features::jsonb, p.price_cents, p.currency,
         p."interval", p.self_serve, p.contact_url, p.included_seats,
         p.per_seat_price_cents, p.sort_order
  from public.billing_plans p
  where p.active = true
  order by p.sort_order asc
$$;

create or replace function public.create_and_assign_care_case(
  p_org uuid,
  p_program uuid,
  p_person uuid,
  p_client_name text,
  p_family uuid,
  p_case_type text,
  p_priority text,
  p_assigned_user uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $care_case$
declare
  v_actor uuid:=auth.uid();
  v_case public.social_cases%rowtype;
  v_client_name text;
  v_assignee_name text;
  v_due timestamptz;
  v_person_id uuid:=p_person;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.social_is_org_member(p_org,v_actor) then
    raise exception 'Active organization membership required' using errcode='42501';
  end if;
  if not (public.social_can_manage_org(p_org,v_actor)
    or public.social_has_capability(p_org,'case.create',v_actor)) then
    raise exception 'Case creation denied for this organization' using errcode='42501';
  end if;
  if not exists(select 1 from public.social_programs
    where id=p_program and org_id=p_org and active) then
    raise exception 'Invalid or inactive Comprehensive Care program';
  end if;
  if v_person_id is null then
    if length(btrim(coalesce(p_client_name,'')))<2 then
      raise exception 'Select an existing client or enter the new client legal name';
    end if;
    insert into public.social_people(
      org_id,person_number,legal_name,aliases,languages,current_location,
      immigration_identifiers,unaccompanied_minor,separated_minor,
      assigned_case_manager,created_by
    ) values(
      p_org,null,btrim(p_client_name),'{}'::text[],'{}'::text[],'{}'::jsonb,
      '{}'::jsonb,false,false,coalesce(p_assigned_user,v_actor),v_actor
    ) returning id into v_person_id;
  elsif not exists(select 1 from public.social_people
    where id=v_person_id and org_id=p_org and deleted_at is null) then
    raise exception 'The selected client is outside this organization';
  end if;
  if p_family is not null and not exists(select 1 from public.social_families
    where id=p_family and org_id=p_org and deleted_at is null) then
    raise exception 'Family is outside this organization';
  end if;
  if p_case_type not in ('individual','minor_child','family') then
    raise exception 'Case type must be individual, minor_child, or family';
  end if;
  if p_priority not in ('standard','urgent','emergency') then
    raise exception 'Priority must be standard, urgent, or emergency';
  end if;
  if p_assigned_user is not null and not exists(
    select 1 from public.org_memberships m
    where m.org_id=p_org and m.user_id=p_assigned_user
      and m.status='active' and m.deleted_at is null
  ) then raise exception 'The selected team member is not active in this organization'; end if;

  select legal_name into v_client_name from public.social_people where id=v_person_id;
  if p_assigned_user is not null then
    select coalesce(p.display_name,p.full_name,p.email,'Team member')
      into v_assignee_name from public.profiles p where p.id=p_assigned_user;
  end if;

  insert into public.social_cases(
    org_id,program_id,person_id,family_id,case_type,assigned_case_manager,
    supervising_manager,status,priority,risk_level,confidentiality_level,
    service_areas,tags,created_by
  ) values(
    p_org,p_program,v_person_id,p_family,p_case_type,p_assigned_user,v_actor,
    'intake',p_priority,'unknown','standard','{}'::text[],'{}'::text[],v_actor
  ) returning * into v_case;

  if p_assigned_user is not null then
    insert into public.social_case_assignments(
      org_id,social_case_id,user_id,assignment_role,assigned_by
    ) values(p_org,v_case.id,p_assigned_user,'primary_case_manager',v_actor)
    on conflict do nothing;
  end if;

  insert into public.social_case_status_history(
    org_id,social_case_id,from_status,to_status,changed_by,reason
  ) values(p_org,v_case.id,null,'intake',v_actor,'Case opened; displayed as New');

  insert into public.social_activity_events(
    org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    p_org,v_case.id,v_actor,'case_opened_and_assigned','social_case',v_case.id,
    jsonb_build_object(
      'case_type',p_case_type,'priority',p_priority,
      'assigned_user_id',p_assigned_user,'supervising_manager',v_actor
    )
  );

  insert into public.social_alerts(
    org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,
    assigned_to,metadata
  ) values(
    p_org,v_case.id,'new_case_assignment',
    case when p_priority='emergency' then 'critical'
         when p_priority='urgent' then 'high' else 'info' end,
    'Nuevo caso asignado: '||v_client_name,
    'New case assigned: '||v_client_name,
    case when p_priority='emergency' then now()+interval '15 minutes'
         when p_priority='urgent' then now()+interval '4 hours' else null end,
    coalesce(p_assigned_user,v_actor),
    jsonb_build_object('case_id',v_case.id,'case_number',v_case.case_number,
      'priority',p_priority,'assigned_by',v_actor,'requires_acknowledgement',p_priority<>'standard')
  );

  if p_priority in ('urgent','emergency') then
    v_due:=case when p_priority='emergency' then now()+interval '15 minutes'
                else now()+interval '4 hours' end;
    insert into public.social_tasks(
      org_id,social_case_id,title,description,assignee_id,priority,status,
      due_at,reminder_at,supervisor_escalation_at,created_by
    ) values(
      p_org,v_case.id,
      case when p_priority='emergency' then 'Immediate emergency response and acknowledgement'
           else 'Acknowledge urgent case assignment' end,
      'Review the new assignment, document the initial response, and acknowledge it. This system does not replace emergency services.',
      coalesce(p_assigned_user,v_actor),'urgent','todo',v_due,
      case when p_priority='emergency' then now()+interval '5 minutes' else now()+interval '2 hours' end,
      v_due,v_actor
    );
  end if;

  if p_priority='emergency' and p_assigned_user is distinct from v_actor then
    insert into public.social_alerts(
      org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,
      assigned_to,metadata
    ) values(
      p_org,v_case.id,'emergency_case_supervision','critical',
      'Supervisión inmediata requerida: '||v_case.case_number,
      'Immediate supervision required: '||v_case.case_number,
      now()+interval '15 minutes',v_actor,
      jsonb_build_object('case_id',v_case.id,'assigned_user_id',p_assigned_user)
    );
  end if;

  return to_jsonb(v_case)||jsonb_build_object(
    'display_status','new','client_name',v_client_name,
    'assigned_user_name',v_assignee_name
  );
end
$care_case$;

create or replace function public.invite_social_organization_member(
  p_org uuid,p_email text,p_role text,p_name text,p_title text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $member_invitation$
declare
  v_email text:=lower(btrim(coalesce(p_email,'')));
  v_token text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  v_id uuid; v_limit integer; v_used integer;
begin
  if not public.social_can_manage_org(p_org,auth.uid()) then raise exception 'Organization manager authority required'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'A valid email address is required'; end if;
  if length(btrim(coalesce(p_name,'')))<2 then raise exception 'Team member name is required'; end if;
  if length(btrim(coalesce(p_title,'')))<2 then raise exception 'Team member title is required'; end if;
  if p_role not in ('firm_manager','supervisor','case_worker','legal_provider','psychosocial_provider','read_only') then raise exception 'Unsupported organization role'; end if;
  if exists(select 1 from public.org_memberships m join public.profiles p on p.id=m.user_id
    where m.org_id=p_org and lower(p.email)=v_email and m.status='active' and m.deleted_at is null) then
    raise exception 'That person is already an active organization member';
  end if;
  update public.organization_invitations set status='expired' where org_id=p_org and status='invited' and expires_at<=now();
  v_limit:=public.social_org_seat_limit(p_org);
  v_used:=public.social_org_seats_used(p_org)+(select count(*)::integer from public.organization_invitations where org_id=p_org and status='invited' and expires_at>now());
  if v_used>=v_limit then raise exception 'Organization seat limit reached'; end if;
  update public.organization_invitations set status='revoked',revoked_at=now() where org_id=p_org and email=v_email and status='invited';
  insert into public.organization_invitations(org_id,email,role,token_hash,invited_by,invitee_name,invitee_title)
  values(p_org,v_email,p_role,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid(),btrim(p_name),btrim(p_title))
  returning id into v_id;
  insert into public.social_activity_events(org_id,actor_id,event_type,entity_type,entity_id,metadata)
  values(p_org,auth.uid(),'member_invited','organization_membership',v_id,jsonb_build_object('role',p_role,'name',btrim(p_name),'title',btrim(p_title)));
  return jsonb_build_object('id',v_id,'email',v_email,'name',btrim(p_name),'title',btrim(p_title),'role',p_role,'token',v_token,'expires_at',now()+interval '7 days','seat_limit',v_limit,'seats_used',v_used+1);
end
$member_invitation$;

create or replace function public.assign_social_intake_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $assign_intake_number$
declare
  v_year integer := extract(year from current_date)::integer;
  v_next bigint;
begin
  if new.intake_number is not null and btrim(new.intake_number) <> '' then
    return new;
  end if;

  insert into public.social_intake_number_counters(org_id, intake_year, next_value)
  values(new.org_id, v_year, 2)
  on conflict (org_id, intake_year)
  do update set next_value = public.social_intake_number_counters.next_value + 1
  returning next_value - 1 into v_next;

  new.intake_number :=
    'NYR-INT-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
  return new;
end
$assign_intake_number$;

create or replace function public.prevent_social_intake_number_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $immutable_intake_number$
begin
  if new.intake_number is distinct from old.intake_number
    or new.org_id is distinct from old.org_id
  then
    raise exception 'Intake number and organization are immutable';
  end if;
  return new;
end
$immutable_intake_number$;

create or replace function public.create_social_intake(
  p_org uuid,
  p_program uuid,
  p_person uuid,
  p_family uuid,
  p_source text,
  p_summary text,
  p_presenting_needs text[],
  p_assigned_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $create_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.social_is_org_member(p_org, v_actor) then
    raise exception 'Active organization membership required' using errcode = '42501';
  end if;

  if not (
    public.social_can_manage_org(p_org, v_actor)
    or public.social_has_capability(p_org, 'case.create', v_actor)
  ) then
    raise exception 'Intake creation denied for this organization' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.social_programs
    where id = p_program and org_id = p_org and active
  ) then
    raise exception 'Invalid or inactive Comprehensive Care program';
  end if;

  if not exists (
    select 1 from public.social_people
    where id = p_person and org_id = p_org and deleted_at is null
  ) then
    raise exception 'The selected client is outside this organization';
  end if;

  if p_family is not null and not exists (
    select 1 from public.social_families
    where id = p_family and org_id = p_org and deleted_at is null
  ) then
    raise exception 'Family is outside this organization';
  end if;

  if p_source not in ('direct','phone','email','walk_in','outreach','referral','emergency','other') then
    raise exception 'Unsupported intake source';
  end if;

  if length(btrim(coalesce(p_summary, ''))) < 3 then
    raise exception 'Intake summary is required';
  end if;

  if p_assigned_user is not null and not exists (
    select 1 from public.org_memberships
    where org_id = p_org
      and user_id = p_assigned_user
      and status = 'active'
      and deleted_at is null
  ) then
    raise exception 'The selected team member is not active in this organization';
  end if;

  insert into public.social_intakes(
    org_id, program_id, intake_number, person_id, family_id, source,
    status, disposition, summary, presenting_needs, assigned_to, created_by
  )
  values(
    p_org, p_program, null, p_person, p_family, p_source,
    'under_review', 'pending', btrim(p_summary),
    coalesce(p_presenting_needs, '{}'::text[]),
    coalesce(p_assigned_user, v_actor), v_actor
  )
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    p_org, v_actor, 'intake_created', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'person_id', p_person,
      'family_id', p_family,
      'assigned_to', v_intake.assigned_to,
      'source', p_source
    )
  );

  return to_jsonb(v_intake);
end
$create_intake$;

create or replace function public.complete_social_intake(
  p_intake uuid,
  p_disposition text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $complete_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
begin
  select * into v_intake
  from public.social_intakes
  where id = p_intake
  for update;

  if not found then
    raise exception 'Intake not found';
  end if;

  if not (
    v_intake.assigned_to = v_actor
    or v_intake.created_by = v_actor
    or public.social_can_manage_org(v_intake.org_id, v_actor)
    or public.social_has_capability(v_intake.org_id, 'case.view_all', v_actor)
  ) then
    raise exception 'Intake disposition denied' using errcode = '42501';
  end if;

  if v_intake.status = 'completed' then
    raise exception 'Intake is already completed';
  end if;

  if p_disposition not in ('refer_only','information_only','ineligible','duplicate','no_follow_up') then
    raise exception 'Use the intake-to-case workflow when opening a case';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A disposition reason is required';
  end if;

  update public.social_intakes
  set status = 'completed',
      disposition = p_disposition,
      disposition_reason = btrim(p_reason),
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_intake.id
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    v_intake.org_id, v_actor, 'intake_completed', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'disposition', p_disposition,
      'reason', btrim(p_reason)
    )
  );

  return to_jsonb(v_intake);
end
$complete_intake$;

create or replace function public.open_care_case_from_intake(
  p_intake uuid,
  p_case_type text,
  p_priority text,
  p_assigned_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $open_from_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
  v_case jsonb;
  v_case_id uuid;
begin
  select * into v_intake
  from public.social_intakes
  where id = p_intake
  for update;

  if not found then
    raise exception 'Intake not found';
  end if;

  if v_intake.status = 'completed' then
    raise exception 'Intake is already completed';
  end if;

  if not (
    v_intake.assigned_to = v_actor
    or v_intake.created_by = v_actor
    or public.social_can_manage_org(v_intake.org_id, v_actor)
    or public.social_has_capability(v_intake.org_id, 'case.view_all', v_actor)
  ) then
    raise exception 'Intake-to-case conversion denied' using errcode = '42501';
  end if;

  v_case := public.create_and_assign_care_case(
    v_intake.org_id,
    v_intake.program_id,
    v_intake.person_id,
    null,
    v_intake.family_id,
    p_case_type,
    p_priority,
    coalesce(p_assigned_user, v_intake.assigned_to)
  );

  v_case_id := (v_case ->> 'id')::uuid;

  update public.social_intakes
  set status = 'completed',
      disposition = 'open_case',
      disposition_reason = 'Converted through the authorized intake-to-case workflow',
      social_case_id = v_case_id,
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_intake.id
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, social_case_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    v_intake.org_id, v_case_id, v_actor,
    'intake_converted_to_case', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'case_id', v_case_id,
      'case_number', v_case ->> 'case_number'
    )
  );

  return v_case || jsonb_build_object(
    'intake_id', v_intake.id,
    'intake_number', v_intake.intake_number
  );
end
$open_from_intake$;

create or replace function public.canonicalize_social_assignment_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $canonical_assignment_role$
begin
  if new.assignment_role = 'primary_case_manager' then
    new.assignment_role := 'case_manager';
  end if;
  return new;
end
$canonical_assignment_role$;

create or replace function public.assign_social_intake_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $assign_intake_number$
declare
  v_year integer := extract(year from current_date)::integer;
  v_next bigint;
begin
  if new.intake_number is not null and btrim(new.intake_number) <> '' then
    return new;
  end if;

  insert into public.social_intake_number_counters(org_id, intake_year, next_value)
  values(new.org_id, v_year, 2)
  on conflict (org_id, intake_year)
  do update set next_value = public.social_intake_number_counters.next_value + 1
  returning next_value - 1 into v_next;

  new.intake_number :=
    'NYR-INT-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
  return new;
end
$assign_intake_number$;

create or replace function public.prevent_social_intake_number_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $immutable_intake_number$
begin
  if new.intake_number is distinct from old.intake_number
    or new.org_id is distinct from old.org_id
  then
    raise exception 'Intake number and organization are immutable';
  end if;
  return new;
end
$immutable_intake_number$;

create or replace function public.create_social_intake(
  p_org uuid,
  p_program uuid,
  p_person uuid,
  p_family uuid,
  p_source text,
  p_summary text,
  p_presenting_needs text[],
  p_assigned_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $create_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.social_is_org_member(p_org, v_actor) then
    raise exception 'Active organization membership required' using errcode = '42501';
  end if;

  if not (
    public.social_can_manage_org(p_org, v_actor)
    or public.social_has_capability(p_org, 'case.create', v_actor)
  ) then
    raise exception 'Intake creation denied for this organization' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.social_programs
    where id = p_program and org_id = p_org and active
  ) then
    raise exception 'Invalid or inactive Comprehensive Care program';
  end if;

  if not exists (
    select 1 from public.social_people
    where id = p_person and org_id = p_org and deleted_at is null
  ) then
    raise exception 'The selected client is outside this organization';
  end if;

  if p_family is not null and not exists (
    select 1 from public.social_families
    where id = p_family and org_id = p_org and deleted_at is null
  ) then
    raise exception 'Family is outside this organization';
  end if;

  if p_source not in ('direct','phone','email','walk_in','outreach','referral','emergency','other') then
    raise exception 'Unsupported intake source';
  end if;

  if length(btrim(coalesce(p_summary, ''))) < 3 then
    raise exception 'Intake summary is required';
  end if;

  if p_assigned_user is not null and not exists (
    select 1 from public.org_memberships
    where org_id = p_org
      and user_id = p_assigned_user
      and status = 'active'
      and deleted_at is null
  ) then
    raise exception 'The selected team member is not active in this organization';
  end if;

  insert into public.social_intakes(
    org_id, program_id, intake_number, person_id, family_id, source,
    status, disposition, summary, presenting_needs, assigned_to, created_by
  )
  values(
    p_org, p_program, null, p_person, p_family, p_source,
    'under_review', 'pending', btrim(p_summary),
    coalesce(p_presenting_needs, '{}'::text[]),
    coalesce(p_assigned_user, v_actor), v_actor
  )
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    p_org, v_actor, 'intake_created', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'person_id', p_person,
      'family_id', p_family,
      'assigned_to', v_intake.assigned_to,
      'source', p_source
    )
  );

  return to_jsonb(v_intake);
end
$create_intake$;

create or replace function public.complete_social_intake(
  p_intake uuid,
  p_disposition text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $complete_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
begin
  select * into v_intake
  from public.social_intakes
  where id = p_intake
  for update;

  if not found then
    raise exception 'Intake not found';
  end if;

  if not (
    v_intake.assigned_to = v_actor
    or v_intake.created_by = v_actor
    or public.social_can_manage_org(v_intake.org_id, v_actor)
    or public.social_has_capability(v_intake.org_id, 'case.view_all', v_actor)
  ) then
    raise exception 'Intake disposition denied' using errcode = '42501';
  end if;

  if v_intake.status = 'completed' then
    raise exception 'Intake is already completed';
  end if;

  if p_disposition not in ('refer_only','information_only','ineligible','duplicate','no_follow_up') then
    raise exception 'Use the intake-to-case workflow when opening a case';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A disposition reason is required';
  end if;

  update public.social_intakes
  set status = 'completed',
      disposition = p_disposition,
      disposition_reason = btrim(p_reason),
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_intake.id
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    v_intake.org_id, v_actor, 'intake_completed', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'disposition', p_disposition,
      'reason', btrim(p_reason)
    )
  );

  return to_jsonb(v_intake);
end
$complete_intake$;

create or replace function public.open_care_case_from_intake(
  p_intake uuid,
  p_case_type text,
  p_priority text,
  p_assigned_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $open_from_intake$
declare
  v_actor uuid := auth.uid();
  v_intake public.social_intakes%rowtype;
  v_case jsonb;
  v_case_id uuid;
begin
  select * into v_intake
  from public.social_intakes
  where id = p_intake
  for update;

  if not found then
    raise exception 'Intake not found';
  end if;

  if v_intake.status = 'completed' then
    raise exception 'Intake is already completed';
  end if;

  if not (
    v_intake.assigned_to = v_actor
    or v_intake.created_by = v_actor
    or public.social_can_manage_org(v_intake.org_id, v_actor)
    or public.social_has_capability(v_intake.org_id, 'case.view_all', v_actor)
  ) then
    raise exception 'Intake-to-case conversion denied' using errcode = '42501';
  end if;

  v_case := public.create_and_assign_care_case(
    v_intake.org_id,
    v_intake.program_id,
    v_intake.person_id,
    null,
    v_intake.family_id,
    p_case_type,
    p_priority,
    coalesce(p_assigned_user, v_intake.assigned_to)
  );

  v_case_id := (v_case ->> 'id')::uuid;

  update public.social_intakes
  set status = 'completed',
      disposition = 'open_case',
      disposition_reason = 'Converted through the authorized intake-to-case workflow',
      social_case_id = v_case_id,
      completed_at = now(),
      completed_by = v_actor,
      updated_at = now()
  where id = v_intake.id
  returning * into v_intake;

  insert into public.social_activity_events(
    org_id, social_case_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values(
    v_intake.org_id, v_case_id, v_actor,
    'intake_converted_to_case', 'social_intake', v_intake.id,
    jsonb_build_object(
      'intake_number', v_intake.intake_number,
      'case_id', v_case_id,
      'case_number', v_case ->> 'case_number'
    )
  );

  return v_case || jsonb_build_object(
    'intake_id', v_intake.id,
    'intake_number', v_intake.intake_number
  );
end
$open_from_intake$;

create or replace function public.canonicalize_social_assignment_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $canonical_assignment_role$
begin
  if new.assignment_role = 'primary_case_manager' then
    new.assignment_role := 'case_manager';
  end if;
  return new;
end
$canonical_assignment_role$;

create or replace function public.update_care_case_state(
  p_case uuid,
  p_status text,
  p_priority text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $update_case_state$
declare
  v_actor uuid := auth.uid();
  v_case public.social_cases%rowtype;
  v_status text;
  v_priority text;
  v_kind text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_case
  from public.social_cases
  where id = p_case
  for update;

  if not found then
    raise exception 'Comprehensive Care case not found';
  end if;

  if not public.social_can_access_case(
    v_case.id, 'general_case_record', true, v_actor
  ) then
    raise exception 'Case state change denied' using errcode = '42501';
  end if;

  if v_case.status = 'closed' then
    raise exception 'Closed cases must use the authorized reopening workflow';
  end if;

  v_status := coalesce(nullif(btrim(p_status), ''), v_case.status);
  v_priority := coalesce(nullif(btrim(p_priority), ''), v_case.priority);

  if v_case.status in ('transferred','archived') then
    raise exception 'Transferred or archived cases cannot be changed from the case header';
  end if;

  if v_status in ('closed','reopened','transferred','archived')
    and v_status is distinct from v_case.status
  then
    raise exception 'Use the dedicated closure, reopening, transfer, or archive workflow';
  end if;

  if v_priority not in ('standard','urgent','emergency') then
    raise exception 'Priority must be standard, urgent, or emergency';
  end if;

  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A documented reason of at least five characters is required';
  end if;

  if v_status is distinct from v_case.status and not (
    (v_case.status = 'intake' and v_status in ('assessment','active'))
    or (v_case.status = 'assessment' and v_status in ('active','monitoring'))
    or (v_case.status = 'active' and v_status in ('monitoring','pending_referral'))
    or (v_case.status = 'monitoring' and v_status in ('active','pending_referral'))
    or (v_case.status = 'pending_referral' and v_status in ('active','monitoring'))
    or (v_case.status = 'reopened' and v_status in ('assessment','active'))
  ) then
    raise exception 'Invalid Comprehensive Care status transition: % to %',
      v_case.status, v_status;
  end if;

  if v_status = v_case.status and v_priority = v_case.priority then
    raise exception 'Status and priority are unchanged';
  end if;

  v_kind := case
    when v_status is distinct from v_case.status
      and v_priority is distinct from v_case.priority
      then 'status_and_priority'
    when v_status is distinct from v_case.status then 'status'
    else 'priority'
  end;

  update public.social_cases
  set status = v_status,
      priority = v_priority,
      updated_at = now(),
      last_activity_at = now()
  where id = v_case.id;

  insert into public.social_case_status_history(
    org_id, social_case_id, from_status, to_status,
    changed_by, reason, change_kind, from_priority, to_priority
  )
  values(
    v_case.org_id, v_case.id, v_case.status, v_status,
    v_actor, btrim(p_reason), v_kind, v_case.priority, v_priority
  );

  insert into public.social_activity_events(
    org_id, social_case_id, actor_id, event_type,
    entity_type, entity_id, metadata
  )
  values(
    v_case.org_id, v_case.id, v_actor, 'case_state_changed',
    'social_case', v_case.id,
    jsonb_build_object(
      'change_kind', v_kind,
      'from_status', v_case.status,
      'to_status', v_status,
      'from_priority', v_case.priority,
      'to_priority', v_priority,
      'reason', btrim(p_reason)
    )
  );

  if v_priority = 'emergency'
    and v_case.priority is distinct from 'emergency'
  then
    insert into public.social_alerts(
      org_id, social_case_id, alert_type, severity,
      title_es, title_en, due_at, assigned_to, metadata
    )
    values(
      v_case.org_id, v_case.id, 'emergency_priority_escalation', 'critical',
      'Prioridad de emergencia: ' || v_case.case_number,
      'Emergency priority: ' || v_case.case_number,
      now() + interval '15 minutes',
      coalesce(v_case.assigned_case_manager, v_actor),
      jsonb_build_object(
        'case_id', v_case.id,
        'changed_by', v_actor,
        'reason', btrim(p_reason),
        'requires_acknowledgement', true
      )
    );

    insert into public.social_tasks(
      org_id, social_case_id, title, description,
      assignee_id, priority, status, due_at,
      reminder_at, supervisor_escalation_at, created_by
    )
    values(
      v_case.org_id, v_case.id,
      'Immediate emergency response and acknowledgement',
      'Review the emergency-priority change, document the response, and acknowledge it. This system does not replace emergency services.',
      coalesce(v_case.assigned_case_manager, v_actor),
      'urgent', 'todo',
      now() + interval '15 minutes',
      now() + interval '5 minutes',
      now() + interval '15 minutes',
      v_actor
    );
  end if;

  select * into v_case
  from public.social_cases
  where id = p_case;

  return to_jsonb(v_case);
end
$update_case_state$;

create or replace function public.accept_matching_social_organization_invitations()
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $accept_matching_invitations$
declare
  v_user uuid:=auth.uid();
  v_email text;
  v_inv public.organization_invitations%rowtype;
  v_social_role text;
  v_accepted jsonb:='[]'::jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select lower(email) into v_email from auth.users where id=v_user;
  if v_email is null then
    raise exception 'Signed-in account has no verified email' using errcode='42501';
  end if;

  update public.organization_invitations
  set status='expired'
  where status='invited' and expires_at<=now() and lower(email)=v_email;

  for v_inv in
    select *
    from public.organization_invitations
    where status='invited' and expires_at>now() and lower(email)=v_email
    order by invited_at
    for update
  loop
    if public.social_org_seats_used(v_inv.org_id)>=public.social_org_seat_limit(v_inv.org_id)
       and not exists(
         select 1 from public.org_memberships
         where org_id=v_inv.org_id and user_id=v_user
           and status='active' and deleted_at is null
       ) then
      continue;
    end if;

    insert into public.org_memberships(org_id,user_id,role_in_org,status,invited_by,deleted_at)
    values(v_inv.org_id,v_user,v_inv.role::public.org_role,'active',v_inv.invited_by,null)
    on conflict (org_id,user_id) do update set
      role_in_org=excluded.role_in_org,status='active',invited_by=excluded.invited_by,
      deleted_at=null,updated_at=now();

    v_social_role:=public.social_org_role_to_care_role(v_inv.role);
    update public.social_role_assignments
    set active=false,ends_at=now()
    where org_id=v_inv.org_id and user_id=v_user
      and scope_type='organization' and active;
    insert into public.social_role_assignments(
      org_id,user_id,role,scope_type,active,assigned_by
    ) values(v_inv.org_id,v_user,v_social_role,'organization',true,v_inv.invited_by);

    update public.organization_invitations
    set status='accepted',accepted_by=v_user,accepted_at=now()
    where id=v_inv.id;

    insert into public.social_activity_events(
      org_id,actor_id,event_type,entity_type,entity_id,metadata
    ) values(
      v_inv.org_id,v_user,'member_joined','organization_membership',v_inv.id,
      jsonb_build_object('role',v_inv.role,'activation','signed_in_email_match')
    );

    v_accepted:=v_accepted||jsonb_build_array(jsonb_build_object(
      'organization_id',v_inv.org_id,
      'organization_name',(select name from public.organizations where id=v_inv.org_id),
      'role',v_inv.role,'status','active'
    ));
  end loop;

  return jsonb_build_object(
    'accepted',v_accepted,
    'accepted_count',jsonb_array_length(v_accepted)
  );
end
$accept_matching_invitations$;

create or replace function public.social_org_unlimited_seats(p_org uuid)
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select exists (
    select 1
    from public.organizations o
    join public.user_roles r on r.user_id = o.created_by
    where o.id = p_org
      and r.role in ('super_admin','platform_admin','admin')
  )
  or exists (
    select 1
    from public.org_memberships m
    join public.user_roles r on r.user_id = m.user_id
    where m.org_id = p_org
      and m.status = 'active'
      and m.role_in_org::text in ('owner','admin','firm_administrator')
      and r.role in ('super_admin','platform_admin','admin')
  )
$$;

create or replace function public.social_org_employee_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select case when public.social_org_unlimited_seats(p_org) then 100000 else
    greatest(0,coalesce(
      (select e.employee_seats from public.organization_entitlements e
        where e.org_id=p_org and e.status in ('active','trialing','past_due')),
      (select bp.employee_seats
        from public.org_subscriptions s join public.billing_plans bp on bp.id=s.plan_id
        where s.org_id=p_org and s.primary_subscription
        order by s.updated_at desc limit 1),
      (select greatest(0,coalesce(bp.team_member_limit,bp.included_seats,1)-1)
        from public.organizations o join public.billing_plans bp
          on bp.code=o.plan or bp.key=o.plan
        where o.id=p_org and bp.active order by bp.updated_at desc limit 1),
      0
    ))
  end
$$;

create or replace function public.social_org_seat_limit(p_org uuid)
returns integer language sql stable security definer
set search_path=public,pg_temp as $$
  select case when public.social_org_unlimited_seats(p_org) then 100001 else
    greatest(1,coalesce(
      (select e.total_user_limit from public.organization_entitlements e
        where e.org_id=p_org and e.status in ('active','trialing','past_due')),
      1+public.social_org_employee_seat_limit(p_org)
    ))
  end
$$;

create or replace function public.enforce_social_invitation_subscription()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $invitation$
begin
  if new.status in ('invited','accepted')
     and not public.social_org_unlimited_seats(new.org_id)
     and not public.social_org_subscription_active(new.org_id) then
    raise exception 'An active organization subscription is required to use employee seats';
  end if;
  return new;
end
$invitation$;

create or replace function public.get_social_case_core(p_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $get_social_case_core$
declare
  v_actor uuid := auth.uid();
  v_case public.social_cases%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
  into v_case
  from public.social_cases
  where id = p_case
    and deleted_at is null;

  if not found then
    raise exception 'Comprehensive Care case not found' using errcode = 'P0002';
  end if;

  if not public.social_can_access_case(
    v_case.id,
    'general_case_record',
    false,
    v_actor
  ) then
    raise exception 'You are not authorized to open this Comprehensive Care case'
      using errcode = '42501';
  end if;

  return to_jsonb(v_case);
end
$get_social_case_core$;

create or replace function public.delete_social_case_by_assigning_manager(
  p_case uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $delete_case$
declare
  v_actor uuid := auth.uid();
  v_case public.social_cases%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'A deletion reason of at least 5 characters is required';
  end if;

  select *
  into v_case
  from public.social_cases
  where id=p_case
  for update;

  if not found then
    raise exception 'Comprehensive Care case not found' using errcode='P0002';
  end if;

  if v_case.deleted_at is not null then
    raise exception 'This Comprehensive Care case has already been deleted';
  end if;

  -- The employee who receives the case is deliberately not authorized here.
  -- Only the manager who opened/assigned it may remove it.
  if v_case.created_by is distinct from v_actor
     and v_case.supervising_manager is distinct from v_actor then
    raise exception 'Only the manager who created and assigned this case may delete it'
      using errcode='42501';
  end if;

  if v_case.status='closed' then
    raise exception 'A closed case must be reopened before it can be deleted';
  end if;

  insert into public.social_activity_events(
    org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_case.org_id,v_case.id,v_actor,'case_deleted','social_cases',v_case.id,
    jsonb_build_object(
      'case_number',v_case.case_number,
      'reason',btrim(p_reason),
      'assigned_case_manager',v_case.assigned_case_manager,
      'supervising_manager',v_case.supervising_manager
    )
  );

  update public.social_case_assignments
  set active=false,
      ended_at=coalesce(ended_at,now())
  where social_case_id=v_case.id
    and active;

  update public.social_cases
  set deleted_at=now(),
      deleted_by=v_actor,
      deletion_reason=btrim(p_reason),
      updated_at=now()
  where id=v_case.id;

  return jsonb_build_object(
    'id',v_case.id,
    'case_number',v_case.case_number,
    'deleted',true
  );
end
$delete_case$;

create or replace function public.validate_social_resource_communication()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  c public.social_cases%rowtype;
  i public.social_institutions%rowtype;
  d uuid;
  allowed text[];
begin
  select * into c from public.social_cases where id=new.social_case_id;
  if not found or c.org_id<>new.org_id or not public.social_can_access_case(c.id,'general_case_record',true,auth.uid()) then
    raise exception 'Case access denied';
  end if;
  select * into i from public.social_institutions where id=new.institution_id and active;
  if not found then raise exception 'Resource not found'; end if;
  if new.communication_type='email' and (i.email is null or lower(i.email)<>lower(new.recipient)) then
    raise exception 'Recipient must be the resource verified email address';
  end if;

  if cardinality(new.document_ids)>0 or coalesce(new.message,'')<>'' then
    if new.consent_id is null then raise exception 'Consent required. Open Documents and Consent.'; end if;
    select cv.permitted_information into allowed
    from public.social_consents co join public.social_consent_versions cv
      on cv.consent_id=co.id and cv.version=co.current_version
    where co.id=new.consent_id and co.status='active'
      and (co.expires_at is null or co.expires_at>now())
      and (co.person_id=c.person_id or co.family_id=c.family_id)
      and ('referral'=any(cv.permitted_purpose) or 'resource_contact'=any(cv.permitted_purpose))
      and (i.id::text=any(cv.permitted_recipients) or coalesce(i.official_name,i.name)=any(cv.permitted_recipients));
    if allowed is null then raise exception 'Consent does not cover this resource contact. Open Documents and Consent.'; end if;
  end if;

  foreach d in array new.document_ids loop
    if not exists(select 1 from public.social_documents x where x.id=d and x.social_case_id=c.id
      and x.deleted_at is null and x.external_shareable and ('document'=any(allowed) or x.document_type=any(allowed))) then
      raise exception 'A selected document is unrelated, restricted, or not covered by consent';
    end if;
  end loop;
  return new;
end $$;

create or replace function public.log_social_resource_communication()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status is distinct from old.status and new.status in ('sent','delivered','failed','attempted','completed') then
    insert into public.social_activity_events(org_id,social_case_id,actor_id,event_type,entity_type,entity_id,metadata)
    values(new.org_id,new.social_case_id,new.sender_id,'resource_communication_'||new.status,'resource_communication',new.id,
      jsonb_build_object('institution_id',new.institution_id,'referral_id',new.referral_id,'sender',new.sender_id,
        'recipient',new.recipient,'subject',new.subject,'communication_type',new.communication_type,
        'document_ids',new.document_ids,'status',new.status,'sent_at',new.sent_at));
  end if;
  return new;
end $$;

create or replace function public.search_resource_network(
  p_query text default null,p_state text default null,p_municipality text default null,
  p_latitude double precision default null,p_longitude double precision default null,p_radius_km double precision default null,
  p_service text default null,p_urgency text default null,p_population text default null,p_language text default null,
  p_cost_type text default null,p_availability text default null,p_limit integer default 50
) returns table(
  id uuid,official_name text,institution_type text,services text[],description text,state_code text,municipality text,
  address text,latitude double precision,longitude double precision,phone text,whatsapp text,email text,website text,
  hours jsonb,languages text[],populations text[],eligibility text,required_documents text[],cost_type text,
  appointment_required boolean,walk_in_available boolean,emergency_available boolean,remote_available boolean,
  referral_methods text[],coverage_levels text[],capacity_status text,verification_status text,verified_at timestamptz,
  next_verification_at timestamptz,status text,distance_km double precision,match_score integer,match_explanation text[],
  contact_verification text,source_url text,source_type text,last_checked_at timestamptz
) language sql stable security invoker set search_path=public as $$
  with ranked as (
    select i.*,
      case when p_latitude is not null and p_longitude is not null and i.latitude is not null and i.longitude is not null then
        6371 * 2 * asin(sqrt(power(sin(radians(i.latitude-p_latitude)/2),2)+cos(radians(p_latitude))*cos(radians(i.latitude))*power(sin(radians(i.longitude-p_longitude)/2),2)))
      end as km,
      (case when p_service is not null and p_service=any(i.services) then 35 else 0 end+
       case when p_state is not null and (upper(i.state_code)=upper(p_state) or upper(p_state)=any(i.coverage_states)) then 20 else 0 end+
       case when p_municipality is not null and (lower(i.municipality)=lower(p_municipality) or lower(p_municipality)=any(i.coverage_municipalities)) then 15 else 0 end+
       case when p_language is not null and lower(p_language)=any(select lower(x) from unnest(i.languages)x) then 10 else 0 end+
       case when p_population is not null and lower(p_population)=any(select lower(x) from unnest(i.populations)x) then 10 else 0 end+
       case when i.status='verified' then 10 else 0 end+
       case when p_urgency='emergency' and i.emergency_available then 20 else 0 end) as score
    from public.social_institutions i
    where i.active and i.status not in ('closed','archived')
      and (p_query is null or to_tsvector('spanish',coalesce(i.official_name,i.name,'')||' '||coalesce(i.description,'')||' '||array_to_string(i.services,' ')) @@ plainto_tsquery('spanish',p_query))
      and (p_state is null or upper(i.state_code)=upper(p_state) or upper(p_state)=any(i.coverage_states) or 'national'=any(i.coverage_levels) or i.remote_available)
      and (p_municipality is null or lower(i.municipality)=lower(p_municipality) or lower(p_municipality)=any(i.coverage_municipalities) or 'statewide'=any(i.coverage_levels) or 'national'=any(i.coverage_levels) or i.remote_available)
      and (p_service is null or p_service=any(i.services))
      and (p_language is null or lower(p_language)=any(select lower(x) from unnest(i.languages)x))
      and (p_population is null or lower(p_population)=any(select lower(x) from unnest(i.populations)x))
      and (p_cost_type is null or i.cost_type=p_cost_type)
      and (p_availability is null or i.capacity_status=p_availability)
      and (p_urgency is null or p_urgency<>'emergency' or i.emergency_available)
  )
  select r.id,coalesce(r.official_name,r.name),r.institution_type,r.services,r.description,r.state_code,r.municipality,
    case when r.location_confidential then null else r.address end,
    case when r.location_confidential then null else r.latitude end,
    case when r.location_confidential then null else r.longitude end,
    r.phone,r.whatsapp,r.email,r.website,r.hours,r.languages,r.populations,r.eligibility,r.required_documents,r.cost_type,
    r.appointment_required,r.walk_in_available,r.emergency_available,r.remote_available,r.referral_methods,r.coverage_levels,
    r.capacity_status,r.verification_status,r.verified_at,r.next_verification_at,r.status,r.km,r.score,
    array_remove(array[
      case when p_service is not null and p_service=any(r.services) then 'service_match' end,
      case when p_state is not null and (upper(r.state_code)=upper(p_state) or upper(p_state)=any(r.coverage_states)) then 'geographic_match' end,
      case when p_language is not null and lower(p_language)=any(select lower(x) from unnest(r.languages)x) then 'language_match' end,
      case when p_population is not null and lower(p_population)=any(select lower(x) from unnest(r.populations)x) then 'population_match' end,
      case when p_urgency='emergency' and r.emergency_available then 'emergency_available' end,
      case when r.status='verified' then 'verified_resource' end
    ],null),
    r.contact_verification,r.source_url,r.source_type,r.last_checked_at
  from ranked r
  where (p_radius_km is null or r.km is null or r.km<=p_radius_km)
  order by r.score desc,r.km nulls last,coalesce(r.official_name,r.name)
  limit least(greatest(p_limit,1),100)
$$;

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

create or replace function public.social_sales_demo_any_owner_allows(
  p_id uuid,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

create or replace function public.social_sales_demo_owner_allows(
  p_table text,
  p_id uuid,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

create or replace function public.social_can_access_case(
  p_case uuid,
  p_record_type text default 'general_case_record',
  p_write boolean default false,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $social_case_access$
  with c as (
    select
      id,
      org_id,
      created_by,
      supervising_manager,
      assigned_case_manager
    from public.social_cases
    where id = p_case
      and deleted_at is null
  )
  select exists (
    select 1
    from c
    where
      (not p_write and public.social_support_access_active(c.id, p_record_type, p_user))
      or (
        public.social_is_org_member(c.org_id, p_user)
        and (
          public.social_can_manage_org(c.org_id, p_user)
          or c.created_by = p_user
          or c.supervising_manager = p_user
          or c.assigned_case_manager = p_user
          or exists (
            select 1
            from public.social_case_assignments a
            where a.social_case_id = c.id
              and a.user_id = p_user
              and a.active
              and (a.ended_at is null or a.ended_at > now())
          )
          or (not p_write and public.social_has_capability(c.org_id, 'case.view_all', p_user))
        )
        and case p_record_type
          when 'general_case_record' then
            not p_write
            or public.social_can_manage_org(c.org_id, p_user)
            or public.social_has_capability(c.org_id, 'case.update', p_user)
            or public.social_has_capability(c.org_id, 'case.update_assigned', p_user)
          when 'social_work_record' then
            public.social_has_capability(c.org_id, 'intervention.social_work', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'legal_privileged_record' then
            public.social_has_capability(c.org_id, 'restricted.legal', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'psychosocial_restricted_record' then
            public.social_has_capability(c.org_id, 'restricted.psychosocial', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'medical_restricted_record' then
            public.social_has_capability(c.org_id, 'restricted.medical', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'child_protection_restricted_record' then
            public.social_has_capability(c.org_id, 'restricted.child_protection', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          else false
        end
      )
  );
$social_case_access$;

-- 7. INDEXES

CREATE INDEX cases_user_idx ON public.cases(user_id, created_at DESC);

CREATE INDEX documents_case_idx ON public.documents(case_id);

CREATE INDEX documents_hash_idx ON public.documents(user_id, content_hash);

CREATE INDEX case_findings_case_idx ON public.case_findings(case_id, created_at DESC);

CREATE INDEX case_findings_category_idx ON public.case_findings(case_id, category);

CREATE INDEX case_findings_severity_idx ON public.case_findings(case_id, severity);

CREATE INDEX case_opps_case_idx ON public.case_opportunities(case_id);

CREATE INDEX case_chat_idx ON public.case_chat_messages(case_id, created_at);

CREATE INDEX case_work_idx ON public.case_work_product(case_id, document_type);

CREATE INDEX IF NOT EXISTS cases_user_active_idx
  ON public.cases (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS case_perspectives_case_idx ON public.case_perspectives (case_id);

CREATE INDEX IF NOT EXISTS evidence_class_case_idx ON public.evidence_classifications (case_id);

CREATE INDEX IF NOT EXISTS case_strategy_case_idx ON public.case_strategy (case_id);

CREATE INDEX IF NOT EXISTS user_groq_keys_user_idx ON public.user_groq_keys(user_id);

CREATE INDEX IF NOT EXISTS case_findings_case_priority_idx
  ON public.case_findings (case_id, priority);

CREATE INDEX IF NOT EXISTS pipeline_events_case_idx ON public.pipeline_events(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_pages_case_idx ON public.document_pages(case_id);

CREATE INDEX IF NOT EXISTS document_pages_doc_idx ON public.document_pages(document_id, page);

CREATE INDEX idx_pipeline_engine_runs_case ON public.pipeline_engine_runs(case_id, created_at DESC);

CREATE INDEX idx_pipeline_engine_runs_engine ON public.pipeline_engine_runs(case_id, engine);

CREATE INDEX IF NOT EXISTS user_groq_keys_user_priority_idx ON public.user_groq_keys (user_id, priority);

CREATE INDEX IF NOT EXISTS case_domain_activations_case_idx
  ON public.case_domain_activations(case_id);

CREATE INDEX IF NOT EXISTS idx_documents_case_status ON documents(case_id, status);

CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);

CREATE INDEX IF NOT EXISTS audit_logs_case_idx ON public.audit_logs (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON public.audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS report_versions_case_idx
  ON public.report_versions (case_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_report_versions_case_version
  ON public.report_versions(case_id, version DESC);

CREATE INDEX IF NOT EXISTS agent_logs_case_idx ON public.agent_logs(case_id, run_id, agent_index);

CREATE INDEX IF NOT EXISTS agent_logs_user_idx ON public.agent_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_logs_output_idx
  ON public.agent_logs(case_id, run_id, agent_index, findings_produced);

CREATE INDEX case_timeline_events_case_active_idx
  ON public.case_timeline_events (case_id)
  WHERE superseded_by IS NULL;

CREATE INDEX image_intelligence_case_idx ON public.image_intelligence (case_id);

CREATE INDEX image_intelligence_doc_idx  ON public.image_intelligence (document_id);

CREATE INDEX IF NOT EXISTS cases_firm_id_idx ON public.cases (firm_id) WHERE firm_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cases_queue_idx ON public.cases (queued_at)
  WHERE queued_at IS NOT NULL AND status <> 'complete';

CREATE INDEX IF NOT EXISTS ai_usage_user_key_created_idx
  ON public.ai_usage (user_id, groq_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_engine_runs_case_created_idx
  ON public.pipeline_engine_runs (case_id, created_at DESC);

CREATE INDEX idx_canonical_analysis_case ON public.canonical_analysis(case_id);

CREATE INDEX idx_canonical_analysis_status ON public.canonical_analysis(status);

CREATE INDEX IF NOT EXISTS idx_user_ai_keys_user ON public.user_ai_keys(user_id);

CREATE INDEX IF NOT EXISTS idx_reports_case ON public.reports(case_id);

CREATE INDEX IF NOT EXISTS idx_report_versions_case ON public.report_versions(case_id);

CREATE INDEX case_motion_drafts_case_idx ON public.case_motion_drafts(case_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON public.subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_subscription_id_idx
  ON public.subscriptions (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS webhook_events_created_at_idx ON public.webhook_events (created_at DESC);

CREATE INDEX IF NOT EXISTS beta_invites_redeemed_at_idx ON public.beta_invites (redeemed_at);

CREATE INDEX IF NOT EXISTS idx_user_provider_order_user ON public.user_provider_order(user_id);

CREATE INDEX IF NOT EXISTS idx_user_intelligence_features_user ON public.user_intelligence_features(user_id);

CREATE INDEX demo_case_documents_case_idx ON public.demo_case_documents (demo_case_id);

CREATE UNIQUE INDEX IF NOT EXISTS firm_invites_pending_email_idx
  ON public.firm_invites (firm_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS firm_invites_email_idx ON public.firm_invites (lower(email));

CREATE INDEX matters_org_idx ON public.matters (org_id, status);

CREATE INDEX matters_type_idx ON public.matters (org_id, matter_type);

CREATE INDEX IF NOT EXISTS idx_matters_org_type ON public.matters(org_id, matter_type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matters_lead_lawyer ON public.matters(lead_lawyer_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matters_updated ON public.matters(org_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_matters_tags ON public.matters USING gin(tags);

CREATE INDEX IF NOT EXISTS idx_matter_docs_matter ON public.matter_documents(matter_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matter_docs_status ON public.matter_documents(org_id, processing_status);

CREATE INDEX IF NOT EXISTS idx_matter_events_matter_time ON public.matter_events(matter_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_matter_tasks_matter_status ON public.matter_tasks(matter_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matter_tasks_assignee ON public.matter_tasks(assignee_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matter_notes_matter ON public.matter_notes(matter_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matter_parties_matter ON public.matter_parties(matter_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.org_memberships(user_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.org_memberships(org_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_org_time ON public.audit_log(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON public.audit_log(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_docver_document ON public.document_versions(document_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_docjobs_status_sched ON public.document_processing_jobs(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_intel_runs_matter ON public.intelligence_runs(matter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intel_runs_status ON public.intelligence_runs(status) WHERE status IN ('pending','running');

CREATE INDEX IF NOT EXISTS idx_mk_matter_engine ON public.matter_knowledge(matter_id, engine);

CREATE INDEX IF NOT EXISTS idx_legal_auth_kind ON public.legal_authorities(kind, jurisdiction);

CREATE INDEX IF NOT EXISTS idx_legal_auth_body_fts ON public.legal_authorities USING gin(to_tsvector('spanish', coalesce(body,'') || ' ' || coalesce(title,'')));

CREATE INDEX IF NOT EXISTS idx_kr_matter ON public.knowledge_relationships(matter_id);

CREATE INDEX IF NOT EXISTS idx_kr_subject ON public.knowledge_relationships(subject_id);

CREATE INDEX IF NOT EXISTS idx_kr_object ON public.knowledge_relationships(object_id);

CREATE INDEX IF NOT EXISTS idx_kr_relation ON public.knowledge_relationships(matter_id, relation);

CREATE INDEX IF NOT EXISTS legal_authority_versions_authority_idx
  ON public.legal_authority_versions (authority_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS legal_ingest_runs_connector_idx
  ON public.legal_ingest_runs (connector_code, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS billing_plans_key_uidx ON public.billing_plans(key) WHERE key IS NOT NULL;

CREATE INDEX IF NOT EXISTS legal_authority_versions_authority_idx
  ON public.legal_authority_versions (authority_id, archived_at DESC);

CREATE INDEX IF NOT EXISTS legal_ingest_runs_connector_idx
  ON public.legal_ingest_runs (connector_code, started_at DESC);

CREATE INDEX IF NOT EXISTS legal_articles_authority_idx ON public.legal_articles(authority_id);

CREATE INDEX IF NOT EXISTS legal_amendments_article_idx ON public.legal_amendments(article_id, effective_at DESC);

CREATE INDEX IF NOT EXISTS legal_precedents_case_number_idx ON public.legal_precedents(case_number);

CREATE INDEX IF NOT EXISTS legal_topic_links_entity_idx ON public.legal_topic_links(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS legal_keyword_links_entity_idx ON public.legal_keyword_links(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS authority_relationships_from_idx ON public.authority_relationships(from_type, from_id);

CREATE INDEX IF NOT EXISTS authority_relationships_to_idx ON public.authority_relationships(to_type, to_id);

CREATE INDEX IF NOT EXISTS legal_authorities_title_trgm_idx ON public.legal_authorities USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS legal_articles_body_trgm_idx ON public.legal_articles USING gin (body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS legal_jurisprudencia_title_trgm_idx ON public.legal_jurisprudencia USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS legal_theses_title_trgm_idx ON public.legal_theses USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS legal_precedents_case_number_trgm_idx ON public.legal_precedents USING gin (case_number gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_provider_type_key ON public.ai_providers (provider_type);

CREATE INDEX idx_pipeline_trace_case_id ON public.pipeline_trace (case_id, id DESC);

CREATE INDEX idx_pipeline_trace_created_at ON public.pipeline_trace (created_at DESC);

CREATE INDEX idx_pipeline_trace_corr ON public.pipeline_trace (correlation_id);

CREATE INDEX verification_items_case_idx ON public.verification_items(case_id);

CREATE INDEX closing_milestones_case_idx ON public.closing_milestones(case_id);

CREATE INDEX IF NOT EXISTS case_parties_case_id_idx ON public.case_parties(case_id);

CREATE INDEX IF NOT EXISTS case_tasks_case_id_idx ON public.case_tasks(case_id);

CREATE INDEX IF NOT EXISTS case_tasks_due_idx ON public.case_tasks(user_id, due_date);

CREATE UNIQUE INDEX IF NOT EXISTS case_tasks_template_unique
  ON public.case_tasks(case_id, template_key) WHERE template_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS case_events_case_id_idx ON public.case_events(case_id);

CREATE INDEX IF NOT EXISTS case_events_sched_idx ON public.case_events(user_id, scheduled_at);

CREATE INDEX IF NOT EXISTS case_communications_case_id_idx ON public.case_communications(case_id);

CREATE UNIQUE INDEX case_findings_projection_identity_uidx
  ON public.case_findings (case_id, projected_from_table, projected_from_row_id)
  WHERE projected_from_table IS NOT NULL;

CREATE INDEX case_findings_supporting_engines_gin
  ON public.case_findings USING gin (supporting_engines);

CREATE INDEX IF NOT EXISTS usage_counters_user_idx ON public.usage_counters (user_id);

CREATE INDEX IF NOT EXISTS usage_events_user_time_idx ON public.usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS finding_version_snapshots_case_version_idx
  ON public.finding_version_snapshots (case_id, report_version);

CREATE INDEX IF NOT EXISTS finding_version_snapshots_canonical_idx
  ON public.finding_version_snapshots (case_id, canonical_finding_id);

CREATE INDEX IF NOT EXISTS cross_agent_audit_case_idx ON public.cross_agent_audit (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_feedback_created_idx ON public.user_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS user_feedback_status_idx ON public.user_feedback (status);

CREATE INDEX IF NOT EXISTS reports_execution_id_idx ON public.reports (execution_id);

CREATE INDEX IF NOT EXISTS support_threads_user_idx ON public.support_threads (user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS support_threads_admin_unread_idx ON public.support_threads (unread_by_admin, last_message_at DESC);

CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON public.support_messages (thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_case_events_reminder_due
  ON public.case_events (scheduled_at)
  WHERE reminder_enabled AND reminder_fired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_case_tasks_reminder_due
  ON public.case_tasks (due_date)
  WHERE reminder_enabled AND reminder_fired_at IS NULL;

CREATE INDEX IF NOT EXISTS case_outcome_assessments_case_idx
  ON public.case_outcome_assessments(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS case_classification_evidence_case_idx
  ON public.case_classification_evidence(case_id);

CREATE INDEX IF NOT EXISTS case_findings_active_idx
  ON public.case_findings(case_id)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS case_decision_reconstructions_case_idx
  ON public.case_decision_reconstructions(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS case_finding_patches_case_idx
  ON public.case_finding_patches(case_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS case_finding_patches_finding_idx
  ON public.case_finding_patches(finding_id) WHERE finding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS documents_evidence_scope_idx
  ON public.documents(case_id, evidence_scope);

CREATE INDEX IF NOT EXISTS case_finding_patches_report_version_idx
  ON public.case_finding_patches(case_id, report_version);

CREATE INDEX IF NOT EXISTS intelligence_lessons_case_idx
  ON public.intelligence_lessons(case_id);

CREATE INDEX IF NOT EXISTS intelligence_lessons_canonical_finding_idx
  ON public.intelligence_lessons(canonical_finding_id) WHERE canonical_finding_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS case_findings_lifecycle_status_idx
  ON public.case_findings(case_id, lifecycle_status) WHERE lifecycle_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS intelligence_patterns_lookup_idx
  ON public.intelligence_patterns(user_id, matter_type, jurisdiction_country, error_type);

CREATE INDEX IF NOT EXISTS intelligence_patterns_tier_idx
  ON public.intelligence_patterns(user_id, tier) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS intelligence_improvement_proposals_bucket_idx
  ON public.intelligence_improvement_proposals(user_id, matter_type, jurisdiction_country, error_type);

CREATE INDEX IF NOT EXISTS intelligence_versions_user_idx
  ON public.intelligence_versions(user_id, version DESC);

CREATE INDEX IF NOT EXISTS case_findings_evidence_relationship_idx
  ON public.case_findings(case_id, evidence_relationship) WHERE evidence_relationship IS NOT NULL;

create index if not exists case_findings_reconciliation_state_idx
  on public.case_findings(case_id, reconciliation_state) where reconciliation_state is not null;

create index if not exists cases_migratorio_internal_number_idx
  on public.cases ((lower(btrim(matter_metadata->>'internal_matter_number'))))
  where case_type = 'migratorio' and deleted_at is null;

create index if not exists cases_migratorio_authority_status_idx
  on public.cases (
    (lower(btrim(matter_metadata->>'responsible_authority'))),
    (lower(btrim(matter_metadata->>'matter_status')))
  )
  where case_type = 'migratorio' and deleted_at is null;

create unique index if not exists social_case_assignments_one_active
  on public.social_case_assignments(social_case_id,user_id,assignment_role)
  where active;

create unique index if not exists social_documents_exact_duplicate
  on public.social_documents(social_case_id, checksum)
  where deleted_at is null and checksum is not null;

create index if not exists social_people_search_idx on public.social_people using gin (
  public.social_people_search_document(legal_name,preferred_name,aliases)
);

create index if not exists social_cases_queue_idx on public.social_cases(org_id,status,risk_level,last_activity_at);

create index if not exists social_assignments_user_idx on public.social_case_assignments(user_id,social_case_id) where active;

create index if not exists social_tasks_due_idx on public.social_tasks(org_id,status,due_at);

create index if not exists social_alerts_open_idx on public.social_alerts(org_id,severity,due_at) where resolved_at is null;

create index if not exists social_activity_org_time_idx on public.social_activity_events(org_id,occurred_at desc);

create unique index if not exists social_indicator_definitions_unique
on public.social_indicator_definitions(coalesce(org_id,'00000000-0000-0000-0000-000000000000'::uuid),code);

create index social_people_search_idx
on public.social_people using gin (
  public.social_people_search_document(legal_name,preferred_name,aliases)
);

create index if not exists social_institutions_search_idx on public.social_institutions using gin
  (to_tsvector('spanish',coalesce(official_name,'')||' '||coalesce(description,'')||' '||array_to_string(services,' ')));

create index if not exists social_institutions_location_idx on public.social_institutions(state_code,municipality,status);

create index if not exists resource_verifications_institution_idx on public.resource_verifications(institution_id,verified_at desc);

create index if not exists resource_knowledge_filters_idx on public.resource_knowledge_records(approval_status,knowledge_type,review_due_at);

create index if not exists social_document_access_case_idx
  on public.social_document_access_events(social_case_id,occurred_at desc);

create index if not exists social_document_access_document_idx
  on public.social_document_access_events(document_id,occurred_at desc);

create index if not exists social_documents_dashboard_idx
  on public.social_documents(social_case_id,document_status,classification_status,created_at desc);

create index if not exists social_care_assistant_runs_case_idx
  on public.social_care_assistant_runs(social_case_id,created_at desc);

create index if not exists social_care_action_proposals_case_idx
  on public.social_care_action_proposals(social_case_id,status,created_at desc);

create unique index if not exists organization_invitations_one_pending
  on public.organization_invitations(org_id,lower(email)) where status='invited';

create index if not exists organization_invitations_org_status_idx
  on public.organization_invitations(org_id,status,expires_at);

create unique index if not exists org_subscriptions_provider_subscription_uidx
  on public.org_subscriptions(provider,provider_subscription_id)
  where provider_subscription_id is not null;

create unique index if not exists org_subscriptions_one_primary_uidx
  on public.org_subscriptions(org_id)
  where primary_subscription;

create index if not exists social_case_status_history_case_time_idx
  on public.social_case_status_history(social_case_id,changed_at desc);

create index if not exists social_intakes_org_status_time_idx
  on public.social_intakes(org_id, status, created_at desc);

create index if not exists social_intakes_person_idx
  on public.social_intakes(person_id, created_at desc);

create index if not exists social_intakes_assignee_idx
  on public.social_intakes(assigned_to, status)
  where status in ('draft','under_review');

create unique index if not exists social_case_assignments_one_active
  on public.social_case_assignments(social_case_id, user_id, assignment_role)
  where active;

create unique index if not exists social_case_assignments_one_active_role
  on public.social_case_assignments(social_case_id, assignment_role)
  where active and assignment_role in ('case_manager', 'supervisor');

create index if not exists social_intakes_org_status_time_idx
  on public.social_intakes(org_id, status, created_at desc);

create index if not exists social_intakes_person_idx
  on public.social_intakes(person_id, created_at desc);

create index if not exists social_intakes_assignee_idx
  on public.social_intakes(assigned_to, status)
  where status in ('draft','under_review');

create unique index if not exists social_case_assignments_one_active
  on public.social_case_assignments(social_case_id, user_id, assignment_role)
  where active;

create unique index if not exists social_case_assignments_one_active_role
  on public.social_case_assignments(social_case_id, assignment_role)
  where active and assignment_role in ('case_manager', 'supervisor');

CREATE INDEX IF NOT EXISTS security_incidents_status_idx ON public.security_incidents (status, discovered_at DESC);

CREATE INDEX IF NOT EXISTS user_consents_user_idx ON public.user_consents (user_id, document_type, granted_at DESC);

CREATE INDEX IF NOT EXISTS arco_requests_status_idx ON public.arco_requests (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS arco_request_events_request_idx ON public.arco_request_events (request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS case_penal_dispositions_case_idx
  ON public.case_penal_dispositions(case_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_engine_runs_case_execution
  ON public.pipeline_engine_runs (case_id, execution_id);

CREATE INDEX IF NOT EXISTS idx_cases_queued_lease
  ON public.cases (status, queued_at, worker_lease_until)
  WHERE status = 'queued';

create index if not exists social_resource_communications_case_idx
  on public.social_resource_communications(social_case_id,created_at desc);

create unique index if not exists social_institutions_source_slug_idx
  on public.social_institutions(source_slug) where source_slug is not null;

create index if not exists resource_contact_refresh_runs_idx
  on public.resource_contact_refresh_runs(slug, started_at desc);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_org ON public.social_community_campaigns(org_id);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_status ON public.social_community_campaigns(lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_slug ON public.social_community_campaigns(public_slug);

CREATE INDEX IF NOT EXISTS idx_social_offers_campaign ON public.social_community_support_offers(campaign_id);

CREATE INDEX IF NOT EXISTS idx_social_reports_case ON public.social_audit_reports(social_case_id);

CREATE INDEX IF NOT EXISTS idx_social_reports_code ON public.social_audit_reports(report_id);

CREATE INDEX IF NOT EXISTS idx_social_report_emails_org ON public.social_audit_report_emails(org_id);

CREATE INDEX IF NOT EXISTS idx_subscriber_donation_identities_user ON public.social_subscriber_donation_identities(subscriber_user_id);

CREATE INDEX IF NOT EXISTS idx_donation_identity_audit_org ON public.social_donation_identity_audit_events(org_id);

CREATE INDEX IF NOT EXISTS idx_case_theories_case_exec
  ON public.case_theories(case_id, execution_id);

CREATE INDEX IF NOT EXISTS idx_case_theories_case_type
  ON public.case_theories(case_id, theory_type);

CREATE INDEX IF NOT EXISTS idx_case_opps_case_exec
  ON public.case_opportunities(case_id, execution_id);

CREATE INDEX IF NOT EXISTS idx_case_opps_side
  ON public.case_opportunities(case_id, side);

CREATE INDEX IF NOT EXISTS idx_case_findings_canonical_fingerprint
  ON public.case_findings(case_id, canonical_fingerprint);

CREATE INDEX IF NOT EXISTS idx_cases_underlying_materia
  ON public.cases(underlying_materia);

-- 8. TRIGGERS

CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER user_settings_updated BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER cases_updated BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER documents_updated BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER analyses_updated BEFORE UPDATE ON public.analyses FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER tg_case_findings_updated_at
  BEFORE UPDATE ON public.case_findings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_case_theories_updated_at BEFORE UPDATE ON public.case_theories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_case_opps_updated_at BEFORE UPDATE ON public.case_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_case_witnesses_updated_at BEFORE UPDATE ON public.case_witnesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_trial_prep_updated_at BEFORE UPDATE ON public.case_trial_prep
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_work_updated_at BEFORE UPDATE ON public.case_work_product
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER case_perspectives_updated BEFORE UPDATE ON public.case_perspectives
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER case_strategy_updated BEFORE UPDATE ON public.case_strategy
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER ai_providers_updated BEFORE UPDATE ON public.ai_providers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER ai_task_routing_updated BEFORE UPDATE ON public.ai_task_routing FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER agent_configs_updated BEFORE UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER feature_flags_updated BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_pipeline_engine_runs_updated_at
  BEFORE UPDATE ON public.pipeline_engine_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER agent_logs_set_updated_at BEFORE UPDATE ON public.agent_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER case_timeline_events_set_updated_at
  BEFORE UPDATE ON public.case_timeline_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER firms_set_updated_at BEFORE UPDATE ON public.firms
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER cases_stamp_firm BEFORE INSERT ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_case_firm();

CREATE TRIGGER protect_user_settings_firm_id
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_protect_user_settings_firm_id();

CREATE TRIGGER protect_user_settings_firm_id
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_protect_user_settings_firm_id();

CREATE TRIGGER validate_canonical_analysis
  BEFORE INSERT OR UPDATE ON public.canonical_analysis
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_canonical_analysis();

CREATE TRIGGER bump_canonical_version
  BEFORE UPDATE ON public.canonical_analysis
  FOR EACH ROW EXECUTE FUNCTION public.tg_bump_canonical_version();

CREATE TRIGGER user_ai_keys_updated_at
  BEFORE UPDATE ON public.user_ai_keys
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER mirror_reports_to_canonical
  AFTER INSERT OR UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_mirror_reports_to_canonical();

CREATE TRIGGER tg_motion_drafts_updated_at BEFORE UPDATE ON public.case_motion_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER billing_plans_set_updated_at
  BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER on_auth_user_created_beta_redemption
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_beta_invite_redemption();

CREATE TRIGGER user_provider_order_updated_at
  BEFORE UPDATE ON public.user_provider_order
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER user_intelligence_features_updated_at
  BEFORE UPDATE ON public.user_intelligence_features
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER demo_cases_set_updated_at
  BEFORE UPDATE ON public.demo_cases
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_case_strategy_center_updated_at
  BEFORE UPDATE ON public.case_strategy_center
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_memb_updated BEFORE UPDATE ON public.org_memberships FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_org_bootstrap AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_bootstrap_owner();

CREATE TRIGGER trg_matters_updated BEFORE UPDATE ON public.matters FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_parties_updated BEFORE UPDATE ON public.matter_parties FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_events_updated BEFORE UPDATE ON public.matter_events FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_docs_updated BEFORE UPDATE ON public.matter_documents FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_notes_updated BEFORE UPDATE ON public.matter_notes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.matter_tasks FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_docjobs_updated BEFORE UPDATE ON public.document_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_intel_runs_updated BEFORE UPDATE ON public.intelligence_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_mk_updated BEFORE UPDATE ON public.matter_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_auth_updated BEFORE UPDATE ON public.legal_authorities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_connectors_updated BEFORE UPDATE ON public.legal_source_connectors
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON public.org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_kr_updated
  BEFORE UPDATE ON public.knowledge_relationships
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_profiles_updated BEFORE UPDATE ON public.legal_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER protect_user_settings_firm_id_insert
  BEFORE INSERT ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_protect_user_settings_firm_id_insert();

CREATE TRIGGER billing_plan_notes_set_updated_at
  BEFORE UPDATE ON public.billing_plan_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_articles_updated BEFORE UPDATE ON public.legal_articles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_precedents_updated BEFORE UPDATE ON public.legal_precedents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_jurisprudencia_updated BEFORE UPDATE ON public.legal_jurisprudencia
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_theses_updated BEFORE UPDATE ON public.legal_theses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_regulations_updated BEFORE UPDATE ON public.legal_regulations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER tg_case_findings_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_findings
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

CREATE TRIGGER tg_case_theories_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_theories
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

CREATE TRIGGER tg_case_opportunities_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

CREATE TRIGGER tg_case_perspectives_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_perspectives
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

CREATE TRIGGER tg_case_witnesses_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_witnesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

CREATE TRIGGER trg_prevent_user_settings_firm_change
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.prevent_user_settings_firm_change();

CREATE TRIGGER property_records_updated BEFORE UPDATE ON public.property_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER verification_items_updated BEFORE UPDATE ON public.verification_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER closing_milestones_updated BEFORE UPDATE ON public.closing_milestones
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER case_parties_set_updated_at
  BEFORE UPDATE ON public.case_parties
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER case_tasks_set_updated_at
  BEFORE UPDATE ON public.case_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER case_events_set_updated_at
  BEFORE UPDATE ON public.case_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER case_communications_set_updated_at
  BEFORE UPDATE ON public.case_communications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER usage_counters_set_updated_at
  BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_user_feedback_updated BEFORE UPDATE ON public.user_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_support_threads_updated BEFORE UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

create trigger trg_nyrava_verified_analysis_mode
before insert or update of analysis_mode on public.cases
for each row
execute function public.nyrava_enforce_verified_analysis_mode();

create trigger trg_nyrava_verified_analysis_mode
before insert or update of analysis_mode on public.cases
for each row
execute function public.nyrava_enforce_verified_analysis_mode();

create trigger trg_nyrava_force_unified_analysis_mode
before insert or update of analysis_mode on public.cases
for each row execute function public.nyrava_force_unified_analysis_mode();

create trigger trg_nyrava_enforce_score_provenance
before insert or update of dimension_breakdowns, case_id on public.case_scores
for each row execute function public.nyrava_enforce_score_provenance();

create trigger trg_nyrava_enforce_released_case_state
before insert or update of status, progress, completed_at, report_at,
  lifecycle_status, next_stage, worker_lease_until, execution_id,
  execution_started_at
on public.cases
for each row execute function public.nyrava_enforce_released_case_state();

create trigger trg_nyrava_00_release_snapshot_guard
before insert or update of status
on public.cases
for each row execute function public.nyrava_guard_release_snapshot();

create trigger trg_nyrava_report_legal_integrity_guard
before insert or update on public.reports
for each row
execute function public.nyrava_report_legal_integrity_guard();

CREATE TRIGGER trg_nyrava_guard_case_finding_personal_notice
BEFORE INSERT OR UPDATE ON public.case_findings
FOR EACH ROW EXECUTE FUNCTION public.nyrava_guard_case_finding_personal_notice();

CREATE TRIGGER trg_nyrava_sanitize_analysis_personal_notice
BEFORE INSERT OR UPDATE ON public.analyses
FOR EACH ROW EXECUTE FUNCTION public.nyrava_sanitize_analysis_personal_notice();

CREATE TRIGGER trg_nyrava_sanitize_agent_finding_personal_notice
BEFORE INSERT OR UPDATE ON public.agent_findings
FOR EACH ROW EXECUTE FUNCTION public.nyrava_sanitize_agent_finding_personal_notice();

CREATE TRIGGER trg_nyrava_sanitize_agent_log_personal_notice
BEFORE INSERT OR UPDATE ON public.agent_logs
FOR EACH ROW EXECUTE FUNCTION public.nyrava_sanitize_agent_log_personal_notice();

CREATE TRIGGER trg_nyrava_enforce_released_case_terminal_state
BEFORE INSERT OR UPDATE OF status, progress, completed_at, next_stage, worker_lease_until ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.nyrava_enforce_released_case_terminal_state();

create trigger social_case_number_assign before insert on public.social_cases
for each row execute function public.assign_social_case_number();

create trigger social_case_number_immutable before update on public.social_cases
for each row execute function public.prevent_social_case_number_change();

create trigger social_case_assign_creator after insert on public.social_cases
for each row execute function public.assign_social_case_creator();

create trigger social_activity_no_update before update or delete on public.social_activity_events
for each row execute function public.prevent_social_activity_mutation();

create trigger validate_social_referral_share before insert or update
on public.social_referral_shared_packets for each row
execute function public.validate_social_referral_share();

create trigger validate_social_document_share before insert or update
on public.social_document_shares for each row
execute function public.validate_social_document_share();

create trigger validate_social_immigration_link before insert or update
on public.social_immigration_links for each row
execute function public.validate_social_immigration_link();

create trigger enforce_social_referral_completion before insert or update
on public.social_referrals for each row
execute function public.enforce_social_referral_completion();

create trigger protect_closed_social_case before update on public.social_cases
for each row execute function public.protect_closed_social_case();

create trigger social_person_number_assign before insert on public.social_people
for each row execute function public.assign_social_entity_number();

create trigger social_person_number_immutable before update on public.social_people
for each row execute function public.prevent_social_identifier_change();

create trigger social_family_number_assign before insert on public.social_families
for each row execute function public.assign_social_entity_number();

create trigger social_family_number_immutable before update on public.social_families
for each row execute function public.prevent_social_identifier_change();

create trigger social_referral_number_assign before insert on public.social_referrals
for each row execute function public.assign_social_entity_number();

create trigger social_referral_number_immutable before update on public.social_referrals
for each row execute function public.prevent_social_identifier_change();

create trigger billing_provider_keep_one_enabled before update on public.billing_provider_settings
for each row execute function public.prevent_disabling_all_billing_providers();

create trigger billing_provider_toggle_audit after update on public.billing_provider_settings
for each row execute function public.audit_billing_provider_toggle();

create trigger audit_social_document_access_events
after insert or update or delete on public.social_document_access_events
for each row execute function public.audit_social_change();

create trigger audit_social_case_document_requirements
after insert or update or delete on public.social_case_document_requirements
for each row execute function public.audit_social_change();

create trigger organization_invitations_require_subscription
before insert or update of status on public.organization_invitations
for each row execute function public.enforce_social_invitation_subscription();

create trigger social_intake_number_assign
before insert on public.social_intakes
for each row execute function public.assign_social_intake_number();

create trigger social_intake_number_immutable
before update on public.social_intakes
for each row execute function public.prevent_social_intake_number_change();

create trigger canonicalize_social_assignment_role
before insert or update of assignment_role
on public.social_case_assignments
for each row execute function public.canonicalize_social_assignment_role();

create trigger social_intake_number_assign
before insert on public.social_intakes
for each row execute function public.assign_social_intake_number();

create trigger social_intake_number_immutable
before update on public.social_intakes
for each row execute function public.prevent_social_intake_number_change();

create trigger canonicalize_social_assignment_role
before insert or update of assignment_role
on public.social_case_assignments
for each row execute function public.canonicalize_social_assignment_role();

create trigger social_cases_manager_only_insert
before insert on public.social_cases
for each row execute function public.enforce_social_case_manager_creation();

create trigger social_case_number_assign
before insert on public.social_cases
for each row execute function public.assign_social_case_number();

CREATE TRIGGER trg_security_incidents_updated_at
  BEFORE UPDATE ON public.security_incidents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_legal_document_versions_updated_at
  BEFORE UPDATE ON public.legal_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_user_consents_updated_at
  BEFORE UPDATE ON public.user_consents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_arco_requests_updated_at
  BEFORE UPDATE ON public.arco_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

create trigger validate_social_resource_communication before insert or update
on public.social_resource_communications for each row execute function public.validate_social_resource_communication();

create trigger log_social_resource_communication after update on public.social_resource_communications
for each row execute function public.log_social_resource_communication();

-- 9. RLS ENABLEMENT

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_findings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_theories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_opportunities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_witnesses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_trial_prep ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_work_product ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_perspectives ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.evidence_classifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_strategy ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_groq_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_task_routing ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_engine_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_domain_activations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_timeline_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.image_intelligence ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.worker_secrets ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.canonical_analysis ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_ai_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_motion_drafts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_provider_order ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_intelligence_features ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.demo_cases ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.demo_case_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_strategy_center ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.firm_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.matter_parties ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.matter_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.matter_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.matter_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.matter_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.org_role_permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.document_processing_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intelligence_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.matter_knowledge ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_authorities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_citations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_source_connectors ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.knowledge_relationships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_findings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_authority_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_ingest_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_scores ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_authority_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_ingest_runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_plan_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_articles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_amendments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_precedents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_jurisprudencia ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_theses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_regulations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_topics ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_keywords ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_topic_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_keyword_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.authority_relationships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.citation_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pipeline_trace ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.property_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.verification_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.closing_milestones ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_parties ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_communications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finding_version_snapshots ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cross_agent_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_outcome_assessments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_classification_evidence ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_decision_reconstructions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_finding_patches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intelligence_lessons ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intelligence_patterns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intelligence_validation_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intelligence_improvement_proposals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intelligence_versions ENABLE ROW LEVEL SECURITY;

alter table public.social_identifier_counters enable row level security;

alter table public.social_indicator_definitions enable row level security;

alter table public.social_case_transfer_items enable row level security;

alter table public.social_retention_actions enable row level security;

alter table public.social_support_access_grants enable row level security;

alter table public.billing_provider_settings enable row level security;

alter table public.billing_provider_events enable row level security;

alter table public.resource_service_categories enable row level security;

alter table public.resource_verifications enable row level security;

alter table public.resource_corrections enable row level security;

alter table public.resource_internal_experiences enable row level security;

alter table public.resource_knowledge_records enable row level security;

alter table public.resource_knowledge_versions enable row level security;

alter table public.social_document_access_events enable row level security;

alter table public.social_case_document_requirements enable row level security;

alter table public.resource_knowledge_corrections enable row level security;

alter table public.resource_knowledge_case_actions enable row level security;

alter table public.resource_knowledge_usage enable row level security;

alter table public.social_care_assistant_runs enable row level security;

alter table public.social_care_action_proposals enable row level security;

alter table public.social_sales_demo_records enable row level security;

alter table public.organization_invitations enable row level security;

alter table public.organization_entitlements enable row level security;

alter table public.organization_usage_periods enable row level security;

alter table public.organization_usage_events enable row level security;

alter table public.billing_webhook_events enable row level security;

alter table public.social_case_status_history enable row level security;

alter table public.social_intake_number_counters enable row level security;

alter table public.social_intakes enable row level security;

alter table public.social_intake_number_counters enable row level security;

alter table public.social_intakes enable row level security;

ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.arco_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.arco_request_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.case_penal_dispositions ENABLE ROW LEVEL SECURITY;

alter table public.social_resource_communications enable row level security;

alter table public.resource_official_sources enable row level security;

alter table public.resource_contact_refresh_runs enable row level security;

alter table public.social_case_templates enable row level security;

ALTER TABLE public.social_community_campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.social_community_support_offers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.social_audit_report_emails ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.social_donation_identity_audit_events ENABLE ROW LEVEL SECURITY;

-- 10. RLS POLICIES

CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "own settings" ON public.user_settings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cases select" ON public.cases FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "cases insert" ON public.cases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cases update" ON public.cases FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "cases delete" ON public.cases FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "docs all" ON public.documents FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "analyses all" ON public.analyses FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "reports all" ON public.reports FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "usage select" ON public.ai_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "usage insert" ON public.ai_usage FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "case files own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'case-files' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(),'admin')));

CREATE POLICY "case files own write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "case files own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'case-files' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(),'admin')));

CREATE POLICY "findings select" ON public.case_findings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "findings insert" ON public.case_findings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "findings update" ON public.case_findings FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "findings delete" ON public.case_findings FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "theories all" ON public.case_theories FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "opps all" ON public.case_opportunities FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "witnesses all" ON public.case_witnesses FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat all" ON public.case_chat_messages FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "trial all" ON public.case_trial_prep FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "work all" ON public.case_work_product FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Only admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "perspectives owner full" ON public.case_perspectives FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "evidence_class owner full" ON public.evidence_classifications FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "strategy owner full" ON public.case_strategy FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users manage own groq keys" ON public.user_groq_keys FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_providers admin read"  ON public.ai_providers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "ai_providers admin write" ON public.ai_providers FOR ALL    TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "ai_task_routing admin read"  ON public.ai_task_routing FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "ai_task_routing admin write" ON public.ai_task_routing FOR ALL    TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "agent_configs read all auth" ON public.agent_configs FOR SELECT TO authenticated USING (true);

CREATE POLICY "agent_configs admin write" ON public.agent_configs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "pipeline_events read by case owner" ON public.pipeline_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.cases c WHERE c.id = pipeline_events.case_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
);

CREATE POLICY "feature_flags read all auth" ON public.feature_flags FOR SELECT TO authenticated USING (true);

CREATE POLICY "feature_flags admin write" ON public.feature_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "admin_audit_log admin read" ON public.admin_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "pages owner all"
  ON public.document_pages FOR ALL
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read own engine runs"
  ON public.pipeline_engine_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own engine runs"
  ON public.pipeline_engine_runs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own engine runs"
  ON public.pipeline_engine_runs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own engine runs"
  ON public.pipeline_engine_runs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own settings"
  ON public.user_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pipeline_events insert by case owner"
ON public.pipeline_events
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cases c
    WHERE c.id = pipeline_events.case_id
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "pipeline_events read by case owner"
ON public.pipeline_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cases c
    WHERE c.id = pipeline_events.case_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

CREATE POLICY "owners read activations"
  ON public.case_domain_activations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "owners write activations"
  ON public.case_domain_activations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "users read own audit logs" ON public.audit_logs
  FOR SELECT USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "service inserts audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "report_versions owner read"
  ON public.report_versions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "report_versions owner write"
  ON public.report_versions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own agent logs" ON public.agent_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own agent logs" ON public.agent_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own agent logs" ON public.agent_logs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users view timeline events for their own cases"
  ON public.case_timeline_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users insert timeline events for their own cases"
  ON public.case_timeline_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users update timeline events for their own cases"
  ON public.case_timeline_events FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users view image intelligence for their own cases"
  ON public.image_intelligence FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users insert image intelligence for their own cases"
  ON public.image_intelligence FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY firms_read ON public.firms FOR SELECT TO authenticated USING (true);

CREATE POLICY firms_admin_write ON public.firms FOR ALL TO authenticated
USING (public.is_admin_tier(auth.uid()))
WITH CHECK (public.is_admin_tier(auth.uid()));

CREATE POLICY cases_firm_admin_read ON public.cases FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'firm_admin'::app_role)
  AND public.same_firm(auth.uid(), user_id)
);

CREATE POLICY "Users delete image intelligence for their own cases"
ON public.image_intelligence FOR DELETE
USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = image_intelligence.case_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))));

CREATE POLICY "worker_secrets super_admin read only"
ON public.worker_secrets FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Users read canonical analysis for their cases"
  ON public.canonical_analysis
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = canonical_analysis.case_id
        AND (
          c.user_id = auth.uid()
          OR public.same_firm(auth.uid(), c.user_id)
          OR public.is_admin_tier(auth.uid())
        )
    )
  );

CREATE POLICY "Service role manages canonical analysis"
  ON public.canonical_analysis
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users manage their own AI keys"
  ON public.user_ai_keys
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read reports for their cases"
  ON public.reports FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = reports.case_id
        AND (c.user_id = auth.uid()
             OR public.same_firm(auth.uid(), c.user_id)
             OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE POLICY "Service role manages reports"
  ON public.reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Owners write reports for their cases"
  ON public.reports FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.cases c WHERE c.id = reports.case_id AND c.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.cases c WHERE c.id = reports.case_id AND c.user_id = auth.uid())
  );

CREATE POLICY "Users read report versions for their cases"
  ON public.report_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = report_versions.case_id
        AND (c.user_id = auth.uid()
             OR public.same_firm(auth.uid(), c.user_id)
             OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE POLICY "Service role manages report versions"
  ON public.report_versions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "motion drafts all" ON public.case_motion_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view active plans"
  ON public.billing_plans FOR SELECT
  USING (active = true);

CREATE POLICY "Admins can view all plans"
  ON public.billing_plans FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert plans"
  ON public.billing_plans FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can update plans"
  ON public.billing_plans FOR UPDATE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete plans"
  ON public.billing_plans FOR DELETE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can view webhook events"
  ON public.webhook_events FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Users manage their own provider order"
  ON public.user_provider_order
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage their own feature routing"
  ON public.user_intelligence_features
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view published demo cases"
  ON public.demo_cases FOR SELECT
  USING (published = true);

CREATE POLICY "Admins can view all demo cases"
  ON public.demo_cases FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert demo cases"
  ON public.demo_cases FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can update demo cases"
  ON public.demo_cases FOR UPDATE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete demo cases"
  ON public.demo_cases FOR DELETE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Anyone can view documents of published demo cases"
  ON public.demo_case_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.demo_cases dc
    WHERE dc.id = demo_case_documents.demo_case_id AND dc.published = true
  ));

CREATE POLICY "Admins can view all demo case documents"
  ON public.demo_case_documents FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert demo case documents"
  ON public.demo_case_documents FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete demo case documents"
  ON public.demo_case_documents FOR DELETE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Anyone can read demo-cases storage objects"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'demo-cases');

CREATE POLICY "Admins can write demo-cases storage objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())));

CREATE POLICY "Admins can update demo-cases storage objects"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())))
  WITH CHECK (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())));

CREATE POLICY "Admins can delete demo-cases storage objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())));

CREATE POLICY "strategy center all" ON public.case_strategy_center FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY firm_invites_read ON public.firm_invites FOR SELECT TO authenticated
USING (
  public.is_admin_tier(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_settings us
    WHERE us.user_id = auth.uid() AND us.firm_id = firm_invites.firm_id
  )
);

CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "user_roles_self_select" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "orgs_owner_update" ON public.organizations FOR UPDATE TO authenticated
  USING (public.can_manage_org(auth.uid(), id)) WITH CHECK (public.can_manage_org(auth.uid(), id));

CREATE POLICY "orgs_authenticated_insert" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "memb_admin_write" ON public.org_memberships FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "memb_admin_update" ON public.org_memberships FOR UPDATE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id)) WITH CHECK (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "memb_admin_delete" ON public.org_memberships FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "matters_member_select" ON public.matters FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);

CREATE POLICY "matters_contrib_insert" ON public.matters FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "matters_manage_update" ON public.matters FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "matters_admin_delete" ON public.matters FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "parties_member_select" ON public.matter_parties FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);

CREATE POLICY "parties_contrib_write" ON public.matter_parties FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "parties_contrib_update" ON public.matter_parties FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "parties_admin_delete" ON public.matter_parties FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "events_member_select" ON public.matter_events FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);

CREATE POLICY "events_contrib_write" ON public.matter_events FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "events_contrib_update" ON public.matter_events FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "events_admin_delete" ON public.matter_events FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "docs_member_select" ON public.matter_documents FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);

CREATE POLICY "docs_contrib_write" ON public.matter_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "docs_contrib_update" ON public.matter_documents FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "docs_admin_delete" ON public.matter_documents FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "notes_member_select" ON public.matter_notes FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);

CREATE POLICY "notes_contrib_insert" ON public.matter_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id) AND author_id = auth.uid());

CREATE POLICY "notes_author_update" ON public.matter_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

CREATE POLICY "notes_author_or_admin_delete" ON public.matter_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "tasks_member_select" ON public.matter_tasks FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);

CREATE POLICY "tasks_contrib_write" ON public.matter_tasks FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "tasks_contrib_update" ON public.matter_tasks FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "tasks_admin_delete" ON public.matter_tasks FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "audit_member_select" ON public.audit_log FOR SELECT TO authenticated
  USING (org_id IS NULL OR public.is_org_member(auth.uid(), org_id));

CREATE POLICY permissions_read_all ON public.permissions FOR SELECT TO authenticated USING (true);

CREATE POLICY role_perms_read_all ON public.role_permissions FOR SELECT TO authenticated USING (true);

CREATE POLICY orgperms_member_select ON public.org_role_permissions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY orgperms_admin_write ON public.org_role_permissions FOR ALL TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id))
  WITH CHECK (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY docver_member_select ON public.document_versions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY docver_contrib_write ON public.document_versions FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY docver_admin_delete ON public.document_versions FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY docjobs_member_select ON public.document_processing_jobs FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY intel_runs_select ON public.intelligence_runs FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY intel_runs_insert ON public.intelligence_runs FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY mk_select ON public.matter_knowledge FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY mk_contrib_write ON public.matter_knowledge FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY mk_contrib_update ON public.matter_knowledge FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY mk_admin_delete ON public.matter_knowledge FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY legal_auth_public_read ON public.legal_authorities FOR SELECT USING (true);

CREATE POLICY legal_cite_public_read ON public.legal_citations FOR SELECT USING (true);

CREATE POLICY connectors_authenticated_read ON public.legal_source_connectors FOR SELECT TO authenticated USING (true);

CREATE POLICY plans_public_read ON public.billing_plans FOR SELECT USING (active = true);

CREATE POLICY plan_ent_public_read ON public.plan_entitlements FOR SELECT USING (true);

CREATE POLICY subs_member_select ON public.org_subscriptions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY pay_member_select ON public.billing_payments FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY audit_insert_self ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND (org_id IS NULL OR public.is_org_member(auth.uid(), org_id)));

CREATE POLICY "matter_docs_contrib_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'matter-documents'
  AND public.can_contribute_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "matter_docs_contrib_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'matter-documents'
  AND public.can_contribute_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "matter_docs_admin_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'matter-documents'
  AND public.can_manage_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "docjobs_contrib_write" ON public.document_processing_jobs
  FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "docjobs_contrib_update" ON public.document_processing_jobs
  FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id))
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "intel_runs_update" ON public.intelligence_runs
  FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id))
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "kr_select" ON public.knowledge_relationships
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "kr_contrib_write" ON public.knowledge_relationships
  FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "kr_contrib_update" ON public.knowledge_relationships
  FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id))
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "kr_admin_delete" ON public.knowledge_relationships
  FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE POLICY "legal_profiles_public_read" ON public.legal_profiles FOR SELECT USING (true);

CREATE POLICY "legal_authority_versions public read" ON public.legal_authority_versions FOR SELECT USING (true);

CREATE POLICY "legal_ingest_runs admin read" ON public.legal_ingest_runs FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "legal_authority_versions public read" ON public.legal_authority_versions FOR SELECT USING (true);

CREATE POLICY "legal_ingest_runs admin read" ON public.legal_ingest_runs FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "case-files: users insert own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "case-files: users update own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "case-files: users delete own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "users select own agent_findings" ON public.agent_findings FOR SELECT TO authenticated USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_providers admin insert" ON public.ai_providers
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_providers admin update" ON public.ai_providers
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_providers admin delete" ON public.ai_providers
  FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins read plan notes" ON public.billing_plan_notes
  FOR SELECT TO authenticated USING (public.is_admin_tier(auth.uid()));

CREATE POLICY "admins write plan notes" ON public.billing_plan_notes
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_tier(auth.uid()));

CREATE POLICY "admins update plan notes" ON public.billing_plan_notes
  FOR UPDATE TO authenticated USING (public.is_admin_tier(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()));

CREATE POLICY "admins delete plan notes" ON public.billing_plan_notes
  FOR DELETE TO authenticated USING (public.is_admin_tier(auth.uid()));

CREATE POLICY "admins insert plans" ON public.billing_plans
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_tier(auth.uid()));

CREATE POLICY "admins update plans" ON public.billing_plans
  FOR UPDATE TO authenticated USING (public.is_admin_tier(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()));

CREATE POLICY "admins delete plans" ON public.billing_plans
  FOR DELETE TO authenticated USING (public.is_admin_tier(auth.uid()));

CREATE POLICY "cases update" ON public.cases
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "findings update" ON public.case_findings
  FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY firms_read ON public.firms
  FOR SELECT TO authenticated
  USING (
    public.is_member_of_firm(auth.uid(), id)
    OR public.is_admin_tier(auth.uid())
  );

CREATE POLICY connectors_admin_read ON public.legal_source_connectors FOR SELECT TO authenticated USING (public.is_admin_tier(auth.uid()));

CREATE POLICY legal_articles_public_read ON public.legal_articles FOR SELECT USING (true);

CREATE POLICY legal_amendments_public_read ON public.legal_amendments FOR SELECT USING (true);

CREATE POLICY legal_precedents_public_read ON public.legal_precedents FOR SELECT USING (true);

CREATE POLICY legal_jurisprudencia_public_read ON public.legal_jurisprudencia FOR SELECT USING (true);

CREATE POLICY legal_theses_public_read ON public.legal_theses FOR SELECT USING (true);

CREATE POLICY legal_regulations_public_read ON public.legal_regulations FOR SELECT USING (true);

CREATE POLICY legal_topics_public_read ON public.legal_topics FOR SELECT USING (true);

CREATE POLICY legal_keywords_public_read ON public.legal_keywords FOR SELECT USING (true);

CREATE POLICY legal_topic_links_public_read ON public.legal_topic_links FOR SELECT USING (true);

CREATE POLICY legal_keyword_links_public_read ON public.legal_keyword_links FOR SELECT USING (true);

CREATE POLICY authority_relationships_public_read ON public.authority_relationships FOR SELECT USING (true);

CREATE POLICY citation_cache_public_read ON public.citation_cache FOR SELECT USING (true);

CREATE POLICY "Users read trace for their own cases"
ON public.pipeline_trace
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = pipeline_trace.case_id
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Users insert trace for their own cases"
ON public.pipeline_trace
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = pipeline_trace.case_id
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "agent_configs admin read"
  ON public.agent_configs FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

CREATE POLICY "feature_flags admin read"
  ON public.feature_flags FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

CREATE POLICY "permissions admin read"
  ON public.permissions FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

CREATE POLICY "role_permissions admin read"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

CREATE POLICY "property_records all" ON public.property_records FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "verification_items all" ON public.verification_items FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "closing_milestones all" ON public.closing_milestones FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "parties all" ON public.case_parties
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tasks all" ON public.case_tasks
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "events all" ON public.case_events
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "communications all" ON public.case_communications
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "audit_member_select" ON public.audit_log FOR SELECT TO authenticated
USING (
  (org_id IS NOT NULL AND public.is_org_member(auth.uid(), org_id))
  OR (org_id IS NULL AND actor_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Users can view own usage"
  ON public.usage_counters
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own usage events"
  ON public.usage_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own case finding snapshots"
  ON public.finding_version_snapshots
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = finding_version_snapshots.case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users can view their own case audits"
  ON public.cross_agent_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "feedback_insert_own" ON public.user_feedback
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "feedback_select_own_or_admin" ON public.user_feedback
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_tier(auth.uid()));

CREATE POLICY firm_invites_read ON public.firm_invites
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.firm_id = firm_invites.firm_id
  )
);

CREATE POLICY plan_ent_read_authenticated ON public.plan_entitlements
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "users insert own agent_findings" ON public.agent_findings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "findings insert" ON public.case_findings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "users insert own case_scores" ON public.case_scores
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "theories all" ON public.case_theories FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "opps all" ON public.case_opportunities FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "witnesses all" ON public.case_witnesses FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "parties all" ON public.case_parties FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "tasks all" ON public.case_tasks FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "events all" ON public.case_events FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "communications all" ON public.case_communications FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "perspectives owner full" ON public.case_perspectives FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

CREATE POLICY "strategy owner full" ON public.case_strategy FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

CREATE POLICY "evidence_class owner full" ON public.evidence_classifications FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

CREATE POLICY "motion drafts all" ON public.case_motion_drafts FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "strategy center all" ON public.case_strategy_center FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "property_records all" ON public.property_records FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

CREATE POLICY "verification_items all" ON public.verification_items FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

CREATE POLICY "closing_milestones all" ON public.closing_milestones FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

CREATE POLICY "support_threads_insert_own" ON public.support_threads
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "support_threads_select_own_or_admin" ON public.support_threads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_tier(auth.uid()));

CREATE POLICY "support_messages_insert_own_thread" ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'user'
    AND sender_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.support_threads t WHERE t.id = thread_id AND t.user_id = auth.uid())
  );

CREATE POLICY "support_messages_select_own_or_admin" ON public.support_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_threads t
      WHERE t.id = thread_id AND (t.user_id = auth.uid() OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE POLICY case_outcome_assessments_owner_select ON public.case_outcome_assessments
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY case_classification_evidence_owner_select ON public.case_classification_evidence
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY case_decision_reconstructions_owner_select ON public.case_decision_reconstructions
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "analyses all" ON public.analyses FOR ALL TO authenticated
USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((auth.uid() = user_id) AND private.owns_case(case_id));

CREATE POLICY "chat all" ON public.case_chat_messages FOR ALL TO authenticated
USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((user_id = auth.uid()) AND private.owns_case(case_id));

CREATE POLICY "trial all" ON public.case_trial_prep FOR ALL TO authenticated
USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((user_id = auth.uid()) AND private.owns_case(case_id));

CREATE POLICY "work all" ON public.case_work_product FOR ALL TO authenticated
USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((user_id = auth.uid()) AND private.owns_case(case_id));

CREATE POLICY case_finding_patches_owner_select ON public.case_finding_patches
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY intelligence_lessons_owner_select ON public.intelligence_lessons
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY intelligence_patterns_owner_select ON public.intelligence_patterns
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY intelligence_validation_rules_owner_select ON public.intelligence_validation_rules
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY intelligence_versions_owner_select ON public.intelligence_versions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY intelligence_versions_owner_select ON public.intelligence_versions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY intelligence_validation_rules_owner_select ON public.intelligence_validation_rules
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY intelligence_patterns_owner_select ON public.intelligence_patterns
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY case_finding_patches_owner_select ON public.case_finding_patches
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY intelligence_lessons_owner_select ON public.intelligence_lessons
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE POLICY "mk_contrib_update" ON public.matter_knowledge
FOR UPDATE TO authenticated
USING (public.can_contribute_org(auth.uid(), org_id))
WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

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

create policy social_documents_access on public.social_documents for all
using (public.social_can_access_case(social_case_id,record_type,false,auth.uid()))
with check (public.social_can_access_case(social_case_id,record_type,true,auth.uid()));

create policy social_plan_versions_access on public.social_care_plan_versions for all
using (exists(select 1 from public.social_care_plans p where p.id=care_plan_id and public.social_can_access_case(p.social_case_id,'general_case_record',false,auth.uid())))
with check (exists(select 1 from public.social_care_plans p where p.id=care_plan_id and public.social_can_access_case(p.social_case_id,'general_case_record',true,auth.uid())));

create policy social_goals_access on public.social_care_plan_goals for all
using (exists(select 1 from public.social_care_plan_versions v join public.social_care_plans p on p.id=v.care_plan_id where v.id=care_plan_version_id and public.social_can_access_case(p.social_case_id,'general_case_record',false,auth.uid())))
with check (exists(select 1 from public.social_care_plan_versions v join public.social_care_plans p on p.id=v.care_plan_id where v.id=care_plan_version_id and public.social_can_access_case(p.social_case_id,'general_case_record',true,auth.uid())));

create policy social_document_versions_access on public.social_document_versions for all
using (exists(select 1 from public.social_documents d where d.id=document_id and public.social_can_access_case(d.social_case_id,d.record_type,false,auth.uid())))
with check (exists(select 1 from public.social_documents d where d.id=document_id and public.social_can_access_case(d.social_case_id,d.record_type,true,auth.uid())));

create policy social_consent_versions_access on public.social_consent_versions for all
using (exists(select 1 from public.social_consents c where c.id=consent_id))
with check (exists(select 1 from public.social_consents c where c.id=consent_id));

create policy social_institutions_manage on public.social_institutions for all
using (org_id is not null and public.can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.can_manage_org(org_id,auth.uid()));

create policy social_templates_read on public.social_assessment_templates for select
using (org_id is null or public.is_org_member(org_id,auth.uid()));

create policy social_templates_manage on public.social_assessment_templates for all
using (org_id is not null and public.can_manage_org(org_id,auth.uid()))
with check (org_id is not null and public.can_manage_org(org_id,auth.uid()));

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

create policy social_case_files_read on storage.objects for select to authenticated using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',false,auth.uid())
);

create policy social_case_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',true,auth.uid())
);

create policy social_case_files_update on storage.objects for update to authenticated using (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',true,auth.uid())
) with check (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,'general_case_record',true,auth.uid())
);

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

create policy social_case_files_update on storage.objects for update to authenticated using (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid())
) with check (
  bucket_id='social-case-files'
  and public.social_can_access_case(((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid())
);

create policy resource_categories_read on public.resource_service_categories for select to authenticated
  using (org_id is null or public.is_org_member(org_id,auth.uid()) or public.is_platform_admin(auth.uid()));

create policy resource_categories_manage on public.resource_service_categories for all to authenticated
  using (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())))
  with check (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())));

create policy resource_verifications_read on public.resource_verifications for select to authenticated
  using (public.is_platform_admin(auth.uid()) or (org_id is not null and public.is_org_member(org_id,auth.uid())));

create policy resource_verifications_manage on public.resource_verifications for all to authenticated
  using (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())))
  with check (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())));

create policy resource_corrections_read on public.resource_corrections for select to authenticated
  using (submitted_by=auth.uid() or public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())));

create policy resource_corrections_insert on public.resource_corrections for insert to authenticated
  with check (submitted_by=auth.uid() and (org_id is null or public.is_org_member(org_id,auth.uid()) or public.is_platform_admin(auth.uid())));

create policy resource_corrections_manage on public.resource_corrections for update to authenticated
  using (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())));

create policy resource_experiences_access on public.resource_internal_experiences for all to authenticated
  using (public.is_platform_admin(auth.uid()) or public.is_org_member(org_id,auth.uid()))
  with check ((created_by=auth.uid() and public.is_org_member(org_id,auth.uid())) or public.is_platform_admin(auth.uid()));

create policy resource_knowledge_read on public.resource_knowledge_records for select to authenticated
  using ((approval_status='approved' and (org_id is null or public.is_org_member(org_id,auth.uid()))) or public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())));

create policy resource_knowledge_manage on public.resource_knowledge_records for all to authenticated
  using (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())))
  with check (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())));

create policy resource_knowledge_versions_read on public.resource_knowledge_versions for select to authenticated
  using (exists(select 1 from public.resource_knowledge_records k where k.id=knowledge_id));

create policy resource_knowledge_versions_manage on public.resource_knowledge_versions for all to authenticated
  using (exists(select 1 from public.resource_knowledge_records k where k.id=knowledge_id and (public.is_platform_admin(auth.uid()) or (k.org_id is not null and public.can_manage_org(k.org_id,auth.uid())))))
  with check (exists(select 1 from public.resource_knowledge_records k where k.id=knowledge_id and (public.is_platform_admin(auth.uid()) or (k.org_id is not null and public.can_manage_org(k.org_id,auth.uid())))));

create policy social_institutions_read on public.social_institutions for select to authenticated
  using (status<>'archived' and (org_id is null or public.is_org_member(org_id,auth.uid()) or public.is_platform_admin(auth.uid())));

create policy social_institutions_manage on public.social_institutions for all to authenticated
  using (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())))
  with check (public.is_platform_admin(auth.uid()) or (org_id is not null and public.can_manage_org(org_id,auth.uid())));

create policy social_case_document_requirements_access on public.social_case_document_requirements for all to authenticated
using (public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()))
with check (public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid()));

create policy social_document_access_events_read on public.social_document_access_events for select to authenticated
using (
  public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid())
  or public.social_can_manage_org(org_id,auth.uid())
);

create policy social_document_access_events_insert on public.social_document_access_events for insert to authenticated
with check (
  actor_id=auth.uid()
  and exists(
    select 1 from public.social_documents d
    where d.id=document_id and d.social_case_id=social_case_id and d.org_id=org_id
      and public.social_can_access_case(d.social_case_id,d.record_type,false,auth.uid())
  )
);

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

create policy resource_knowledge_read on public.resource_knowledge_records for select to authenticated
using (
  (approval_status in ('approved','published') and (org_id is null or public.social_is_org_member(org_id,auth.uid())))
  or public.social_is_platform_admin(auth.uid())
  or (org_id is not null and public.social_can_manage_org(org_id,auth.uid()))
);

create policy knowledge_corrections_access on public.resource_knowledge_corrections for all to authenticated
using (submitted_by=auth.uid() or public.social_is_platform_admin(auth.uid()) or (org_id is not null and public.social_can_manage_org(org_id,auth.uid())))
with check (submitted_by=auth.uid() and (org_id is null or public.social_is_org_member(org_id,auth.uid()) or public.social_is_platform_admin(auth.uid())));

create policy knowledge_case_actions_access on public.resource_knowledge_case_actions for all to authenticated
using (public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()))
with check (created_by=auth.uid() and public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid()));

create policy knowledge_usage_insert on public.resource_knowledge_usage for insert to authenticated
with check (actor_id=auth.uid() and (org_id is null or public.social_is_org_member(org_id,auth.uid()) or public.social_is_platform_admin(auth.uid())));

create policy knowledge_usage_manage on public.resource_knowledge_usage for select to authenticated
using (actor_id=auth.uid() or public.social_is_platform_admin(auth.uid()) or (org_id is not null and public.social_can_manage_org(org_id,auth.uid())));

create policy social_knowledge_files_read on storage.objects for select to authenticated using (
  bucket_id='social-knowledge-files' and exists(
    select 1 from public.resource_knowledge_records k where k.document_path=name
  )
);

create policy social_knowledge_files_write on storage.objects for insert to authenticated with check (
  bucket_id='social-knowledge-files' and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (public.social_is_platform_admin(auth.uid()) or public.social_can_manage_org(((storage.foldername(name))[1])::uuid,auth.uid()))
);

create policy social_care_assistant_runs_access on public.social_care_assistant_runs for all to authenticated
using (
  actor_id=auth.uid()
  or public.social_can_manage_org(org_id,auth.uid())
)
with check (
  actor_id=auth.uid()
  and public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid())
);

create policy social_care_action_proposals_access on public.social_care_action_proposals for all to authenticated
using (
  proposed_by=auth.uid()
  or public.social_can_manage_org(org_id,auth.uid())
)
with check (
  public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid())
  and (proposed_by=auth.uid() or confirmed_by=auth.uid())
);

create policy social_sales_demo_owner_read on public.social_sales_demo_records for select to authenticated
using(owner_user_id=auth.uid());

create policy organization_invitations_manage on public.organization_invitations
for select to authenticated
using (public.social_can_manage_org(org_id,auth.uid()) or accepted_by=auth.uid());

create policy social_role_capabilities_read
  on public.social_role_capabilities
  for select
  to authenticated
  using (
    public.social_is_platform_admin(auth.uid())
    or exists (
      select 1
      from public.social_role_assignments ra
      where ra.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.org_memberships m
      where m.user_id = auth.uid()
        and m.status = 'active'
        and m.deleted_at is null
    )
  );

create policy social_role_capabilities_admin_write
  on public.social_role_capabilities
  for all
  to authenticated
  using (public.social_is_platform_admin(auth.uid()))
  with check (public.social_is_platform_admin(auth.uid()));

create policy demo_case_documents_authenticated_read
  on public.demo_case_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.demo_cases dc
      where dc.id = demo_case_documents.demo_case_id
        and dc.published = true
    )
  );

create policy social_case_status_history_read on public.social_case_status_history
for select to authenticated
using(public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid()));

create policy social_intakes_read
on public.social_intakes
for select to authenticated
using (
  public.social_is_org_member(org_id, auth.uid())
  and (
    assigned_to is null
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.social_can_manage_org(org_id, auth.uid())
    or public.social_has_capability(org_id, 'case.view_all', auth.uid())
  )
);

create policy social_intakes_read
on public.social_intakes
for select to authenticated
using (
  public.social_is_org_member(org_id, auth.uid())
  and (
    assigned_to is null
    or assigned_to = auth.uid()
    or created_by = auth.uid()
    or public.social_can_manage_org(org_id, auth.uid())
    or public.social_has_capability(org_id, 'case.view_all', auth.uid())
  )
);

create policy social_cases_direct_participant_read
on public.social_cases
for select
to authenticated
using (
  deleted_at is null
  and (
    created_by = auth.uid()
    or supervising_manager = auth.uid()
    or assigned_case_manager = auth.uid()
    or public.social_is_platform_admin(auth.uid())
    or exists (
      select 1
      from public.social_case_assignments a
      where a.social_case_id = social_cases.id
        and a.user_id = auth.uid()
        and a.active
        and (a.ended_at is null or a.ended_at > now())
    )
    or (
      public.social_is_org_member(org_id,auth.uid())
      and (
        public.social_can_manage_org(org_id,auth.uid())
        or public.social_has_capability(org_id,'case.view_all',auth.uid())
      )
    )
  )
);

create policy social_case_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and storage.filename(name) ~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|txt|csv|tsv|json|xml|jpg|jpeg|png|webp|gif|bmp|tif|tiff|heic|heif|svg|zip|rar|7z|tar|gz|tgz|mp3|wav|m4a|aac|ogg|oga|flac|mp4|mov|m4v|webm|avi|mpeg|mpg|mkv|eml|msg|dcm)$'
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
  and public.social_media_upload_allowed(
    ((storage.foldername(name))[2])::uuid,metadata->>'mimetype',auth.uid()
  )
);

create policy social_case_files_update on storage.objects
for update to authenticated
using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
)
with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and storage.filename(name) ~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|txt|csv|tsv|json|xml|jpg|jpeg|png|webp|gif|bmp|tif|tiff|heic|heif|svg|zip|rar|7z|tar|gz|tgz|mp3|wav|m4a|aac|ogg|oga|flac|mp4|mov|m4v|webm|avi|mpeg|mpg|mkv|eml|msg|dcm)$'
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
  and public.social_media_upload_allowed(
    ((storage.foldername(name))[2])::uuid,metadata->>'mimetype',auth.uid()
  )
);

create policy social_consents_read
  on public.social_consents
  for select
  to authenticated
  using (
    social_can_manage_org(org_id, auth.uid())
    or (created_by = auth.uid() and social_is_org_member(org_id, auth.uid()))
    or (
      social_is_org_member(org_id, auth.uid())
      and (
        (person_id is not null and social_can_access_person(person_id, auth.uid()))
        or exists (
          select 1
          from public.social_cases c
          where c.org_id = social_consents.org_id
            and (
              (social_consents.person_id is not null and c.person_id = social_consents.person_id)
              or (social_consents.family_id is not null and c.family_id = social_consents.family_id)
            )
            and social_can_access_case(c.id, 'general_case_record'::text, false, auth.uid())
        )
      )
    )
  );

create policy social_consents_update
  on public.social_consents
  for update
  to authenticated
  using (
    social_can_manage_org(org_id, auth.uid())
    or (
      social_is_org_member(org_id, auth.uid())
      and (
        (person_id is not null and social_can_access_person(person_id, auth.uid()))
        or exists (
          select 1
          from public.social_cases c
          where c.org_id = social_consents.org_id
            and (
              (social_consents.person_id is not null and c.person_id = social_consents.person_id)
              or (social_consents.family_id is not null and c.family_id = social_consents.family_id)
            )
            and social_can_access_case(c.id, 'general_case_record'::text, true, auth.uid())
        )
      )
    )
  )
  with check (
    social_is_org_member(org_id, auth.uid())
    and (
      social_can_manage_org(org_id, auth.uid())
      or (
        (person_id is not null and social_can_access_person(person_id, auth.uid()))
        or exists (
          select 1
          from public.social_cases c
          where c.org_id = social_consents.org_id
            and (
              (social_consents.person_id is not null and c.person_id = social_consents.person_id)
              or (social_consents.family_id is not null and c.family_id = social_consents.family_id)
            )
            and social_can_access_case(c.id, 'general_case_record'::text, true, auth.uid())
        )
      )
    )
  );

create policy social_family_members_write
  on public.social_family_members
  for all
  to authenticated
  using (
    social_can_manage_org(org_id, auth.uid())
    or (
      social_has_capability(org_id, 'person.manage'::text, auth.uid())
      and exists (
        select 1
        from public.social_families f
        where f.id = social_family_members.family_id
          and f.org_id = social_family_members.org_id
          and (
            f.created_by = auth.uid()
            or f.assigned_case_manager = auth.uid()
            or exists (
              select 1
              from public.social_cases c
              where c.family_id = f.id
                and c.org_id = social_family_members.org_id
                and social_can_access_case(c.id, 'general_case_record'::text, true, auth.uid())
            )
          )
      )
    )
  )
  with check (
    social_is_org_member(org_id, auth.uid())
    and (
      social_can_manage_org(org_id, auth.uid())
      or social_has_capability(org_id, 'person.manage'::text, auth.uid())
    )
    and exists (
      select 1
      from public.social_people p
      where p.id = social_family_members.person_id
        and p.org_id = social_family_members.org_id
    )
    and exists (
      select 1
      from public.social_families f
      where f.id = social_family_members.family_id
        and f.org_id = social_family_members.org_id
    )
  );

create policy social_document_access_events_insert
  on public.social_document_access_events
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1
      from public.social_documents d
      where d.id = social_document_access_events.document_id
        and d.social_case_id is not distinct from social_document_access_events.social_case_id
        and d.org_id = social_document_access_events.org_id
        and social_is_org_member(d.org_id, auth.uid())
        and social_can_access_case(d.social_case_id, d.record_type, false, auth.uid())
    )
  );

create policy social_document_access_events_read
  on public.social_document_access_events
  for select
  to authenticated
  using (
    social_is_org_member(org_id, auth.uid())
    and (
      social_can_manage_org(org_id, auth.uid())
      or social_can_access_case(social_case_id, 'general_case_record'::text, false, auth.uid())
    )
  );

create policy social_activity_read
  on public.social_activity_events
  for select
  to authenticated
  using (
    is_org_member(org_id, auth.uid())
    and social_sales_demo_any_owner_allows(entity_id, auth.uid())
    and (
      social_case_id is null
      or social_can_access_case(social_case_id, 'general_case_record'::text, false, auth.uid())
    )
    and (
      actor_id = auth.uid()
      or can_manage_org(org_id, auth.uid())
      or (
        social_has_capability(org_id, 'audit.view'::text, auth.uid())
        and public.social_activity_entity_visible(entity_type, entity_id, org_id, auth.uid())
      )
    )
  );

create policy social_activity_insert
  on public.social_activity_events
  for insert
  to authenticated
  with check (
    social_is_org_member(org_id, auth.uid())
    and actor_id = auth.uid()
    and (
      social_case_id is null
      or exists (
        select 1
        from public.social_cases c
        where c.id = social_activity_events.social_case_id
          and c.org_id = social_activity_events.org_id
      )
    )
  );

create policy social_activity_read
  on public.social_activity_events
  for select
  to authenticated
  using (
    public.social_is_org_member(org_id, auth.uid())
    and public.social_sales_demo_any_owner_allows(entity_id, auth.uid())
    and (
      social_case_id is null
      or public.social_can_access_case(
        social_case_id,
        'general_case_record',
        false,
        auth.uid()
      )
    )
    and (
      actor_id = auth.uid()
      or public.social_can_manage_org(org_id, auth.uid())
      or (
        public.social_has_capability(org_id, 'audit.view', auth.uid())
        and public.social_activity_entity_visible(
          entity_type,
          entity_id,
          org_id,
          auth.uid()
        )
      )
    )
  );

create policy social_activity_insert
  on public.social_activity_events
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and event_type = 'case_media_ai_access_changed'
    and entity_type in ('social_document', 'social_documents')
    and exists (
      select 1
      from public.social_documents d
      where d.id = social_activity_events.entity_id
        and d.org_id = social_activity_events.org_id
        and d.social_case_id is not distinct from social_activity_events.social_case_id
        and d.deleted_at is null
        and public.social_can_access_case(
          d.social_case_id,
          d.record_type,
          false,
          auth.uid()
        )
    )
  );

create policy social_families_read
  on public.social_families
  for select
  to authenticated
  using (
    public.social_sales_demo_owner_allows(
      'social_families',
      social_families.id,
      auth.uid()
    )
    and public.social_is_org_member(social_families.org_id, auth.uid())
    and (
      public.social_can_manage_org(social_families.org_id, auth.uid())
      or social_families.created_by = auth.uid()
      or social_families.assigned_case_manager = auth.uid()
      or exists (
        select 1
        from public.social_cases c
        where c.family_id = social_families.id
          and c.org_id = social_families.org_id
          and public.social_can_access_case(
            c.id,
            'general_case_record',
            false,
            auth.uid()
          )
      )
    )
  );

create policy billing_plans_public_marketing_read
  on public.billing_plans
  for select
  to anon
  using (active is true);

CREATE POLICY security_incidents_admin_select ON public.security_incidents
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

CREATE POLICY security_incidents_admin_insert ON public.security_incidents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()) AND created_by = auth.uid());

CREATE POLICY security_incidents_admin_update ON public.security_incidents
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

CREATE POLICY legal_document_versions_read_active ON public.legal_document_versions
  FOR SELECT TO authenticated
  USING (is_active OR (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid())));

CREATE POLICY legal_document_versions_admin_insert ON public.legal_document_versions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

CREATE POLICY legal_document_versions_admin_update ON public.legal_document_versions
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

CREATE POLICY user_consents_select_own ON public.user_consents
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin_tier(auth.uid())));

CREATE POLICY user_consents_insert_own ON public.user_consents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY user_consents_update_own ON public.user_consents
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY arco_requests_select_own ON public.arco_requests
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin_tier(auth.uid())));

CREATE POLICY arco_requests_insert_own ON public.arco_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

CREATE POLICY arco_requests_admin_update ON public.arco_requests
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

CREATE POLICY arco_request_events_select ON public.arco_request_events
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.arco_requests r
      WHERE r.id = arco_request_events.request_id
        AND (r.user_id = auth.uid() OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE POLICY arco_request_events_insert ON public.arco_request_events
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND actor_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.arco_requests r
      WHERE r.id = arco_request_events.request_id
        AND (r.user_id = auth.uid() OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE POLICY case_penal_dispositions_owner_all
  ON public.case_penal_dispositions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND private.owns_case(case_id))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

create policy social_resource_communications_read on public.social_resource_communications
  for select to authenticated using (
    public.social_is_platform_admin(auth.uid()) or public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid())
  );

create policy social_resource_communications_insert on public.social_resource_communications
  for insert to authenticated with check (
    sender_id=auth.uid() and public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid())
  );

create policy social_resource_communications_update on public.social_resource_communications
  for update to authenticated using (
    sender_id=auth.uid() and public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid())
  );

create policy resource_official_sources_read on public.resource_official_sources
  for select to authenticated using (true);

create policy resource_official_sources_manage on public.resource_official_sources
  for all to authenticated
  using (public.is_admin_tier(auth.uid()))
  with check (public.is_admin_tier(auth.uid()));

create policy resource_refresh_runs_read on public.resource_contact_refresh_runs
  for select to authenticated using (public.is_admin_tier(auth.uid()));

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

CREATE POLICY "Organization owners and admins can update fundraising profiles"
  ON public.social_community_fundraising_profiles
  FOR ALL
  USING (
    org_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'organization_owner', 'program_director', 'case_management_supervisor')
    )
  );

CREATE POLICY "Public can view published campaigns"
  ON public.social_community_campaigns
  FOR SELECT
  TO anon, authenticated
  USING (lifecycle_status = 'published');

CREATE POLICY "Staff can insert draft campaign requests"
  ON public.social_community_campaigns
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Organization admins can manage campaigns"
  ON public.social_community_campaigns
  FOR ALL
  USING (
    org_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'organization_owner', 'program_director', 'case_management_supervisor')
    )
  );

CREATE POLICY "Staff can view support offers for their org campaigns"
  ON public.social_community_support_offers
  FOR SELECT
  USING (
    campaign_id IN (
      SELECT id FROM public.social_community_campaigns
      WHERE org_id IN (
        SELECT organization_id FROM public.organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Staff can update support offers for their org campaigns"
  ON public.social_community_support_offers
  FOR UPDATE
  USING (
    campaign_id IN (
      SELECT id FROM public.social_community_campaigns
      WHERE org_id IN (
        SELECT organization_id FROM public.organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Primary subscribers can insert audit reports"
  ON public.social_audit_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscribers can view report email logs"
  ON public.social_audit_report_emails
  FOR SELECT
  TO authenticated
  USING (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscribers can insert report email logs"
  ON public.social_audit_report_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscriber only can select donation identity"
  ON public.social_subscriber_donation_identities
  FOR SELECT
  TO authenticated
  USING (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscriber only can insert donation identity"
  ON public.social_subscriber_donation_identities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscriber only can update donation identity"
  ON public.social_subscriber_donation_identities
  FOR UPDATE
  TO authenticated
  USING (public.is_primary_subscriber(org_id))
  WITH CHECK (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscriber only can select audit events"
  ON public.social_donation_identity_audit_events
  FOR SELECT
  TO authenticated
  USING (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscriber only can insert audit events"
  ON public.social_donation_identity_audit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_primary_subscriber(org_id));

create policy "case files own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'case-files'
    and (auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'case-files'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

create policy social_activity_read on public.social_activity_events
  for select to authenticated
  using (
    (social_case_id is null or public.social_can_access_case(social_case_id, 'general_case_record', false, auth.uid()))
    and public.is_org_member(org_id, auth.uid())
    and (public.can_manage_org(org_id, auth.uid()) or actor_id = auth.uid() or public.social_has_capability(org_id, 'audit.view', auth.uid()))
  );

-- 11. STORAGE BUCKETS INITIALIZATION

INSERT INTO storage.buckets (id, name, public) VALUES ('case-files', 'case-files', false), ('social-case-files', 'social-case-files', false), ('social-knowledge-files', 'social-knowledge-files', false) ON CONFLICT (id) DO NOTHING;

-- 12. ROLE GRANTS & PERMISSIONS

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;