DROP POLICY IF EXISTS intelligence_versions_owner_select ON public.intelligence_versions;
CREATE POLICY intelligence_versions_owner_select ON public.intelligence_versions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals;
CREATE POLICY intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS intelligence_validation_rules_owner_select ON public.intelligence_validation_rules;
CREATE POLICY intelligence_validation_rules_owner_select ON public.intelligence_validation_rules
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS intelligence_patterns_owner_select ON public.intelligence_patterns;
CREATE POLICY intelligence_patterns_owner_select ON public.intelligence_patterns
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS case_finding_patches_owner_select ON public.case_finding_patches;
CREATE POLICY case_finding_patches_owner_select ON public.case_finding_patches
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND private.owns_case(case_id));

DROP POLICY IF EXISTS intelligence_lessons_owner_select ON public.intelligence_lessons;
CREATE POLICY intelligence_lessons_owner_select ON public.intelligence_lessons
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND private.owns_case(case_id));

REVOKE ALL ON public.intelligence_versions FROM anon;
REVOKE ALL ON public.intelligence_improvement_proposals FROM anon;
REVOKE ALL ON public.intelligence_validation_rules FROM anon;
REVOKE ALL ON public.intelligence_patterns FROM anon;
REVOKE ALL ON public.case_finding_patches FROM anon;
REVOKE ALL ON public.intelligence_lessons FROM anon;