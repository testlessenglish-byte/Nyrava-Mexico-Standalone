ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS included_seats integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS per_seat_price_cents integer,
  ADD COLUMN IF NOT EXISTS per_seat_stripe_price_id text,
  ADD COLUMN IF NOT EXISTS internal_notes text;

COMMENT ON COLUMN public.billing_plans.included_seats IS 'Number of seats covered by the base price_cents. 1 = no seat concept (e.g. Solo).';
COMMENT ON COLUMN public.billing_plans.per_seat_price_cents IS 'Price per additional seat beyond included_seats, in cents. NULL = no per-seat add-on.';
COMMENT ON COLUMN public.billing_plans.per_seat_stripe_price_id IS 'Stripe Price ID for the per-seat add-on line item (licensed, not metered). NULL until configured.';
COMMENT ON COLUMN public.billing_plans.internal_notes IS 'Admin-only notes (e.g. negotiation floors). Never rendered on the public /billing page.';

UPDATE public.billing_plans SET price_cents = 9900, included_seats = 1 WHERE key = 'solo';
UPDATE public.billing_plans SET price_cents = 29900, included_seats = 3, per_seat_price_cents = 7900 WHERE key = 'firm';
UPDATE public.billing_plans
   SET internal_notes = 'Negotiation floor: $99–125/seat/mo, 20-seat minimum. Anchor quote: $150-200/seat/mo. Never shown on /billing — reference only for sales.'
 WHERE key = 'enterprise' AND (internal_notes IS NULL OR internal_notes = '');