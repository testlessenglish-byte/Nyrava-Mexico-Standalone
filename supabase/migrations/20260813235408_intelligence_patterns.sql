-- ============================================================================
-- Continuous Legal Intelligence Phase B — cross-case pattern aggregation.
--
-- A pattern is NOT a new source of truth. It is a real-time aggregation over
-- intelligence_lessons (Phase A — see migration
-- 20260813232206_intelligence_lessons.sql), grouped by
-- (user_id, matter_type, jurisdiction_country, jurisdiction_state,
-- error_type). Scoped per-user/account, same as every other table in this
-- schema (case_finding_patches, intelligence_lessons) — this does NOT share
-- error patterns across different NYRAVA accounts. Sharing patterns across
-- tenants would be a real product/privacy decision this migration
-- deliberately does not make.
--
-- Mexico-only per the current directive: jurisdiction_country is NOT NULL
-- DEFAULT 'MX' (matching intelligence_lessons), and nothing in this schema
-- or its consumers builds a non-Mexican code path.
--
-- tier is COMPUTED, never asserted — patterns.server.ts's
-- aggregateIntelligencePatterns() derives it purely from
-- COUNT(intelligence_lessons rows), so a pattern can never claim a
-- confidence level the underlying data doesn't support. sample_size counts
-- every lesson in the bucket; verified_count counts only
-- validation_status IN ('evidence_verified','multi_source_verified',
-- 'human_confirmed') — an 'ai_supported' lesson (grounded + attorney-
-- approved the individual correction, but never independently reviewed AS
-- a reusable lesson) contributes to sample_size but not to what actually
-- moves a pattern's tier, per Phase A's own validation_status doc comment.
-- ============================================================================

CREATE TYPE public.intelligence_pattern_tier AS ENUM (
  'insufficient_sample',
  'emerging',
  'candidate',
  'strong',
  'significant'
);

CREATE TYPE public.intelligence_pattern_status AS ENUM (
  'active',
  'monitoring',
  'retired'
);

CREATE TABLE IF NOT EXISTS public.intelligence_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  jurisdiction_state text,
  error_type public.intelligence_error_type NOT NULL,

  -- Short, human-readable summary — generated deterministically from the
  -- bucket's own dimensions (matter_type/error_type), never an LLM
  -- narrative that could drift from what the counts actually show.
  pattern_description text NOT NULL,

  sample_size integer NOT NULL DEFAULT 0,
  verified_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  -- verified_count / sample_size, computed alongside the counts — a plain
  -- ratio of real numbers, never a model-asserted confidence score.
  confidence numeric,
  tier public.intelligence_pattern_tier NOT NULL DEFAULT 'insufficient_sample',
  status public.intelligence_pattern_status NOT NULL DEFAULT 'monitoring',

  -- Every intelligence_lessons.id this aggregation is currently built from
  -- — lets a UI (Phase D) or an audit trail walk from a pattern back to
  -- its exact source lessons, and lets recordLesson's follow-up
  -- upsertIntelligencePattern call recompute in place rather than
  -- guessing what changed.
  supporting_lesson_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  -- Distinct case_findings.category values seen among this bucket's
  -- supporting lessons, computed at aggregation time. This is the self-
  -- audit match basis (auditFindingAgainstPatterns): a live finding under
  -- review is checked against these real, previously-corrected categories
  -- — never an invented category-to-error_type mapping table.
  category_samples text[] NOT NULL DEFAULT '{}'::text[],

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_recomputed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, matter_type, jurisdiction_country, jurisdiction_state, error_type)
);

GRANT SELECT ON public.intelligence_patterns TO authenticated;
GRANT ALL ON public.intelligence_patterns TO service_role;
ALTER TABLE public.intelligence_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_patterns_owner_select ON public.intelligence_patterns;
CREATE POLICY intelligence_patterns_owner_select ON public.intelligence_patterns
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS intelligence_patterns_lookup_idx
  ON public.intelligence_patterns(user_id, matter_type, jurisdiction_country, error_type);
CREATE INDEX IF NOT EXISTS intelligence_patterns_tier_idx
  ON public.intelligence_patterns(user_id, tier) WHERE status = 'active';

COMMENT ON TABLE public.intelligence_patterns IS
  'Cross-case aggregation over intelligence_lessons, grouped by (user_id, matter_type, jurisdiction, error_type). tier/confidence are always computed from real stored lesson counts (patterns.server.ts) — never asserted by a model. Self-auditing (auditFindingAgainstPatterns) only acts on tier >= candidate (>=5 verified lessons).';
