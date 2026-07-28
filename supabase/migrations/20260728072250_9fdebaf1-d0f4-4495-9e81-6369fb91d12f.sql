-- PRD Phase 2 — Universal Practice Area Architecture: core Parties capability.
CREATE TABLE IF NOT EXISTS public.case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  party_role text NOT NULL DEFAULT 'otro',
  name text NOT NULL,
  role_description text,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_parties TO authenticated;
GRANT ALL ON public.case_parties TO service_role;

ALTER TABLE public.case_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parties all" ON public.case_parties
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS case_parties_case_id_idx ON public.case_parties(case_id);

CREATE TRIGGER case_parties_set_updated_at
  BEFORE UPDATE ON public.case_parties
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();