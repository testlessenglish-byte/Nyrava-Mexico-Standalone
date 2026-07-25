
CREATE TABLE public.billing_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  interval text NOT NULL DEFAULT 'month',
  stripe_price_id text,
  self_serve boolean NOT NULL DEFAULT true,
  contact_url text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_plans TO anon;
GRANT SELECT ON public.billing_plans TO authenticated;
GRANT ALL ON public.billing_plans TO service_role;

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active plans"
  ON public.billing_plans FOR SELECT
  USING (active = true);

CREATE POLICY "Admins can view all plans"
  ON public.billing_plans FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert plans"
  ON public.billing_plans FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can update plans"
  ON public.billing_plans FOR UPDATE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete plans"
  ON public.billing_plans FOR DELETE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER billing_plans_set_updated_at
  BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed with the three existing plans so the admin has something to edit immediately.
INSERT INTO public.billing_plans (key, label, tagline, features, price_cents, self_serve, sort_order) VALUES
  ('solo', 'Solo', 'For solo practitioners and small caseloads',
   '["Unlimited case analysis","Full 20-stage intelligence pipeline","Motion drafting & reports","Email support"]'::jsonb,
   0, true, 10),
  ('firm', 'Firm', 'For firms running multiple cases at once',
   '["Everything in Solo","Multiple attorney seats","Priority processing","Priority support"]'::jsonb,
   0, true, 20),
  ('enterprise', 'Enterprise', 'For large firms with custom needs',
   '["Everything in Firm","Custom seat count & SSO","Dedicated onboarding","Custom contract & invoicing"]'::jsonb,
   0, false, 30)
ON CONFLICT (key) DO NOTHING;
