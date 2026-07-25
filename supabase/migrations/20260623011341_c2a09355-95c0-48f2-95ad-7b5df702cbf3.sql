
CREATE TABLE public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type text NOT NULL CHECK (provider_type IN ('groq','openrouter','openai','anthropic','gemini','ollama','lmstudio')),
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  base_url text,
  default_model text,
  secret_name text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_providers TO authenticated;
GRANT ALL ON public.ai_providers TO service_role;
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_providers admin read"  ON public.ai_providers FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ai_providers admin write" ON public.ai_providers FOR ALL    TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER ai_providers_updated BEFORE UPDATE ON public.ai_providers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.ai_task_routing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL UNIQUE CHECK (task IN ('extraction','analysis','reasoning','report','chat')),
  provider_id uuid REFERENCES public.ai_providers(id) ON DELETE SET NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_task_routing TO authenticated;
GRANT ALL ON public.ai_task_routing TO service_role;
ALTER TABLE public.ai_task_routing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_task_routing admin read"  ON public.ai_task_routing FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ai_task_routing admin write" ON public.ai_task_routing FOR ALL    TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER ai_task_routing_updated BEFORE UPDATE ON public.ai_task_routing FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Extend ai_usage with provider column if missing
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS provider_type text;

-- Seed defaults so out-of-box failover still works
INSERT INTO public.ai_providers (provider_type, display_name, enabled, priority, base_url, default_model, secret_name) VALUES
 ('groq',       'Groq',        true, 10, 'https://api.groq.com/openai/v1', 'openai/gpt-oss-120b',     'GROQ_API_KEY'),
 ('openrouter', 'OpenRouter',  true, 20, 'https://openrouter.ai/api/v1',   'deepseek/deepseek-chat-v3','OPENROUTER_API_KEY');
