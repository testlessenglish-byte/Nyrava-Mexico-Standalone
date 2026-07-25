
-- ============================================================================
-- Phase 2 Hardening: RBAC, Documents, Intelligence, Legal Knowledge, Billing
-- ============================================================================

-- 1. Expand role enum with legal-industry roles ------------------------------
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'firm_administrator';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'attorney';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'associate_attorney';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'legal_assistant';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'client';
ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'read_only';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'platform_admin';

-- 2. Scalable permissions system --------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,          -- e.g. 'matters.create', 'documents.download'
  resource TEXT NOT NULL,             -- 'matters','documents','billing','intelligence'
  action TEXT NOT NULL,               -- 'view','create','update','delete','export'
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_read_all ON public.permissions FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.org_role NOT NULL,
  permission_code TEXT NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, permission_code)
);
GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_perms_read_all ON public.role_permissions FOR SELECT TO authenticated USING (true);

-- Per-organization overrides for fine-grained control
CREATE TABLE IF NOT EXISTS public.org_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.org_role NOT NULL,
  permission_code TEXT NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, role, permission_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_role_permissions TO authenticated;
GRANT ALL ON public.org_role_permissions TO service_role;
ALTER TABLE public.org_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY orgperms_member_select ON public.org_role_permissions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));
CREATE POLICY orgperms_admin_write ON public.org_role_permissions FOR ALL TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id))
  WITH CHECK (public.can_manage_org(auth.uid(), org_id));

-- Permission check function
CREATE OR REPLACE FUNCTION public.has_permission(_user UUID, _org UUID, _perm TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH user_role AS (
    SELECT role_in_org AS r FROM public.org_memberships
    WHERE user_id = _user AND org_id = _org AND status = 'active' AND deleted_at IS NULL
    LIMIT 1
  ),
  override AS (
    SELECT granted FROM public.org_role_permissions orp, user_role
    WHERE orp.org_id = _org AND orp.role = user_role.r AND orp.permission_code = _perm
    LIMIT 1
  ),
  base AS (
    SELECT 1 FROM public.role_permissions rp, user_role
    WHERE rp.role = user_role.r AND rp.permission_code = _perm
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT granted FROM override),
    EXISTS(SELECT 1 FROM base)
  );
$$;

-- Seed baseline permissions
INSERT INTO public.permissions (code, resource, action, description) VALUES
  ('matters.view','matters','view','View matters'),
  ('matters.create','matters','create','Create matters'),
  ('matters.update','matters','update','Edit matters'),
  ('matters.delete','matters','delete','Delete matters'),
  ('documents.view','documents','view','View documents'),
  ('documents.upload','documents','create','Upload documents'),
  ('documents.download','documents','export','Download documents'),
  ('documents.delete','documents','delete','Delete documents'),
  ('notes.write','notes','create','Create notes'),
  ('tasks.write','tasks','create','Create tasks'),
  ('parties.write','parties','create','Create parties'),
  ('events.write','events','create','Create events'),
  ('members.manage','members','update','Manage org members'),
  ('billing.view','billing','view','View billing'),
  ('billing.manage','billing','update','Manage billing'),
  ('intelligence.run','intelligence','create','Run intelligence engines'),
  ('audit.view','audit','view','View audit log')
ON CONFLICT (code) DO NOTHING;

-- Seed default role→permission mapping (baseline; admins can override per-org)
INSERT INTO public.role_permissions (role, permission_code)
SELECT r, p FROM (VALUES
  ('owner'::public.org_role, ARRAY['matters.view','matters.create','matters.update','matters.delete','documents.view','documents.upload','documents.download','documents.delete','notes.write','tasks.write','parties.write','events.write','members.manage','billing.view','billing.manage','intelligence.run','audit.view']),
  ('admin', ARRAY['matters.view','matters.create','matters.update','matters.delete','documents.view','documents.upload','documents.download','documents.delete','notes.write','tasks.write','parties.write','events.write','members.manage','billing.view','intelligence.run','audit.view']),
  ('lawyer', ARRAY['matters.view','matters.create','matters.update','documents.view','documents.upload','documents.download','notes.write','tasks.write','parties.write','events.write','intelligence.run']),
  ('paralegal', ARRAY['matters.view','matters.update','documents.view','documents.upload','documents.download','notes.write','tasks.write','parties.write','events.write']),
  ('viewer', ARRAY['matters.view','documents.view'])
) AS v(r, perms), unnest(v.perms) AS p
ON CONFLICT DO NOTHING;

