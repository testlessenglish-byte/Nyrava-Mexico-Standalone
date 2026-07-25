-- 1) Add WITH CHECK to UPDATE policies (post-update row must still be owned by caller / admin)
DROP POLICY IF EXISTS "cases update" ON public.cases;
CREATE POLICY "cases update" ON public.cases
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "findings update" ON public.case_findings;
CREATE POLICY "findings update" ON public.case_findings
  FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role));

-- 2) Scope firms reads to the caller's own firm (or platform admins)
CREATE OR REPLACE FUNCTION public.is_member_of_firm(_user uuid, _firm uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user = auth.uid() AND EXISTS (
    SELECT 1 FROM public.user_settings us
    WHERE us.user_id = _user AND us.firm_id = _firm
  );
$$;

REVOKE ALL ON FUNCTION public.is_member_of_firm(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_member_of_firm(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_member_of_firm(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS firms_read ON public.firms;
CREATE POLICY firms_read ON public.firms
  FOR SELECT TO authenticated
  USING (
    public.is_member_of_firm(auth.uid(), id)
    OR public.is_admin_tier(auth.uid())
  );