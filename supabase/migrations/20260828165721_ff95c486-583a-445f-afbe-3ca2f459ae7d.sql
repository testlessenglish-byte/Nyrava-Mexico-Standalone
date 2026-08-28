alter table public.social_institutions
  add column if not exists source_slug text,
  add column if not exists source_url text,
  add column if not exists source_type text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists contact_verification text not null default 'unverified',
  add column if not exists source_verified_fields text[] not null default '{}',
  add column if not exists admin_locked_fields text[] not null default '{}';

do $$ begin
  alter table public.social_institutions add constraint social_institutions_contact_verification_check
    check (contact_verification in ('source_verified','manually_verified','unverified'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.social_institutions add constraint social_institutions_source_type_check
    check (source_type is null or source_type in ('official_api','official_website','official_directory','approved_authoritative','manual'));
exception when duplicate_object then null; end $$;

create unique index if not exists social_institutions_source_slug_idx
  on public.social_institutions(source_slug) where source_slug is not null;

comment on column public.social_institutions.contact_verification is
  'source_verified = obtained directly from an approved official source; manually_verified = confirmed by an authorized administrator; unverified = present but reliability not established. Never set from AI-generated content.';
comment on column public.social_institutions.admin_locked_fields is
  'Fields corrected by an administrator. The automated refresh never overwrites these.';

create table if not exists public.resource_official_sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  official_name text not null,
  institution_type text not null,
  jurisdiction_level text not null default 'federal',
  state_code text,
  services text[] not null default '{}',
  coverage_levels text[] not null default '{national}',
  populations text[] not null default '{}',
  source_urls text[] not null,
  source_type text not null default 'official_website',
  allowed_domains text[] not null default '{}',
  website text,
  refresh_interval_days integer not null default 30,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_type in ('official_api','official_website','official_directory','approved_authoritative'))
);

create table if not exists public.resource_contact_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  institution_id uuid references public.social_institutions(id) on delete set null,
  status text not null,
  source_url text,
  fields_updated text[] not null default '{}',
  detail text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (status in ('updated','unchanged','skipped','failed'))
);

create index if not exists resource_contact_refresh_runs_idx
  on public.resource_contact_refresh_runs(slug, started_at desc);

grant select on public.resource_official_sources to authenticated;
grant all on public.resource_official_sources to service_role;
grant select on public.resource_contact_refresh_runs to authenticated;
grant all on public.resource_contact_refresh_runs to service_role;

alter table public.resource_official_sources enable row level security;
alter table public.resource_contact_refresh_runs enable row level security;

drop policy if exists resource_official_sources_read on public.resource_official_sources;
create policy resource_official_sources_read on public.resource_official_sources
  for select to authenticated using (true);
drop policy if exists resource_official_sources_manage on public.resource_official_sources;
create policy resource_official_sources_manage on public.resource_official_sources
  for all to authenticated
  using (public.is_admin_tier(auth.uid()))
  with check (public.is_admin_tier(auth.uid()));

drop policy if exists resource_refresh_runs_read on public.resource_contact_refresh_runs;
create policy resource_refresh_runs_read on public.resource_contact_refresh_runs
  for select to authenticated using (public.is_admin_tier(auth.uid()));

insert into public.resource_official_sources
  (slug, official_name, institution_type, state_code, services, populations, source_urls, source_type, allowed_domains, website)
