ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS report_checkpoint_count integer NOT NULL DEFAULT 0;
NOTIFY pgrst, 'reload schema';