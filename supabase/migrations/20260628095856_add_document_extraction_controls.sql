/*
# Add document extraction control columns

1. New Columns on `documents` table
- `extraction_retry_count` (integer, default 0): Tracks how many times extraction has been retried for a failed document. Prevents infinite retry loops.
- `last_extraction_attempt_at` (timestamptz, nullable): When the most recent extraction attempt occurred. Used for rate-limiting retries.

2. Indexes
- `idx_documents_case_status`: Composite index on (case_id, status) for fast filtering of documents by case and extraction state.
- `idx_documents_content_hash`: Index on content_hash for fast duplicate detection during upload.

3. Security
- No RLS changes — existing policies on documents table remain in effect.
*/

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS extraction_retry_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_extraction_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_documents_case_status ON documents(case_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);