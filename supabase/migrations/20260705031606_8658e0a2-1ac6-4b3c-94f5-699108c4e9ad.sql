ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'released';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'needs_revision';
ALTER TYPE public.case_status ADD VALUE IF NOT EXISTS 'stalled';