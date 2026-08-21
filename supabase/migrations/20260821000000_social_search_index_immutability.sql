-- Repair PostgreSQL 42P17 on the Social people full-text index.
-- array_to_string(text[], text) is not accepted directly in an index expression
-- on supported Supabase PostgreSQL versions. The fixed wrapper is deterministic
-- for text inputs and a fixed text-search configuration.

drop index if exists public.social_people_search_idx;

create or replace function public.social_people_search_document(
  p_legal_name text,
  p_preferred_name text,
  p_aliases text[]
) returns tsvector
language sql
immutable
parallel safe
set search_path = public
as $$
  select to_tsvector(
    'simple'::regconfig,
    coalesce(p_legal_name,'') || ' ' ||
    coalesce(p_preferred_name,'') || ' ' ||
    coalesce(array_to_string(p_aliases,' '),'')
  );
$$;

create index social_people_search_idx
on public.social_people using gin (
  public.social_people_search_document(legal_name,preferred_name,aliases)
);
