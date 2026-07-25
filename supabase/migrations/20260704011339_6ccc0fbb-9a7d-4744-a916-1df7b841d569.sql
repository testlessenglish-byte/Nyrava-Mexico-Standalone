UPDATE public.ai_providers
SET default_model = 'deepseek/deepseek-chat-v3:free'
WHERE provider_type = 'openrouter'
  AND default_model = 'deepseek/deepseek-chat-v3';