values
  ('comar','Comisión Mexicana de Ayuda a Refugiados (COMAR)','government',null,'{legal_aid,social_support,government}','{refugees,migrants}','{https://www.gob.mx/comar,https://www.gob.mx/comar/documentos}','official_website','{gob.mx,comar.gob.mx}','https://www.gob.mx/comar'),
  ('cndh','Comisión Nacional de los Derechos Humanos (CNDH)','government',null,'{legal_aid,government}','{general}','{https://www.cndh.org.mx/}','official_website','{cndh.org.mx}','https://www.cndh.org.mx/'),
  ('inm','Instituto Nacional de Migración (INM)','government',null,'{government,social_support}','{migrants}','{https://www.gob.mx/inm,https://www.gob.mx/inm/acciones-y-programas}','official_website','{gob.mx,inami.gob.mx,inm.gob.mx}','https://www.gob.mx/inm'),
  ('ceav','Comisión Ejecutiva de Atención a Víctimas (CEAV)','government',null,'{legal_aid,psychosocial,social_support}','{victims}','{https://www.gob.mx/ceav,https://www.gob.mx/ceav/acciones-y-programas}','official_website','{gob.mx,ceav.gob.mx}','https://www.gob.mx/ceav'),
  ('difnacional','Sistema Nacional para el Desarrollo Integral de la Familia (DIF)','government',null,'{social_support,psychosocial,shelter}','{children,families}','{https://www.gob.mx/difnacional,https://www.gob.mx/difnacional/acciones-y-programas}','official_website','{gob.mx,dif.gob.mx}','https://www.gob.mx/difnacional'),
  ('conavim','Comisión Nacional para Prevenir y Erradicar la Violencia contra las Mujeres (CONAVIM)','government',null,'{legal_aid,psychosocial,shelter}','{women,victims}','{https://www.gob.mx/conavim}','official_website','{gob.mx,conavim.gob.mx}','https://www.gob.mx/conavim'),
  ('inmujeres','Instituto Nacional de las Mujeres (INMUJERES)','government',null,'{social_support,legal_aid}','{women}','{https://www.gob.mx/inmujeres}','official_website','{gob.mx,inmujeres.gob.mx}','https://www.gob.mx/inmujeres'),
  ('profedet','Procuraduría Federal de la Defensa del Trabajo (PROFEDET)','government',null,'{legal_aid,government}','{workers}','{https://www.gob.mx/profedet}','official_website','{gob.mx,profedet.gob.mx,stps.gob.mx}','https://www.gob.mx/profedet'),
  ('profeco','Procuraduría Federal del Consumidor (PROFECO)','government',null,'{legal_aid,government}','{general}','{https://www.gob.mx/profeco}','official_website','{gob.mx,profeco.gob.mx}','https://www.gob.mx/profeco'),
  ('sipinna','Sistema Nacional de Protección de Niñas, Niños y Adolescentes (SIPINNA)','government',null,'{social_support,government}','{children}','{https://www.gob.mx/sipinna}','official_website','{gob.mx,sipinna.gob.mx}','https://www.gob.mx/sipinna')
on conflict (slug) do update set
  official_name=excluded.official_name,
  source_urls=excluded.source_urls,
  allowed_domains=excluded.allowed_domains,
  website=excluded.website,
  updated_at=now();

insert into public.social_institutions
  (org_id, name, official_name, institution_type, jurisdiction_level, services, populations,
   coverage_levels, website, source_slug, source_url, source_type, contact_verification,
   source_verified_fields, active, status, verification_status)
select null, s.official_name, s.official_name, s.institution_type, s.jurisdiction_level,
       s.services, s.populations, s.coverage_levels, s.website, s.slug, s.website, s.source_type,
       'source_verified', array['website']::text[], true, 'unverified', 'unverified'
from public.resource_official_sources s
where s.active
  and not exists (select 1 from public.social_institutions i where i.source_slug = s.slug);

update public.social_institutions i
set website = coalesce(nullif(i.website,''), s.website),
    source_url = coalesce(i.source_url, s.website),
    source_type = coalesce(i.source_type, s.source_type)
from public.resource_official_sources s
where i.source_slug = s.slug;

drop function if exists public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer);

