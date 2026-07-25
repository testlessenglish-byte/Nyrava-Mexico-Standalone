-- Same root cause as case_scores/agent_findings/preferred_language before
-- it: storage policies for a bucket called 'case-files' exist in the
-- original migration set (RLS rules scoping access to auth.uid()'s own
-- folder), but no migration ever actually CREATEs the bucket itself — it
-- was evidently made directly in Supabase's Storage UI on the USA project.
-- Without this, document upload/extraction has no real bucket to write to
-- or read from in this project.

INSERT INTO storage.buckets (id, name, public)
VALUES ('case-files', 'case-files', false)
ON CONFLICT (id) DO NOTHING;
