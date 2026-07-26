-- REAL FIX (not a workaround): the existing pipeline-worker cron job was
-- scheduled to POST to https://nyrava.com — the USA site's real production
-- domain. This was written for the USA codebase and carried over unchanged
-- during the fork to Mexico. Every single minute, Mexico's own database has
-- been telling pg_cron to ping the USA site instead of Mexico's own worker
-- endpoint — meaning the background worker has never actually advanced a
-- single Mexican case. This is why checkpointed stages ("will resume on
-- next worker tick") never resume: there was never a real tick pointed at
-- this project at all.
--
-- This reschedules the job to the correct URL: this project's own live,
-- published site. Run this once in the SQL Editor.

-- Ensure the required extensions are actually enabled (idempotent either way).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  _secret TEXT;
BEGIN
  SELECT secret INTO _secret FROM public.worker_secrets WHERE name = 'pipeline_worker';

  IF _secret IS NULL THEN
    RAISE EXCEPTION 'worker_secrets row for pipeline_worker not found — cannot reschedule cron job safely.';
  END IF;

  -- Remove any existing schedule for this job name (whether it was pointed
  -- at nyrava.com or anywhere else) before creating the correct one.
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nyrava-pipeline-worker';

  PERFORM cron.schedule(
    'nyrava-pipeline-worker',
    '* * * * *', -- every minute
    format($cmd$
      SELECT net.http_post(
        url := 'https://nyravamexico.lovable.app/api/public/hooks/pipeline-worker',
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
    $cmd$, jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', _secret)::text)
  );
END $$;

-- Verify: confirm the job is active and now points at the correct Mexico URL.
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname = 'nyrava-pipeline-worker';
