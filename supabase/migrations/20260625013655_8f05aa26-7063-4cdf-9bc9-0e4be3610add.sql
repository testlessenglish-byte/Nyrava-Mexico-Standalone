
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS pipeline_progress jsonb NOT NULL DEFAULT jsonb_build_object(
    'extraction','locked','analyzers','locked','agents','locked','evidence_intel','locked',
    'contradictions','locked','witness_intel','locked','discovery_gaps','locked',
    'theories','locked','strategy','locked','scoring','locked','report','locked'
  );

CREATE TABLE IF NOT EXISTS public.agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  run_order int NOT NULL,
  timeout_ms int NOT NULL DEFAULT 120000,
  retries int NOT NULL DEFAULT 1,
  confidence_threshold int NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_configs TO authenticated;
GRANT ALL ON public.agent_configs TO service_role;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_configs read all auth" ON public.agent_configs;
CREATE POLICY "agent_configs read all auth" ON public.agent_configs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "agent_configs admin write" ON public.agent_configs;
CREATE POLICY "agent_configs admin write" ON public.agent_configs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS agent_configs_updated ON public.agent_configs;
CREATE TRIGGER agent_configs_updated BEFORE UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.agent_configs (agent_key, display_name, run_order) VALUES
  ('extraction','Extraction Engine',1),
  ('analyzers','Analyzer Engine',2),
  ('agents','Agent Engine',3),
  ('evidence_intel','Evidence Intelligence',4),
  ('contradictions','Contradiction Engine',5),
  ('witness_intel','Witness Intelligence',6),
  ('discovery_gaps','Discovery Gap Engine',7),
  ('theories','Theory Generation',8),
  ('strategy','Strategy Synthesis',9),
  ('scoring','Scoring Engine',10),
  ('report','Report Generator',11)
ON CONFLICT (agent_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  stage text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pipeline_events TO authenticated;
GRANT ALL ON public.pipeline_events TO service_role;
ALTER TABLE public.pipeline_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pipeline_events read by case owner" ON public.pipeline_events;
CREATE POLICY "pipeline_events read by case owner" ON public.pipeline_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.cases c WHERE c.id = pipeline_events.case_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(),'admin')))
);
CREATE INDEX IF NOT EXISTS pipeline_events_case_idx ON public.pipeline_events(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feature_flags read all auth" ON public.feature_flags;
CREATE POLICY "feature_flags read all auth" ON public.feature_flags FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "feature_flags admin write" ON public.feature_flags;
CREATE POLICY "feature_flags admin write" ON public.feature_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP TRIGGER IF EXISTS feature_flags_updated ON public.feature_flags;
CREATE TRIGGER feature_flags_updated BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('intelligence_map', true,  'Interactive intelligence-map graph on case page'),
  ('live_feed',        true,  'Live processing feed on desktop'),
  ('ask_nyrava',       true,  'Floating Ask Nyrava button on mobile')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_audit_log admin read" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log admin read" ON public.admin_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
