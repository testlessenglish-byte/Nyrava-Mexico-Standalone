
-- ============================================================
-- HARD CUTOVER: drop reports, create canonical_analysis
-- ============================================================

DROP TABLE IF EXISTS public.report_versions CASCADE;
DROP TABLE IF EXISTS public.reports CASCADE;

-- ------------------------------------------------------------
-- canonical_analysis: single source of truth for finalized case analysis
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.canonical_status AS ENUM ('orchestrating','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.canonical_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  status public.canonical_status NOT NULL DEFAULT 'orchestrating',
  pipeline_stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id)
);

CREATE INDEX idx_canonical_analysis_case ON public.canonical_analysis(case_id);
CREATE INDEX idx_canonical_analysis_status ON public.canonical_analysis(status);

GRANT SELECT ON public.canonical_analysis TO authenticated;
GRANT ALL ON public.canonical_analysis TO service_role;

ALTER TABLE public.canonical_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read canonical analysis for their cases"
  ON public.canonical_analysis
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases c
      WHERE c.id = canonical_analysis.case_id
        AND (
          c.user_id = auth.uid()
          OR public.same_firm(auth.uid(), c.user_id)
          OR public.is_admin_tier(auth.uid())
        )
    )
  );

CREATE POLICY "Service role manages canonical analysis"
  ON public.canonical_analysis
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- Validation trigger: enforce 17-section shape when status='completed'
-- ------------------------------------------------------------
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
BEGIN
  IF NEW.status = 'completed' THEN
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

CREATE TRIGGER validate_canonical_analysis
  BEFORE INSERT OR UPDATE ON public.canonical_analysis
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_canonical_analysis();

-- ------------------------------------------------------------
-- Version + updated_at bump on update
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_bump_canonical_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.analysis_payload IS DISTINCT FROM OLD.analysis_payload
     OR NEW.pipeline_stages IS DISTINCT FROM OLD.pipeline_stages
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bump_canonical_version
  BEFORE UPDATE ON public.canonical_analysis
  FOR EACH ROW EXECUTE FUNCTION public.tg_bump_canonical_version();

-- ============================================================
-- BYO API keys: extend user_groq_keys concept to any provider
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.ai_provider AS ENUM ('groq','openai','gemini','anthropic','openrouter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_ai_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider public.ai_provider NOT NULL,
  label TEXT,
  encrypted_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, key_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_user_ai_keys_user ON public.user_ai_keys(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_keys TO authenticated;
GRANT ALL ON public.user_ai_keys TO service_role;

ALTER TABLE public.user_ai_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own AI keys"
  ON public.user_ai_keys
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_ai_keys_updated_at
  BEFORE UPDATE ON public.user_ai_keys
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
