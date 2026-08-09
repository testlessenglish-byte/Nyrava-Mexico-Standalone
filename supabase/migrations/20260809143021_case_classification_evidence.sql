-- ============================================================================
-- Automatic Case Classification — source-grounded, evidence-gated.
--
-- Additive only. Existing case_type/jurisdiction auto-detect
-- (mx-auto-detect.server.ts, mx-case-classifier.ts) always guessed and never
-- recorded WHY — this table is the evidence trail: which document, which
-- page, which exact quote justified each detected field, or that the
-- documents disagreed (CONFLICT) or didn't establish it (INSUFFICIENT_DATA).
-- See src/lib/intelligence/case-classification.server.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.case_classification_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  field text NOT NULL CHECK (field IN (
    'case_type', 'proceeding_type', 'jurisdiction', 'matter',
    'procedural_stage', 'expediente_number', 'court', 'parties',
    'concluded_status'
  )),
  status text NOT NULL CHECK (status IN ('CONFIRMED', 'INSUFFICIENT_DATA', 'CONFLICT')),
  value text,
  confidence numeric,

  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_page integer,
  source_quote text,

  -- Populated only when status = 'CONFLICT': every distinct value seen
  -- across documents, each with its own source — never silently picked.
  conflicting_values jsonb NOT NULL DEFAULT '[]'::jsonb,

  detected_at timestamptz NOT NULL DEFAULT now(),
  -- One row per (case, field) — a fresh detection run replaces the prior
  -- row for that field rather than accumulating history; see
  -- runCaseClassification()'s delete-then-insert.
  UNIQUE (case_id, field)
);

GRANT SELECT ON public.case_classification_evidence TO authenticated;
GRANT ALL ON public.case_classification_evidence TO service_role;
ALTER TABLE public.case_classification_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_classification_evidence_owner_select ON public.case_classification_evidence;
CREATE POLICY case_classification_evidence_owner_select ON public.case_classification_evidence
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE INDEX IF NOT EXISTS case_classification_evidence_case_idx
  ON public.case_classification_evidence(case_id);

COMMENT ON TABLE public.case_classification_evidence IS
  'Evidence trail for automatic case classification (case type, jurisdiction, court, parties, expediente number, procedural stage, concluded status). Never guesses: CONFIRMED requires a located source quote, CONFLICT records every disagreeing source, INSUFFICIENT_DATA when the corpus does not establish the field. See case-classification.server.ts.';

-- ----------------------------------------------------------------------------
-- Provenance of the ACTIVE cases.case_type/jurisdiction values — additive,
-- nullable, no backfill. Lets a manual override be distinguished from a
-- source-confirmed value without joining the evidence table on every read.
-- ----------------------------------------------------------------------------
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS case_type_source text,
  ADD COLUMN IF NOT EXISTS case_type_verification_status text;

ALTER TABLE public.cases
  ADD CONSTRAINT cases_case_type_source_check
    CHECK (case_type_source IS NULL OR case_type_source IN (
      'source_confirmed', 'manual_override', 'manual_override_conflicting', 'heuristic', 'unresolved'
    ));

ALTER TABLE public.cases
  ADD CONSTRAINT cases_case_type_verification_status_check
    CHECK (case_type_verification_status IS NULL OR case_type_verification_status IN (
      'CONFIRMED', 'INSUFFICIENT_DATA', 'CONFLICT'
    ));

COMMENT ON COLUMN public.cases.case_type_source IS
  'Provenance of the current case_type value: source_confirmed (from case_classification_evidence) | manual_override (attorney-set, no conflicting source) | manual_override_conflicting (attorney-set, but disagrees with a CONFIRMED source classification — see case_classification_evidence) | heuristic (legacy keyword guess, pre-dates this table) | unresolved.';
COMMENT ON COLUMN public.cases.case_type_verification_status IS
  'CONFIRMED | INSUFFICIENT_DATA | CONFLICT — mirrors case_classification_evidence.status for the case_type field, denormalized for cheap UI reads.';
