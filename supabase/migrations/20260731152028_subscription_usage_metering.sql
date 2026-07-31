-- ============================================================================
-- Subscription & Usage Metering
--
-- Turns the platform from "unlimited AI processing per subscription" into
-- metered monthly allowances that admins can configure per plan without a
-- code deploy, per-user usage that resets automatically each billing cycle,
-- and a BYOK escape hatch that bypasses the platform allowance entirely.
--
-- Design notes:
-- - Limits live as columns on the EXISTING `billing_plans` table (already
--   admin-editable via admin.billing.tsx / billing-plans.functions.ts), not
--   a new side table — one central place to configure a plan, matching the
--   existing "no code deploy to change a plan" pattern used for pricing.
-- - Usage is counted per (user_id, period_month) row in `usage_counters`.
--   "Reset each billing cycle" is implemented by keying on the calendar
--   month rather than by any cron job that zeroes counters: a new month
--   simply has no row yet, so usage reads back as 0 with no maintenance
--   job required. period_month is 'YYYY-MM' in UTC.
-- - `consume_usage` is the only way these counters are ever incremented.
--   It runs SECURITY DEFINER as a single statement per call so concurrent
--   requests from the same user can't both read a stale count and both
--   succeed past the limit (the INSERT ... ON CONFLICT DO UPDATE below is
--   a single atomic row-level operation, so no explicit advisory lock is
--   needed for correctness here).
-- ============================================================================

-- 1. Plan limit configuration -------------------------------------------------
-- NULL in any *_limit / *_monthly column means "unlimited" — used for the
-- Enterprise tier by default, and available to any plan an admin wants to
-- mark unlimited without a special-case flag.
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS ai_requests_monthly integer,
  ADD COLUMN IF NOT EXISTS talk_to_case_monthly integer,
  ADD COLUMN IF NOT EXISTS case_limit integer,
  ADD COLUMN IF NOT EXISTS storage_gb_limit numeric,
  ADD COLUMN IF NOT EXISTS team_member_limit integer,
  ADD COLUMN IF NOT EXISTS byok_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS overage_price_cents integer,
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.billing_plans.ai_requests_monthly IS
  'Monthly allowance shared by Case Intelligence processing, AI document analysis, report generation, motion generation, strategic analysis, and future intelligence modules. NULL = unlimited.';
COMMENT ON COLUMN public.billing_plans.talk_to_case_monthly IS
  'Monthly allowance of Talk-to-Case turns, tracked separately because it performs continuous AI reasoning. NULL = unlimited.';
COMMENT ON COLUMN public.billing_plans.case_limit IS
  'Max non-archived cases a user on this plan may have open at once. NULL = unlimited.';
COMMENT ON COLUMN public.billing_plans.storage_gb_limit IS
  'Max evidence storage (GB) for a user on this plan. NULL = unlimited.';
COMMENT ON COLUMN public.billing_plans.team_member_limit IS
  'Max team/firm seats for this plan. NULL = unlimited.';
COMMENT ON COLUMN public.billing_plans.byok_allowed IS
  'Whether users on this plan may connect their own AI provider keys (BYOK) to bypass the platform allowance.';
COMMENT ON COLUMN public.billing_plans.overage_price_cents IS
  'Reserved for future pay-as-you-go overage pricing once included allowance is exhausted. Not charged yet.';
COMMENT ON COLUMN public.billing_plans.feature_flags IS
  'Free-form per-plan feature toggles (e.g. {"priority_processing": true}) read by the app without needing new columns for every future flag.';

-- Seed sensible defaults on the three existing plans. Admins can change any
-- of these from Admin -> Billing Plans afterward.
UPDATE public.billing_plans SET
  ai_requests_monthly = 150,
  talk_to_case_monthly = 30,
  case_limit = 10,
  storage_gb_limit = 5,
  team_member_limit = 1,
  byok_allowed = true
WHERE key = 'solo' AND ai_requests_monthly IS NULL;

UPDATE public.billing_plans SET
  ai_requests_monthly = 750,
  talk_to_case_monthly = 150,
  case_limit = 100,
  storage_gb_limit = 50,
  team_member_limit = 10,
  byok_allowed = true
WHERE key = 'firm' AND ai_requests_monthly IS NULL;

-- Enterprise stays NULL (= custom/unlimited) by default; admins set explicit
-- numbers per contract from the same admin screen when needed.
UPDATE public.billing_plans SET
  byok_allowed = true
WHERE key = 'enterprise';

-- Refresh the seeded marketing copy away from "Unlimited case analysis" now
-- that usage is metered. Only touches rows still holding the original seed
-- text, so any admin who already edited their own copy is left alone.
UPDATE public.billing_plans SET
  features = '["150 AI requests / month", "30 Talk-to-Case conversations / month", "Full 20-stage intelligence pipeline", "Motion drafting & reports", "Connect your own AI keys (BYOK)", "Email support"]'::jsonb
WHERE key = 'solo' AND features = '["Unlimited case analysis","Full 20-stage intelligence pipeline","Motion drafting & reports","Email support"]'::jsonb;

UPDATE public.billing_plans SET
  features = '["750 AI requests / month", "150 Talk-to-Case conversations / month", "Everything in Solo", "Multiple attorney seats", "Priority processing", "Priority support"]'::jsonb
