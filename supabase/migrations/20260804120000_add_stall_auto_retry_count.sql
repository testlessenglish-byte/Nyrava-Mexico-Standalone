-- Bounded auto-retry counter for the stall watchdog (pipeline-stall.server.ts).
-- Previously every stalled case was force-failed and left for a human to
-- click "Resume" -- the exact "stuck in generation" symptom this column
-- exists to fix. Bounded (not unconditional) so a case whose stall cause is
-- deterministic (e.g. a stage that always hangs) doesn't retry forever and
-- burn AI spend -- after MAX_AUTO_STALL_RETRIES it falls back to the
-- existing manual-resume path.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS stall_auto_retry_count integer NOT NULL DEFAULT 0;
