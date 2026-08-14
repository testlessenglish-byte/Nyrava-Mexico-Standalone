-- ============================================================================
-- Evidence relationship taxonomy — Rule 6 of the report-quality audit
-- (2026-08-14, ADR-2239-2018-180906): finding_type (DIRECT_EVIDENCE /
-- EVIDENCE_BASED_INFERENCE / AI_THEORY) answers "how strong is the citation
-- floor", but never "what KIND of thing does the cited evidence actually
-- establish" — a verbatim, verified quote of a party's own allegation
-- passes the citation floor exactly like a verbatim quote of the tribunal's
-- own ruling. The audit is explicit: NYRAVA must never present its own
-- inference, or a party's mere allegation, as if it were a tribunal
-- determination.
--
-- evidence_relationship is that missing axis, computed deterministically by
-- classifyEvidenceRelationship (evidence-gate.server.ts) as a byproduct of
-- the same verified-quote data the gate already has — never a separate
-- subsystem, never an LLM call. Only 'SOURCE_HOLDING'/'SOURCE_FACT' are
-- ever eligible to back a DIRECT_EVIDENCE finding_type; that invariant is
-- enforced in application code (diagnoseEvidenceGate), not by this
-- constraint, since it's a cross-column rule.
--
-- Nullable, no default, no backfill — every existing finding keeps working
-- unchanged with evidence_relationship NULL, matching every prior additive
-- case_findings column this session (see
-- 20260813232400_case_findings_lifecycle_status.sql,
-- 20260809150000_finding_supersession.sql).
-- ============================================================================

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS evidence_relationship text;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_evidence_relationship_check
  CHECK (
    evidence_relationship IS NULL OR evidence_relationship IN (
      'SOURCE_HOLDING',
      'SOURCE_FACT',
      'SOURCE_ARGUMENT',
      'DERIVED_INFERENCE',
      'UNPROVEN_ABSENCE',
      'MISSING_EVIDENCE'
    )
  );

CREATE INDEX IF NOT EXISTS case_findings_evidence_relationship_idx
  ON public.case_findings(case_id, evidence_relationship) WHERE evidence_relationship IS NOT NULL;

COMMENT ON COLUMN public.case_findings.evidence_relationship IS
  'What KIND of relationship this finding has to its cited evidence (SOURCE_HOLDING/SOURCE_FACT/SOURCE_ARGUMENT/DERIVED_INFERENCE/UNPROVEN_ABSENCE/MISSING_EVIDENCE) — distinct from finding_type''s evidentiary-strength axis. Only SOURCE_HOLDING/SOURCE_FACT are ever eligible to back a DIRECT_EVIDENCE finding_type (enforced in evidence-gate.server.ts, not by this constraint). NULL for findings generated before this taxonomy existed, or persisted through a path that does not run the evidence gate.';
