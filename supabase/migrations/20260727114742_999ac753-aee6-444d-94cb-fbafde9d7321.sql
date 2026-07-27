DELETE FROM public.legal_authorities
WHERE source_url ILIKE '%diputados.gob.mx/LeyesBiblio/ref/%'
   OR (title = 'Años anteriores');