-- Guard-coverage + reset-integrity hardening after live ADR5829/2025 audit.
--
-- Goals:
-- 1) No direct/RPC writer may persist a personal-notice defect when the
--    verified case corpus expressly says there was no duty to notify
--    personally. This closes projection/direct-write paths that bypass the
--    TypeScript validateFindingsForCase choke point.
-- 2) Raw analyses/agent JSON is sanitized too, so a rejected theory cannot
--    survive in exports or secondary consumers merely because case_findings
--    was clean.
-- 3) A released case is always terminal in its public lifecycle fields.
-- 4) Factory reset targets stay aligned with current derived/audit tables.

BEGIN;

CREATE OR REPLACE FUNCTION public.nyrava_case_denies_personal_notice_duty(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documents d
    WHERE d.case_id = p_case_id
      AND d.status = 'extracted'
      AND regexp_replace(coalesce(d.extracted_text, ''), E'[\n\r]+', ' ', 'g') ~*
        '(no exist[ií]a|no era necesario|no resultaba necesario|no fue necesario|no hab[ií]a).{0,360}(deber|obligaci[oó]n|necesidad)?.{0,240}notific.{0,120}personal'
  );
$$;

CREATE OR REPLACE FUNCTION public.nyrava_is_personal_notice_defect_text(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_text, '') ~* '(notific.{0,180}personal|personal.{0,180}notific)'
    AND coalesce(p_text, '') ~*
      '(defect|irregular|error procesal|nulidad|invalid|afect.{0,100}(procedencia|defensa|debido proceso)|desestim|debilidad|riesgo|perjuicio|garanti[cz]|asegurar|deb[ií][oa].{0,100}realiz|motivo.{0,100}impug|incidente_de_nulidad)';
