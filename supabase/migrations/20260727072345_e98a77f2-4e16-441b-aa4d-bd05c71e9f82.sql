-- ============================================================
-- 1. Internal configuration tables: admin-tier read only
-- ============================================================
DROP POLICY IF EXISTS "agent_configs read all auth" ON public.agent_configs;
CREATE POLICY "agent_configs admin read"
  ON public.agent_configs FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

DROP POLICY IF EXISTS "feature_flags read all auth" ON public.feature_flags;
CREATE POLICY "feature_flags admin read"
  ON public.feature_flags FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

-- ============================================================
-- 2. Authorization catalog tables: admin-tier read only
-- ============================================================
DROP POLICY IF EXISTS "permissions_read_all" ON public.permissions;
CREATE POLICY "permissions admin read"
  ON public.permissions FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

DROP POLICY IF EXISTS "role_perms_read_all" ON public.role_permissions;
CREATE POLICY "role_permissions admin read"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()));

-- ============================================================
-- 3. Destructive routine: service_role only, explicit actor
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_factory_reset_case_data(boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.admin_factory_reset_case_data(
  p_include_demo boolean DEFAULT false,
  p_include_audit boolean DEFAULT false,
  p_include_ai_usage boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t text;
  n bigint;
  v_actor uuid;
  result jsonb := '{}'::jsonb;
  targets text[] := ARRAY[
    'pipeline_events','pipeline_engine_runs','agent_findings','agent_logs',
    'case_chat_messages','case_domain_activations','case_findings','case_motion_drafts',
    'case_opportunities','case_perspectives','case_scores','case_strategy',
    'case_strategy_center','case_theories','case_timeline_events','case_trial_prep',
    'case_witnesses','case_work_product','evidence_classifications','image_intelligence',
    'intelligence_runs','knowledge_relationships','document_pages','document_versions',
    'document_processing_jobs','documents','report_versions','reports','canonical_analysis',
    'analyses','matter_documents','matter_events','matter_knowledge','matter_notes',
    'matter_parties','matter_tasks','matters','cases'
  ];
BEGIN
  -- When a real end-user session is present, that session is the actor and no
  -- caller-supplied id is trusted. p_actor_id is only honored for trusted
  -- server-side (service_role) callers, which cannot be reached by signed-in
  -- users because EXECUTE is revoked from anon/authenticated below.
  v_actor := COALESCE(auth.uid(), p_actor_id);

  IF v_actor IS NULL OR NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Forbidden — super admin required.';
  END IF;

  IF p_include_demo THEN
    targets := targets || ARRAY['demo_case_documents','demo_cases'];
  END IF;
  IF p_include_audit THEN
    targets := targets || ARRAY['audit_log','audit_logs'];
  END IF;
  IF p_include_ai_usage THEN
    targets := targets || ARRAY['ai_usage'];
  END IF;

  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DELETE FROM public.%I WHERE true', t);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        result := result || jsonb_build_object(t, n);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (actor_id, action, target, meta)
  VALUES (v_actor, 'factory_reset_case_data', 'operational_case_data',
          jsonb_build_object('deleted', result,
                             'include_demo', p_include_demo,
                             'include_audit', p_include_audit,
                             'include_ai_usage', p_include_ai_usage));

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) TO service_role;

-- ============================================================
-- 4. SECURITY DEFINER helpers not required by RLS evaluation:
--    remove direct end-user EXECUTE, keep trusted server access.
--    (has_role, is_admin_tier, is_super_admin, is_org_member,
--     org_role_of, can_manage_org, can_contribute_org, same_firm and
--     is_member_of_firm are referenced by RLS policies and MUST keep
--     authenticated EXECUTE, so they are intentionally untouched.)
-- ============================================================
REVOKE ALL ON FUNCTION public.firm_seat_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firm_seat_usage(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_case_manager(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_case_manager(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.has_permission(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, uuid, text) TO service_role;