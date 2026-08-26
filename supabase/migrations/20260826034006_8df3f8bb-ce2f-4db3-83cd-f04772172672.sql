-- Phase 1 safe security hardening: additive compliance infrastructure only.
-- No existing table, policy, grant, or function is modified by this migration.

-- ---------------------------------------------------------------
-- 1. Security incident register (platform administrators only)
-- ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.security_incident_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.security_incident_status AS ENUM ('open','triage','contained','investigating','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

GRANT SELECT, INSERT, UPDATE ON public.security_incidents TO authenticated;
GRANT ALL ON public.security_incidents TO service_role;
ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_incidents_admin_select ON public.security_incidents;
CREATE POLICY security_incidents_admin_select ON public.security_incidents
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

DROP POLICY IF EXISTS security_incidents_admin_insert ON public.security_incidents;
CREATE POLICY security_incidents_admin_insert ON public.security_incidents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()) AND created_by = auth.uid());

DROP POLICY IF EXISTS security_incidents_admin_update ON public.security_incidents;
CREATE POLICY security_incidents_admin_update ON public.security_incidents
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

DROP TRIGGER IF EXISTS trg_security_incidents_updated_at ON public.security_incidents;
CREATE TRIGGER trg_security_incidents_updated_at
  BEFORE UPDATE ON public.security_incidents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS security_incidents_status_idx ON public.security_incidents (status, discovered_at DESC);

-- ---------------------------------------------------------------
-- 2. Legal / privacy document version registry
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,
  version text NOT NULL,
  language text NOT NULL DEFAULT 'es',
  effective_date date NOT NULL DEFAULT current_date,
  document_hash text NOT NULL,
  source_url text,
  summary text,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_document_versions_type_check CHECK (
    document_type IN ('aviso_privacidad','terms','ai_transparency','data_processing','acceptable_use')
  ),
  CONSTRAINT legal_document_versions_lang_check CHECK (language IN ('es','en')),
  CONSTRAINT legal_document_versions_unique UNIQUE (document_type, version, language)
);

GRANT SELECT ON public.legal_document_versions TO authenticated;
GRANT INSERT, UPDATE ON public.legal_document_versions TO authenticated;
GRANT ALL ON public.legal_document_versions TO service_role;
ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legal_document_versions_read_active ON public.legal_document_versions;
CREATE POLICY legal_document_versions_read_active ON public.legal_document_versions
  FOR SELECT TO authenticated
  USING (is_active OR (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid())));

DROP POLICY IF EXISTS legal_document_versions_admin_insert ON public.legal_document_versions;
CREATE POLICY legal_document_versions_admin_insert ON public.legal_document_versions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

DROP POLICY IF EXISTS legal_document_versions_admin_update ON public.legal_document_versions;
CREATE POLICY legal_document_versions_admin_update ON public.legal_document_versions
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

DROP TRIGGER IF EXISTS trg_legal_document_versions_updated_at ON public.legal_document_versions;
CREATE TRIGGER trg_legal_document_versions_updated_at
  BEFORE UPDATE ON public.legal_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------------------------------------------------------------
-- 3. Consent records (infrastructure only; no enforcement yet)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid,
  document_type text NOT NULL,
  document_version text NOT NULL,
  document_hash text,
  language text NOT NULL DEFAULT 'es',
  consent_type text NOT NULL DEFAULT 'acceptance',
  purpose text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_consents_type_check CHECK (
    document_type IN ('aviso_privacidad','terms','ai_transparency','data_processing','acceptable_use')
  ),
  CONSTRAINT user_consents_consent_type_check CHECK (
    consent_type IN ('acceptance','acknowledgment','explicit_consent','sensitive_data_consent','transfer_consent')
  )
);

GRANT SELECT, INSERT, UPDATE ON public.user_consents TO authenticated;
GRANT ALL ON public.user_consents TO service_role;
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_consents_select_own ON public.user_consents;
CREATE POLICY user_consents_select_own ON public.user_consents
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin_tier(auth.uid())));

DROP POLICY IF EXISTS user_consents_insert_own ON public.user_consents;
CREATE POLICY user_consents_insert_own ON public.user_consents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS user_consents_update_own ON public.user_consents;
CREATE POLICY user_consents_update_own ON public.user_consents
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_user_consents_updated_at ON public.user_consents;
CREATE TRIGGER trg_user_consents_updated_at
  BEFORE UPDATE ON public.user_consents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS user_consents_user_idx ON public.user_consents (user_id, document_type, granted_at DESC);

-- ---------------------------------------------------------------
-- 4. ARCO request intake / tracking (no destructive automation)
-- ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.arco_request_type AS ENUM ('acceso','rectificacion','cancelacion','oposicion','revocacion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.arco_request_status AS ENUM ('received','identity_pending','in_review','awaiting_information','resolved','rejected','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

GRANT SELECT, INSERT, UPDATE ON public.arco_requests TO authenticated;
GRANT ALL ON public.arco_requests TO service_role;
ALTER TABLE public.arco_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS arco_requests_select_own ON public.arco_requests;
CREATE POLICY arco_requests_select_own ON public.arco_requests
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_admin_tier(auth.uid())));

DROP POLICY IF EXISTS arco_requests_insert_own ON public.arco_requests;
CREATE POLICY arco_requests_insert_own ON public.arco_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS arco_requests_admin_update ON public.arco_requests;
CREATE POLICY arco_requests_admin_update ON public.arco_requests
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_admin_tier(auth.uid()));

DROP TRIGGER IF EXISTS trg_arco_requests_updated_at ON public.arco_requests;
CREATE TRIGGER trg_arco_requests_updated_at
  BEFORE UPDATE ON public.arco_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS arco_requests_status_idx ON public.arco_requests (status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.arco_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.arco_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  notes text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.arco_request_events TO authenticated;
GRANT ALL ON public.arco_request_events TO service_role;
ALTER TABLE public.arco_request_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS arco_request_events_select ON public.arco_request_events;
CREATE POLICY arco_request_events_select ON public.arco_request_events
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.arco_requests r
      WHERE r.id = arco_request_events.request_id
        AND (r.user_id = auth.uid() OR public.is_admin_tier(auth.uid()))
    )
  );

DROP POLICY IF EXISTS arco_request_events_insert ON public.arco_request_events;
CREATE POLICY arco_request_events_insert ON public.arco_request_events
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND actor_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.arco_requests r
      WHERE r.id = arco_request_events.request_id
        AND (r.user_id = auth.uid() OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE INDEX IF NOT EXISTS arco_request_events_request_idx ON public.arco_request_events (request_id, created_at DESC);

REVOKE ALL ON public.security_incidents FROM anon;
REVOKE ALL ON public.legal_document_versions FROM anon;
REVOKE ALL ON public.user_consents FROM anon;
REVOKE ALL ON public.arco_requests FROM anon;
REVOKE ALL ON public.arco_request_events FROM anon;