ALTER TABLE public.case_findings
  ALTER COLUMN canonical_finding_id TYPE text
  USING canonical_finding_id::text;

COMMENT ON COLUMN public.case_findings.canonical_finding_id IS
  'Stable post-merge finding identity, format cf_<fnv1a-hash>. Text, not UUID — see src/lib/intelligence/canonical-id.ts.';