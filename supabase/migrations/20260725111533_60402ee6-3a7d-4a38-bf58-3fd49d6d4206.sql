ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'es'
  CHECK (preferred_language IN ('es', 'en'));

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS case_language text
  CHECK (case_language IN ('es', 'en')),
  ADD COLUMN IF NOT EXISTS report_language text NOT NULL DEFAULT 'es'
  CHECK (report_language IN ('es', 'en'));

ALTER TABLE public.case_chat_messages
  ADD COLUMN IF NOT EXISTS message_language text
  CHECK (message_language IN ('es', 'en'));

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS generated_language text NOT NULL DEFAULT 'es'
  CHECK (generated_language IN ('es', 'en'));

COMMENT ON COLUMN public.cases.case_language IS
  'Detected/set language of the case''s source documents. Null until detected — distinct from report_language, which is what the attorney wants OUTPUT in.';
COMMENT ON COLUMN public.cases.report_language IS
  'Language to generate this case''s reports/analysis in. Defaults to the case owner''s profiles.preferred_language at case-creation time.';