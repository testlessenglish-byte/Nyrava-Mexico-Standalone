update public.legal_source_connectors
set name = 'Legislación Estatal (Orden Jurídico Nacional)',
    base_url = 'https://www.ordenjuridico.gob.mx',
    description = 'Constituciones, códigos y leyes de los 32 estados, vía el agregador oficial de SEGOB',
    status = 'active',
    updated_at = now()
where code = 'state_gazettes';