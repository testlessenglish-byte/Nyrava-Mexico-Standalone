-- ============================================================================
-- Decision Reconstruction / Case Baseline — additive, brand-new table.
--
-- Phase 2/3 of the "Universal Completed Case Legal Audit Architecture Fix."
-- Unlike case_outcome_assessments (which reviews EXISTING case_findings/
-- case_scores/reports), this table stores an INDEPENDENT reconstruction of
-- what the case corpus itself establishes — matter identity, court,
-- jurisdiction, procedural posture, parties, procedural history, material
-- facts, issues presented, party arguments, evidence/factual findings,
-- applicable legal authorities, court reasoning, court holding, disposition/
-- remedy, unresolved issues, and cited precedent — built directly from the
-- documents, not derived from prior analysis output. See
-- src/lib/intelligence/decision-reconstruction.ts for the TypeScript shape
-- (CaseDecisionReconstruction) this table persists, and
-- src/lib/intelligence/decision-reconstruction-extractor.server.ts for the
-- extraction pass that populates it.
--
-- One row per reconstruction run (a re-run after a corpus change gets a
-- fresh row, not an overwrite, so reconstruction history is never lost —
-- same convention as case_outcome_assessments).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.case_decision_reconstructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The full CaseDecisionReconstruction object (every field already
  -- Sourced<T> — status + value + source_refs — at the application layer;
  -- stored whole here rather than exploded into columns, since almost every
  -- field is itself a variable-length array of Sourced entries).
  reconstruction jsonb NOT NULL,

  -- Denormalized top-level status flags for cheap filtering/monitoring
  -- without parsing the full jsonb blob — never the source of truth,
  -- `reconstruction` always is.
  matter_identity_status text,
  court_status text,
  disposition_remedy_status text,

  raw_model_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.case_decision_reconstructions TO authenticated;
GRANT ALL ON public.case_decision_reconstructions TO service_role;
ALTER TABLE public.case_decision_reconstructions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_decision_reconstructions_owner_select ON public.case_decision_reconstructions;
CREATE POLICY case_decision_reconstructions_owner_select ON public.case_decision_reconstructions
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE INDEX IF NOT EXISTS case_decision_reconstructions_case_idx
  ON public.case_decision_reconstructions(case_id, created_at DESC);

COMMENT ON TABLE public.case_decision_reconstructions IS
  'Decision Reconstruction / Case Baseline — an independent reconstruction of what the case corpus establishes, built directly from documents rather than derived from prior findings/scores. See src/lib/intelligence/decision-reconstruction-extractor.server.ts.';
