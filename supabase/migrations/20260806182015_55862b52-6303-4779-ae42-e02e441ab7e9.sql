-- Beta tester profile intake fields
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS cedula_profesional text,
  ADD COLUMN IF NOT EXISTS state_practice text,
  ADD COLUMN IF NOT EXISTS practice_focus text,
  ADD COLUMN IF NOT EXISTS years_experience text,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz;

-- Direct feedback channel from users (beta testers in particular) to admins
CREATE TABLE IF NOT EXISTS public.user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  category text NOT NULL DEFAULT 'general',
  severity text NOT NULL DEFAULT 'normal',
  message text NOT NULL,
  page_path text,
  case_id uuid,
  status text NOT NULL DEFAULT 'new',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_feedback_created_idx ON public.user_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS user_feedback_status_idx ON public.user_feedback (status);

GRANT SELECT, INSERT ON public.user_feedback TO authenticated;
GRANT ALL ON public.user_feedback TO service_role;

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_insert_own" ON public.user_feedback;
CREATE POLICY "feedback_insert_own" ON public.user_feedback
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "feedback_select_own_or_admin" ON public.user_feedback;
CREATE POLICY "feedback_select_own_or_admin" ON public.user_feedback
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_tier(auth.uid()));

DROP TRIGGER IF EXISTS trg_user_feedback_updated ON public.user_feedback;
CREATE TRIGGER trg_user_feedback_updated BEFORE UPDATE ON public.user_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();