alter function public.log_social_resource_communication() set search_path = public, pg_temp;
revoke all on function public.log_social_resource_communication() from public, anon, authenticated;