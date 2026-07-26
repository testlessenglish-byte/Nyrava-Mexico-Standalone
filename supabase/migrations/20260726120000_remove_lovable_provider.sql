-- Audit remediation: the `lovable` AI provider is not part of the Mexico
-- runtime. Remove every row and make the provider_type CHECK constraint
-- reject it, so no migration, admin UI action or seed can recreate it.
DELETE FROM public.ai_task_routing
 WHERE provider_id IN (SELECT id FROM public.ai_providers WHERE provider_type = 'lovable');
DELETE FROM public.ai_providers WHERE provider_type = 'lovable';

ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_type_check;
ALTER TABLE public.ai_providers ADD CONSTRAINT ai_providers_provider_type_check
  CHECK (provider_type = ANY (ARRAY['groq','openrouter','openai','anthropic','gemini','ollama','lmstudio']));
