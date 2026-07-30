-- ============================================================
-- Intelligence Aggregation Refactor — Migration (Revision 3)
-- Additive only. No drops, renames, policy or trigger changes.
-- ============================================================

-- 1. case_findings: aggregation columns
ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS finding_status text NOT NULL DEFAULT 'candidate',
  ADD COLUMN IF NOT EXISTS supporting_engines text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS evidence_strength numeric,
  ADD COLUMN IF NOT EXISTS citation_quality numeric,
  ADD COLUMN IF NOT EXISTS authority_level smallint NOT NULL DEFAULT 1;

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_finding_status_check
  CHECK (finding_status IN ('candidate','verified','disputed','suppressed','promoted'));

ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_authority_level_check
  CHECK (authority_level BETWEEN 0 AND 5);

-- 2. Provenance identity for projected rows (generated from metadata)
ALTER TABLE public.case_findings
  ADD COLUMN projected_from_table text
    GENERATED ALWAYS AS (metadata #>> '{projected_from,table}') STORED,
  ADD COLUMN projected_from_row_id text
    GENERATED ALWAYS AS (metadata #>> '{projected_from,row_id}') STORED;

CREATE UNIQUE INDEX case_findings_projection_identity_uidx
  ON public.case_findings (case_id, projected_from_table, projected_from_row_id)
  WHERE projected_from_table IS NOT NULL;

-- 3. Read indexes
CREATE INDEX case_findings_case_status_idx
  ON public.case_findings (case_id, finding_status)
  WHERE finding_status <> 'candidate';

CREATE INDEX case_findings_supporting_engines_gin
  ON public.case_findings USING gin (supporting_engines);

-- 4. Provenance-honest backfill. Nothing becomes 'promoted'.
UPDATE public.case_findings
   SET finding_status = 'disputed'
 WHERE verification_status = 'demoted_unsupported';

-- 5. Report reproducibility: bind a report to the canonical version it used
ALTER TABLE public.reports          ADD COLUMN IF NOT EXISTS canonical_version integer;
ALTER TABLE public.report_versions  ADD COLUMN IF NOT EXISTS canonical_version integer;

-- 6. Batched, race-safe projection RPC.
--    PostgREST cannot express a partial-index conflict target, so the
--    projection goes through this SECURITY DEFINER routine. Service-role
--    only: the pipeline calls it with the admin client and supplies the
--    case owner's user_id, never the caller's session identity.
CREATE OR REPLACE FUNCTION public.project_case_findings(
  p_case_id uuid,
  p_rows    jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_count integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  SELECT user_id INTO v_owner FROM public.cases WHERE id = p_case_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'project_case_findings: unknown case %', p_case_id;
  END IF;

  WITH src AS (
    SELECT *
      FROM jsonb_to_recordset(p_rows) AS r(
        source_module      text,
        category           text,
        title              text,
        description        text,
        severity           text,
        confidence         numeric,
        legal_significance text,
        potential_impact   text,
        affected_party     text,
        evidence_type      text,
        impact_direction   text,
        priority           integer,
        tags               text[],
        supporting_engines text[],
        source_doc_ids     uuid[],
        evidence_refs      jsonb,
        metadata           jsonb
      )
  ), ins AS (
    INSERT INTO public.case_findings (
      case_id, user_id, source_module, category, title, description,
      severity, confidence, legal_significance, potential_impact,
      affected_party, evidence_type, impact_direction, priority,
      tags, supporting_engines, source_doc_ids, evidence_refs, metadata
    )
    SELECT
      p_case_id, v_owner,
      s.source_module, s.category, s.title, s.description,
      COALESCE(s.severity, 'medium'), COALESCE(s.confidence, 0.5),
      s.legal_significance, s.potential_impact, s.affected_party,
      s.evidence_type, s.impact_direction, s.priority,
      COALESCE(s.tags, '{}'::text[]),
      COALESCE(s.supporting_engines, '{}'::text[]),
      COALESCE(s.source_doc_ids, '{}'::uuid[]),
      COALESCE(s.evidence_refs, '[]'::jsonb),
      COALESCE(s.metadata, '{}'::jsonb)
    FROM src s
    WHERE s.metadata #>> '{projected_from,table}'  IS NOT NULL
      AND s.metadata #>> '{projected_from,row_id}' IS NOT NULL
    ON CONFLICT (case_id, projected_from_table, projected_from_row_id)
      WHERE projected_from_table IS NOT NULL
    DO UPDATE SET
      title              = EXCLUDED.title,
      description        = EXCLUDED.description,
      category           = EXCLUDED.category,
      severity           = EXCLUDED.severity,
      confidence         = EXCLUDED.confidence,
      legal_significance = EXCLUDED.legal_significance,
      potential_impact   = EXCLUDED.potential_impact,
      affected_party     = EXCLUDED.affected_party,
      evidence_type      = EXCLUDED.evidence_type,
      impact_direction   = EXCLUDED.impact_direction,
      priority           = EXCLUDED.priority,
      tags               = EXCLUDED.tags,
      supporting_engines = EXCLUDED.supporting_engines,
      source_doc_ids     = EXCLUDED.source_doc_ids,
      evidence_refs      = EXCLUDED.evidence_refs,
      metadata           = EXCLUDED.metadata,
      updated_at         = now()
    -- finding_status is deliberately NOT updated: re-projection must never
    -- reset a status the canonical gate already earned.
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.project_case_findings(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_case_findings(uuid, jsonb) TO service_role;