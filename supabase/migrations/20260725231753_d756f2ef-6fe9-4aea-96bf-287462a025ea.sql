DROP POLICY IF EXISTS connectors_authenticated_read ON public.legal_source_connectors;
DROP POLICY IF EXISTS connectors_admin_read ON public.legal_source_connectors;
CREATE POLICY connectors_admin_read ON public.legal_source_connectors FOR SELECT TO authenticated USING (public.is_admin_tier(auth.uid()));