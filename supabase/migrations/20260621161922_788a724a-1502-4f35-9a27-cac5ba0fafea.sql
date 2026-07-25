
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS cases_user_active_idx
  ON public.cases (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
