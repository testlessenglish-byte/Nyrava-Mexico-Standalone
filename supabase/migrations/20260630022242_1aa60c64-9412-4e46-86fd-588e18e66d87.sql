ALTER TABLE public.agent_logs
  ADD COLUMN IF NOT EXISTS documents_analyzed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_generated INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_suppressed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_promoted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS findings_produced INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_items INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_output_reason TEXT;

CREATE INDEX IF NOT EXISTS agent_logs_output_idx
  ON public.agent_logs(case_id, run_id, agent_index, findings_produced);