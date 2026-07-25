-- Beta tester support + Stripe webhook event log + admin lookup RPCs.
--
-- Beta testers get full billing access (getBillingAccess in
-- billing.functions.ts) without a Stripe subscription and without
-- consuming/needing the one-time free case. They are NOT given any
-- Anthropic/OpenAI/etc key of their own — resolveProviderKeys() in
-- ai-key-router.server.ts already falls back to the platform key
-- (process.env.*_API_KEY) for any user with zero saved keys, so a beta
-- tester who never opens "AI Keys" automatically rides on the platform key.
-- This migration only removes the billing gate; it changes nothing about
-- key routing.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS is_beta_tester boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS beta_note text,
  ADD COLUMN IF NOT EXISTS beta_granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS beta_granted_at timestamptz;

COMMENT ON COLUMN public.subscriptions.is_beta_tester IS
  'Grants full billing access with no Stripe subscription and no free-case limit. Written only via admin beta-tester endpoints (service_role), gated by is_admin_tier/is_super_admin.';

-- ------------------------------------------------------------
-- Stripe webhook event log — gives the admin Billing page something to
-- show for "is the webhook actually wired up", beyond just the presence
-- of an env var.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text UNIQUE,
  event_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('processed', 'ignored', 'error')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_created_at_idx ON public.webhook_events (created_at DESC);

GRANT SELECT ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view webhook events" ON public.webhook_events;
CREATE POLICY "Admins can view webhook events"
  ON public.webhook_events FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

COMMENT ON TABLE public.webhook_events IS
  'Append-only log of received Stripe webhook events, written by the webhook handler itself (service_role, unauthenticated route verified via Stripe signature). Admin-only read via RLS.';

-- ------------------------------------------------------------
-- Admin RPCs. Both check admin status INSIDE the function (not just via
-- grants) so they're safe to expose to any authenticated caller — a
-- non-admin gets a clean "Forbidden" instead of the query ever touching
-- auth.users on their behalf.
-- ------------------------------------------------------------

-- Look up a user id by email, for "add this attorney as a beta tester by
-- email" in the admin UI. Admin-gated, not just service_role-gated, so it
-- can be called straight from the authenticated admin's browser session.
CREATE OR REPLACE FUNCTION public.admin_get_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Forbidden — admin required.';
  END IF;
  RETURN (SELECT id FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) TO authenticated;

-- Combined user + subscription/beta listing for the admin Subscriptions
-- and Beta Testers pages (PostgREST can't join into the auth schema, so
-- this does the join server-side instead).
CREATE OR REPLACE FUNCTION public.admin_list_users_with_subscriptions()
RETURNS TABLE (
  user_id uuid,
  email text,
  user_created_at timestamptz,
  plan text,
  status text,
  is_beta_tester boolean,
  beta_note text,
  beta_granted_at timestamptz,
  free_case_used boolean,
  stripe_customer_id text,
  current_period_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Forbidden — admin required.';
  END IF;
  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    u.created_at,
    s.plan,
    COALESCE(s.status, 'none'),
    COALESCE(s.is_beta_tester, false),
    s.beta_note,
    s.beta_granted_at,
    COALESCE(s.free_case_used, false),
    s.stripe_customer_id,
    s.current_period_end
  FROM auth.users u
  LEFT JOIN public.subscriptions s ON s.user_id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users_with_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO authenticated;
