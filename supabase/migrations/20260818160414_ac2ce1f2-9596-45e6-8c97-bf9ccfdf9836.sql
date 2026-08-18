REVOKE EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_engine_run(_case_id uuid, _user_id uuid, _engine text, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = _case_id AND c.user_id = _user_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO public.pipeline_engine_runs (case_id, user_id, engine, status, started_at, meta)
  VALUES (_case_id, _user_id, _engine, 'running', now(), _meta)
  RETURNING id INTO _id;
  RETURN _id;
EXCEPTION
  WHEN unique_violation THEN
    RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO service_role;