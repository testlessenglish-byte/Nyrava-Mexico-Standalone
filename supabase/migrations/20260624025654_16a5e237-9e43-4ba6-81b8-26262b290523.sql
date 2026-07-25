ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS evidence_type text,
  ADD COLUMN IF NOT EXISTS impact_direction text,
  ADD COLUMN IF NOT EXISTS strategic_significance text,
  ADD COLUMN IF NOT EXISTS priority integer;

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS attack_surface jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS case_findings_case_priority_idx
  ON public.case_findings (case_id, priority);