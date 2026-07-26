-- Re-point any task routing that referenced a duplicate row to the surviving row
WITH keep AS (
  SELECT provider_type, min(id::text)::uuid AS keep_id
  FROM public.ai_providers GROUP BY provider_type
)
UPDATE public.ai_task_routing t
SET provider_id = k.keep_id
FROM public.ai_providers p JOIN keep k ON k.provider_type = p.provider_type
WHERE t.provider_id = p.id AND p.id <> k.keep_id;

DELETE FROM public.ai_providers p
USING (SELECT provider_type, min(id::text)::uuid AS keep_id FROM public.ai_providers GROUP BY provider_type) k
WHERE p.provider_type = k.provider_type AND p.id <> k.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_provider_type_key ON public.ai_providers (provider_type);