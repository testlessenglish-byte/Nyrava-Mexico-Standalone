-- Nyrava México post-#169 canonical correctness hardening.
--
-- This migration addresses defects reproduced by the ADR 5829/2025
-- concluded-audit regression run after PR #169:
--   1) legacy strict/balanced/exploratory tokens were still able to select
--      different evidence policies even though the UI exposes one run mode;
--   2) LLM score explanations could persist invented contributors that had
--      no canonical finding_id (including criminal-only concepts in amparo);
--   3) a case could be status=released while remaining progress=90 with
--      completed_at/report_at NULL and lifecycle_status='intake'.
--
-- This is deliberately data-preserving. It does not delete findings,
-- reports, documents, Talk-to-Case data, or historical agent telemetry.

begin;

-- ---------------------------------------------------------------------
-- 1. ONE VERIFIED EVIDENCE POLICY: neutralize legacy storage tokens.
-- ---------------------------------------------------------------------
-- Runtime still accepts the old text column for compatibility, but every
-- live row is normalized to the same internal token. This makes the old
-- strict/balanced/exploratory branch behavior inert while code references
-- are retired incrementally.
update public.cases
   set analysis_mode = 'balanced'
 where analysis_mode is distinct from 'balanced';

alter table public.cases
  alter column analysis_mode set default 'balanced';

-- Prevent a stale client/server build from silently reintroducing a second
-- evidence policy. The compatibility token is not a user-selectable mode.
alter table public.cases
  drop constraint if exists cases_analysis_mode_check;

alter table public.cases
  add constraint cases_analysis_mode_unified_check
  check (analysis_mode = 'balanced');

comment on column public.cases.analysis_mode is
  'LEGACY compatibility token only. Unified verified pipeline always stores balanced; user-facing Strict/Balanced/Exploratory modes are retired. Procedural posture lives in case_analysis_mode.';

create or replace function public.nyrava_force_unified_analysis_mode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.analysis_mode := 'balanced';
  return new;
end;
$$;

drop trigger if exists trg_nyrava_force_unified_analysis_mode on public.cases;
create trigger trg_nyrava_force_unified_analysis_mode
before insert or update of analysis_mode on public.cases
for each row execute function public.nyrava_force_unified_analysis_mode();

-- ---------------------------------------------------------------------
-- 2. SCORE PROVENANCE: LLM prose may explain a score, but it may not
--    persist positive/negative contributors without a real case finding.
-- ---------------------------------------------------------------------
create or replace function public.nyrava_sanitize_score_breakdowns(
  p_case_id uuid,
  p_breakdowns jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_result jsonb := coalesce(p_breakdowns, '{}'::jsonb);
  v_llm jsonb := coalesce(v_result -> 'llm', '{}'::jsonb);
  v_key text;
  v_dim jsonb;
  v_positive jsonb;
  v_negative jsonb;
begin
  if jsonb_typeof(v_llm) <> 'object' then
    return v_result - 'llm';
  end if;

  for v_key, v_dim in
    select key, value from jsonb_each(v_llm)
  loop
    if jsonb_typeof(v_dim) <> 'object' then
      continue;
    end if;

    select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
      into v_positive
      from jsonb_array_elements(
             case when jsonb_typeof(v_dim -> 'positive') = 'array'
                  then v_dim -> 'positive' else '[]'::jsonb end
           ) with ordinality as a(e, ord)
     where nullif(e ->> 'finding_id', '') is not null
       and exists (
         select 1
           from public.case_findings f
          where f.case_id = p_case_id
            and f.id::text = e ->> 'finding_id'
       );

    select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
      into v_negative
      from jsonb_array_elements(
             case when jsonb_typeof(v_dim -> 'negative') = 'array'
                  then v_dim -> 'negative' else '[]'::jsonb end
           ) with ordinality as a(e, ord)
     where nullif(e ->> 'finding_id', '') is not null
       and exists (
         select 1
           from public.case_findings f
          where f.case_id = p_case_id
            and f.id::text = e ->> 'finding_id'
       );

    v_dim := jsonb_set(v_dim, '{positive}', v_positive, true);
    v_dim := jsonb_set(v_dim, '{negative}', v_negative, true);
    v_llm := jsonb_set(v_llm, array[v_key], v_dim, true);
  end loop;

  return jsonb_set(v_result, '{llm}', v_llm, true);
end;
$$;

create or replace function public.nyrava_enforce_score_provenance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.dimension_breakdowns := public.nyrava_sanitize_score_breakdowns(
    new.case_id,
    new.dimension_breakdowns
  );
  return new;
end;
$$;

drop trigger if exists trg_nyrava_enforce_score_provenance on public.case_scores;
create trigger trg_nyrava_enforce_score_provenance
before insert or update of dimension_breakdowns, case_id on public.case_scores
for each row execute function public.nyrava_enforce_score_provenance();

-- Clean already-persisted explanations too. Numeric scores are intentionally
-- untouched; the next normal scoring run recalculates them from canonical
-- verified findings.
update public.case_scores
   set dimension_breakdowns = public.nyrava_sanitize_score_breakdowns(
     case_id,
     dimension_breakdowns
   )
 where dimension_breakdowns is not null;

comment on function public.nyrava_sanitize_score_breakdowns(uuid, jsonb) is
  'Removes LLM score contributors that are not backed by a case_findings row for the same case. Prevents cross-materia/fabricated score explanations.';

-- ---------------------------------------------------------------------
-- 3. TERMINAL RELEASE STATE: released must mean complete everywhere.
-- ---------------------------------------------------------------------
create or replace function public.nyrava_enforce_released_case_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status::text = 'released' then
    new.progress := 100;
    new.completed_at := coalesce(new.completed_at, now());
    new.report_at := coalesce(new.report_at, now());
    new.lifecycle_status := 'released';
    new.next_stage := null;
    new.worker_lease_until := null;
    new.execution_id := null;
    new.execution_started_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_nyrava_enforce_released_case_state on public.cases;
create trigger trg_nyrava_enforce_released_case_state
before insert or update of status, progress, completed_at, report_at,
  lifecycle_status, next_stage, worker_lease_until, execution_id,
  execution_started_at
on public.cases
for each row execute function public.nyrava_enforce_released_case_state();

-- Repair already-released rows so UI/export/debug views share one truth.
update public.cases
   set progress = 100,
       completed_at = coalesce(completed_at, updated_at, now()),
       report_at = coalesce(report_at, updated_at, now()),
       lifecycle_status = 'released',
       next_stage = null,
       worker_lease_until = null,
       execution_id = null,
       execution_started_at = null
 where status::text = 'released'
   and (
     progress <> 100
     or completed_at is null
     or report_at is null
     or lifecycle_status is distinct from 'released'
     or next_stage is not null
     or worker_lease_until is not null
     or execution_id is not null
     or execution_started_at is not null
   );

comment on function public.nyrava_enforce_released_case_state() is
  'Canonical terminal-state invariant: status=released implies progress=100, completion/report timestamps present, lifecycle released, and no active execution/lease.';

commit;
