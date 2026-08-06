-- 1. Case ownership helper (private schema: not exposed through the API)
CREATE OR REPLACE FUNCTION private.owns_case(_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = _case_id AND c.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION private.owns_case(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.owns_case(uuid) TO authenticated;

-- 2. INSERT policies with case-ownership validation
DROP POLICY IF EXISTS "users insert own agent_findings" ON public.agent_findings;
CREATE POLICY "users insert own agent_findings" ON public.agent_findings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "findings insert" ON public.case_findings;
CREATE POLICY "findings insert" ON public.case_findings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "users insert own case_scores" ON public.case_scores;
CREATE POLICY "users insert own case_scores" ON public.case_scores
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

-- 3. ALL policies on case-child tables: add ownership to WITH CHECK
DROP POLICY IF EXISTS "theories all" ON public.case_theories;
CREATE POLICY "theories all" ON public.case_theories FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "opps all" ON public.case_opportunities;
CREATE POLICY "opps all" ON public.case_opportunities FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "witnesses all" ON public.case_witnesses;
CREATE POLICY "witnesses all" ON public.case_witnesses FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "parties all" ON public.case_parties;
CREATE POLICY "parties all" ON public.case_parties FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "tasks all" ON public.case_tasks;
CREATE POLICY "tasks all" ON public.case_tasks FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "events all" ON public.case_events;
CREATE POLICY "events all" ON public.case_events FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "communications all" ON public.case_communications;
CREATE POLICY "communications all" ON public.case_communications FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "perspectives owner full" ON public.case_perspectives;
CREATE POLICY "perspectives owner full" ON public.case_perspectives FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

DROP POLICY IF EXISTS "strategy owner full" ON public.case_strategy;
CREATE POLICY "strategy owner full" ON public.case_strategy FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

DROP POLICY IF EXISTS "evidence_class owner full" ON public.evidence_classifications;
CREATE POLICY "evidence_class owner full" ON public.evidence_classifications FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

DROP POLICY IF EXISTS "motion drafts all" ON public.case_motion_drafts;
CREATE POLICY "motion drafts all" ON public.case_motion_drafts FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "strategy center all" ON public.case_strategy_center;
CREATE POLICY "strategy center all" ON public.case_strategy_center FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS "property_records all" ON public.property_records;
CREATE POLICY "property_records all" ON public.property_records FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

DROP POLICY IF EXISTS "verification_items all" ON public.verification_items;
CREATE POLICY "verification_items all" ON public.verification_items FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

DROP POLICY IF EXISTS "closing_milestones all" ON public.closing_milestones;
CREATE POLICY "closing_milestones all" ON public.closing_milestones FOR ALL TO authenticated
  USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id AND private.owns_case(case_id));

-- 4. SECURITY DEFINER exposure: admin routines are server-side only
REVOKE EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO service_role;

-- self-scope guard so signed-in users cannot probe other users' firm relationships
CREATE OR REPLACE FUNCTION public.same_firm(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NULL OR _a = auth.uid() OR _b = auth.uid())
     AND EXISTS (
    SELECT 1
    FROM public.user_settings ua
    JOIN public.user_settings ub ON ub.user_id = _b AND ua.firm_id = ub.firm_id
    WHERE ua.user_id = _a AND ua.firm_id IS NOT NULL
  );
$$;