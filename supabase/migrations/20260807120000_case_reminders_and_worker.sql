-- Reminders for calendar events and task deadlines. Subscribers can enable a
-- reminder on any hearing/event or task deadline, choose how far in advance
-- it fires, and pick delivery channels (in-app/browser notification and/or
-- email to their account address). A background worker (pg_cron, same
-- pattern as nyrava-pipeline-worker) fires due reminders on a schedule.

ALTER TABLE public.case_events
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] NOT NULL DEFAULT ARRAY['browser']::TEXT[],
  ADD COLUMN IF NOT EXISTS reminder_fired_at TIMESTAMPTZ;

ALTER TABLE public.case_tasks
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS reminder_channels TEXT[] NOT NULL DEFAULT ARRAY['browser']::TEXT[],
  ADD COLUMN IF NOT EXISTS reminder_fired_at TIMESTAMPTZ;

-- Guard against garbage channel values slipping in outside the app layer.
ALTER TABLE public.case_events DROP CONSTRAINT IF EXISTS case_events_reminder_channels_check;
ALTER TABLE public.case_events
  ADD CONSTRAINT case_events_reminder_channels_check
  CHECK (reminder_channels <@ ARRAY['browser','email']::TEXT[]);

ALTER TABLE public.case_tasks DROP CONSTRAINT IF EXISTS case_tasks_reminder_channels_check;
ALTER TABLE public.case_tasks
  ADD CONSTRAINT case_tasks_reminder_channels_check
  CHECK (reminder_channels <@ ARRAY['browser','email']::TEXT[]);

CREATE INDEX IF NOT EXISTS idx_case_events_reminder_due
  ON public.case_events (scheduled_at)
  WHERE reminder_enabled AND reminder_fired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_case_tasks_reminder_due
  ON public.case_tasks (due_date)
  WHERE reminder_enabled AND reminder_fired_at IS NULL;

-- Worker secret + cron job, following the exact pattern used for
-- nyrava-pipeline-worker (worker_secrets table, x-worker-secret header,
-- service-role-only access).
INSERT INTO public.worker_secrets (name, secret)
VALUES ('reminders_worker', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  _secret TEXT;
BEGIN
  SELECT secret INTO _secret FROM public.worker_secrets WHERE name = 'reminders_worker';
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nyrava-reminders-worker';
  PERFORM cron.schedule(
    'nyrava-reminders-worker',
    '*/5 * * * *',
    format($cmd$
      SELECT net.http_post(
        url := 'https://mexico.nyrava.com/api/public/hooks/reminders-worker',
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
    $cmd$, jsonb_build_object('Content-Type','application/json','x-worker-secret', _secret)::text)
  );
END $$;
