DROP TRIGGER IF EXISTS protect_user_settings_firm_id ON public.user_settings;
CREATE TRIGGER protect_user_settings_firm_id
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_protect_user_settings_firm_id();

REVOKE UPDATE (firm_id) ON public.user_settings FROM authenticated;