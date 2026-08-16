-- Canonical Reconciliation Design (2026-08-16), P1 §06 F-3.
--
-- Real bug: chat-patch.server.ts's FindingPatchAction type has included
-- 'dispute_evidence' since the proposition-level evidence-dispute feature
-- shipped (20260813214353_case_finding_patch_set.sql's own table), and the
-- application writes it (see the `action === "dispute_evidence"` branches in
-- chat-patch.server.ts) -- but that migration's own CHECK constraint on
-- case_finding_patches.action never included the value:
--   action text NOT NULL CHECK (action IN ('keep', 'amend', 'remove', 'merge', 'create'))
-- Every attempt to record a dispute_evidence patch has been failing at the
-- database layer since the feature shipped. Additive fix: replace the
-- constraint with one that matches what the code has always written.
alter table public.case_finding_patches
  drop constraint if exists case_finding_patches_action_check;

alter table public.case_finding_patches
  add constraint case_finding_patches_action_check
  check (action in ('keep', 'amend', 'remove', 'merge', 'create', 'dispute_evidence'));
