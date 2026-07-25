
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

CREATE INDEX image_intelligence_case_idx ON public.image_intelligence (case_id);
CREATE INDEX image_intelligence_doc_idx  ON public.image_intelligence (document_id);

GRANT SELECT, INSERT ON public.image_intelligence TO authenticated;
GRANT ALL ON public.image_intelligence TO service_role;

ALTER TABLE public.image_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view image intelligence for their own cases"
  ON public.image_intelligence FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users insert image intelligence for their own cases"
  ON public.image_intelligence FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));
