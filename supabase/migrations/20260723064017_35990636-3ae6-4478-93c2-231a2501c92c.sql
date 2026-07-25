
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_key TEXT CHECK (plan_key IN ('solo', 'firm', 'enterprise')),
  ADD COLUMN IF NOT EXISTS seat_limit INTEGER;

COMMENT ON COLUMN public.firms.seat_limit IS
  'Total seats available to this firm. NULL is treated as the solo default (1) until a paying subscription sets it.';

CREATE OR REPLACE FUNCTION public.plan_seat_limit(_plan TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _plan
    WHEN 'solo' THEN 1
    WHEN 'firm' THEN 10
    WHEN 'enterprise' THEN 50
    ELSE 1
  END;
$$;

CREATE TABLE IF NOT EXISTS public.firm_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('firm_admin', 'case_manager', 'user')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  redeemed_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS firm_invites_pending_email_idx
  ON public.firm_invites (firm_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS firm_invites_email_idx ON public.firm_invites (lower(email));

GRANT SELECT ON public.firm_invites TO authenticated;
GRANT ALL ON public.firm_invites TO service_role;
ALTER TABLE public.firm_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_invites_read ON public.firm_invites;
CREATE POLICY firm_invites_read ON public.firm_invites FOR SELECT TO authenticated
USING (
  public.is_admin_tier(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_settings us
    WHERE us.user_id = auth.uid() AND us.firm_id = firm_invites.firm_id
  )
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _firm_id UUID;
  _invite RECORD;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;

  SELECT * INTO _invite
  FROM public.firm_invites
  WHERE lower(email) = lower(NEW.email) AND status = 'pending'
  ORDER BY invited_at DESC
  LIMIT 1;

  IF _invite.id IS NOT NULL THEN
    _firm_id := _invite.firm_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _invite.role::public.app_role) ON CONFLICT DO NOTHING;
    UPDATE public.firm_invites
      SET status = 'accepted', accepted_at = now(), redeemed_user_id = NEW.id
      WHERE id = _invite.id;
  ELSE
    _firm_id := public.resolve_firm_for_email(NEW.email);
  END IF;

  INSERT INTO public.user_settings (user_id, firm_id)
  VALUES (NEW.id, _firm_id)
  ON CONFLICT (user_id) DO UPDATE SET firm_id = COALESCE(public.user_settings.firm_id, EXCLUDED.firm_id);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.firm_seat_usage(_firm_id UUID)
RETURNS TABLE (seats_used INTEGER, seat_limit INTEGER, plan_key TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      (SELECT count(*)::int FROM public.user_settings us
        JOIN public.profiles p ON p.id = us.user_id
        WHERE us.firm_id = _firm_id AND COALESCE(p.is_blocked, false) = false)
      +
      (SELECT count(*)::int FROM public.firm_invites fi
        WHERE fi.firm_id = _firm_id AND fi.status = 'pending')
    ) AS seats_used,
    COALESCE(f.seat_limit, public.plan_seat_limit('solo')) AS seat_limit,
    f.plan_key
  FROM public.firms f WHERE f.id = _firm_id;
$$;

GRANT EXECUTE ON FUNCTION public.firm_seat_usage(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plan_seat_limit(TEXT) TO authenticated, service_role;

-- Super Admin helper: list every firm with its current seat usage. Used by
-- the /admin/team super-admin panel to hand-set seat limits before Stripe is live.
CREATE OR REPLACE FUNCTION public.admin_list_firms_with_seats()
RETURNS TABLE (
  firm_id UUID, name TEXT, domain TEXT,
  plan_key TEXT, seat_limit INTEGER, seats_used INTEGER,
  owner_user_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden — super admin required.';
  END IF;
  RETURN QUERY
  SELECT
    f.id,
    f.name,
    f.domain,
    f.plan_key,
    COALESCE(f.seat_limit, public.plan_seat_limit('solo')) AS seat_limit,
    (
      (SELECT count(*)::int FROM public.user_settings us
        JOIN public.profiles p ON p.id = us.user_id
        WHERE us.firm_id = f.id AND COALESCE(p.is_blocked, false) = false)
      +
      (SELECT count(*)::int FROM public.firm_invites fi
        WHERE fi.firm_id = f.id AND fi.status = 'pending')
    ) AS seats_used,
    f.owner_user_id
  FROM public.firms f
  ORDER BY f.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_firms_with_seats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_firms_with_seats() TO authenticated;
