update public.resource_official_sources
set source_urls = array['https://www.gob.mx/inm','https://www.gob.mx/inm/acciones-y-programas']
where slug = 'inm';

update public.resource_official_sources
set source_urls = array['https://www.gob.mx/difnacional','https://www.gob.mx/difnacional/articulos']
where slug = 'difnacional';

update public.resource_official_sources
set source_urls = array['https://www.gob.mx/cndh','https://www.cndh.org.mx/'],
    allowed_domains = array['cndh.org.mx','gob.mx','www.gob.mx']
where slug = 'cndh';