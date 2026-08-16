-- Canonical Reconciliation Design (2026-08-16), P0 §08.
--
-- Additive, nullable column. Only ever written by canonical-id.ts's
-- detectProducerConflict / findings.server.ts's dedupSemantically when a
-- genuine cross-producer disagreement is detected (two different producers
-- each affirmatively asserting incompatible conclusions about the same
-- canonical claim) -- every other row stays NULL, which is today's implicit
-- behavior unchanged. Never "conflicting" pre-verification in this pass;
-- by the time either code path can compare two findings, both have already
-- passed their own producer's evidence verification, so the only state this
-- migration's consumers currently write is "unresolved".
alter table public.case_findings
  add column if not exists reconciliation_state text null;

alter table public.case_findings
  drop constraint if exists case_findings_reconciliation_state_check;

alter table public.case_findings
  add constraint case_findings_reconciliation_state_check
  check (
    reconciliation_state is null
    or reconciliation_state in (
      'new',
      'duplicate',
      'supporting',
      'conflicting',
      'unresolved',
      'amended',
      'rejected'
    )
  );

create index if not exists case_findings_reconciliation_state_idx
  on public.case_findings(case_id, reconciliation_state) where reconciliation_state is not null;

comment on column public.case_findings.reconciliation_state is
  'Canonical Reconciliation Design state. NULL = ordinary path (no cross-producer disagreement detected). "unresolved"/"conflicting" = two different producers affirmatively asserted incompatible conclusions about the same canonical claim; see metadata.conflict for both sides.';
