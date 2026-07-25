
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS additional_domains text[] NOT NULL DEFAULT '{}'::text[];

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

CREATE INDEX IF NOT EXISTS case_domain_activations_case_idx
  ON public.case_domain_activations(case_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_domain_activations TO authenticated;
GRANT ALL ON public.case_domain_activations TO service_role;

ALTER TABLE public.case_domain_activations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read activations" ON public.case_domain_activations;
CREATE POLICY "owners read activations"
  ON public.case_domain_activations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS "owners write activations" ON public.case_domain_activations;
CREATE POLICY "owners write activations"
  ON public.case_domain_activations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));
