
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS discovery_at timestamptz,
  ADD COLUMN IF NOT EXISTS contradiction_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_product_at timestamptz;

ALTER TABLE public.case_work_product
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS generation_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS canonical_finding_id uuid,
  ADD COLUMN IF NOT EXISTS derived_from_finding_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
