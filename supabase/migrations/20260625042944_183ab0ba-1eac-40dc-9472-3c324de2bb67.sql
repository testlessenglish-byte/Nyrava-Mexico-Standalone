
-- Per-page document text so quotes/citations can be verified
CREATE TABLE IF NOT EXISTS public.document_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  page integer NOT NULL,
  text text NOT NULL DEFAULT '',
  char_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_pages TO authenticated;
GRANT ALL ON public.document_pages TO service_role;

ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pages owner all"
  ON public.document_pages FOR ALL
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS document_pages_case_idx ON public.document_pages(case_id);
CREATE INDEX IF NOT EXISTS document_pages_doc_idx ON public.document_pages(document_id, page);

-- Verification metadata on findings
ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unchecked',
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- Hallucination report on cases
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS hallucination_report jsonb,
  ADD COLUMN IF NOT EXISTS hallucination_at timestamptz;
