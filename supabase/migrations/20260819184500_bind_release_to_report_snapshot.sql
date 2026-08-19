-- Nyrava México — bind final release approval to the exact saved report snapshot.
--
-- A case may become `released` only when QA, Hallucination, and Judge all
-- succeeded in the SAME final-review run, and that run finished AFTER the
-- latest immutable report_versions snapshot was created. This prevents an
-- older successful gate row from authorizing a newer regenerated report.
--
-- Data preserving: no reports, findings, snapshots, or agent logs are deleted.

begin;

create or replace function public.nyrava_guard_release_snapshot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_snapshot_at timestamptz;
  v_gate_run_id uuid;
  v_gate_count integer := 0;
  v_gate_keys integer := 0;
begin
  if new.status::text <> 'released' then
    return new;
  end if;

  -- The immutable snapshot is created immediately before final release review.
  select rv.created_at
    into v_snapshot_at
    from public.report_versions rv
   where rv.case_id = new.id
   order by rv.created_at desc, rv.version desc
   limit 1;

  if v_snapshot_at is null then
    new.status := 'needs_revision';
    new.status_message := 'Release blocked: no immutable report snapshot exists for final review.';
    new.progress := least(coalesce(new.progress, 100), 99);
    return new;
  end if;

  -- Pick the newest post-snapshot successful gate run. All three authoritative
  -- gates must share that run_id; mixing success rows from separate/historical
  -- runs is explicitly forbidden.
  select al.run_id
    into v_gate_run_id
    from public.agent_logs al
   where al.case_id = new.id
     and al.agent_key in ('qa', 'hallucination', 'judge')
     and al.status = 'success'
     and coalesce(al.finished_at, al.created_at) >= v_snapshot_at
   order by coalesce(al.finished_at, al.created_at) desc
   limit 1;

  if v_gate_run_id is not null then
    select count(*), count(distinct al.agent_key)
      into v_gate_count, v_gate_keys
      from public.agent_logs al
     where al.case_id = new.id
       and al.run_id = v_gate_run_id
       and al.agent_key in ('qa', 'hallucination', 'judge')
       and al.status = 'success'
       and coalesce(al.finished_at, al.created_at) >= v_snapshot_at;
  end if;

  if v_gate_run_id is null or v_gate_count < 3 or v_gate_keys < 3 then
    new.status := 'needs_revision';
    new.status_message := 'Release blocked: QA, Hallucination, and Judge did not all pass against the latest saved report snapshot.';
    new.progress := least(coalesce(new.progress, 100), 99);
    return new;
  end if;

  return new;
end;
$$;

-- PostgreSQL executes same-kind triggers alphabetically. Prefix 00 ensures
-- this guard runs before trg_nyrava_enforce_released_case_state, so a rejected
-- release is not accidentally stamped as a completed/released terminal row.
drop trigger if exists trg_nyrava_00_release_snapshot_guard on public.cases;
create trigger trg_nyrava_00_release_snapshot_guard
before insert or update of status
on public.cases
for each row execute function public.nyrava_guard_release_snapshot();

comment on function public.nyrava_guard_release_snapshot() is
  'Prevents stale gate success from releasing a newer report: QA, hallucination and judge must all succeed in one post-snapshot final-review run.';

commit;
