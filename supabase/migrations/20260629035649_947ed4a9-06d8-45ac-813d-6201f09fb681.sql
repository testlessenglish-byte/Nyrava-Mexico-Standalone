
ALTER TABLE public.report_versions
  ADD COLUMN IF NOT EXISTS triggering_upload_id uuid,
  ADD COLUMN IF NOT EXISTS document_count integer,
  ADD COLUMN IF NOT EXISTS findings_count integer,
  ADD COLUMN IF NOT EXISTS contradiction_count integer,
  ADD COLUMN IF NOT EXISTS ess numeric,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS report_hash text;

CREATE INDEX IF NOT EXISTS idx_report_versions_case_version
  ON public.report_versions(case_id, version DESC);

REVOKE UPDATE, DELETE ON public.report_versions FROM authenticated;
GRANT SELECT, INSERT ON public.report_versions TO authenticated;
GRANT ALL ON public.report_versions TO service_role;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS quality_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_block_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;
