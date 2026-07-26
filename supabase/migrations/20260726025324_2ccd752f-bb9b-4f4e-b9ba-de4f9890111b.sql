CREATE OR REPLACE FUNCTION public.tg_normalize_finding_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v text;
BEGIN
  IF NEW.finding_type IS NULL OR btrim(NEW.finding_type) = '' THEN
    RETURN NEW;
  END IF;

  v := upper(regexp_replace(btrim(NEW.finding_type), '[\s-]+', '_', 'g'));

  NEW.finding_type := CASE
    WHEN v IN ('DIRECT_EVIDENCE','DIRECT','EVIDENCE','FACT','FACTUAL','PRUEBA_DIRECTA','DATO_DE_PRUEBA','DATO_PRUEBA') THEN 'DIRECT_EVIDENCE'
    WHEN v IN ('EVIDENCE_BASED_INFERENCE','EVIDENCE_INFERENCE','INFERENCE','INFERRED','INFERENCIA','INFERENCIA_BASADA_EN_PRUEBA','INFERENCIA_PROBATORIA') THEN 'EVIDENCE_BASED_INFERENCE'
    WHEN v IN ('AI_THEORY','THEORY','AI','SPECULATION','TEORIA','TEORIA_IA','HIPOTESIS','HIPÓTESIS') THEN 'AI_THEORY'
    ELSE 'AI_THEORY'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_case_findings_normalize_finding_type ON public.case_findings;
CREATE TRIGGER tg_case_findings_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_findings
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

DROP TRIGGER IF EXISTS tg_case_theories_normalize_finding_type ON public.case_theories;
CREATE TRIGGER tg_case_theories_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_theories
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

DROP TRIGGER IF EXISTS tg_case_opportunities_normalize_finding_type ON public.case_opportunities;
CREATE TRIGGER tg_case_opportunities_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

DROP TRIGGER IF EXISTS tg_case_perspectives_normalize_finding_type ON public.case_perspectives;
CREATE TRIGGER tg_case_perspectives_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_perspectives
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();

DROP TRIGGER IF EXISTS tg_case_witnesses_normalize_finding_type ON public.case_witnesses;
CREATE TRIGGER tg_case_witnesses_normalize_finding_type
  BEFORE INSERT OR UPDATE OF finding_type ON public.case_witnesses
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_finding_type();