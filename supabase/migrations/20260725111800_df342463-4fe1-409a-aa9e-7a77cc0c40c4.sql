-- billing_plans: US-parity columns
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS self_serve boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contact_url text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_seats integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS per_seat_price_cents integer,
  ADD COLUMN IF NOT EXISTS per_seat_stripe_price_id text,
  ADD COLUMN IF NOT EXISTS internal_notes text;

-- Backfill key from code where present, then enforce uniqueness
UPDATE public.billing_plans SET key = code WHERE key IS NULL AND code IS NOT NULL;
UPDATE public.billing_plans SET label = name WHERE label IS NULL AND name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_plans_key_uidx ON public.billing_plans(key) WHERE key IS NOT NULL;

-- reports: extra scoring/cache columns
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS risk_score numeric,
  ADD COLUMN IF NOT EXISTS missing_evidence_struct jsonb,
  ADD COLUMN IF NOT EXISTS report_chunk_cache jsonb NOT NULL DEFAULT '{}'::jsonb;

-- profiles: email column (mirrored from auth.users)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;
UPDATE public.profiles p SET email = u.email
  FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;

-- documents: soft-archive timestamp
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- case_status enum: US-parity intermediate states
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'extracted';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'analyzed';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'agents_running';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'agents_complete';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'scored';