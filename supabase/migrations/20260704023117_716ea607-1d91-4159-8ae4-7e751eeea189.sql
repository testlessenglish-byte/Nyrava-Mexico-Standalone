-- Phase 1: Pipeline ledger — expand pipeline_engine_runs with observability fields
-- Phase 2: Add explicit 'blocked' status so downstream engines can distinguish
--          "never ran" from "upstream failure prevented execution"

ALTER TABLE public.pipeline_engine_runs
  DROP CONSTRAINT IF EXISTS pipeline_engine_runs_status_check;

ALTER TABLE public.pipeline_engine_runs
  ADD CONSTRAINT pipeline_engine_runs_status_check
  CHECK (status = ANY (ARRAY['queued','running','completed','failed','skipped','blocked']));

ALTER TABLE public.pipeline_engine_runs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS tokens_in integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_out integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS db_write_confirmed boolean,
  ADD COLUMN IF NOT EXISTS rows_written integer,
  ADD COLUMN IF NOT EXISTS parent_engine text,
  ADD COLUMN IF NOT EXISTS blocking_engines text[],
  ADD COLUMN IF NOT EXISTS dependency_status text;

CREATE INDEX IF NOT EXISTS pipeline_engine_runs_case_created_idx
  ON public.pipeline_engine_runs (case_id, created_at DESC);