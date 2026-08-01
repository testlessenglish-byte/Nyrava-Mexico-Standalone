-- 1. Resolve pre-existing duplicate active rows so the unique index can be built.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY case_id, engine
           ORDER BY created_at DESC, id DESC
         ) AS rn
    FROM public.pipeline_engine_runs
   WHERE status IN ('queued', 'running')
)
UPDATE public.pipeline_engine_runs r
   SET status = 'failed',
       error = COALESCE(r.error, 'superseded_duplicate_active_run'),
       ended_at = COALESCE(r.ended_at, now()),
       meta = r.meta || jsonb_build_object('superseded_by_duplicate_guard', true),
       updated_at = now()
  FROM ranked
 WHERE ranked.id = r.id
   AND ranked.rn > 1;

-- 2. Atomic guard: at most one active (queued/running) run per (case_id, engine).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pipeline_engine_runs_active
  ON public.pipeline_engine_runs (case_id, engine)
  WHERE status IN ('queued', 'running');

-- 3. Atomic claim helper: returns the run id, or NULL when another worker holds it.
CREATE OR REPLACE FUNCTION public.claim_engine_run(
  _case_id uuid,
  _user_id uuid,
  _engine text,
  _meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.pipeline_engine_runs (case_id, user_id, engine, status, started_at, meta)
  VALUES (_case_id, _user_id, _engine, 'running', now(), _meta)
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN
    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO authenticated, service_role;