CREATE OR REPLACE FUNCTION public.admin_grant_beta_access(_email text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor_id uuid := auth.uid();
  target_id uuid;
  normalized_email text := lower(trim(_email));
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = actor_id
      AND ur.role IN ('admin'::public.app_role, 'super_admin'::public.app_role, 'platform_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden — admin required';
  END IF;

  IF normalized_email = '' OR normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'A valid email is required';
  END IF;

  SELECT u.id INTO target_id
  FROM auth.users u
  WHERE lower(u.email) = normalized_email
  LIMIT 1;

  IF target_id IS NULL THEN
    INSERT INTO public.beta_invites (
      email, note, invited_by, invited_at, redeemed_at, redeemed_user_id
    ) VALUES (
      normalized_email, nullif(trim(_note), ''), actor_id, now(), NULL, NULL
    )
    ON CONFLICT (email) DO UPDATE SET
      note = EXCLUDED.note,
      invited_by = EXCLUDED.invited_by,
      invited_at = EXCLUDED.invited_at,
      redeemed_at = NULL,
      redeemed_user_id = NULL;

    RETURN jsonb_build_object('ok', true, 'userId', NULL, 'pending', true);
  END IF;

  INSERT INTO public.subscriptions (
    user_id, is_beta_tester, beta_note, beta_granted_by, beta_granted_at
  ) VALUES (
    target_id, true, nullif(trim(_note), ''), actor_id, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_beta_tester = true,
    beta_note = EXCLUDED.beta_note,
    beta_granted_by = EXCLUDED.beta_granted_by,
    beta_granted_at = EXCLUDED.beta_granted_at;

  DELETE FROM public.beta_invites WHERE email = normalized_email;

  RETURN jsonb_build_object('ok', true, 'userId', target_id, 'pending', false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_beta_access(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO authenticated, service_role;