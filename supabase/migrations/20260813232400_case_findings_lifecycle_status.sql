-- ============================================================================
-- Finding lifecycle status — a richer descriptive layer on top of the
-- existing superseded_at/superseded_reason gate, not a replacement for it.
--
-- superseded_at remains the ONE hard boolean listFindings() (the report/
-- dashboard/scoring choke point) filters on — that invariant does not
-- change. lifecycle_status is additive: it lets Talk-to-Case corrections
-- and future self-auditing distinguish WHY a finding is in its current
-- state (challenged-but-still-active vs. corrected-in-place vs. formally
-- superseded) without overloading superseded_at's simple present/absent
-- semantics or duplicating case_finding_patches.action (which records what
-- CHANGED it, not what state it's currently in).
--
-- Nullable, no default, no backfill — every existing finding keeps working
-- unchanged with lifecycle_status NULL, exactly like every prior additive
-- case_findings column this session (see
-- 20260809150000_finding_supersession.sql,
-- 20260808201119_finding_judicial_attribution.sql).
-- ============================================================================

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS lifecycle_status text;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_lifecycle_status_check
  CHECK (
    lifecycle_status IS NULL OR lifecycle_status IN (
      'discovered',
      'supported',
      'verified',
      'active',
      'challenged',
      'corrected',
      'superseded',
      'rejected',
      'corroborated'
    )
  );

CREATE INDEX IF NOT EXISTS case_findings_lifecycle_status_idx
  ON public.case_findings(case_id, lifecycle_status) WHERE lifecycle_status IS NOT NULL;

COMMENT ON COLUMN public.case_findings.lifecycle_status IS
  'Descriptive lifecycle state (discovered/supported/verified/active/challenged/corrected/superseded/rejected/corroborated). NULL for findings generated before this column existed, or where nothing has set it yet. Never the gate for report/scoring inclusion — that remains superseded_at IS NULL, unchanged.';
