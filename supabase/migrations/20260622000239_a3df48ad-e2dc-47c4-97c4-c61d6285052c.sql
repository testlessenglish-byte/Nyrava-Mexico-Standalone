CREATE TABLE IF NOT EXISTS public.user_groq_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Primary',
  key_value text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_groq_keys TO authenticated;
GRANT ALL ON public.user_groq_keys TO service_role;
ALTER TABLE public.user_groq_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own groq keys" ON public.user_groq_keys FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS user_groq_keys_user_idx ON public.user_groq_keys(user_id);
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS shared_brief jsonb;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS shared_brief_at timestamptz;