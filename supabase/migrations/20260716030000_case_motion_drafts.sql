-- Motion Center: single-motion drafting.
--
-- Deliberately a SEPARATE table from case_work_product. That table is owned
-- by runWorkProductEngine (engines.server.ts), which does
-- `delete().eq("case_id", caseId)` then reinserts a fixed generic batch on
-- every run. A lawyer-triggered "Draft this motion" click from Motion
-- Center must survive that batch engine rerunning later in the pipeline —
-- so it gets its own table instead of sharing case_work_product and being
-- silently wiped out.
--
-- Unique on (case_id, motion_title) so re-drafting the same motion is an
-- upsert (overwrite), not an ever-growing duplicate list.
CREATE TABLE public.case_motion_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  motion_title text NOT NULL,
  title text NOT NULL,
  body_markdown text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'complete', -- complete | unverified | rejected | failed
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, motion_title)
);
CREATE INDEX case_motion_drafts_case_idx ON public.case_motion_drafts(case_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_motion_drafts TO authenticated;
GRANT ALL ON public.case_motion_drafts TO service_role;
ALTER TABLE public.case_motion_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "motion drafts all" ON public.case_motion_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER tg_motion_drafts_updated_at BEFORE UPDATE ON public.case_motion_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
