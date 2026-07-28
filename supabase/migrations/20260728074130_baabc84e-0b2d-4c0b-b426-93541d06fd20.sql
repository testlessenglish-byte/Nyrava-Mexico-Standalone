REVOKE UPDATE ON public.user_settings FROM authenticated;
REVOKE UPDATE ON public.user_settings FROM anon;
REVOKE INSERT ON public.user_settings FROM anon;
GRANT UPDATE (user_id, gemini_api_key, created_at, updated_at, display_name, phone, firm_name, title, avatar_url, voice_id, voice_speed, voice_muted, voice_autoplay, notify_email, notify_pipeline_complete, notify_pipeline_failed, notify_new_evidence, ai_default_mode, ai_response_style, ai_max_response_chars, voice_continuous, voice_pitch, voice_accent, voice_gender) ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;