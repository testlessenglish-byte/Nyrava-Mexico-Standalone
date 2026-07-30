DROP POLICY IF EXISTS "audit_member_select" ON public.audit_log;

CREATE POLICY "audit_member_select" ON public.audit_log FOR SELECT TO authenticated
USING (
  (org_id IS NOT NULL AND public.is_org_member(auth.uid(), org_id))
  OR (org_id IS NULL AND actor_id = auth.uid())
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);