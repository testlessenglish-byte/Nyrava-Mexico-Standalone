
ALTER TABLE public.user_ai_keys
  ADD COLUMN IF NOT EXISTS priority integer,
  ADD COLUMN IF NOT EXISTS calls_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calls_month integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_month integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_date date,
  ADD COLUMN IF NOT EXISTS usage_month text;
