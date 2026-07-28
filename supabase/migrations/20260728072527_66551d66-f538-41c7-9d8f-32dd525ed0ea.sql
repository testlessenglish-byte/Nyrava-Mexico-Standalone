-- PRD Phase 3 (core Communications capability) — Universal Practice Area Architecture.
CREATE TABLE IF NOT EXISTS public.case_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'internal_note',
  direction text NOT NULL DEFAULT 'internal'
    CHECK (direction IN ('outbound','inbound','internal')),
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_review','sent','logged')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_communications TO authenticated;
GRANT ALL ON public.case_communications TO service_role;
ALTER TABLE public.case_communications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "communications all" ON public.case_communications
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS case_communications_case_id_idx ON public.case_communications(case_id);
CREATE TRIGGER case_communications_set_updated_at
  BEFORE UPDATE ON public.case_communications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();