
ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_type_check;
ALTER TABLE public.ai_providers ADD CONSTRAINT ai_providers_provider_type_check
  CHECK (provider_type = ANY (ARRAY['groq','openrouter','openai','anthropic','gemini','lovable','ollama','lmstudio']));

INSERT INTO public.ai_providers (provider_type, display_name, enabled, priority, base_url, default_model, secret_name)
SELECT 'lovable', 'Lovable AI Gateway (Gemini)', true, 10, 'https://ai.gateway.lovable.dev/v1', 'google/gemini-2.5-flash', 'LOVABLE_API_KEY'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_providers WHERE provider_type = 'lovable');

INSERT INTO public.ai_providers (provider_type, display_name, enabled, priority, base_url, default_model, secret_name)
SELECT 'gemini', 'Google Gemini', true, 15, 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.0-flash', 'GEMINI_API_KEY'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_providers WHERE provider_type = 'gemini');

UPDATE public.ai_providers SET enabled = false WHERE provider_type = 'openrouter';
