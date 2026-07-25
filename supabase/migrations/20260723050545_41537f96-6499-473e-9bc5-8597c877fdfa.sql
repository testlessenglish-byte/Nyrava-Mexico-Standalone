-- Revoke EXECUTE from anon+authenticated on trigger-only functions (never meant as RPC)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_beta_invite_redemption() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_stamp_case_firm() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_protect_user_settings_firm_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_mirror_reports_to_canonical() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_validate_canonical_analysis() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_bump_canonical_version() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_firm_for_email(text) FROM PUBLIC, anon, authenticated;

-- Revoke anon EXECUTE on admin-only helper functions (they check admin internally,
-- but anonymous users should never be able to call them). Keep authenticated so
-- signed-in admin server functions can still invoke them via RPC.
REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) FROM PUBLIC, anon;