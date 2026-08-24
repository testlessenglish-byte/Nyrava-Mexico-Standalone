begin;

-- Ensure a newly created Comprehensive Care case can be read immediately by
-- its creator, supervising manager, assigned case manager and active assignees.
-- Restricted child records continue to use their own record-type authorization.

create or replace function public.social_can_access_case(
  p_case uuid,
  p_record_type text default 'general_case_record',
  p_write boolean default false,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $social_case_access$
  with c as (
    select
      id,
      org_id,
      created_by,
      supervising_manager,
      assigned_case_manager
    from public.social_cases
    where id = p_case
      and deleted_at is null
  )
  select exists (
    select 1
    from c
    where
      (not p_write and public.social_support_access_active(c.id,p_record_type,p_user))
      or (
        public.social_is_org_member(c.org_id,p_user)
        and (
          public.social_can_manage_org(c.org_id,p_user)
          or c.created_by = p_user
          or c.supervising_manager = p_user
          or c.assigned_case_manager = p_user
          or exists (
            select 1
            from public.social_case_assignments a
            where a.social_case_id = c.id
              and a.user_id = p_user
              and a.active
              and (a.ended_at is null or a.ended_at > now())
          )
          or (not p_write and public.social_has_capability(c.org_id,'case.view_all',p_user))
        )
        and case p_record_type
          when 'general_case_record' then
            not p_write
            or public.social_can_manage_org(c.org_id,p_user)
            or public.social_has_capability(c.org_id,'case.update',p_user)
            or public.social_has_capability(c.org_id,'case.update_assigned',p_user)
          when 'social_work_record' then
            public.social_has_capability(c.org_id,'intervention.social_work',p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id=c.id and g.user_id=p_user
                and g.record_type=p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at>now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'legal_privileged_record' then
            public.social_has_capability(c.org_id,'restricted.legal',p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id=c.id and g.user_id=p_user
                and g.record_type=p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at>now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'psychosocial_restricted_record' then
            public.social_has_capability(c.org_id,'restricted.psychosocial',p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id=c.id and g.user_id=p_user
                and g.record_type=p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at>now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'medical_restricted_record' then
            public.social_has_capability(c.org_id,'restricted.medical',p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id=c.id and g.user_id=p_user
                and g.record_type=p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at>now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'child_protection_restricted_record' then
            public.social_has_capability(c.org_id,'restricted.child_protection',p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id=c.id and g.user_id=p_user
                and g.record_type=p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at>now())
                and g.can_read and (not p_write or g.can_write)
            )
          else false
        end
      )
  );
$social_case_access$;

revoke all on function public.social_can_access_case(uuid,text,boolean,uuid) from public, anon;
grant execute on function public.social_can_access_case(uuid,text,boolean,uuid)
  to authenticated, service_role;

drop policy if exists social_cases_direct_participant_read on public.social_cases;
create policy social_cases_direct_participant_read
on public.social_cases
for select
to authenticated
using (
  deleted_at is null
  and (
    created_by = auth.uid()
    or supervising_manager = auth.uid()
    or assigned_case_manager = auth.uid()
    or public.social_is_platform_admin(auth.uid())
    or exists (
      select 1
      from public.social_case_assignments a
      where a.social_case_id = social_cases.id
        and a.user_id = auth.uid()
        and a.active
        and (a.ended_at is null or a.ended_at > now())
    )
    or (
      public.social_is_org_member(org_id,auth.uid())
      and (
        public.social_can_manage_org(org_id,auth.uid())
        or public.social_has_capability(org_id,'case.view_all',auth.uid())
      )
    )
  )
);

create or replace function public.get_social_case_core(p_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $get_social_case_core$
declare
  v_actor uuid := auth.uid();
  v_case public.social_cases%rowtype;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select *
  into v_case
  from public.social_cases
  where id = p_case
    and deleted_at is null;

  if not found then
    raise exception 'Comprehensive Care case not found' using errcode = 'P0002';
  end if;

  if not public.social_can_access_case(
    v_case.id,
    'general_case_record',
    false,
    v_actor
  ) then
    raise exception 'You are not authorized to open this Comprehensive Care case'
      using errcode = '42501';
  end if;

  return to_jsonb(v_case);
end
$get_social_case_core$;

revoke all on function public.get_social_case_core(uuid) from public, anon;
grant execute on function public.get_social_case_core(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