WHERE key = 'firm' AND features = '["Everything in Solo","Multiple attorney seats","Priority processing","Priority support"]'::jsonb;

UPDATE public.billing_plans SET
  features = '["Custom monthly AI + Talk-to-Case allowance", "Everything in Firm", "Custom seat count & SSO", "Dedicated onboarding", "Custom contract & invoicing"]'::jsonb
WHERE key = 'enterprise' AND features = '["Everything in Firm","Custom seat count & SSO","Dedicated onboarding","Custom contract & invoicing"]'::jsonb;

-- 2. Per-user monthly usage ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_counters (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_month text NOT NULL, -- 'YYYY-MM', UTC
  ai_requests_used integer NOT NULL DEFAULT 0,
  talk_to_case_used integer NOT NULL DEFAULT 0,
  reports_generated integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_month)
);

CREATE INDEX IF NOT EXISTS usage_counters_user_idx ON public.usage_counters (user_id);

GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage" ON public.usage_counters;
CREATE POLICY "Users can view own usage"
  ON public.usage_counters
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER usage_counters_set_updated_at
  BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.usage_counters IS
  'One row per user per calendar month. Written only via consume_usage()/service-role (never directly by a client). A new month simply has no row yet, which is how the monthly reset works without a cron job.';

-- 3. Lightweight audit trail (optional detail behind the counters) -----------
-- Not required for gating, but gives support/admins a way to see WHAT
-- consumed an allowance, not just the running total.
CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ai_request', 'talk_to_case')),
  feature text NOT NULL, -- 'case_intelligence' | 'talk_to_case' | 'document_analysis' | 'report_generation' | 'motion_generation' | 'strategic_analysis'
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'platform' CHECK (source IN ('platform', 'byok')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_user_time_idx ON public.usage_events (user_id, created_at DESC);

GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage events" ON public.usage_events;
CREATE POLICY "Users can view own usage events"
  ON public.usage_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.usage_events IS
  'Append-only detail log behind usage_counters — one row per metered AI call. Best-effort (fire-and-forget from the app); usage_counters is the source of truth for gating, this is for visibility/debugging only.';

-- 4. Atomic check-and-consume -------------------------------------------------
-- p_limit is resolved by the CALLER (from the user's plan row) and passed in
-- rather than looked up here, so this function has no opinion about how a
-- user's plan/limit is determined (admin overrides, beta bypass, BYOK, etc.
-- all stay in application code where the rest of that logic already lives).
-- p_limit = NULL means unlimited: always allowed, still counted for the
-- dashboard's "used this month" display.
CREATE OR REPLACE FUNCTION public.consume_usage(
  p_user_id uuid,
  p_kind text,
  p_limit integer,
  p_amount integer DEFAULT 1
)
RETURNS TABLE (allowed boolean, used integer, "limit" integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
  v_current integer;
BEGIN
  IF p_kind NOT IN ('ai_request', 'talk_to_case') THEN
    RAISE EXCEPTION 'consume_usage: unknown kind %', p_kind;
  END IF;

  -- Ensure a row exists for this user/period, then lock it.
  INSERT INTO public.usage_counters (user_id, period_month)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period_month) DO NOTHING;

  IF p_kind = 'ai_request' THEN
    SELECT ai_requests_used INTO v_current
      FROM public.usage_counters
      WHERE user_id = p_user_id AND period_month = v_period
      FOR UPDATE;

    IF p_limit IS NOT NULL AND v_current + p_amount > p_limit THEN
      RETURN QUERY SELECT false, v_current, p_limit;
      RETURN;
    END IF;

    UPDATE public.usage_counters
      SET ai_requests_used = ai_requests_used + p_amount
      WHERE user_id = p_user_id AND period_month = v_period
      RETURNING ai_requests_used INTO v_current;

    RETURN QUERY SELECT true, v_current, p_limit;
    RETURN;
  ELSE -- talk_to_case
    SELECT talk_to_case_used INTO v_current
      FROM public.usage_counters
      WHERE user_id = p_user_id AND period_month = v_period
      FOR UPDATE;

    IF p_limit IS NOT NULL AND v_current + p_amount > p_limit THEN
      RETURN QUERY SELECT false, v_current, p_limit;
      RETURN;
    END IF;

    UPDATE public.usage_counters
      SET talk_to_case_used = talk_to_case_used + p_amount
      WHERE user_id = p_user_id AND period_month = v_period
      RETURNING talk_to_case_used INTO v_current;

    RETURN QUERY SELECT true, v_current, p_limit;
    RETURN;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_usage(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage(uuid, text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.consume_usage IS
  'Atomically checks p_amount against p_limit for the current UTC month and, if allowed, increments the counter in the same statement. service_role only — called from usage.server.ts with a limit already resolved from the caller''s plan.';

-- 5. Informational (non-gating) increment for the dashboard's "Reports
--    generated" stat. Report generation ALSO consumes the ai_request
--    allowance via consume_usage above; this just tallies the raw count.
CREATE OR REPLACE FUNCTION public.increment_reports_generated(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.usage_counters (user_id, period_month, reports_generated)
  VALUES (p_user_id, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM'), 1)
  ON CONFLICT (user_id, period_month)
  DO UPDATE SET reports_generated = public.usage_counters.reports_generated + 1;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_reports_generated(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_reports_generated(uuid) TO service_role;
