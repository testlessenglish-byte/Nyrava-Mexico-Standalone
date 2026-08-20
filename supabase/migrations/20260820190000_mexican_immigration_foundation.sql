-- Mexican immigration foundation: searchable tenant-scoped metadata and official-source connectors.
-- Existing case/document RLS remains authoritative; the search RPC is SECURITY INVOKER.

create index if not exists cases_migratorio_metadata_gin
  on public.cases using gin (matter_metadata)
  where case_type = 'migratorio' and deleted_at is null;

create index if not exists cases_migratorio_internal_number_idx
  on public.cases ((lower(btrim(matter_metadata->>'internal_matter_number'))))
  where case_type = 'migratorio' and deleted_at is null;

create index if not exists cases_migratorio_authority_status_idx
  on public.cases (
    (lower(btrim(matter_metadata->>'responsible_authority'))),
    (lower(btrim(matter_metadata->>'matter_status')))
  )
  where case_type = 'migratorio' and deleted_at is null;

insert into public.legal_source_connectors (code, name, description, base_url, status, config)
values
  (
    'inm_official',
    'Instituto Nacional de Migración',
    'Official Mexican immigration requirements, procedures and publications.',
    'https://www.inm.gob.mx/',
    'active',
    '{"jurisdiction":"MX","materias":["migratorio"],"fail_open_with_verified_cache":true}'::jsonb
  ),
  (
    'sre_consular_official',
    'Secretaría de Relaciones Exteriores',
    'Official Mexican visa, nationality, naturalization and consular requirements.',
    'https://www.gob.mx/sre',
    'active',
    '{"jurisdiction":"MX","materias":["migratorio"],"fail_open_with_verified_cache":true}'::jsonb
  ),
  (
    'comar_official',
    'Comisión Mexicana de Ayuda a Refugiados',
    'Official refugee-status and complementary-protection information.',
    'https://www.gob.mx/comar',
    'active',
    '{"jurisdiction":"MX","materias":["migratorio"],"fail_open_with_verified_cache":true}'::jsonb
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  base_url = excluded.base_url,
  config = public.legal_source_connectors.config || excluded.config,
  updated_at = now();

create or replace function public.normalize_mx_search(value text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    translate(
      lower(coalesce(value, '')),
      'áéíóúüñàèìòùäëïöÿç',
      'aeiouunaeiouaeiouyc'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  );
$$;

create or replace function public.search_immigration_cases(
  p_query text,
  p_limit integer default 50
)
returns table (
  case_id uuid,
  case_name text,
  internal_matter_number text,
  client_name text,
  nationality text,
  immigration_subtype text,
  responsible_authority text,
  matter_status text,
  passport_masked text,
  matched_document_filename text,
  updated_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with access_context as (
    select exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role::text in ('super_admin','admin','firm_owner','firm_admin','attorney')
    ) as can_search_sensitive
  ),
  scoped as (
    select
      c.id,
      c.name,
      c.matter_metadata,
      c.updated_at,
      d.filename,
      public.normalize_mx_search(
        concat_ws(
          ' ',
          c.name,
          c.matter_metadata->>'internal_matter_number',
          c.matter_metadata->>'client_name',
          array_to_string(
            array(select jsonb_array_elements_text(coalesce(c.matter_metadata->'client_aliases', '[]'::jsonb))),
            ' '
          ),
          c.matter_metadata->>'nationality',
          c.matter_metadata->>'immigration_subtype',
          c.matter_metadata->>'responsible_authority',
          c.matter_metadata->>'matter_status',
          c.matter_metadata->>'responsible_attorney',
          c.matter_metadata->>'inm_expediente_number',
          c.matter_metadata->>'comar_expediente_number',
          c.matter_metadata->>'sre_consular_number',
          c.matter_metadata->>'tfja_court_case_number',
          array_to_string(
            array(select jsonb_array_elements_text(coalesce(c.matter_metadata->'tags', '[]'::jsonb))),
            ' '
          ),
          d.filename
        )
      ) as haystack,
      public.normalize_mx_search(c.matter_metadata->>'passport_number') as passport_search,
      ac.can_search_sensitive
    from public.cases c
    cross join access_context ac
    left join public.documents d
      on d.case_id = c.id
      and d.archived_at is null
    where c.case_type = 'migratorio'
      and c.deleted_at is null
  ),
  matched as (
    select *
    from scoped s
    where public.normalize_mx_search(p_query) = ''
       or not exists (
         select 1
         from unnest(string_to_array(public.normalize_mx_search(p_query), ' ')) token
         where token <> ''
           and s.haystack not like '%' || token || '%'
           and (not s.can_search_sensitive or s.passport_search not like '%' || token || '%')
       )
  )
  select distinct on (m.id)
    m.id,
    m.name,
    nullif(m.matter_metadata->>'internal_matter_number', ''),
    nullif(m.matter_metadata->>'client_name', ''),
    nullif(m.matter_metadata->>'nationality', ''),
    nullif(m.matter_metadata->>'immigration_subtype', ''),
    nullif(m.matter_metadata->>'responsible_authority', ''),
    nullif(m.matter_metadata->>'matter_status', ''),
    case
      when nullif(m.matter_metadata->>'passport_number', '') is null then null
      else repeat('•', least(8, greatest(4, length(m.matter_metadata->>'passport_number') - 4)))
        || right(m.matter_metadata->>'passport_number', 4)
    end,
    m.filename,
    m.updated_at
  from matched m
  order by m.id, m.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.search_immigration_cases(text, integer) from public;
grant execute on function public.search_immigration_cases(text, integer) to authenticated;
