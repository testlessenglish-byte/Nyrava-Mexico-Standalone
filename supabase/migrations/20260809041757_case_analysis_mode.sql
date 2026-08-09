-- ============================================================================
-- Case Analysis Mode — orchestration axis, orthogonal to case_type (materia)
-- and analysis_mode (evidence strictness). Tells the existing engines what
-- OBJECTIVE they are pursuing: standard case preparation ("ongoing", the
-- default — every existing case keeps this value and therefore keeps its
-- exact current behavior), or one of three retrospective forensic-audit
-- postures for a concluded case. See
-- src/lib/intelligence/case-analysis-mode.ts for the enforcement layer.
--
-- NOT NULL DEFAULT 'ongoing': every existing row gets 'ongoing' on migrate,
-- identical to today's behavior. Additive by construction.
-- ============================================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS case_analysis_mode text NOT NULL DEFAULT 'ongoing';

ALTER TABLE public.cases
  ADD CONSTRAINT cases_case_analysis_mode_check
    CHECK (case_analysis_mode IN ('ongoing', 'concluded_audit', 'judgment_audit', 'appeal_routes'));

COMMENT ON COLUMN public.cases.case_analysis_mode IS
  'ongoing (default, case preparation) | concluded_audit (retrospective forensic audit) | judgment_audit (focused on the final resolution) | appeal_routes (focused on identifying legally supportable challenge routes). See src/lib/intelligence/case-analysis-mode.ts.';

-- ----------------------------------------------------------------------------
-- Completed-case finding classification — additive, nullable, no backfill.
-- Populated only by findings generated under a completed-case analysis mode
-- (the vast majority of findings, generated under "ongoing", leave this
-- NULL and are untouched — see normAuditClassification in findings.server.ts,
-- which follows the exact same additive pattern as speaker_role/
-- proposition_type/adoption_status from the judicial-hierarchy migration).
-- ----------------------------------------------------------------------------

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS audit_classification text;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_audit_classification_check
    CHECK (
      audit_classification IS NULL OR audit_classification IN (
        'VERIFIED_FACT',
        'VERIFIED_COURT_HOLDING',
        'VERIFIED_LEGAL_RULE',
        'SUPPORTED_INFERENCE',
        'POTENTIAL_ISSUE',
        'EVIDENCE_GAP',
        'NOT_FOUND'
      )
    );

COMMENT ON COLUMN public.case_findings.audit_classification IS
  'VERIFIED_FACT|VERIFIED_COURT_HOLDING|VERIFIED_LEGAL_RULE|SUPPORTED_INFERENCE|POTENTIAL_ISSUE|EVIDENCE_GAP|NOT_FOUND — strict finding classification used by completed-case analysis modes. NULL for findings generated outside those modes. See src/lib/intelligence/case-analysis-mode.ts.';
