
CREATE TABLE IF NOT EXISTS public.agent_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  run_id UUID NOT NULL,
  agent_key TEXT NOT NULL,
  agent_index INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','success','failed','skipped','blocked')),
  confidence NUMERIC,
  processing_time_ms INTEGER,
  tokens_used INTEGER,
  output_file TEXT,
  output JSONB,
  errors JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_logs_case_idx ON public.agent_logs(case_id, run_id, agent_index);
CREATE INDEX IF NOT EXISTS agent_logs_user_idx ON public.agent_logs(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_logs TO authenticated;
GRANT ALL ON public.agent_logs TO service_role;

ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own agent logs" ON public.agent_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own agent logs" ON public.agent_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own agent logs" ON public.agent_logs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER agent_logs_set_updated_at BEFORE UPDATE ON public.agent_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