-- 3. Document versioning & processing pipeline ------------------------------
CREATE TYPE public.doc_processing_status AS ENUM (
  'pending','uploading','uploaded','extracting','extracted','classifying','classified','analyzing','analyzed','failed'
);

ALTER TABLE public.matter_documents
  ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processing_status public.doc_processing_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS classification JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checksum TEXT,
  ADD COLUMN IF NOT EXISTS media_kind TEXT;  -- 'pdf','docx','image','audio','video','email','spreadsheet','other'

CREATE TABLE IF NOT EXISTS public.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.matter_documents(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version INT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes BIGINT,
  mime_type TEXT,
  checksum TEXT,
  uploaded_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_versions TO authenticated;
GRANT ALL ON public.document_versions TO service_role;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY docver_member_select ON public.document_versions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));
CREATE POLICY docver_contrib_write ON public.document_versions FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY docver_admin_delete ON public.document_versions FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

-- Processing queue
CREATE TABLE IF NOT EXISTS public.document_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.matter_documents(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,  -- 'extract','classify','analyze'
  status public.doc_processing_status NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.document_processing_jobs TO authenticated;
GRANT ALL ON public.document_processing_jobs TO service_role;
ALTER TABLE public.document_processing_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY docjobs_member_select ON public.document_processing_jobs FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE TRIGGER trg_docjobs_updated BEFORE UPDATE ON public.document_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4. Intelligence engine architecture ---------------------------------------
CREATE TYPE public.intelligence_engine AS ENUM (
  'legal','case','evidence','witness','timeline','litigation','contract','research','work_product'
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
GRANT SELECT, INSERT ON public.intelligence_runs TO authenticated;
GRANT ALL ON public.intelligence_runs TO service_role;
ALTER TABLE public.intelligence_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY intel_runs_select ON public.intelligence_runs FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));
CREATE POLICY intel_runs_insert ON public.intelligence_runs FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE TRIGGER trg_intel_runs_updated BEFORE UPDATE ON public.intelligence_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Matter Knowledge Base (persistent output from intelligence engines)
CREATE TABLE IF NOT EXISTS public.matter_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  engine public.intelligence_engine NOT NULL,
  kind TEXT NOT NULL,       -- 'fact','entity','citation','timeline_event','risk','summary'
  title TEXT NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(5,4),
  source_document_id UUID REFERENCES public.matter_documents(id) ON DELETE SET NULL,
  source_run_id UUID REFERENCES public.intelligence_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_knowledge TO authenticated;
GRANT ALL ON public.matter_knowledge TO service_role;
ALTER TABLE public.matter_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY mk_select ON public.matter_knowledge FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));
CREATE POLICY mk_contrib_write ON public.matter_knowledge FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY mk_contrib_update ON public.matter_knowledge FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY mk_admin_delete ON public.matter_knowledge FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));
CREATE TRIGGER trg_mk_updated BEFORE UPDATE ON public.matter_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. Legal knowledge (Mexican legal sources, shared across tenants) ---------
CREATE TABLE IF NOT EXISTS public.legal_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,           -- 'law','code','regulation','jurisprudence','decision','concept','article'
  jurisdiction TEXT,            -- 'federal','cdmx', state code, etc.
  title TEXT NOT NULL,
  short_title TEXT,
  issuer TEXT,                  -- SCJN, DOF, Congreso, etc.
  citation TEXT,
  published_at DATE,
  effective_at DATE,
  source_url TEXT,
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_authorities TO authenticated, anon;
GRANT ALL ON public.legal_authorities TO service_role;
ALTER TABLE public.legal_authorities ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_auth_public_read ON public.legal_authorities FOR SELECT USING (true);
CREATE TRIGGER trg_legal_auth_updated BEFORE UPDATE ON public.legal_authorities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.legal_citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id UUID NOT NULL REFERENCES public.legal_authorities(id) ON DELETE CASCADE,
  cited_authority_id UUID REFERENCES public.legal_authorities(id) ON DELETE SET NULL,
  citation_text TEXT NOT NULL,
  context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_citations TO authenticated, anon;
