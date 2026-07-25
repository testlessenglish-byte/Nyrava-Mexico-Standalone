UPDATE public.ai_providers SET enabled = false WHERE provider_type <> 'groq';
UPDATE public.ai_providers SET enabled = true, priority = 1 WHERE provider_type = 'groq';