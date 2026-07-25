CREATE OR REPLACE FUNCTION public.admin_factory_reset_case_data(
  p_include_demo boolean DEFAULT false,
  p_include_audit boolean DEFAULT false,
  p_include_ai_usage boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t text;
  n bigint;
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
  IF NOT public.is_super_admin(auth.uid()) THEN
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
      EXECUTE format('DELETE FROM public.%I', t);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        result := result || jsonb_build_object(t, n);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (actor_id, action, target, meta)
  VALUES (auth.uid(), 'factory_reset_case_data', 'operational_case_data',
          jsonb_build_object('deleted', result,
                             'include_demo', p_include_demo,
                             'include_audit', p_include_audit,
                             'include_ai_usage', p_include_ai_usage));

  RETURN result;
END;
$$;