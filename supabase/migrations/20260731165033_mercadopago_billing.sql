-- ============================================================================
-- Mercado Pago subscriptions (replaces Stripe as the billing processor)
--
-- Non-destructive by design: existing stripe_* columns are left in place
-- (harmless, unused going forward) rather than dropped, so this is safe to
-- run without any data-loss risk or coordination with a rollback plan.
-- ============================================================================

-- 1. Plan configuration — Mercado Pago Preapproval Plan id replaces the
--    Stripe Price id as the thing admins configure per plan.
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS mercadopago_plan_id text;

COMMENT ON COLUMN public.billing_plans.mercadopago_plan_id IS
  'Mercado Pago Preapproval Plan id (from POST /preapproval_plan). Replaces stripe_price_id, which is no longer read by the app but is left in place rather than dropped.';

-- 2. Per-user subscription linkage — Mercado Pago has no "customer" object
--    like Stripe; a subscription is a Preapproval, identified by its own id
--    and (optionally) a payer id/email.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS mercadopago_preapproval_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS mercadopago_payer_id text,
  ADD COLUMN IF NOT EXISTS mercadopago_payer_email text;

COMMENT ON COLUMN public.subscriptions.mercadopago_preapproval_id IS
  'Mercado Pago Preapproval id — the subscription object itself. Replaces stripe_subscription_id.';
COMMENT ON COLUMN public.subscriptions.mercadopago_payer_id IS
  'Mercado Pago payer id, when returned. Informational only — the preapproval id is what the app keys off of.';

-- 3. Webhook event log — Mercado Pago notification ids live in their own
--    column (kept separate from stripe_event_id, which used a bare UNIQUE
--    constraint keyed to Stripe's id format) plus a provider tag so the
--    admin Billing page can tell old Stripe rows apart from new Mercado
--    Pago rows without guessing from event_type alone.
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS mp_event_id text UNIQUE;

COMMENT ON COLUMN public.webhook_events.provider IS
  '''stripe'' for legacy rows (column default, preserves existing data as-is) or ''mercadopago'' for rows written by the new webhook handler.';
COMMENT ON COLUMN public.webhook_events.mp_event_id IS
  'Mercado Pago notification id (from the notification payload''s data.id + type), used the same way stripe_event_id is used for Stripe rows — de-duplicating retried webhook deliveries.';

-- 4. Extend the admin users+subscriptions RPC to surface the new Mercado
--    Pago linkage alongside (not instead of) the legacy Stripe columns, so
--    the admin Subscriptions page can display whichever is populated.
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
  current_period_end timestamptz,
  mercadopago_preapproval_id text
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
    s.current_period_end,
    s.mercadopago_preapproval_id
  FROM auth.users u
  LEFT JOIN public.subscriptions s ON s.user_id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users_with_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO authenticated;
