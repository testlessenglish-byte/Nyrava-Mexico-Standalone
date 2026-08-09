-- ============================================================================
-- Zero-hallucination hardening for the Completed Case Audit — additive only.
--
-- Adds an explicit, queryable state distinguishing "we produced a real
-- probability estimate" from "the record does not support one" — see
-- src/lib/intelligence/completed-case-audit.server.ts. Before this, the
-- engine always forced favorable_pct/unfavorable_pct to sum to 100 even
-- when the underlying evidence was too thin to support any meaningful
-- number. NOT NULL DEFAULT 'ESTIMATED' preserves every existing row's
-- current meaning unchanged.
-- ============================================================================

ALTER TABLE public.case_outcome_assessments
  ADD COLUMN IF NOT EXISTS outcome_status text NOT NULL DEFAULT 'ESTIMATED';

ALTER TABLE public.case_outcome_assessments
  ADD CONSTRAINT case_outcome_assessments_outcome_status_check
    CHECK (outcome_status IN ('ESTIMATED', 'INSUFFICIENT_DATA'));

COMMENT ON COLUMN public.case_outcome_assessments.outcome_status IS
  'ESTIMATED: favorable_pct/unfavorable_pct/confidence reflect a real evidence-based assessment. INSUFFICIENT_DATA: the record does not support a meaningful probability — favorable_pct/unfavorable_pct/confidence are placeholders (0/0/LOW) and must not be displayed as a real estimate. See completed-case-audit.server.ts.';

-- Also additive: a "no material error identified" is itself a valid,
-- meaningful audit result (spec rule 6) — distinct from "the audit found
-- nothing" or "the audit failed to run." Recorded explicitly so the UI can
-- render it as a positive result, not an empty state.
ALTER TABLE public.case_outcome_assessments
  ADD COLUMN IF NOT EXISTS no_material_error_identified boolean NOT NULL DEFAULT false;
