
ALTER TABLE public.evidence_classifications
  ADD COLUMN IF NOT EXISTS supports_finding_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contradicts_finding_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS referenced_by_doc_ids      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_witness_ids         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_timeline_event_ids  jsonb NOT NULL DEFAULT '[]'::jsonb;
