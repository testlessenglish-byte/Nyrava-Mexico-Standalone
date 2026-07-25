
-- 1. case_timeline_events: add DELETE policy
CREATE POLICY "Users delete timeline events for their own cases"
ON public.case_timeline_events FOR DELETE
USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = case_timeline_events.case_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))));

-- 2. image_intelligence: add UPDATE + DELETE policies
CREATE POLICY "Users update image intelligence for their own cases"
ON public.image_intelligence FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = image_intelligence.case_id AND c.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = image_intelligence.case_id AND c.user_id = auth.uid()));

CREATE POLICY "Users delete image intelligence for their own cases"
ON public.image_intelligence FOR DELETE
USING (EXISTS (SELECT 1 FROM public.cases c WHERE c.id = image_intelligence.case_id AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))));

-- 3. worker_secrets: explicit deny-by-default with documented super_admin-only read
--    RLS is already enabled with no policies; add an explicit super_admin-only SELECT
--    to document intent and prevent accidental broad grants. All writes remain service_role only.
REVOKE ALL ON public.worker_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.worker_secrets TO service_role;

CREATE POLICY "worker_secrets super_admin read only"
ON public.worker_secrets FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role));

COMMENT ON TABLE public.worker_secrets IS 'Server-only secrets. Access via service_role only. Any additional policy MUST be admin-scoped; never grant broad authenticated access.';

-- 4. Prevent non-admin users from changing their own firm_id in user_settings.
--    firm_id drives firm_admin case visibility via same_firm(); user-editable firm_id
--    is a privilege-escalation vector. Enforce via BEFORE UPDATE trigger so admins/service
--    role can still adjust it, but self-service updates cannot change firm_id.
CREATE OR REPLACE FUNCTION public.tg_protect_user_settings_firm_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'super_admin'::app_role)
            OR public.has_role(auth.uid(), 'firm_admin'::app_role)) THEN
      NEW.firm_id := OLD.firm_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_user_settings_firm_id ON public.user_settings;
CREATE TRIGGER protect_user_settings_firm_id
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.tg_protect_user_settings_firm_id();
