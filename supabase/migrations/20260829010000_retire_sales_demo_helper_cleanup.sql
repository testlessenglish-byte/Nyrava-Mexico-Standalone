-- Complete retirement of legacy sales demo helper references
-- Ensures functions and policies do not query dropped prototype tables

begin;

create or replace function public.social_sales_demo_any_owner_allows(
  p_id uuid,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;
revoke all on function public.social_sales_demo_any_owner_allows(uuid, uuid) from public, anon;
grant execute on function public.social_sales_demo_any_owner_allows(uuid, uuid) to authenticated, service_role;

create or replace function public.social_sales_demo_owner_allows(
  p_table text,
  p_id uuid,
  p_user uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;
revoke all on function public.social_sales_demo_owner_allows(text, uuid, uuid) from public, anon;
grant execute on function public.social_sales_demo_owner_allows(text, uuid, uuid) to authenticated, service_role;

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
      (not p_write and public.social_support_access_active(c.id, p_record_type, p_user))
      or (
        public.social_is_org_member(c.org_id, p_user)
        and (
          public.social_can_manage_org(c.org_id, p_user)
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
          or (not p_write and public.social_has_capability(c.org_id, 'case.view_all', p_user))
        )
        and case p_record_type
          when 'general_case_record' then
            not p_write
            or public.social_can_manage_org(c.org_id, p_user)
            or public.social_has_capability(c.org_id, 'case.update', p_user)
            or public.social_has_capability(c.org_id, 'case.update_assigned', p_user)
          when 'social_work_record' then
            public.social_has_capability(c.org_id, 'intervention.social_work', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'legal_privileged_record' then
            public.social_has_capability(c.org_id, 'restricted.legal', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'psychosocial_restricted_record' then
            public.social_has_capability(c.org_id, 'restricted.psychosocial', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'medical_restricted_record' then
            public.social_has_capability(c.org_id, 'restricted.medical', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          when 'child_protection_restricted_record' then
            public.social_has_capability(c.org_id, 'restricted.child_protection', p_user)
            or exists (
              select 1 from public.social_record_grants g
              where g.social_case_id = c.id and g.user_id = p_user
                and g.record_type = p_record_type and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now())
                and g.can_read and (not p_write or g.can_write)
            )
          else false
        end
      )
  );
$social_case_access$;
revoke all on function public.social_can_access_case(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.social_can_access_case(uuid, text, boolean, uuid) to authenticated, service_role;

drop policy if exists social_activity_read on public.social_activity_events;
create policy social_activity_read on public.social_activity_events
  for select to authenticated
  using (
    (social_case_id is null or public.social_can_access_case(social_case_id, 'general_case_record', false, auth.uid()))
    and public.is_org_member(org_id, auth.uid())
    and (public.can_manage_org(org_id, auth.uid()) or actor_id = auth.uid() or public.social_has_capability(org_id, 'audit.view', auth.uid()))
  );

commit;
