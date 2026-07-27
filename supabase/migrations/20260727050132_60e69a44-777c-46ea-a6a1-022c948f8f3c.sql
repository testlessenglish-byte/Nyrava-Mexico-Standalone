UPDATE public.ai_providers SET default_model = 'gemini-flash-latest', updated_at = now() WHERE provider_type = 'gemini';
UPDATE public.ai_task_routing SET model = NULL WHERE model ILIKE 'gemini-2.%';