-- ============================================================================
-- Finding supersession — Talk to Case as a CASE-STATE UPDATE, not another
-- document.
--
-- Bug: a Talk-to-Case attorney clarification was ingested exactly like any
-- other uploaded evidence file, and the analyzers/agents that regenerate on
-- rerun only ever clear-and-replace their OWN module's findings
-- (clearFindingsByModule). A conclusion the clarification corrects (e.g.
-- "Interés jurídico o legítimo no identificado en el corpus") could
-- therefore keep sitting in case_findings unmarked, right next to a fresh
-- finding drawn from the clarification that says the opposite — the report
-- then read as an original report with new findings appended, not one
-- internally-consistent re-analysis. See
-- src/lib/intelligence/case-state-reconciliation.server.ts, which is what
-- actually decides supersession (an LLM call whose output is verified
-- against the clarification's own real text before being applied — the same
-- "never trust an unverified claim" discipline as every other gate in this
-- codebase) and writes these columns.
--
-- Additive by construction: nullable, no default, no backfill. Every
-- existing finding keeps working unchanged with both columns NULL, which
-- listFindings() (findings.server.ts) — the single choke point the report,
-- dashboard, and scoring all read through — treats as "still active."
-- Deliberately NOT a case_timeline_events-style superseded_by uuid FK: a
-- clarification can retire several findings at once with no single
-- replacing row, so the audit trail is a reason string, not a foreign key.
-- ============================================================================

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

CREATE INDEX IF NOT EXISTS case_findings_active_idx
  ON public.case_findings(case_id)
  WHERE superseded_at IS NULL;

COMMENT ON COLUMN public.case_findings.superseded_at IS
  'Set when a later, verified case-state update (a Talk-to-Case clarification, currently the only source) established that this finding no longer reflects the case record. NULL = still active. listFindings() excludes superseded rows by default — the row itself is NEVER deleted, preserving the audit trail.';
COMMENT ON COLUMN public.case_findings.superseded_reason IS
  'Human-readable explanation of why this finding was superseded and by what, including a verbatim quote from the superseding source. NULL whenever superseded_at is NULL.';
