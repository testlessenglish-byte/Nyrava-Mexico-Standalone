-- Final attorney-facing report integrity guard.
--
-- Canonical engines already compute the controlling holding, contradiction
-- set, timeline, and deterministic risk.  This trigger makes those canonical
-- outputs authoritative at the reports persistence boundary so free-form LLM
-- prose cannot silently contradict them in the PDF/DOCX/UI.

create or replace function public.nyrava_strip_false_contradiction_prose(input_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    coalesce(input_text, ''),
    '[^.!?\n]*(contradicci[oó]n|contradictori[oa]s?|discrepancia)[^.!?\n]*[.!?]?',
    '',
    'gi'
  ));
$$;

create or replace function public.nyrava_strip_personal_notice_inversion(input_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        coalesce(input_text, ''),
        '[^.!?\n]*(notificaci[oó]n defectuosa|irregularidad[^.!?\n]{0,80}notificaci[oó]n|error[^.!?\n]{0,80}notificaci[oó]n)[^.!?\n]*[.!?]?',
        '',
        'gi'
      ),
      '[^.!?\n]*(falta|ausencia|omisi[oó]n)[^.!?\n]{0,100}notificaci[oó]n[^.!?\n]{0,80}personal[^.!?\n]*(afecta|afectar|invalid|nulidad|procedencia|desestim|derecho de defensa)[^.!?\n]*[.!?]?',
      '',
      'gi'
    ),
    '[^.!?\n]*notificaci[oó]n personal[^.!?\n]*(es necesaria|era necesaria|debe ser|debi[oó] ser)[^.!?\n]*[.!?]?',
    '',
    'gi'
  ));
$$;

create or replace function public.nyrava_filter_notice_inversion_array(input_value jsonb)
returns jsonb
language sql
stable
as $$
  select case
    when input_value is null or jsonb_typeof(input_value) <> 'array' then coalesce(input_value, '[]'::jsonb)
    else coalesce(
      (
        select jsonb_agg(item order by ord)
        from jsonb_array_elements(input_value) with ordinality as x(item, ord)
        where not (
          item::text ~* 'notificaci[oó]n[^"}]{0,100}personal'
          and item::text ~* '(defectu|irregular|error|nulidad|invalid|procedencia|desestim|afect)'
        )
      ),
      '[]'::jsonb
    )
  end;
$$;

create or replace function public.nyrava_report_legal_integrity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fr jsonb := coalesce(new.full_report::jsonb, '{}'::jsonb);
  canonical_events jsonb;
  canonical_timeline_text text;
  canonical_contradiction_count integer := 0;
  deterministic_risk numeric;
  no_personal_notice_duty boolean := false;
