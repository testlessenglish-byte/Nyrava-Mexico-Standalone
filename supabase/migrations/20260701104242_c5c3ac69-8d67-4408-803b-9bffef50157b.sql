
CREATE TABLE public.case_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  canonical_id text NOT NULL,
  event_date text,
  description text,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_page int,
  superseded_by uuid REFERENCES public.case_timeline_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_timeline_events_case_canonical_key UNIQUE (case_id, canonical_id)
);

CREATE INDEX case_timeline_events_case_active_idx
  ON public.case_timeline_events (case_id)
  WHERE superseded_by IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.case_timeline_events TO authenticated;
GRANT ALL ON public.case_timeline_events TO service_role;

ALTER TABLE public.case_timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view timeline events for their own cases"
  ON public.case_timeline_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users insert timeline events for their own cases"
  ON public.case_timeline_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users update timeline events for their own cases"
  ON public.case_timeline_events FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_id AND c.user_id = auth.uid()));

CREATE TRIGGER case_timeline_events_set_updated_at
  BEFORE UPDATE ON public.case_timeline_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
