REVOKE EXECUTE ON FUNCTION public.tg_mirror_reports_to_canonical() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_mirror_reports_to_canonical() TO service_role;