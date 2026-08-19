-- Final attorney-facing report integrity guard.
--
-- This migration fixes a class of failures where the canonical engines were
-- correct but free-form report prose drifted away from them.  It is deliberately
-- deterministic and case-agnostic:
--   1) a verified controlling holding that says personal service was NOT
--      required suppresses contrary "defective personal notice" findings and
--      removes prospective nullity/remedy prose based on that rejected premise;
--   2) an empty canonical contradictions array means prose may not manufacture
--      a "contradiction" out of a lower-court position later reversed on review;
--   3) the canonical timeline stored in full_report is copied into the root
--      timeline_summary that PDF/DOCX renderers actually consume;
--   4) root risk_score is normalized to deterministic_algorithms.risk.score so
--      stale LLM confidence can never masquerade as litigation risk.

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
  fr jsonb;
  canonical_events jsonb;
  canonical_timeline_text text;
  canonical_contradiction_count integer := 0;
  deterministic_risk numeric;
  no_personal_notice_duty boolean := false;
begin
  fr := coalesce(new.full_report::jsonb, '{}'::jsonb);

  -- Canonical timeline is authoritative.  The report renderer currently reads
  -- reports.timeline_summary, while the robust timeline builder stores the full
  -- event set under full_report.canonical_timeline.  Bridge those two surfaces
  -- at the persistence boundary so a 4-event canonical chronology cannot be
  -- printed as a one-sentence LLM summary.
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

  -- Deterministic risk owns the public risk score.  The LLM's confidence score
  -- remains available in score_breakdown/scorecard but cannot overwrite risk.
  begin
    deterministic_risk := nullif(fr #>> '{deterministic_algorithms,risk,score}', '')::numeric;
  exception when invalid_text_representation then
    deterministic_risk := null;
  end;
  if deterministic_risk is not null and deterministic_risk between 0 and 100 then
    new.risk_score := deterministic_risk;
  end if;

  -- Canonical contradictions own contradiction semantics.  A judicial reversal
  -- is not itself a factual contradiction.  When the structured contradiction
  -- engine returned zero, remove free-form prose that invents one.
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

  -- Detect a verified court holding that expressly rejects a supposed duty of
  -- personal service.  Once such a holding exists, lower-authority/generated
  -- rows may describe the historical notice dispute, but they may not turn the
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
    -- Suppress only contrary findings that hinge on the absence of PERSONAL
    -- notice.  Other service defects remain untouched.
    update public.case_findings f
    set finding_status = 'suppressed',
        metadata = coalesce(f.metadata, '{}'::jsonb) || jsonb_build_object(
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
    new.missing_evidence_report := public.nyrava_strip_personal_notice_inversion(new.missing_evidence_report);
    new.procedural_issues_report := public.nyrava_strip_personal_notice_inversion(new.procedural_issues_report);
    new.constitutional_issues := public.nyrava_strip_personal_notice_inversion(new.constitutional_issues);
    new.risk_analysis := public.nyrava_strip_personal_notice_inversion(new.risk_analysis);
    new.recommendations := public.nyrava_strip_personal_notice_inversion(new.recommendations);

    new.constitutional_issues_struct := public.nyrava_filter_notice_inversion_array(new.constitutional_issues_struct::jsonb);
    new.motion_opportunities := public.nyrava_filter_notice_inversion_array(new.motion_opportunities::jsonb);
    new.strategy_recommendations := public.nyrava_filter_notice_inversion_array(new.strategy_recommendations::jsonb);
    new.next_actions := public.nyrava_filter_notice_inversion_array(new.next_actions::jsonb);

    if jsonb_typeof(fr #> '{legal_memorandum,risk_matrix}') = 'array' then
      fr := jsonb_set(
        fr,
        '{legal_memorandum,risk_matrix}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,risk_matrix}'),
        true
      );
    end if;
    if jsonb_typeof(fr #> '{legal_memorandum,recommended_motions}') = 'array' then
      fr := jsonb_set(
        fr,
        '{legal_memorandum,recommended_motions}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,recommended_motions}'),
        true
      );
    end if;
    if jsonb_typeof(fr #> '{legal_memorandum,next_actions}') = 'array' then
      fr := jsonb_set(
        fr,
        '{legal_memorandum,next_actions}',
        public.nyrava_filter_notice_inversion_array(fr #> '{legal_memorandum,next_actions}'),
        true
      );
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
