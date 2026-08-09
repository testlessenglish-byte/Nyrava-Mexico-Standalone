-- ============================================================================
-- Completed Case Audit / Outcome Assessment — additive, brand-new table.
--
-- Explicitly NOT a change to case_findings, cases, reports, or any existing
-- pipeline table: a "final quality-control attorney review" layer that
-- reads the EXISTING completed-case results (case_findings, case_scores,
-- reports) and writes its own independent judgment here, never mutating
-- what it reviewed. See src/lib/intelligence/completed-case-audit.server.ts.
--
-- One row per audit run (a case rerun under a completed-case analysis mode
-- gets a fresh row, not an overwrite, so the audit history is never lost).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.case_outcome_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_analysis_mode text NOT NULL,

  overall_position text NOT NULL CHECK (overall_position IN ('FAVORABLE', 'UNFAVORABLE', 'MIXED')),
  favorable_pct integer NOT NULL CHECK (favorable_pct BETWEEN 0 AND 100),
  unfavorable_pct integer NOT NULL CHECK (unfavorable_pct BETWEEN 0 AND 100),
  confidence text NOT NULL CHECK (confidence IN ('LOW', 'MODERATE', 'HIGH')),

  principal_strength text,
  principal_weakness text,
  biggest_risk text,
  most_important_missing_evidence text,

  -- Structured breakdowns — see completed-case-audit.server.ts for the
  -- exact shape written into each. Kept as jsonb (not new columns per
  -- field) since this is genuinely variable-shape narrative content, not
  -- queryable scalar data, and case_findings has already taught this
  -- codebase twice what happens when every new field becomes its own
  -- column on a hot-path table — this table isn't one, so jsonb here is a
  -- deliberate choice, not corner-cutting.
  both_sides jsonb NOT NULL DEFAULT '{}'::jsonb,
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  what_could_change jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Per-finding review outcome: [{ finding_id, status, note }], status one
  -- of VERIFIED|CORRECTED|UNVERIFIED|CONTRADICTED|MISSING_EVIDENCE.
  finding_reviews jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Statutory-citation re-verification results (verifyStatutoryCitation()
  -- output per citation found in the existing analysis) — real, deterministic
  -- checks against public.legal_authorities/legal_articles, not LLM claims.
  citation_reviews jsonb NOT NULL DEFAULT '[]'::jsonb,

  raw_model_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.case_outcome_assessments TO authenticated;
GRANT ALL ON public.case_outcome_assessments TO service_role;
ALTER TABLE public.case_outcome_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_outcome_assessments_owner_select ON public.case_outcome_assessments;
CREATE POLICY case_outcome_assessments_owner_select ON public.case_outcome_assessments
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE INDEX IF NOT EXISTS case_outcome_assessments_case_idx
  ON public.case_outcome_assessments(case_id, created_at DESC);

COMMENT ON TABLE public.case_outcome_assessments IS
  'Completed Case Audit / Outcome Assessment — a final review layer over EXISTING completed-case findings/scores/report. Never regenerates or reprocesses documents; see src/lib/intelligence/completed-case-audit.server.ts.';
