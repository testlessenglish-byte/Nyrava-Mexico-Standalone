
-- 1) Worker secrets table (service-role-only access)
CREATE TABLE IF NOT EXISTS public.worker_secrets (
  name TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON public.worker_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.worker_secrets TO service_role;
ALTER TABLE public.worker_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (bypasses RLS) can read/write.

-- Seed a random secret for the pipeline worker if not present
INSERT INTO public.worker_secrets (name, secret)
VALUES ('pipeline_worker', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

-- 2) Reschedule pg_cron job to send the secret in x-worker-secret header
DO $$
DECLARE
  _secret TEXT;
BEGIN
  SELECT secret INTO _secret FROM public.worker_secrets WHERE name = 'pipeline_worker';
  PERFORM cron.unschedule('nyrava-pipeline-worker');
  PERFORM cron.schedule(
    'nyrava-pipeline-worker',
    '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := 'https://project--32eba6e3-54e6-45c5-84e3-7ca2343ca38b.lovable.app/api/public/hooks/pipeline-worker',
        headers := %L::jsonb,
        body := '{}'::jsonb
      );
    $cmd$, jsonb_build_object('Content-Type','application/json','x-worker-secret', _secret)::text)
  );
END $$;

-- 3) Lock down SECURITY DEFINER helpers so anon cannot execute them
REVOKE EXECUTE ON FUNCTION public.resolve_firm_for_email(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.same_firm(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_stamp_case_firm() FROM PUBLIC, anon;
-- Keep authenticated + service_role able to use them where needed
GRANT EXECUTE ON FUNCTION public.same_firm(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_firm_for_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_stamp_case_firm() TO service_role;
