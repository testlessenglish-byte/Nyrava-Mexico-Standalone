-- Atomic self-service organization setup for Atención Integral.
-- Replaces the browser-side multi-call flow so organization, ownership,
-- program configuration and Social authority either all save or all roll back.

create or replace function public.create_social_organization_workspace(
  p_name text,
  p_slug text,
  p_prefix text default 'NYR-SOC'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_org public.organizations%rowtype;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if length(btrim(coalesce(p_name,''))) < 2 then
    raise exception 'Organization name is required';
  end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
    raise exception 'Organization slug is invalid';
  end if;
  if p_prefix !~ '^[A-Z0-9-]{2,20}$' then
    raise exception 'Social case prefix is invalid';
  end if;

  insert into public.organizations(name,slug,created_by,status)
  values(btrim(p_name),p_slug,v_user,'active')
  returning * into v_org;

  insert into public.org_memberships(org_id,user_id,role_in_org,status,invited_by)
  select v_org.id,v_user,'owner','active',v_user
  where not exists (
    select 1 from public.org_memberships
    where org_id=v_org.id and user_id=v_user and status='active'
  );

  insert into public.social_programs(
    org_id,name,name_es,name_en,code,case_prefix,active,settings,created_by
  ) values(
    v_org.id,'Atención Integral','Atención Integral','Comprehensive Care',
    'atencion-integral',p_prefix,true,'{}'::jsonb,v_user
  );

  insert into public.social_role_assignments(
    org_id,user_id,role,scope_type,scope_id,active,assigned_by
  ) values(
    v_org.id,v_user,'organization_owner','organization',null,true,v_user
  );

  return jsonb_build_object(
    'id',v_org.id,
    'name',v_org.name,
    'slug',v_org.slug,
    'status',v_org.status,
    'casePrefix',p_prefix
  );
exception
  when unique_violation then
    raise exception 'That organization name or identifier is already in use';
end;
$$;

revoke all on function public.create_social_organization_workspace(text,text,text) from public;
grant execute on function public.create_social_organization_workspace(text,text,text) to authenticated;
