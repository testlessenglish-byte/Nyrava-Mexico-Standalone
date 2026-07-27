UPDATE public.legal_source_connectors
SET name = 'Justicia Electoral (TECDMX · Ciudad de México)',
    status = 'active',
    base_url = 'https://www.tecdmx.org.mx/index.php/sentencias_inicio/'
WHERE code = 'tepjf';