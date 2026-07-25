
-- Extend user_settings with profile, voice, notification, and security preferences.
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS firm_name text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS voice_id text NOT NULL DEFAULT 'alloy',
  ADD COLUMN IF NOT EXISTS voice_speed numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS voice_muted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_autoplay boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_pipeline_complete boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_pipeline_failed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_new_evidence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_default_mode text NOT NULL DEFAULT 'evidence_grounded',
  ADD COLUMN IF NOT EXISTS ai_response_style text NOT NULL DEFAULT 'professional',
  ADD COLUMN IF NOT EXISTS ai_max_response_chars integer NOT NULL DEFAULT 1500;

-- Ensure RLS exists and the owner can read/update their own row.
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings"
  ON public.user_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
