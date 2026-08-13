-- ============================================================================
-- Revision grouping for case_finding_patches — "which corrections made up
-- revision N" without a parallel case_revision table.
--
-- report_versions (report-version.server.ts) is already an append-only,
-- immutable snapshot of the full report at each version — the case-revision
-- architecture's "RUN-001 remains recoverable" requirement is already met by
-- it. This column is the missing link: it lets a query answer "what changed
-- in revision N" as `case_finding_patches WHERE case_id = X AND
-- report_version = N`, joined against report_versions for the snapshot and
-- finding_version_snapshots for the per-finding delta classification —
-- rather than inventing a new case_revision entity that would just duplicate
-- what report_versions already tracks.
--
-- Nullable: set by pushCaseChatCorrectionsToReport AFTER the report version
-- bump (the version isn't known yet at the moment a patch is applied and its
-- audit row inserted — see cases.functions.ts). A row with report_version
-- NULL simply hasn't had its revision number backfilled, never a sign of
-- corruption.
-- ============================================================================

ALTER TABLE public.case_finding_patches
  ADD COLUMN IF NOT EXISTS report_version integer;

CREATE INDEX IF NOT EXISTS case_finding_patches_report_version_idx
  ON public.case_finding_patches(case_id, report_version);

COMMENT ON COLUMN public.case_finding_patches.report_version IS
  'The reports.version this patch''s application produced — groups patches into the "revision" they belong to. NULL until pushCaseChatCorrectionsToReport backfills it post-apply.';
