-- Finding 1 & 2: SUPA_rls_disabled_in_public / social_role_capabilities_rls_disabled
-- Enable RLS on the only public-schema table missing it, and restrict the
-- role -> capability authorization matrix to service_role, platform admins
-- and signed-in members of a social-care organization.
-- Idempotent: safe to re-run.

alter table public.social_role_capabilities enable row level security;

revoke all on table public.social_role_capabilities from anon;
revoke all on table public.social_role_capabilities from public;
grant select on table public.social_role_capabilities to authenticated;
grant all on table public.social_role_capabilities to service_role;

drop policy if exists social_role_capabilities_read on public.social_role_capabilities;
create policy social_role_capabilities_read
  on public.social_role_capabilities
  for select
  to authenticated
  using (
    public.social_is_platform_admin(auth.uid())
    or exists (
      select 1
      from public.social_role_assignments ra
      where ra.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.org_memberships m
      where m.user_id = auth.uid()
        and m.status = 'active'
        and m.deleted_at is null
    )
  );

drop policy if exists social_role_capabilities_admin_write on public.social_role_capabilities;
create policy social_role_capabilities_admin_write
  on public.social_role_capabilities
  for all
  to authenticated
  using (public.social_is_platform_admin(auth.uid()))
  with check (public.social_is_platform_admin(auth.uid()));