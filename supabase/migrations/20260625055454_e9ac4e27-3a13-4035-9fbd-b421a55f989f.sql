
CREATE TABLE public.pipeline_engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  engine text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','skipped')),
  started_at timestamptz,
  ended_at timestamptz,
  runtime_ms integer,
  generated integer NOT NULL DEFAULT 0,
  accepted integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  suppressed_ess integer NOT NULL DEFAULT 0,
  suppressed_validator integer NOT NULL DEFAULT 0,
  skipped_reason text,
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_engine_runs_case ON public.pipeline_engine_runs(case_id, created_at DESC);
CREATE INDEX idx_pipeline_engine_runs_engine ON public.pipeline_engine_runs(case_id, engine);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_engine_runs TO authenticated;
GRANT ALL ON public.pipeline_engine_runs TO service_role;

ALTER TABLE public.pipeline_engine_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own engine runs"
  ON public.pipeline_engine_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own engine runs"
  ON public.pipeline_engine_runs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own engine runs"
  ON public.pipeline_engine_runs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own engine runs"
  ON public.pipeline_engine_runs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_pipeline_engine_runs_updated_at
  BEFORE UPDATE ON public.pipeline_engine_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS scores_suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motions_suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS engines_summary jsonb NOT NULL DEFAULT '{}'::jsonb;
