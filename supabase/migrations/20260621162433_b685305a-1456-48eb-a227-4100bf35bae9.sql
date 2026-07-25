
-- ============ case_perspectives ============
CREATE TABLE IF NOT EXISTS public.case_perspectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  perspective text NOT NULL CHECK (perspective IN ('defense','prosecution','plaintiff','respondent','appellate','jury','independent')),
  summary text,
  strengths jsonb DEFAULT '[]'::jsonb,
  weaknesses jsonb DEFAULT '[]'::jsonb,
  opposing_arguments jsonb DEFAULT '[]'::jsonb,
  counter_arguments jsonb DEFAULT '[]'::jsonb,
  key_evidence jsonb DEFAULT '[]'::jsonb,
  recommended_actions jsonb DEFAULT '[]'::jsonb,
  strength_score int,
  risk_score int,
  confidence numeric,
  confidence_label text CHECK (confidence_label IN ('confirmed','likely','possible','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, perspective)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_perspectives TO authenticated;
GRANT ALL ON public.case_perspectives TO service_role;
ALTER TABLE public.case_perspectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perspectives owner full" ON public.case_perspectives FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER case_perspectives_updated BEFORE UPDATE ON public.case_perspectives
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS case_perspectives_case_idx ON public.case_perspectives (case_id);

-- ============ evidence_classifications ============
CREATE TABLE IF NOT EXISTS public.evidence_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  classification text NOT NULL CHECK (classification IN
    ('corroborating','contradictory','weak','missing','undisclosed','brady','chain_of_custody','timeline_inconsistency')),
  title text NOT NULL,
  description text,
  severity text CHECK (severity IN ('low','medium','high','critical')),
  confidence_label text CHECK (confidence_label IN ('confirmed','likely','possible','unknown')),
  confidence numeric,
  affected_party text,
  citations jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_classifications TO authenticated;
GRANT ALL ON public.evidence_classifications TO service_role;
ALTER TABLE public.evidence_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence_class owner full" ON public.evidence_classifications FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS evidence_class_case_idx ON public.evidence_classifications (case_id);

-- ============ case_strategy ============
CREATE TABLE IF NOT EXISTS public.case_strategy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  perspective text NOT NULL DEFAULT 'independent',
  summary text,
  motion_rankings jsonb DEFAULT '[]'::jsonb,
  anticipated_opposing jsonb DEFAULT '[]'::jsonb,
  counter_arguments jsonb DEFAULT '[]'::jsonb,
  next_actions jsonb DEFAULT '[]'::jsonb,
  case_strength_score int,
  risk_score int,
  confidence_label text CHECK (confidence_label IN ('confirmed','likely','possible','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, perspective)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_strategy TO authenticated;
GRANT ALL ON public.case_strategy TO service_role;
ALTER TABLE public.case_strategy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "strategy owner full" ON public.case_strategy FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER case_strategy_updated BEFORE UPDATE ON public.case_strategy
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS case_strategy_case_idx ON public.case_strategy (case_id);

-- Track timestamps on cases for these new engines.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS perspectives_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_intel_at timestamptz,
  ADD COLUMN IF NOT EXISTS strategy_at timestamptz;
