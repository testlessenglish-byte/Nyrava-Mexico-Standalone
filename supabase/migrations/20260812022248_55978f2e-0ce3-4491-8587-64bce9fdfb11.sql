DROP POLICY IF EXISTS "analyses all" ON public.analyses;
CREATE POLICY "analyses all" ON public.analyses FOR ALL TO authenticated
USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((auth.uid() = user_id) AND private.owns_case(case_id));

DROP POLICY IF EXISTS "chat all" ON public.case_chat_messages;
CREATE POLICY "chat all" ON public.case_chat_messages FOR ALL TO authenticated
USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((user_id = auth.uid()) AND private.owns_case(case_id));

DROP POLICY IF EXISTS "trial all" ON public.case_trial_prep;
CREATE POLICY "trial all" ON public.case_trial_prep FOR ALL TO authenticated
USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((user_id = auth.uid()) AND private.owns_case(case_id));

DROP POLICY IF EXISTS "work all" ON public.case_work_product;
CREATE POLICY "work all" ON public.case_work_product FOR ALL TO authenticated
USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((user_id = auth.uid()) AND private.owns_case(case_id));