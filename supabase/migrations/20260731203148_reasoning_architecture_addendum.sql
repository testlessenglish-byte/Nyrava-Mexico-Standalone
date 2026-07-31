-- ============================================================================
-- Reasoning architecture addendum: multidimensional confidence, auditable
-- rationale, per-finding delta classification, and cross-agent audit.
--
-- Everything here is additive (new nullable columns / new tables) and
-- read/written by NEW deterministic code paths only — nothing here changes
-- how existing AI calls are chunked, sized, or scheduled, and nothing here
-- is required for a finding/report to exist (every consumer of case_findings
-- that predates this migration keeps working unchanged).
-- ============================================================================

-- 1. Multidimensional confidence + auditable rationale on findings ----------
-- Both are optional/nullable — populated going forward by
-- normalizeLlmFindings (src/lib/intelligence/findings.server.ts), never
-- backfilled, so historical findings simply show as "not yet computed"
-- rather than fabricating dimensions they were never scored on.
ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS confidence_dimensions jsonb,
  ADD COLUMN IF NOT EXISTS rationale jsonb;

COMMENT ON COLUMN public.case_findings.confidence_dimensions IS
  'Per-dimension confidence (extraction, factual, evidence_quality, legal, procedural, corpus_completeness, classification), each {level: high|moderate|low|indeterminate, reason: string}. Supplements the single confidence float — never replaces it, existing scoring math is untouched. See src/lib/intelligence/confidence-dimensions.ts.';
COMMENT ON COLUMN public.case_findings.rationale IS
  'Auditable legal rationale: {supporting_evidence, contrary_evidence, assumptions, unresolved_questions, applicable_authority, attorney_review_required, unsupported_language_flagged}. A structured trace of why a conclusion was reached, not private model chain-of-thought.';

-- 2. Per-finding version snapshots — enables true delta classification -----
-- (new / strengthened / weakened / resolved / removed) across report
-- regenerations, keyed on the same canonical_finding_id already produced by
-- src/lib/intelligence/canonical-id.ts. report_versions already snapshots
-- the rendered report; this snapshots the individual findings that fed it,
-- which the report snapshot alone doesn't preserve at per-finding
-- granularity.
CREATE TABLE IF NOT EXISTS public.finding_version_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  report_version integer NOT NULL,
  finding_id uuid NOT NULL,
  canonical_finding_id text,
  category text NOT NULL,
  severity text NOT NULL,
  confidence numeric NOT NULL,
  title text NOT NULL,
  -- Deterministic hash of title+description+severity+confidence, used to
  -- tell "strengthened/weakened" (same finding, changed substance) apart
  -- from "unchanged" (identical hash) without re-diffing full text.
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finding_version_snapshots_case_version_idx
  ON public.finding_version_snapshots (case_id, report_version);
CREATE INDEX IF NOT EXISTS finding_version_snapshots_canonical_idx
  ON public.finding_version_snapshots (case_id, canonical_finding_id);

GRANT SELECT ON public.finding_version_snapshots TO authenticated;
GRANT ALL ON public.finding_version_snapshots TO service_role;

ALTER TABLE public.finding_version_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own case finding snapshots" ON public.finding_version_snapshots;
CREATE POLICY "Users can view their own case finding snapshots"
  ON public.finding_version_snapshots
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = finding_version_snapshots.case_id AND c.user_id = auth.uid()));

COMMENT ON TABLE public.finding_version_snapshots IS
  'One row per finding per report version. Written by snapshotFindingVersions() immediately before finalizeReportChangeLog runs its diff. Never updated or deleted — a plain append-only log, same immutability posture as report_versions.';

-- 3. Cross-agent reasoning audit ---------------------------------------------
-- Result of a deterministic, no-AI-call consistency pass across every
-- agent's output for a case, run once after the pipeline's normal stage
-- loop finishes (see runCrossAgentValidator in
-- src/lib/intelligence/cross-agent-validator.server.ts). Advisory only —
-- never blocks or retries pipeline stages; it flags disagreements for
-- attorney review rather than silently picking a winner.
CREATE TABLE IF NOT EXISTS public.cross_agent_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_version integer,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warnings', 'conflicts')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cross_agent_audit_case_idx ON public.cross_agent_audit (case_id, created_at DESC);

GRANT SELECT ON public.cross_agent_audit TO authenticated;
GRANT ALL ON public.cross_agent_audit TO service_role;

ALTER TABLE public.cross_agent_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own case audits" ON public.cross_agent_audit;
CREATE POLICY "Users can view their own case audits"
  ON public.cross_agent_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.cross_agent_audit IS
  'One row per cross-agent validation pass. checks = every check performed (pass/fail + detail); conflicts = disagreements the validator could not resolve deterministically, surfaced for attorney review rather than silently resolved.';
