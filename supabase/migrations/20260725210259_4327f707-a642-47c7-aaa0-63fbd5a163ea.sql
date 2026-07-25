-- 1) Admin-only home for internal plan notes.
CREATE TABLE public.billing_plan_notes (
  plan_id UUID PRIMARY KEY REFERENCES public.billing_plans(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_plan_notes TO authenticated;
GRANT ALL ON public.billing_plan_notes TO service_role;

ALTER TABLE public.billing_plan_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read plan notes" ON public.billing_plan_notes
  FOR SELECT TO authenticated USING (public.is_admin_tier(auth.uid()));
CREATE POLICY "admins write plan notes" ON public.billing_plan_notes
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_tier(auth.uid()));
CREATE POLICY "admins update plan notes" ON public.billing_plan_notes
  FOR UPDATE TO authenticated USING (public.is_admin_tier(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()));
CREATE POLICY "admins delete plan notes" ON public.billing_plan_notes
  FOR DELETE TO authenticated USING (public.is_admin_tier(auth.uid()));

CREATE TRIGGER billing_plan_notes_set_updated_at
  BEFORE UPDATE ON public.billing_plan_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2) Carry existing notes over, then drop the publicly readable column.
INSERT INTO public.billing_plan_notes (plan_id, notes)
SELECT id, internal_notes FROM public.billing_plans
WHERE internal_notes IS NOT NULL AND btrim(internal_notes) <> ''
ON CONFLICT (plan_id) DO NOTHING;

ALTER TABLE public.billing_plans DROP COLUMN internal_notes;

-- 3) billing_plans only had a public SELECT policy for active plans, so admin
--    reads of drafts and all admin writes were silently blocked by RLS.
CREATE POLICY "admins read all plans" ON public.billing_plans
  FOR SELECT TO authenticated USING (public.is_admin_tier(auth.uid()));
CREATE POLICY "admins insert plans" ON public.billing_plans
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_tier(auth.uid()));
CREATE POLICY "admins update plans" ON public.billing_plans
  FOR UPDATE TO authenticated USING (public.is_admin_tier(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()));
CREATE POLICY "admins delete plans" ON public.billing_plans
  FOR DELETE TO authenticated USING (public.is_admin_tier(auth.uid()));

GRANT SELECT ON public.billing_plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_plans TO authenticated;
GRANT ALL ON public.billing_plans TO service_role;