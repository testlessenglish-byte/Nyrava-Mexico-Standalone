DELETE FROM public.ai_task_routing WHERE provider_id IN (SELECT id FROM public.ai_providers WHERE provider_type = 'lovable');
DELETE FROM public.ai_providers WHERE provider_type = 'lovable';
UPDATE public.ai_providers SET enabled = true WHERE provider_type IN ('gemini','openrouter');