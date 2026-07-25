-- Fix: canonical_finding_id was declared as `uuid`, but
-- src/lib/intelligence/canonical-id.ts computes it as `cf_<fnv1a-hash>` —
-- a text value, never a valid UUID. Every write to this column has been
-- silently rejected/nulled since the column was added, permanently
-- breaking canonical-id based dedup/merge across ALL cases (not specific
-- to any one test case).
--
-- This migration is data-safe: the column has never successfully held a
-- non-null value (writes always fail against the uuid type), so there is
-- nothing to migrate/convert — we only need to correct the type going
-- forward.

ALTER TABLE public.case_findings
  ALTER COLUMN canonical_finding_id TYPE text
  USING canonical_finding_id::text;

COMMENT ON COLUMN public.case_findings.canonical_finding_id IS
  'Stable post-merge finding identity, format cf_<fnv1a-hash>. Text, not UUID — see src/lib/intelligence/canonical-id.ts.';
