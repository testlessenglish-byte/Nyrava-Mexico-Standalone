
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS change_log jsonb;

CREATE TABLE IF NOT EXISTS public.report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  change_log jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_versions TO authenticated;
GRANT ALL ON public.report_versions TO service_role;

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_versions owner read"
  ON public.report_versions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "report_versions owner write"
  ON public.report_versions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS report_versions_case_idx
  ON public.report_versions (case_id, version DESC);
