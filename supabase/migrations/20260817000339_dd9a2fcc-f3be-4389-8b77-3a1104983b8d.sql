DROP POLICY IF EXISTS "mk_contrib_update" ON public.matter_knowledge;
CREATE POLICY "mk_contrib_update" ON public.matter_knowledge
FOR UPDATE TO authenticated
USING (public.can_contribute_org(auth.uid(), org_id))
WITH CHECK (public.can_contribute_org(auth.uid(), org_id));