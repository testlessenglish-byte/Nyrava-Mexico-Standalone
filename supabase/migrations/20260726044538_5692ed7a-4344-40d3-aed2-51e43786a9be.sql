GRANT EXECUTE ON FUNCTION public.can_contribute_org(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_org(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_role_of(uuid, uuid) TO authenticated;