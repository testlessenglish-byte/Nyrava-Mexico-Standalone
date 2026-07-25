
CREATE OR REPLACE FUNCTION public.has_permission(_user UUID, _org UUID, _perm TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH guarded AS (
    SELECT _user AS u WHERE _user = auth.uid()
  ),
  user_role AS (
    SELECT role_in_org AS r FROM public.org_memberships, guarded
    WHERE user_id = guarded.u AND org_id = _org AND status = 'active' AND deleted_at IS NULL
    LIMIT 1
  ),
  override AS (
    SELECT granted FROM public.org_role_permissions orp, user_role
    WHERE orp.org_id = _org AND orp.role = user_role.r AND orp.permission_code = _perm
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT granted FROM override),
    EXISTS(SELECT 1 FROM public.role_permissions rp, user_role
           WHERE rp.role = user_role.r AND rp.permission_code = _perm)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) TO authenticated, service_role;
