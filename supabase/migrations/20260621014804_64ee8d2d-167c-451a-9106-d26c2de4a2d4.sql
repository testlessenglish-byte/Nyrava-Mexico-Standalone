
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS investigator_summary text,
  ADD COLUMN IF NOT EXISTS discovery_analysis text,
  ADD COLUMN IF NOT EXISTS procedural_issues_report text,
  ADD COLUMN IF NOT EXISTS prosecution_theory_report text,
  ADD COLUMN IF NOT EXISTS defense_theory_report text,
  ADD COLUMN IF NOT EXISTS alternative_theory_report text,
  ADD COLUMN IF NOT EXISTS risk_analysis text,
  ADD COLUMN IF NOT EXISTS score_breakdown text,
  ADD COLUMN IF NOT EXISTS appendix_sources text,
  ADD COLUMN IF NOT EXISTS full_report jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tg_reports_updated_at') THEN
    CREATE TRIGGER tg_reports_updated_at BEFORE UPDATE ON public.reports
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END $$;

ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'intelligence_running';
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'intelligence_complete';