$$;

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_personal_notice_json_value(
  p_value jsonb,
  p_deny_personal_notice_duty boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type text;
  v_is_claim_object boolean;
  v_result jsonb;
BEGIN
  IF p_value IS NULL OR NOT p_deny_personal_notice_duty THEN
    RETURN p_value;
  END IF;

  v_type := jsonb_typeof(p_value);

  IF v_type = 'object' THEN
    v_is_claim_object := p_value ?| ARRAY[
      'title','item','description','legal_significance','potential_impact',
      'potential_avenue','why_it_may_apply','what_is_missing','rule'
    ];

    IF v_is_claim_object AND public.nyrava_is_personal_notice_defect_text(p_value::text) THEN
      RETURN NULL;
    END IF;

    SELECT coalesce(jsonb_object_agg(e.key, e.cleaned), '{}'::jsonb)
      INTO v_result
    FROM (
      SELECT j.key,
             coalesce(
               public.nyrava_sanitize_personal_notice_json_value(j.value, p_deny_personal_notice_duty),
               'null'::jsonb
             ) AS cleaned
      FROM jsonb_each(p_value) AS j(key, value)
    ) e;
    RETURN v_result;
  END IF;

  IF v_type = 'array' THEN
    SELECT coalesce(jsonb_agg(e.cleaned), '[]'::jsonb)
      INTO v_result
    FROM (
      SELECT public.nyrava_sanitize_personal_notice_json_value(a.value, p_deny_personal_notice_duty) AS cleaned
      FROM jsonb_array_elements(p_value) AS a(value)
    ) e
    WHERE e.cleaned IS NOT NULL;
    RETURN v_result;
  END IF;

  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.nyrava_guard_case_finding_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.nyrava_case_denies_personal_notice_duty(NEW.case_id)
     AND public.nyrava_is_personal_notice_defect_text(to_jsonb(NEW)::text) THEN
    IF TG_OP = 'UPDATE' THEN
      RETURN OLD;
    END IF;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nyrava_guard_case_finding_personal_notice ON public.case_findings;
CREATE TRIGGER trg_nyrava_guard_case_finding_personal_notice
BEFORE INSERT OR UPDATE ON public.case_findings
FOR EACH ROW EXECUTE FUNCTION public.nyrava_guard_case_finding_personal_notice();

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_analysis_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deny boolean;
BEGIN
  v_deny := public.nyrava_case_denies_personal_notice_duty(NEW.case_id);
  IF NOT v_deny THEN RETURN NEW; END IF;

  NEW.procedural_issues := public.nyrava_sanitize_personal_notice_json_value(NEW.procedural_issues, true);
  NEW.key_findings := public.nyrava_sanitize_personal_notice_json_value(NEW.key_findings, true);
  NEW.contradictions := public.nyrava_sanitize_personal_notice_json_value(NEW.contradictions, true);
  NEW.missing_evidence := public.nyrava_sanitize_personal_notice_json_value(NEW.missing_evidence, true);
  NEW.scoring := public.nyrava_sanitize_personal_notice_json_value(NEW.scoring, true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nyrava_sanitize_analysis_personal_notice ON public.analyses;
CREATE TRIGGER trg_nyrava_sanitize_analysis_personal_notice
BEFORE INSERT OR UPDATE ON public.analyses
FOR EACH ROW EXECUTE FUNCTION public.nyrava_sanitize_analysis_personal_notice();

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_agent_finding_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deny boolean;
BEGIN
  v_deny := public.nyrava_case_denies_personal_notice_duty(NEW.case_id);
  IF NOT v_deny THEN RETURN NEW; END IF;

  NEW.findings := public.nyrava_sanitize_personal_notice_json_value(NEW.findings, true);
  IF public.nyrava_is_personal_notice_defect_text(NEW.summary) THEN
    NEW.summary := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nyrava_sanitize_agent_finding_personal_notice ON public.agent_findings;
CREATE TRIGGER trg_nyrava_sanitize_agent_finding_personal_notice
BEFORE INSERT OR UPDATE ON public.agent_findings
FOR EACH ROW EXECUTE FUNCTION public.nyrava_sanitize_agent_finding_personal_notice();

CREATE OR REPLACE FUNCTION public.nyrava_sanitize_agent_log_personal_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.nyrava_case_denies_personal_notice_duty(NEW.case_id) THEN
    NEW.output := public.nyrava_sanitize_personal_notice_json_value(NEW.output, true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nyrava_sanitize_agent_log_personal_notice ON public.agent_logs;
CREATE TRIGGER trg_nyrava_sanitize_agent_log_personal_notice
BEFORE INSERT OR UPDATE ON public.agent_logs
FOR EACH ROW EXECUTE FUNCTION public.nyrava_sanitize_agent_log_personal_notice();

CREATE OR REPLACE FUNCTION public.nyrava_enforce_released_case_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'released' THEN
    NEW.progress := 100;
    NEW.completed_at := coalesce(NEW.completed_at, now());
    NEW.next_stage := NULL;
    NEW.worker_lease_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nyrava_enforce_released_case_terminal_state ON public.cases;
CREATE TRIGGER trg_nyrava_enforce_released_case_terminal_state
BEFORE INSERT OR UPDATE OF status, progress, completed_at, next_stage, worker_lease_until ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.nyrava_enforce_released_case_terminal_state();

-- Preserve the CURRENT service-role-only factory-reset API, including the
-- p_actor_id parameter used by src/lib/factory-reset.functions.ts.
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
AS $$
DECLARE
  t text;
  n bigint;
  result jsonb := '{}'::jsonb;
  targets text[] := ARRAY[
    'verification_items','case_finding_patches','case_decision_reconstructions',
    'cross_agent_audit','finding_version_snapshots','case_outcome_assessments',
    'pipeline_trace','pipeline_events','pipeline_engine_runs','agent_findings','agent_logs',
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
  -- This RPC is invoked only with the server-side service-role client after
  -- factory-reset.functions.ts has independently verified the real actor is
  -- a super admin. Do not re-open this destructive RPC to browser clients.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden — service role required.';
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
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DELETE FROM public.%I WHERE true', t);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        result := result || jsonb_build_object(t, n);
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.admin_audit_log (actor_id, action, target, meta)
  VALUES (
    p_actor_id,
    'factory_reset_case_data',
    'operational_case_data',
    jsonb_build_object(
      'deleted', result,
      'include_demo', p_include_demo,
      'include_audit', p_include_audit,
      'include_ai_usage', p_include_ai_usage
    )
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset_case_data(boolean, boolean, boolean, uuid) TO service_role;

COMMIT;
