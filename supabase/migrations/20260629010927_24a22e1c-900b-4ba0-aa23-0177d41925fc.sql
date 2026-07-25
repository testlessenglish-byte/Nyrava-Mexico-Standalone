ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extraction_retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_extraction_attempt_at TIMESTAMPTZ;