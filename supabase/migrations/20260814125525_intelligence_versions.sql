-- ============================================================================
-- Continuous Legal Intelligence Phase C — versioned deployment history.
--
-- One row per deployed (or rolled-back) change to a user's
-- intelligence_validation_rules. Rows are NEVER edited or deleted — a
-- rollback INSERTS a new version row (rollback_reference pointing at the
-- version it reverses) rather than mutating history, so "what did NYRAVA
-- believe, why, what replaced it" is always fully reconstructable from this
-- table alone (directive §20).
--
-- version is sequential PER USER, starting at 1, computed by
-- deployProposal (proposals.server.ts) as MAX(version)+1 — matches every
-- other per-user-scoped table in this schema (intelligence_lessons,
-- intelligence_patterns).
-- ============================================================================

CREATE TYPE public.intelligence_version_deployment_status AS ENUM (
  'deployed',
  'rolled_back'
);

CREATE TABLE IF NOT EXISTS public.intelligence_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer NOT NULL,

  proposal_id uuid REFERENCES public.intelligence_improvement_proposals(id),

  -- Exact rule diff this version deployed: { rule_id, matter_type,
  -- jurisdiction_country, error_type, old: {...} | null, new: {...} }.
  -- A historical snapshot, not a source of truth — the live rule set is
  -- always intelligence_validation_rules.is_active = true.
  changes jsonb NOT NULL,
  supporting_lesson_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  supporting_pattern_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],

  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  deployment_status public.intelligence_version_deployment_status NOT NULL DEFAULT 'deployed',
  -- Set on a rollback version: the version it reverses. Also settable on
  -- the ORIGINAL version once rolled back, pointing forward at the
  -- rollback — either direction is fine, proposals.server.ts documents
  -- which it writes.
  rollback_reference uuid REFERENCES public.intelligence_versions(id),

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, version)
);

GRANT SELECT ON public.intelligence_versions TO authenticated;
GRANT ALL ON public.intelligence_versions TO service_role;
ALTER TABLE public.intelligence_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_versions_owner_select ON public.intelligence_versions;
CREATE POLICY intelligence_versions_owner_select ON public.intelligence_versions
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS intelligence_versions_user_idx
  ON public.intelligence_versions(user_id, version DESC);

COMMENT ON TABLE public.intelligence_versions IS
  'Append-only deployment history for intelligence_validation_rules changes. Every reports.adaptive_intelligence_version stamp refers to a version number here, so a past report''s forensic record never silently changes when the rules improve later.';

-- Forensic reproducibility (directive §15): every future report records
-- which deployed intelligence version was active when it was generated.
-- Nullable/additive like every other report-versioning column already in
-- this table (canonical_version, execution_id) — existing reports are
-- simply NULL, meaning "predates this version tracking."
--
-- Deliberately NOT reusing reports.intelligence_version: that column
-- already exists (migration 20260621155559) and means something different
-- — a hardcoded pipeline/engine tag ("intel-v2"), shown to users as
-- "Engine Version" in exports (export.ts). Renaming it would be a breaking
-- change to an already-shipped, already-displayed field; this is a new,
-- separate column instead.
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS adaptive_intelligence_version integer;

COMMENT ON COLUMN public.reports.adaptive_intelligence_version IS
  'The intelligence_versions.version (per this report''s user) that was the latest DEPLOYED version at report-generation time, or NULL if none had been deployed yet. Distinct from reports.intelligence_version (the pipeline/engine tag) — this tracks the adaptive validation-rule layer specifically.';
