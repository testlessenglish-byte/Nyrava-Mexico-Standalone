ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS jurisdiction_profile jsonb,
  ADD COLUMN IF NOT EXISTS procedural_compliance jsonb,
  ADD COLUMN IF NOT EXISTS legal_qa_report jsonb;

COMMENT ON COLUMN public.cases.jurisdiction_profile IS 'Perfil de jurisdiccion resuelto (pais, entidad, fuero, materia, codigos aplicables) - etapa jurisdiction_intel.';
COMMENT ON COLUMN public.cases.procedural_compliance IS 'Resultado del checklist de cumplimiento procesal por materia - etapa procedural_compliance.';
COMMENT ON COLUMN public.cases.legal_qa_report IS 'Auditoria del Control de Calidad Juridica - etapa legal_qa.';