create or replace function public.search_resource_network(
  p_query text default null,p_state text default null,p_municipality text default null,
  p_latitude double precision default null,p_longitude double precision default null,p_radius_km double precision default null,
  p_service text default null,p_urgency text default null,p_population text default null,p_language text default null,
  p_cost_type text default null,p_availability text default null,p_limit integer default 50
) returns table(
  id uuid,official_name text,institution_type text,services text[],description text,state_code text,municipality text,
  address text,latitude double precision,longitude double precision,phone text,whatsapp text,email text,website text,
  hours jsonb,languages text[],populations text[],eligibility text,required_documents text[],cost_type text,
  appointment_required boolean,walk_in_available boolean,emergency_available boolean,remote_available boolean,
  referral_methods text[],coverage_levels text[],capacity_status text,verification_status text,verified_at timestamptz,
  next_verification_at timestamptz,status text,distance_km double precision,match_score integer,match_explanation text[],
  contact_verification text,source_url text,source_type text,last_checked_at timestamptz
) language sql stable security invoker set search_path=public as $$
  with ranked as (
    select i.*,
      case when p_latitude is not null and p_longitude is not null and i.latitude is not null and i.longitude is not null then
        6371 * 2 * asin(sqrt(power(sin(radians(i.latitude-p_latitude)/2),2)+cos(radians(p_latitude))*cos(radians(i.latitude))*power(sin(radians(i.longitude-p_longitude)/2),2)))
      end as km,
      (case when p_service is not null and p_service=any(i.services) then 35 else 0 end+
       case when p_state is not null and (upper(i.state_code)=upper(p_state) or upper(p_state)=any(i.coverage_states)) then 20 else 0 end+
       case when p_municipality is not null and (lower(i.municipality)=lower(p_municipality) or lower(p_municipality)=any(i.coverage_municipalities)) then 15 else 0 end+
       case when p_language is not null and lower(p_language)=any(select lower(x) from unnest(i.languages)x) then 10 else 0 end+
       case when p_population is not null and lower(p_population)=any(select lower(x) from unnest(i.populations)x) then 10 else 0 end+
       case when i.status='verified' then 10 else 0 end+
       case when p_urgency='emergency' and i.emergency_available then 20 else 0 end) as score
    from public.social_institutions i
    where i.active and i.status not in ('closed','archived')
      and (p_query is null or to_tsvector('spanish',coalesce(i.official_name,i.name,'')||' '||coalesce(i.description,'')||' '||array_to_string(i.services,' ')) @@ plainto_tsquery('spanish',p_query))
      and (p_state is null or upper(i.state_code)=upper(p_state) or upper(p_state)=any(i.coverage_states) or 'national'=any(i.coverage_levels) or i.remote_available)
      and (p_municipality is null or lower(i.municipality)=lower(p_municipality) or lower(p_municipality)=any(i.coverage_municipalities) or 'statewide'=any(i.coverage_levels) or 'national'=any(i.coverage_levels) or i.remote_available)
      and (p_service is null or p_service=any(i.services))
      and (p_language is null or lower(p_language)=any(select lower(x) from unnest(i.languages)x))
      and (p_population is null or lower(p_population)=any(select lower(x) from unnest(i.populations)x))
      and (p_cost_type is null or i.cost_type=p_cost_type)
      and (p_availability is null or i.capacity_status=p_availability)
      and (p_urgency is null or p_urgency<>'emergency' or i.emergency_available)
  )
  select r.id,coalesce(r.official_name,r.name),r.institution_type,r.services,r.description,r.state_code,r.municipality,
    case when r.location_confidential then null else r.address end,
    case when r.location_confidential then null else r.latitude end,
    case when r.location_confidential then null else r.longitude end,
    r.phone,r.whatsapp,r.email,r.website,r.hours,r.languages,r.populations,r.eligibility,r.required_documents,r.cost_type,
    r.appointment_required,r.walk_in_available,r.emergency_available,r.remote_available,r.referral_methods,r.coverage_levels,
    r.capacity_status,r.verification_status,r.verified_at,r.next_verification_at,r.status,r.km,r.score,
    array_remove(array[
      case when p_service is not null and p_service=any(r.services) then 'service_match' end,
      case when p_state is not null and (upper(r.state_code)=upper(p_state) or upper(p_state)=any(r.coverage_states)) then 'geographic_match' end,
      case when p_language is not null and lower(p_language)=any(select lower(x) from unnest(r.languages)x) then 'language_match' end,
      case when p_population is not null and lower(p_population)=any(select lower(x) from unnest(r.populations)x) then 'population_match' end,
      case when p_urgency='emergency' and r.emergency_available then 'emergency_available' end,
      case when r.status='verified' then 'verified_resource' end
    ],null),
    r.contact_verification,r.source_url,r.source_type,r.last_checked_at
  from ranked r
  where (p_radius_km is null or r.km is null or r.km<=p_radius_km)
  order by r.score desc,r.km nulls last,coalesce(r.official_name,r.name)
  limit least(greatest(p_limit,1),100)
$$;

comment on function public.search_resource_network is 'Neutral directory search only. Never accepts person, family, case, document, or client-identifying data.';

revoke all on function public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer) from public,anon;
grant execute on function public.search_resource_network(text,text,text,double precision,double precision,double precision,text,text,text,text,text,text,integer) to authenticated;