GRANT ALL ON public.legal_citations TO service_role;
ALTER TABLE public.legal_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_cite_public_read ON public.legal_citations FOR SELECT USING (true);

-- Connector framework
CREATE TABLE IF NOT EXISTS public.legal_source_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,        -- 'scjn','dof','tfja'
  name TEXT NOT NULL,
  description TEXT,
  base_url TEXT,
  status TEXT NOT NULL DEFAULT 'planned',   -- planned|active|paused|error
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_source_connectors TO authenticated;
GRANT ALL ON public.legal_source_connectors TO service_role;
ALTER TABLE public.legal_source_connectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY connectors_authenticated_read ON public.legal_source_connectors FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_connectors_updated BEFORE UPDATE ON public.legal_source_connectors
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.legal_source_connectors (code, name, description, status) VALUES
  ('scjn','Suprema Corte de Justicia de la Nación','Jurisprudencia y tesis SCJN','planned'),
  ('dof','Diario Oficial de la Federación','Publicaciones oficiales federales','planned'),
  ('tfja','Tribunal Federal de Justicia Administrativa','Resoluciones administrativas','planned')
ON CONFLICT (code) DO NOTHING;

-- 6. Billing / Entitlements (Mercado Pago-ready) ----------------------------
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,        -- 'free','starter','pro','enterprise'
  name TEXT NOT NULL,
  description TEXT,
  price_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MXN',
  interval TEXT NOT NULL DEFAULT 'month',
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.billing_plans TO authenticated, anon;
GRANT ALL ON public.billing_plans TO service_role;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_public_read ON public.billing_plans FOR SELECT USING (active = true);
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.billing_plans(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  quota INT,           -- null = unlimited
  UNIQUE(plan_id, permission_code)
);
GRANT SELECT ON public.plan_entitlements TO authenticated, anon;
GRANT ALL ON public.plan_entitlements TO service_role;
ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_ent_public_read ON public.plan_entitlements FOR SELECT USING (true);

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
GRANT SELECT ON public.org_subscriptions TO authenticated;
GRANT ALL ON public.org_subscriptions TO service_role;
ALTER TABLE public.org_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subs_member_select ON public.org_subscriptions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));
CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON public.org_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

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
GRANT SELECT ON public.billing_payments TO authenticated;
GRANT ALL ON public.billing_payments TO service_role;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY pay_member_select ON public.billing_payments FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

-- Seed baseline plans
INSERT INTO public.billing_plans (code, name, description, price_cents, currency, interval, features) VALUES
  ('free','Nyrava Free','Evaluación limitada',0,'MXN','month','{"matters_limit":5,"documents_limit":50}'),
  ('starter','Nyrava Starter','Despacho individual',49900,'MXN','month','{"matters_limit":100,"documents_limit":2000}'),
  ('pro','Nyrava Pro','Despachos medianos',149900,'MXN','month','{"matters_limit":1000,"documents_limit":25000}'),
  ('enterprise','Nyrava Enterprise','Firmas y corporativos',0,'MXN','month','{"matters_limit":null,"documents_limit":null,"contact_sales":true}')
ON CONFLICT (code) DO NOTHING;

-- 7. Audit log expansion ----------------------------------------------------
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Allow authenticated audit inserts (server enforces org via triggers/functions)
DROP POLICY IF EXISTS audit_insert_self ON public.audit_log;
CREATE POLICY audit_insert_self ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND (org_id IS NULL OR public.is_org_member(auth.uid(), org_id)));

-- 8. Performance indexes ----------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_matters_org_status ON public.matters(org_id, status) WHERE deleted_at IS NULL;
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

REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) TO authenticated, service_role;
