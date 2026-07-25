-- Reschedule the pipeline-worker cron job to point at the live custom domain
-- (nyrava.com) instead of the stale Lovable preview/project-ID URL it was
-- created with on 2026-07-01. That URL (project--<uuid>.lovable.app) has
-- not matched the published app since the domain move to nyrava.com, which
-- means every worker.pipeline_worker tick has been POSTing into a dead
-- endpoint — the background worker has effectively not been running at all,
-- leaving the client-side self-drive tab loop and the manual "Resume"
-- button as the only things actually advancing cases.
--
-- Verify BEFORE and AFTER with the queries in diagnose_cron_worker.sql —
-- in particular, net._http_response rows should start showing status_code
-- 200 within a couple of minutes of this migration running.

DO $$
DECLARE
  _secret TEXT;
BEGIN
  SELECT secret INTO _secret FROM public.worker_secrets WHERE name = 'pipeline_worker';

  IF _secret IS NULL THEN
    RAISE EXCEPTION 'worker_secrets row for pipeline_worker not found — cannot reschedule cron job safely.';
  END IF;

  PERFORM cron.unschedule('nyrava-pipeline-worker');

  PERFORM cron.schedule(
    'nyrava-pipeline-worker',
    '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := 'https://nyrava.com/api/public/hooks/pipeline-worker',
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
    $cmd$, jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', _secret)::text)
  );
END $$;

-- Sanity check: confirm the job is active and now points at nyrava.com.
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname = 'nyrava-pipeline-worker';
