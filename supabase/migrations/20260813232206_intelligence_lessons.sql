-- ============================================================================
-- Continuous Legal Intelligence — the learning ledger.
--
-- Every verified Talk-to-Case correction (case_finding_patches — see
-- migration 20260813214353_case_finding_patch_set.sql) can leave behind a
-- structured "lesson": what NYRAVA originally concluded, what was actually
-- wrong with it, and what corrected it. This is deliberately NOT a second
-- source of truth about case_findings — case_finding_patches remains the
-- authoritative per-correction audit trail; a lesson is the same event
-- re-shaped for cross-case learning (error-type taxonomy, jurisdiction/
-- matter-type scoping, validation-state promotion), always traceable back
-- to source_patch_id.
--
-- Deliberately does NOT reference legal_authorities/legal_authority_versions
-- rows directly — authority_refs stores ids only, never authority text, so
-- this table can never become an unaudited second copy of legal content.
-- Adaptive intelligence (this table) and immutable legal authority
-- (legal_authorities) stay architecturally separate, per the platform's
-- "never let the AI silently change the law" requirement.
--
-- validation_status starts at 'ai_supported' — the correction was grounded
-- (a verbatim quote independently re-located in its source, same discipline
-- as every other gate in this codebase) AND an attorney approved it via
-- Talk-to-Case's preview/apply gate (previewCaseChatCorrections ->
-- pushCaseChatCorrectionsToReport). That is a real human action, so
-- 'ai_supported' is correct, not 'unverified' — but it is NOT
-- 'human_confirmed': nobody has yet independently reviewed this SPECIFIC
-- correction as a reusable lesson (as opposed to just approving the report
-- change). Promotion to multi_source_verified/human_confirmed is future
-- work (cross-case pattern aggregation / explicit reviewer action) — this
-- table only ever WRITES 'ai_supported' today; nothing auto-promotes itself.
-- ============================================================================

CREATE TYPE public.intelligence_error_type AS ENUM (
  'unsupported_claim',
  'bad_evidence_link',
  'wrong_evidence_interpretation',
  'duplicate_finding',
  'contradiction_misclassification',
  'wrong_legal_authority',
  'wrong_procedural_rule',
  'wrong_severity',
  'wrong_confidence',
  'missing_finding',
  'false_positive',
  'false_negative',
  'temporal_error',
  'source_classification_error',
  'report_rendering_error',
  'other'
);

CREATE TYPE public.lesson_validation_status AS ENUM (
  'unverified',
  'ai_supported',
  'evidence_verified',
  'multi_source_verified',
  'human_confirmed'
);

CREATE TABLE IF NOT EXISTS public.intelligence_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The correction event this lesson was derived from. A lesson never
  -- exists without a real, applied case_finding_patches row behind it.
  source_patch_id uuid NOT NULL REFERENCES public.case_finding_patches(id) ON DELETE CASCADE,

  -- The finding this lesson concerns. finding_id is nullable (a "create"
  -- patch's lesson concerns the NEW finding, referenced via
  -- canonical_finding_id once assigned, not a prior finding). Never a raw
  -- row id alone: canonical_finding_id (see canonical-id.ts) is the
  -- rerun-stable identity a lesson should actually anchor to.
  finding_id uuid REFERENCES public.case_findings(id) ON DELETE SET NULL,
  canonical_finding_id text,

  -- Jurisdiction/matter-type scoping — required so cross-case pattern
  -- aggregation (future work) never mixes lessons across incompatible
  -- legal systems or practice areas. matter_type mirrors cases.case_type's
  -- existing taxonomy (practice-areas.ts); jurisdiction_country is
  -- explicit (not assumed) so this table is ready for non-Mexican matters
  -- without a schema change.
  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  jurisdiction_state text,

  error_type public.intelligence_error_type,
  original_claim text NOT NULL,
  corrected_claim text,
  reason text NOT NULL,

  -- Same shape as case_finding_patches' source_document_id/source_page/
  -- source_quote, generalized to an array since a lesson may cite more than
  -- one grounding reference.
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- legal_authorities.id values only — never authority text/body. See
  -- header comment: this table must never become a second, unaudited copy
  -- of legal content.
  authority_refs jsonb NOT NULL DEFAULT '[]'::jsonb,

  validation_status public.lesson_validation_status NOT NULL DEFAULT 'ai_supported',
  confidence numeric,

  -- Retrieval-effectiveness counters for future retrieval-relevance ranking
  -- (Phase B). All start at 0; nothing here is backfilled or estimated.
  times_retrieved integer NOT NULL DEFAULT 0,
  times_successful integer NOT NULL DEFAULT 0,
  times_rejected integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.intelligence_lessons TO authenticated;
GRANT ALL ON public.intelligence_lessons TO service_role;
ALTER TABLE public.intelligence_lessons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_lessons_owner_select ON public.intelligence_lessons;
CREATE POLICY intelligence_lessons_owner_select ON public.intelligence_lessons
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE INDEX IF NOT EXISTS intelligence_lessons_case_idx
  ON public.intelligence_lessons(case_id);
CREATE INDEX IF NOT EXISTS intelligence_lessons_canonical_finding_idx
  ON public.intelligence_lessons(canonical_finding_id) WHERE canonical_finding_id IS NOT NULL;
-- Cross-case pattern aggregation (Phase B) will query by exactly this
-- triple — built now so that work starts from a real index, not a
-- migration deferred until it's needed.
CREATE INDEX IF NOT EXISTS intelligence_lessons_pattern_idx
  ON public.intelligence_lessons(matter_type, jurisdiction_country, error_type);

COMMENT ON TABLE public.intelligence_lessons IS
  'One row per verified Talk-to-Case correction, reshaped for cross-case learning. Always traceable to case_finding_patches.source_patch_id. Never stores legal_authorities content, only ids (authority_refs). validation_status starts at ai_supported (grounded + attorney-approved) and is never self-promoted by a model.';
