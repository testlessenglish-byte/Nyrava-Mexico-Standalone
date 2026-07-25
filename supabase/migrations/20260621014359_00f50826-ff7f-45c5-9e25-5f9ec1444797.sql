
-- Unified Findings Store (Priority 1, 3)
CREATE TABLE public.case_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_module text NOT NULL,          -- 'analyzer:timeline', 'agent:witness_credibility', 'engine:defense_opportunity', etc.
  category text NOT NULL,               -- 'contradiction','missing_evidence','witness','timeline','constitutional','chain_of_custody','procedural','strength','opportunity','recovery','theory','discovery_gap'
  title text NOT NULL,
  description text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',          -- 'critical','high','medium','low','info'
  confidence numeric NOT NULL DEFAULT 0.5,          -- 0..1
  legal_significance text,
  potential_impact text,
  affected_party text,                  -- 'defense','prosecution','both','neutral'
  source_doc_ids uuid[] DEFAULT '{}',
  evidence_refs jsonb DEFAULT '[]'::jsonb,           -- [{label, quote, doc_id}]
  related_finding_ids uuid[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_findings_case_idx ON public.case_findings(case_id, created_at DESC);
CREATE INDEX case_findings_category_idx ON public.case_findings(case_id, category);
CREATE INDEX case_findings_severity_idx ON public.case_findings(case_id, severity);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_findings TO authenticated;
GRANT ALL ON public.case_findings TO service_role;

ALTER TABLE public.case_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "findings select" ON public.case_findings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));
CREATE POLICY "findings insert" ON public.case_findings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "findings update" ON public.case_findings FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));
CREATE POLICY "findings delete" ON public.case_findings FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE TRIGGER tg_case_findings_updated_at
  BEFORE UPDATE ON public.case_findings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Theories (Priority 6)
CREATE TABLE public.case_theories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  theory_type text NOT NULL,            -- 'prosecution','defense','alternative','unknown'
  narrative text NOT NULL,
  supporting_evidence jsonb DEFAULT '[]'::jsonb,
  contradicting_evidence jsonb DEFAULT '[]'::jsonb,
  missing_evidence jsonb DEFAULT '[]'::jsonb,
  confidence numeric DEFAULT 0.5,
  risk text,
  key_assumptions jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, theory_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_theories TO authenticated;
GRANT ALL ON public.case_theories TO service_role;
ALTER TABLE public.case_theories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "theories all" ON public.case_theories FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER tg_case_theories_updated_at BEFORE UPDATE ON public.case_theories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Defense opportunities + prosecution recoveries (Priorities 4, 5)
CREATE TABLE public.case_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  side text NOT NULL,                   -- 'defense','prosecution'
  opportunity_type text NOT NULL,       -- 'suppression','discovery','witness_attack','timeline_attack','evidence_attack','credibility_attack','constitutional','recovery'
  title text NOT NULL,
  description text NOT NULL,
  recommended_motions jsonb DEFAULT '[]'::jsonb,
  recommended_questions jsonb DEFAULT '[]'::jsonb,
  recommended_investigations jsonb DEFAULT '[]'::jsonb,
  counter_response text,
  source_finding_ids uuid[] DEFAULT '{}',
  severity text DEFAULT 'medium',
  confidence numeric DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_opps_case_idx ON public.case_opportunities(case_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_opportunities TO authenticated;
GRANT ALL ON public.case_opportunities TO service_role;
ALTER TABLE public.case_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opps all" ON public.case_opportunities FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER tg_case_opps_updated_at BEFORE UPDATE ON public.case_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Witness intelligence (Priority 8)
CREATE TABLE public.case_witnesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  role text,
  reliability integer,                  -- 0..100
  bias integer,
  consistency integer,
  corroboration integer,
  observation_opportunity integer,
  credibility_risk integer,
  cross_exam_questions jsonb DEFAULT '[]'::jsonb,
  impeachment_questions jsonb DEFAULT '[]'::jsonb,
  follow_up_questions jsonb DEFAULT '[]'::jsonb,
  rationale jsonb DEFAULT '{}'::jsonb,
  source_doc_ids uuid[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_witnesses TO authenticated;
GRANT ALL ON public.case_witnesses TO service_role;
ALTER TABLE public.case_witnesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "witnesses all" ON public.case_witnesses FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER tg_case_witnesses_updated_at BEFORE UPDATE ON public.case_witnesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Case AI chat (Priority 9)
CREATE TABLE public.case_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL,                   -- 'user','assistant','system'
  content text NOT NULL,
  cited_finding_ids uuid[] DEFAULT '{}',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_chat_idx ON public.case_chat_messages(case_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_chat_messages TO authenticated;
GRANT ALL ON public.case_chat_messages TO service_role;
ALTER TABLE public.case_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat all" ON public.case_chat_messages FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

-- Trial preparation + jury simulation + work product (Priorities 10, 11, 12)
CREATE TABLE public.case_trial_prep (
  case_id uuid PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  opening_themes jsonb DEFAULT '[]'::jsonb,
  closing_themes jsonb DEFAULT '[]'::jsonb,
  witness_order jsonb DEFAULT '[]'::jsonb,
  exhibit_order jsonb DEFAULT '[]'::jsonb,
  likely_objections jsonb DEFAULT '[]'::jsonb,
  trial_risks jsonb DEFAULT '[]'::jsonb,
  trial_strengths jsonb DEFAULT '[]'::jsonb,
  jury_concerns jsonb DEFAULT '[]'::jsonb,
  jury_conviction_pct integer,
  jury_acquittal_pct integer,
  jury_appeal_pct integer,
  jury_settlement_pct integer,
  most_persuasive_evidence jsonb DEFAULT '[]'::jsonb,
  most_damaging_evidence jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_trial_prep TO authenticated;
GRANT ALL ON public.case_trial_prep TO service_role;
ALTER TABLE public.case_trial_prep ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trial all" ON public.case_trial_prep FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER tg_trial_prep_updated_at BEFORE UPDATE ON public.case_trial_prep
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

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
CREATE INDEX case_work_idx ON public.case_work_product(case_id, document_type);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_work_product TO authenticated;
GRANT ALL ON public.case_work_product TO service_role;
ALTER TABLE public.case_work_product ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work all" ON public.case_work_product FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER tg_work_updated_at BEFORE UPDATE ON public.case_work_product
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Extend case_scores with explainable contributors columns (Priority 2, 12)
ALTER TABLE public.case_scores
  ADD COLUMN IF NOT EXISTS positive_contributors jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS negative_contributors jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_finding_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dimension_breakdowns jsonb DEFAULT '{}'::jsonb;

-- Extend cases with new pipeline timestamps
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS theories_at timestamptz,
  ADD COLUMN IF NOT EXISTS opportunities_at timestamptz,
  ADD COLUMN IF NOT EXISTS witnesses_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_prep_at timestamptz;
