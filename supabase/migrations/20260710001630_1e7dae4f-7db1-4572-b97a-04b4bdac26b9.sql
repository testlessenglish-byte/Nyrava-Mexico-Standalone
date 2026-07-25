
-- Relax the canonical validator: only enforce 17 sections when the payload
-- is explicitly canonical. Compat writes from the legacy `reports` shim
-- carry `_legacy: true` and skip section enforcement.
CREATE OR REPLACE FUNCTION public.tg_validate_canonical_analysis()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  required_sections TEXT[] := ARRAY[
    'ExecutiveSummary','Facts','Timeline','Evidence','Witnesses',
    'Contradictions','Discovery','Risks','Scores','Recommendations',
    'Strategy','CrossExam','Impeachment','WorkProduct','Appendices'
  ];
  section TEXT;
  missing TEXT[] := ARRAY[]::TEXT[];
  is_canonical BOOLEAN;
BEGIN
  is_canonical := COALESCE((NEW.analysis_payload->>'_canonical')::boolean, false);
  IF NEW.status = 'completed' AND is_canonical THEN
    FOREACH section IN ARRAY required_sections LOOP
      IF NOT (NEW.analysis_payload ? section) THEN
        missing := array_append(missing, section);
      END IF;
    END LOOP;
    IF array_length(missing, 1) > 0 THEN
      RAISE EXCEPTION 'canonical_analysis payload missing required sections: %', array_to_string(missing, ', ');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- reports compat table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE UNIQUE,
  user_id UUID,
  full_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  executive_summary TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  change_log JSONB,
  engines_summary JSONB,
  scores_suppressed BOOLEAN NOT NULL DEFAULT false,
  motions_suppressed BOOLEAN NOT NULL DEFAULT false,
  quality_blocked BOOLEAN NOT NULL DEFAULT false,
  report_mode TEXT,
  missing_evidence_report JSONB,
  contradictions_struct JSONB,
  findings_count INTEGER,
  case_strength_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_case ON public.reports(case_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read reports for their cases"
  ON public.reports FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = reports.case_id
        AND (c.user_id = auth.uid()
             OR public.same_firm(auth.uid(), c.user_id)
             OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE POLICY "Service role manages reports"
  ON public.reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Owners write reports for their cases"
  ON public.reports FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.cases c WHERE c.id = reports.case_id AND c.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.cases c WHERE c.id = reports.case_id AND c.user_id = auth.uid())
  );

CREATE TRIGGER reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Mirror every reports write into canonical_analysis
CREATE OR REPLACE FUNCTION public.tg_mirror_reports_to_canonical()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := COALESCE(NEW.full_report, '{}'::jsonb)
    || jsonb_build_object(
      '_legacy', true,
      'executive_summary', NEW.executive_summary,
      'engines_summary', NEW.engines_summary,
      'change_log', NEW.change_log,
      'missing_evidence_report', NEW.missing_evidence_report,
      'contradictions_struct', NEW.contradictions_struct,
      'findings_count', NEW.findings_count,
      'case_strength_score', NEW.case_strength_score,
      'scores_suppressed', NEW.scores_suppressed,
      'motions_suppressed', NEW.motions_suppressed,
      'quality_blocked', NEW.quality_blocked,
      'report_mode', NEW.report_mode
    );

  INSERT INTO public.canonical_analysis (case_id, status, analysis_payload, pipeline_stages)
  VALUES (NEW.case_id, 'orchestrating', payload, '{}'::jsonb)
  ON CONFLICT (case_id) DO UPDATE
    SET analysis_payload = EXCLUDED.analysis_payload;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mirror_reports_to_canonical
  AFTER INSERT OR UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_mirror_reports_to_canonical();

-- ------------------------------------------------------------
-- report_versions compat
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_log JSONB,
  document_count INTEGER,
  findings_count INTEGER,
  contradiction_count INTEGER,
  ess NUMERIC,
  score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

CREATE INDEX IF NOT EXISTS idx_report_versions_case ON public.report_versions(case_id);

GRANT SELECT, INSERT ON public.report_versions TO authenticated;
GRANT ALL ON public.report_versions TO service_role;

ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read report versions for their cases"
  ON public.report_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = report_versions.case_id
        AND (c.user_id = auth.uid()
             OR public.same_firm(auth.uid(), c.user_id)
             OR public.is_admin_tier(auth.uid()))
    )
  );

CREATE POLICY "Service role manages report versions"
  ON public.report_versions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
