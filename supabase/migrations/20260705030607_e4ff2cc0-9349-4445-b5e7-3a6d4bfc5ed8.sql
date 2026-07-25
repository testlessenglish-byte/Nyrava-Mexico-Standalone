ALTER TABLE public.pipeline_engine_runs
  DROP CONSTRAINT IF EXISTS pipeline_engine_runs_status_check;
ALTER TABLE public.pipeline_engine_runs
  ADD CONSTRAINT pipeline_engine_runs_status_check
  CHECK (status = ANY (ARRAY['queued','running','completed','completed_negative','failed','skipped','blocked']));