
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS groq_key_id uuid NULL;

CREATE INDEX IF NOT EXISTS ai_usage_user_key_created_idx
  ON public.ai_usage (user_id, groq_key_id, created_at DESC);

-- Best-effort backfill: attribute each historical ai_usage row to the
-- user_groq_keys row that was the most recent one created at or before
-- the usage timestamp (matches the previous created-at slicing heuristic).
UPDATE public.ai_usage u
SET groq_key_id = k.id
FROM (
  SELECT DISTINCT ON (usage.id) usage.id AS usage_id, keys.id
  FROM public.ai_usage usage
  JOIN public.user_groq_keys keys
    ON keys.user_id = usage.user_id
   AND keys.created_at <= usage.created_at
  WHERE usage.groq_key_id IS NULL
  ORDER BY usage.id, keys.created_at DESC
) k
WHERE u.id = k.usage_id
  AND u.groq_key_id IS NULL;
