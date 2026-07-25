GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_tier(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

ALTER FUNCTION public.has_role(uuid, public.app_role) SECURITY DEFINER;
ALTER FUNCTION public.is_admin_tier(uuid) SECURITY DEFINER;
ALTER FUNCTION public.is_case_manager(uuid) SECURITY DEFINER;
ALTER FUNCTION public.is_super_admin(uuid) SECURITY DEFINER;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public;
ALTER FUNCTION public.is_admin_tier(uuid) SET search_path = public;
ALTER FUNCTION public.is_case_manager(uuid) SET search_path = public;
ALTER FUNCTION public.is_super_admin(uuid) SET search_path = public;