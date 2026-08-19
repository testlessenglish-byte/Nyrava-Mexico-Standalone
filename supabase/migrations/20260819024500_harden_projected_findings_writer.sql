-- Nyrava México canonical findings writer hardening.
--
-- The live-schema audit identified two legitimate writers to public.case_findings:
--   * application addFindings/addGatedFindings for canonical engine findings;
--   * project_case_findings() for mirrors of specialized tables.
--
-- They must never be allowed to write the same logical class of row. Keep the
-- projection path because Evidence/Witness specialized tables need visibility
-- in aggregation, but hard-wall it into the `projection:*` namespace and keep
-- those rows as candidates. Canonical readers already exclude projection:% by
-- default until explicit reconciliation.

create or replace function public.project_case_findings(p_case_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_owner uuid;
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  select user_id into v_owner from public.cases where id = p_case_id;
  if v_owner is null then
    raise exception 'project_case_findings: unknown case %', p_case_id;
  end if;

  with src as (
    select *
      from jsonb_to_recordset(p_rows) as r(
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
  ), safe_src as (
    select s.*,
           s.metadata #>> '{projected_from,table}' as projected_table,
           s.metadata #>> '{projected_from,row_id}' as projected_row_id
      from src s
     where s.metadata #>> '{projected_from,table}' is not null
       and s.metadata #>> '{projected_from,row_id}' is not null
       -- A projection writer may NEVER impersonate an engine/analyzer source.
       and s.source_module = 'projection:' || (s.metadata #>> '{projected_from,table}')
  ), ins as (
    insert into public.case_findings (
      case_id, user_id, source_module, category, title, description,
      severity, confidence, legal_significance, potential_impact,
      affected_party, evidence_type, impact_direction, priority,
      tags, supporting_engines, source_doc_ids, evidence_refs, metadata,
      finding_status
    )
    select
      p_case_id, v_owner,
      s.source_module, s.category, s.title, s.description,
      coalesce(s.severity, 'medium'), coalesce(s.confidence, 0.5),
      s.legal_significance, s.potential_impact, s.affected_party,
      s.evidence_type, s.impact_direction, s.priority,
      coalesce(s.tags, '{}'::text[]),
      coalesce(s.supporting_engines, '{}'::text[]),
      coalesce(s.source_doc_ids, '{}'::uuid[]),
      coalesce(s.evidence_refs, '[]'::jsonb),
      coalesce(s.metadata, '{}'::jsonb),
      'candidate'
    from safe_src s
    on conflict (case_id, projected_from_table, projected_from_row_id)
      where projected_from_table is not null
    do update set
      title              = excluded.title,
      description        = excluded.description,
      category           = excluded.category,
      severity           = excluded.severity,
      confidence         = excluded.confidence,
      legal_significance = excluded.legal_significance,
      potential_impact   = excluded.potential_impact,
      affected_party     = excluded.affected_party,
      evidence_type      = excluded.evidence_type,
      impact_direction   = excluded.impact_direction,
      priority           = excluded.priority,
      tags               = excluded.tags,
      supporting_engines = excluded.supporting_engines,
      source_doc_ids     = excluded.source_doc_ids,
      evidence_refs      = excluded.evidence_refs,
      metadata           = excluded.metadata,
      updated_at         = now()
      -- finding_status intentionally NOT updated: a projection rerun cannot
      -- demote a row that a later reconciliation step already promoted.
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$function$;

revoke execute on function public.project_case_findings(uuid, jsonb) from PUBLIC, anon, authenticated;
grant execute on function public.project_case_findings(uuid, jsonb) to service_role;

comment on function public.project_case_findings(uuid, jsonb) is
  'Projection-only writer for case_findings. Requires source_module=projection:<projected_from.table>; cannot create canonical engine/analyzer rows.';
