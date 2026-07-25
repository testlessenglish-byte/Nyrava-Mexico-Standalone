ALTER TABLE public.user_groq_keys ADD COLUMN IF NOT EXISTS priority integer;
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY is_active DESC, created_at ASC) AS rn
  FROM public.user_groq_keys
)
UPDATE public.user_groq_keys k SET priority = ranked.rn FROM ranked WHERE ranked.id = k.id AND k.priority IS NULL;
CREATE INDEX IF NOT EXISTS user_groq_keys_user_priority_idx ON public.user_groq_keys (user_id, priority);