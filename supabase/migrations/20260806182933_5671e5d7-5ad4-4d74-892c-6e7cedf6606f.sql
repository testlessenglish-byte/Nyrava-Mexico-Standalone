ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS execution_id uuid;

CREATE INDEX IF NOT EXISTS reports_execution_id_idx ON public.reports (execution_id);