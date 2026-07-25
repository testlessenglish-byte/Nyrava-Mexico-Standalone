
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
