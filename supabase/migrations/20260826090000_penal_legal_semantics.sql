-- Penal legal semantics: expand attribution vocabulary and persist the
-- explicit party-aware mapping required before a court holding may affect a
-- score. Legacy enum values remain valid so existing findings are readable.

ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS benefited_party text,
  ADD COLUMN IF NOT EXISTS authority_level text,
  ADD COLUMN IF NOT EXISTS score_dimension text,
  ADD COLUMN IF NOT EXISTS reason_for_score_effect text;

ALTER TABLE public.case_findings
  DROP CONSTRAINT IF EXISTS case_findings_speaker_role_check,
  DROP CONSTRAINT IF EXISTS case_findings_proposition_type_check,
  DROP CONSTRAINT IF EXISTS case_findings_adoption_status_check,
  DROP CONSTRAINT IF EXISTS case_findings_benefited_party_check;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_speaker_role_check CHECK (
    speaker_role IS NULL OR speaker_role IN (
      'quejoso', 'autoridad', 'ministerio_publico', 'fiscal', 'defensa',
      'imputado', 'acusado', 'sentenciado', 'victima', 'ofendido',
      'testigo', 'perito', 'juez_control', 'tribunal_enjuiciamiento',
      'tribunal_alzada', 'tribunal_colegiado', 'tribunal_local', 'scjn'
    )
  ),
  ADD CONSTRAINT case_findings_proposition_type_check CHECK (
    proposition_type IS NULL OR proposition_type IN (
      'argument', 'holding', 'procedural_fact', 'evidence', 'issue',
      'case_fact', 'allegation', 'party_argument', 'prosecution_position',
      'defense_position', 'victim_position', 'witness_statement',
      'expert_opinion', 'physical_evidence', 'documentary_evidence',
      'digital_evidence', 'legal_rule', 'court_holding',
      'rejected_holding', 'procedural_event', 'evidence_gap', 'risk',
      'unresolved_question'
    )
  ),
  ADD CONSTRAINT case_findings_adoption_status_check CHECK (
    adoption_status IS NULL OR adoption_status IN (
      'adopted', 'rejected', 'not_reached', 'party_position', 'historical',
      'unknown', 'unresolved'
    )
  ),
  ADD CONSTRAINT case_findings_benefited_party_check CHECK (
    benefited_party IS NULL OR benefited_party IN (
      'defense', 'prosecution', 'both', 'neutral'
    )
  );

COMMENT ON COLUMN public.case_findings.benefited_party IS
  'Party benefiting from a separately sourced legal-effect mapping. Distinct from speaker_role and affected_party.';
COMMENT ON COLUMN public.case_findings.score_dimension IS
  'Score dimension affected by an explicit, sourced legal-effect mapping. NULL means the legal proposition is score-neutral.';
COMMENT ON COLUMN public.case_findings.reason_for_score_effect IS
  'Auditable reason why the finding affects score_dimension; required by application invariants for non-neutral adopted holdings.';
