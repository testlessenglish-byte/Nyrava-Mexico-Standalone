-- Bilingual program labels and a safe first-run program for each organization.
alter table public.social_programs add column if not exists name_es text;
alter table public.social_programs add column if not exists name_en text;
update public.social_programs
set name_es=coalesce(name_es,name),name_en=coalesce(name_en,name)
where name_es is null or name_en is null;
alter table public.social_programs alter column name_es set not null;
alter table public.social_programs alter column name_en set not null;

insert into public.social_programs(org_id,name,name_es,name_en,code,case_prefix,settings)
select o.id,'Atención Integral','Atención Integral','Comprehensive Care',
       'atencion_integral','NYR-SOC','{"default_language":"es"}'::jsonb
from public.organizations o
where not exists(select 1 from public.social_programs p where p.org_id=o.id);

create or replace function public.ensure_social_program_for_org(
  p_org uuid,p_name_es text default 'Atención Integral',
  p_name_en text default 'Comprehensive Care',p_prefix text default 'NYR-SOC'
) returns public.social_programs
language plpgsql security invoker set search_path=public as $$
declare p public.social_programs%rowtype;
begin
  if not public.can_manage_org(p_org,auth.uid()) then raise exception 'Program administration denied'; end if;
  if p_prefix!~'^[A-Z0-9-]{2,20}$' then raise exception 'Invalid case prefix'; end if;
  insert into public.social_programs(org_id,name,name_es,name_en,code,case_prefix,created_by)
  values(p_org,p_name_es,p_name_es,p_name_en,'atencion_integral',p_prefix,auth.uid())
  on conflict(org_id,code) do update set name=excluded.name,name_es=excluded.name_es,
    name_en=excluded.name_en,case_prefix=excluded.case_prefix,active=true,updated_at=now()
  returning * into p;
  return p;
end $$;
revoke all on function public.ensure_social_program_for_org(uuid,text,text,text) from public;
grant execute on function public.ensure_social_program_for_org(uuid,text,text,text) to authenticated;
