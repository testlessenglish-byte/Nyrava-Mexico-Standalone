GRANT INSERT ON public.user_settings TO authenticated;
GRANT UPDATE (
  cedula_profesional,
  state_practice,
  practice_focus,
  years_experience,
  profile_completed_at
) ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;