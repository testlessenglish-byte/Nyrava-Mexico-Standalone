-- Unified in-app support/message system. Replaces the one-way user_feedback
-- inbox (submit -> admin sees it -> admin can only leave a PRIVATE internal
-- admin_note) with a real two-way thread: the sender can see the admin's
-- reply inside the app, and the admin can see when the sender writes back —
-- both surfaced via server-tracked unread flags, not a client-only dismiss
-- list, so "you have a reply" is correct across devices/sessions.
--
-- "Comentarios" (the floating feedback button) and "Help & Support" both
-- funnel into this same system as different categories on one thread type,
-- per product decision — one inbox for the admin to triage, not two.

CREATE TABLE IF NOT EXISTS public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  -- 'support' = opened from the Help & Support entry point; the rest match
  -- the categories the existing Comentarios button already offers.
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('support', 'bug', 'wrong_result', 'missing_feature', 'usability', 'legal_accuracy', 'general')),
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'blocking')),
  page_path text,
  case_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  -- Whose turn it is to read the latest message. Flipped by the server
  -- function that appends a message, and cleared by the server function
  -- that opens a thread for reading (see support.functions.ts) — never by
  -- the client directly, so this can't be spoofed into a false "read".
  unread_by_admin boolean NOT NULL DEFAULT true,
  unread_by_user boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_threads_user_idx ON public.support_threads (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_threads_admin_unread_idx ON public.support_threads (unread_by_admin, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('user', 'admin')),
  sender_user_id uuid REFERENCES auth.users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON public.support_messages (thread_id, created_at ASC);

GRANT SELECT, INSERT ON public.support_threads TO authenticated;
GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_threads TO service_role;
GRANT ALL ON public.support_messages TO service_role;

ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- A user opens their own thread by inserting it directly (first message is
-- written right after in the same request — see submitSupportMessage).
DROP POLICY IF EXISTS "support_threads_insert_own" ON public.support_threads;
CREATE POLICY "support_threads_insert_own" ON public.support_threads
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_threads_select_own_or_admin" ON public.support_threads;
CREATE POLICY "support_threads_select_own_or_admin" ON public.support_threads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_tier(auth.uid()));

-- Every other write to support_threads (unread flags, status, last_message_at)
-- goes through the service-role client from an admin- or ownership-checked
-- server function — same pattern user_feedback already established for
-- adminUpdateFeedback — so there is no general-purpose UPDATE policy here.

-- A user may append a message to their OWN thread, and only as sender='user'
-- attributed to themselves — an admin reply is never insertable by a
-- non-admin client because that path always goes through the service-role
-- client after an explicit is_admin_tier check in adminReplyToThread.
DROP POLICY IF EXISTS "support_messages_insert_own_thread" ON public.support_messages;
CREATE POLICY "support_messages_insert_own_thread" ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'user'
    AND sender_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.support_threads t WHERE t.id = thread_id AND t.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "support_messages_select_own_or_admin" ON public.support_messages;
CREATE POLICY "support_messages_select_own_or_admin" ON public.support_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_threads t
      WHERE t.id = thread_id AND (t.user_id = auth.uid() OR public.is_admin_tier(auth.uid()))
    )
  );

DROP TRIGGER IF EXISTS trg_support_threads_updated ON public.support_threads;
CREATE TRIGGER trg_support_threads_updated BEFORE UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
