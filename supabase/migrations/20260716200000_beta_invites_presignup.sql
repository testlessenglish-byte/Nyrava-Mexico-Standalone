-- Pre-signup beta invites: admin can add an email to the beta list BEFORE
-- that person has an account. The moment a user signs up with a matching
-- email, a trigger on auth.users grants them beta access automatically —
-- no second admin step required.
--
-- This complements (does not replace) the existing flow in
-- 20260716190000_beta_testers_and_webhook_log.sql, where an admin grants
-- beta access directly to an EXISTING user by email.

CREATE TABLE IF NOT EXISTS public.beta_invites (
  email text PRIMARY KEY,
  note text,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  redeemed_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS beta_invites_redeemed_at_idx ON public.beta_invites (redeemed_at);

COMMENT ON TABLE public.beta_invites IS
  'Emails pre-authorized for beta access before the person has signed up. Redeemed automatically by handle_beta_invite_redemption() when a matching auth.users row is created. Admin-only read/write.';

ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;

-- No direct client access at all — every read/write goes through the
-- admin-gated RPCs/server functions below (service_role for writes from
-- billing.functions.ts, admin RPC for reads). authenticated gets nothing
-- directly on this table.
GRANT ALL ON public.beta_invites TO service_role;

-- ------------------------------------------------------------
-- Auto-redemption trigger. Runs as the table owner (SECURITY DEFINER via
-- trigger context on auth.users), so it can read auth.users and write
-- public.subscriptions regardless of who's signing up.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_beta_invite_redemption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite RECORD;
BEGIN
  SELECT * INTO invite
  FROM public.beta_invites
  WHERE lower(email) = lower(NEW.email)
    AND redeemed_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.subscriptions (user_id, is_beta_tester, beta_note, beta_granted_by, beta_granted_at)
    VALUES (NEW.id, true, invite.note, invite.invited_by, now())
    ON CONFLICT (user_id) DO UPDATE SET
      is_beta_tester = true,
      beta_note = COALESCE(public.subscriptions.beta_note, invite.note),
      beta_granted_by = COALESCE(public.subscriptions.beta_granted_by, invite.invited_by),
      beta_granted_at = COALESCE(public.subscriptions.beta_granted_at, now());

    UPDATE public.beta_invites
    SET redeemed_at = now(), redeemed_user_id = NEW.id
    WHERE email = invite.email;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_beta_redemption ON auth.users;
CREATE TRIGGER on_auth_user_created_beta_redemption
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_beta_invite_redemption();

-- ------------------------------------------------------------
-- Admin RPC: list pending (unredeemed) invites, for the Beta Testers page.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_pending_beta_invites()
RETURNS TABLE (
  email text,
  note text,
  invited_at timestamptz
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
  SELECT bi.email, bi.note, bi.invited_at
  FROM public.beta_invites bi
  WHERE bi.redeemed_at IS NULL
  ORDER BY bi.invited_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_pending_beta_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() TO authenticated;
