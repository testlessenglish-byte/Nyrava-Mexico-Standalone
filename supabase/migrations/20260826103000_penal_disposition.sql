-- First-class structured final disposition for Penal-origin cases.

CREATE TABLE IF NOT EXISTS public.case_penal_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  court text,
  decision_date date,
  status text,
  result text,
  operative_orders jsonb NOT NULL DEFAULT '[]'::jsonb,
  conviction_status text,
  sentence_status text,
  amparo_result text,
  remand boolean NOT NULL DEFAULT false,
  remand_court text,
  remand_instructions jsonb NOT NULL DEFAULT '[]'::jsonb,
  procedure_reopened boolean,
  source_document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  source_page integer,
  source_quote text NOT NULL,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.case_penal_dispositions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_penal_dispositions TO authenticated;
GRANT ALL ON public.case_penal_dispositions TO service_role;

DROP POLICY IF EXISTS case_penal_dispositions_owner_all
  ON public.case_penal_dispositions;
CREATE POLICY case_penal_dispositions_owner_all
  ON public.case_penal_dispositions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid() AND private.owns_case(case_id))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

CREATE INDEX IF NOT EXISTS case_penal_dispositions_case_idx
  ON public.case_penal_dispositions(case_id);

COMMENT ON TABLE public.case_penal_dispositions IS
  'Grounded structured dispositive for Penal-origin cases. Rebuilt on rerun so prior outcomes cannot leak into a new report.';
