GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_firms_with_seats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) TO authenticated;