REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin_tier(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_case_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_tier(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO authenticated, service_role;