-- =============================================================================
-- Migration: Execution Identity & Single-Worker Atomic Claiming
--
-- 1. Adds `execution_id` column to `public.pipeline_engine_runs` to establish
--    strict execution-boundary isolation between runs/reruns.
-- 2. Provides atomic, row-locking RPC functions (`claim_case_for_execution`,
--    `claim_next_queued_case`, `renew_execution_lease`) using FOR UPDATE SKIP LOCKED.
-- 3. Ensures an old/stale worker from Execution A can NEVER write to or renew
--    a lease on Execution B.
-- =============================================================================

-- Add execution_id to pipeline_engine_runs
ALTER TABLE public.pipeline_engine_runs
  ADD COLUMN IF NOT EXISTS execution_id UUID;

CREATE INDEX IF NOT EXISTS idx_pipeline_engine_runs_case_execution
  ON public.pipeline_engine_runs (case_id, execution_id);

CREATE INDEX IF NOT EXISTS idx_cases_queued_lease
  ON public.cases (status, queued_at, worker_lease_until)
  WHERE status = 'queued';

-- Function: claim_case_for_execution (Single case claim with atomic FOR UPDATE)
CREATE OR REPLACE FUNCTION public.claim_case_for_execution(
  p_case_id UUID,
  p_lease_ms INTEGER DEFAULT 180000, -- 3 minutes default lease
  p_worker_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  claimed BOOLEAN,
  case_id UUID,
  user_id UUID,
  next_stage TEXT,
  execution_id UUID
) AS $$
DECLARE
  v_row RECORD;
  v_lease_until TIMESTAMPTZ := now() + (GREATEST(30000, LEAST(p_lease_ms, 1200000)) || ' milliseconds')::INTERVAL;
  v_exec_id UUID;
BEGIN
  -- Row-level lock acquisition (skips if locked by another concurrent transaction)
  SELECT c.id, c.user_id, c.next_stage, c.status, c.worker_lease_until, c.execution_id
  INTO v_row
  FROM public.cases c
  WHERE c.id = p_case_id
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Verify active lease (if leased by another worker and unexpired, do not steal)
  IF v_row.worker_lease_until IS NOT NULL AND v_row.worker_lease_until > now() THEN
    RETURN QUERY SELECT false, v_row.id, v_row.user_id, v_row.next_stage, v_row.execution_id;
    RETURN;
  END IF;

  -- Ensure valid execution_id
  v_exec_id := COALESCE(v_row.execution_id, gen_random_uuid());

  UPDATE public.cases
  SET 
    worker_lease_until = v_lease_until,
    status = 'intelligence_running',
    status_message = 'Worker executing pipeline',
    execution_id = v_exec_id,
    execution_started_at = COALESCE(execution_started_at, now()),
    updated_at = now()
  WHERE id = p_case_id;

  RETURN QUERY SELECT true, v_row.id, v_row.user_id, v_row.next_stage, v_exec_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: claim_next_queued_case (Worker queue drain with atomic FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_next_queued_case(
  p_lease_ms INTEGER DEFAULT 180000, -- 3 minutes default lease
  p_worker_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  claimed BOOLEAN,
  case_id UUID,
  user_id UUID,
  next_stage TEXT,
  execution_id UUID
) AS $$
DECLARE
  v_row RECORD;
  v_lease_until TIMESTAMPTZ := now() + (GREATEST(30000, LEAST(p_lease_ms, 1200000)) || ' milliseconds')::INTERVAL;
  v_exec_id UUID;
BEGIN
  -- Find and lock the oldest queued case that has no active lease
  SELECT c.id, c.user_id, c.next_stage, c.status, c.worker_lease_until, c.execution_id
  INTO v_row
  FROM public.cases c
  WHERE c.status = 'queued'
    AND c.queued_at IS NOT NULL
    AND (c.worker_lease_until IS NULL OR c.worker_lease_until < now())
  ORDER BY c.queued_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  v_exec_id := COALESCE(v_row.execution_id, gen_random_uuid());

  UPDATE public.cases
  SET 
    worker_lease_until = v_lease_until,
    status = 'intelligence_running',
    status_message = 'Worker executing pipeline',
    execution_id = v_exec_id,
    execution_started_at = COALESCE(execution_started_at, now()),
    updated_at = now()
  WHERE id = v_row.id;

  RETURN QUERY SELECT true, v_row.id, v_row.user_id, v_row.next_stage, v_exec_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: renew_execution_lease (Heartbeat with strict execution_id validation)
CREATE OR REPLACE FUNCTION public.renew_execution_lease(
  p_case_id UUID,
  p_execution_id UUID,
  p_lease_ms INTEGER DEFAULT 180000
)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated INTEGER;
  v_lease_until TIMESTAMPTZ := now() + (GREATEST(30000, LEAST(p_lease_ms, 1200000)) || ' milliseconds')::INTERVAL;
BEGIN
  IF p_case_id IS NULL OR p_execution_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.cases
  SET 
    worker_lease_until = v_lease_until,
    updated_at = now()
  WHERE id = p_case_id
    AND execution_id = p_execution_id
    AND status NOT IN ('complete', 'released', 'failed', 'cancelled');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