begin
  -- 1) Canonical timeline -> the root timeline_summary consumed by exports.
  canonical_events := fr #> '{canonical_timeline,events}';
  if canonical_events is not null
     and jsonb_typeof(canonical_events) = 'array'
     and jsonb_array_length(canonical_events) > 0 then
    select string_agg(
      concat_ws(': ', nullif(e->>'date', ''), nullif(e->>'event', '')),
      E'\n'
      order by e->>'date', ord
    )
    into canonical_timeline_text
    from jsonb_array_elements(canonical_events) with ordinality as x(e, ord);

    if nullif(trim(coalesce(canonical_timeline_text, '')), '') is not null then
      new.timeline_summary := canonical_timeline_text;
    end if;
  end if;

  -- 2) Deterministic risk owns reports.risk_score.  LLM confidence is a
  -- separate metric and remains available in score_breakdown/scorecard.
  begin
    deterministic_risk := nullif(fr #>> '{deterministic_algorithms,risk,score}', '')::numeric;
  exception when invalid_text_representation then
    deterministic_risk := null;
  end;
  if deterministic_risk is not null and deterministic_risk between 0 and 100 then
    new.risk_score := deterministic_risk;
  end if;

  -- 3) A lower-court interpretation later reversed by the reviewing court is
  -- a judicial history/holding sequence, not a factual contradiction.  When
  -- canonical contradictions_struct is empty, free prose cannot create one.
  if new.contradictions_struct is null then
    canonical_contradiction_count := 0;
  elsif jsonb_typeof(new.contradictions_struct::jsonb) = 'array' then
    canonical_contradiction_count := jsonb_array_length(new.contradictions_struct::jsonb);
  end if;

  if canonical_contradiction_count = 0 then
    new.contradiction_report := case
      when coalesce(new.generated_language, 'es') = 'en'
        then 'No verified contradictions were identified in the supplied record.'
      else 'No se identificaron contradicciones verificadas en el expediente aportado.'
    end;
    new.executive_summary := public.nyrava_strip_false_contradiction_prose(new.executive_summary);
    new.attorney_summary := public.nyrava_strip_false_contradiction_prose(new.attorney_summary);
    new.investigator_summary := public.nyrava_strip_false_contradiction_prose(new.investigator_summary);
    new.evidence_summary := public.nyrava_strip_false_contradiction_prose(new.evidence_summary);
    new.risk_analysis := public.nyrava_strip_false_contradiction_prose(new.risk_analysis);
  end if;

  -- 4) A VERIFIED_COURT_HOLDING expressly rejecting a duty of personal notice
  -- controls over generated/lower-authority rows that try to turn the same
  -- absence of personal service into an extant defect, nullity, or new remedy.
  select exists (
    select 1
    from public.case_findings f
    where f.case_id = new.case_id
      and coalesce(f.finding_status, 'candidate') <> 'suppressed'
      and coalesce(f.verification_status, '') = 'verified'
      and coalesce(f.audit_classification, '') = 'VERIFIED_COURT_HOLDING'
      and (
        coalesce(f.source_quote, '') || ' ' ||
        coalesce(f.description, '') || ' ' ||
        coalesce(f.metadata::text, '')
      ) ~* '(no exist[ií]a[^.!?]{0,120}deber|no (era|es|fuera) necesario|no resultaba necesario)[^.!?]{0,160}notific[^.!?]{0,80}personal'
  ) into no_personal_notice_duty;

  if no_personal_notice_duty then
    -- Suppress only contrary findings whose claimed defect actually depends on
    -- PERSONAL notice.  Other service defects are not touched.
    update public.case_findings f
    set finding_status = 'suppressed',
        metadata = coalesce(f.metadata::jsonb, '{}'::jsonb) || jsonb_build_object(
          'posture_reconciled', true,
          'suppressed_reason', 'controlling_holding_no_personal_notice_duty'
        )
    where f.case_id = new.case_id
      and coalesce(f.finding_status, 'candidate') <> 'suppressed'
      and coalesce(f.audit_classification, '') <> 'VERIFIED_COURT_HOLDING'
      and (
        coalesce(f.title, '') || ' ' ||
        coalesce(f.description, '') || ' ' ||
        coalesce(f.legal_significance, '') || ' ' ||
        coalesce(f.potential_impact, '')
      ) ~* 'notific[^.!?]{0,100}personal'
      and (
        coalesce(f.title, '') || ' ' ||
        coalesce(f.description, '') || ' ' ||
        coalesce(f.legal_significance, '') || ' ' ||
        coalesce(f.potential_impact, '')
      ) ~* '(defectu|irregular|error|nulidad|invalid|procedencia|desestim|afect)';

    new.executive_summary := public.nyrava_strip_personal_notice_inversion(new.executive_summary);
    new.attorney_summary := public.nyrava_strip_personal_notice_inversion(new.attorney_summary);
    new.investigator_summary := public.nyrava_strip_personal_notice_inversion(new.investigator_summary);
    new.evidence_summary := public.nyrava_strip_personal_notice_inversion(new.evidence_summary);
    new.procedural_issues_report := public.nyrava_strip_personal_notice_inversion(new.procedural_issues_report);
    new.constitutional_issues := public.nyrava_strip_personal_notice_inversion(new.constitutional_issues);
    new.risk_analysis := public.nyrava_strip_personal_notice_inversion(new.risk_analysis);
    new.recommendations := public.nyrava_strip_personal_notice_inversion(new.recommendations);

    new.constitutional_issues_struct := public.nyrava_filter_notice_inversion_array(new.constitutional_issues_struct::jsonb);
    new.motion_opportunities := public.nyrava_filter_notice_inversion_array(new.motion_opportunities::jsonb);
    new.strategy_recommendations := public.nyrava_filter_notice_inversion_array(new.strategy_recommendations::jsonb);
    new.next_actions := public.nyrava_filter_notice_inversion_array(new.next_actions::jsonb);

    -- The legal memorandum is nested in full_report and can independently
    -- regenerate the same invalid remedy.  Filter its structured remedy lanes.
    if jsonb_typeof(fr #> '{legal_memorandum,risk_matrix}') = 'array' then
      fr := jsonb_set(fr, '{legal_memorandum,risk_matrix}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,risk_matrix}'), true);
    end if;
    if jsonb_typeof(fr #> '{legal_memorandum,recommended_motions}') = 'array' then
      fr := jsonb_set(fr, '{legal_memorandum,recommended_motions}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,recommended_motions}'), true);
    end if;
    if jsonb_typeof(fr #> '{legal_memorandum,next_actions}') = 'array' then
      fr := jsonb_set(fr, '{legal_memorandum,next_actions}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,next_actions}'), true);
    end if;
    new.full_report := fr;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_nyrava_report_legal_integrity_guard on public.reports;
create trigger trg_nyrava_report_legal_integrity_guard
before insert or update on public.reports
for each row
execute function public.nyrava_report_legal_integrity_guard();

comment on function public.nyrava_report_legal_integrity_guard() is
  'Canonical final-report guard: controlling holding posture, contradiction authority, canonical timeline propagation, and deterministic risk ownership.';
