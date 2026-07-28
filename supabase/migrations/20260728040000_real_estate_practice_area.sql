-- =============================================================================
-- REAL ESTATE PRACTICE AREA (inmobiliario) — Phase 2 data model.
--
-- Companion tables for the `inmobiliario` materia registered in Phase 1
-- (src/lib/jurisdiction/mexico*.ts). A real-estate case is still a row in
-- `public.cases` with case_type = 'inmobiliario' — these three tables hold
-- the transaction-specific state that has no analogue in litigation cases:
--   - property_records:   the Property Intelligence Panel fields (1:1 per case)
--   - verification_items: the Verification Center (many per case)
--   - closing_milestones: the Closing Readiness score (many per case)
--
-- RLS follows the exact pattern already used by public.documents and
-- public.analyses: denormalized user_id for a direct ownership check,
-- has_role(admin) bypass, no cross-case joins required at query time.
-- =============================================================================

CREATE TABLE public.property_records (
  case_id uuid PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address text,
  municipality text,
  state text,
  country text NOT NULL DEFAULT 'MX',
  folio_real text,
  cuenta_predial text,
  catastro_id text,
  property_type text,
  purchase_price numeric,
  buyer_name text,
  seller_name text,
  closing_date date,
  notary text,
  foreign_buyer boolean NOT NULL DEFAULT false,
  fideicomiso boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_records TO authenticated;
GRANT ALL ON public.property_records TO service_role;
ALTER TABLE public.property_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "property_records all" ON public.property_records FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER property_records_updated BEFORE UPDATE ON public.property_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------------------------------------------------------------------------

CREATE TYPE public.verification_category AS ENUM (
  'ownership', 'registry', 'catastro', 'predial', 'water', 'cfe', 'hoa',
  'mortgage', 'permits', 'corporate_authority', 'environmental'
);

CREATE TYPE public.verification_status AS ENUM (
  'verified', 'pending', 'missing', 'issue_found'
);

-- Per §3.10 of the integration plan: every verification category must be
-- attorney-visible about HOW its status was produced, not just what it is.
-- Most Mexican registries/utilities have no public API (see plan §5), so
-- 'connected' is expected to be rare — that's a fact about Mexico, not a
-- gap to hide behind a fake status.
CREATE TYPE public.verification_mode AS ENUM ('connected', 'document', 'manual');

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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.verification_items TO authenticated;
GRANT ALL ON public.verification_items TO service_role;
ALTER TABLE public.verification_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "verification_items all" ON public.verification_items FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER verification_items_updated BEFORE UPDATE ON public.verification_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX verification_items_case_idx ON public.verification_items(case_id);

-- ---------------------------------------------------------------------------

-- Backs the Closing Readiness score — the inmobiliario materia's
-- readiness_metric (weighted, not the litigation Case Strength/Trial
-- Readiness scoring). One row per milestone in the sequence registered in
-- src/lib/intelligence/mx-procedural-stages.ts (due_diligence,
-- firma_escritura, pago_isai, inscripcion_rpp, cierre).
CREATE TABLE public.closing_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone_key text NOT NULL,
  label_es text NOT NULL,
  label_en text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  percent_complete numeric NOT NULL DEFAULT 0 CHECK (percent_complete >= 0 AND percent_complete <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, milestone_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_milestones TO authenticated;
GRANT ALL ON public.closing_milestones TO service_role;
ALTER TABLE public.closing_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "closing_milestones all" ON public.closing_milestones FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER closing_milestones_updated BEFORE UPDATE ON public.closing_milestones
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX closing_milestones_case_idx ON public.closing_milestones(case_id);

-- ---------------------------------------------------------------------------

-- Closing Readiness = weighted average of percent_complete across a case's
-- milestones. Exposed as a function (not a stored/generated column) so the
-- UI and any future report/engine call the same single source of truth
-- instead of recomputing the weighted average independently in JS.
CREATE OR REPLACE FUNCTION public.closing_readiness(p_case_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN COALESCE(SUM(weight), 0) = 0 THEN NULL
    ELSE ROUND(SUM(percent_complete * weight) / SUM(weight), 1)
  END
  FROM public.closing_milestones
  WHERE case_id = p_case_id;
$$;
