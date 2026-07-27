UPDATE public.legal_source_connectors
SET status = 'active',
    updated_at = now()
WHERE code = 'cjf';