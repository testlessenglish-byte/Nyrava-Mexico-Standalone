-- ============================================================================
-- Judicial-hierarchy attribution on findings.
--
-- Bug: a finding extracted from a multi-instance resolution (e.g. an amparo
-- directo en revisión reviewing a Tribunal Colegiado sentencia) carried no
-- record of who asserted it or whether the highest instance in the case
-- adopted it. A Tribunal Colegiado holding the SCJN's Pleno expressly
-- revoked could therefore render in the Executive Dashboard's Hallazgos
-- Principales indistinguishably from an actual adopted SCJN holding. See
-- src/lib/intelligence/judicial-hierarchy.ts for the enforcement layer that
-- consumes these columns.
--
-- Additive by construction: nullable, no default, no backfill. Every
-- existing finding (and every finding from a materia that never runs the
-- judicial-hierarchy attribution prompt — the overwhelming majority of
-- cases) keeps working unchanged with all three columns NULL, which
-- judicial-hierarchy.ts treats as "not attributed" and passes through
-- every filter untouched.
-- ============================================================================

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS speaker_role text,
  ADD COLUMN IF NOT EXISTS proposition_type text,
  ADD COLUMN IF NOT EXISTS adoption_status text;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_speaker_role_check
    CHECK (speaker_role IS NULL OR speaker_role IN ('quejoso', 'autoridad', 'tribunal_colegiado', 'tribunal_local', 'scjn'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_proposition_type_check
    CHECK (proposition_type IS NULL OR proposition_type IN ('argument', 'holding', 'rejected_holding', 'procedural_fact', 'evidence', 'issue'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_adoption_status_check
    CHECK (adoption_status IS NULL OR adoption_status IN ('adopted', 'rejected', 'unresolved', 'historical'));

COMMENT ON COLUMN public.case_findings.speaker_role IS
  'Who asserted this proposition in the source judicial resolution: quejoso|autoridad|tribunal_colegiado|tribunal_local|scjn. NULL when the extraction pass did not run judicial-hierarchy attribution (most non-precedent-review findings). Distinct from affected_party, which says who a finding BENEFITS, not who stated it.';
COMMENT ON COLUMN public.case_findings.proposition_type IS
  'argument|holding|rejected_holding|procedural_fact|evidence|issue. rejected_holding marks a lower instance''s ruling a higher instance expressly overturned or superseded — this and adoption_status=rejected are the two signals that keep a finding out of the Executive Dashboard.';
COMMENT ON COLUMN public.case_findings.adoption_status IS
  'adopted|rejected|unresolved|historical — whether the highest instance present in the case adopted this proposition. Drives Executive Dashboard / Hallazgos Principales / Resumen Ejecutivo / Puntajes / Recomendaciones eligibility; see src/lib/intelligence/judicial-hierarchy.ts.';
