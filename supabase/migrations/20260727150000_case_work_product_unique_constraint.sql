-- Fix: runWorkProductEngine (engines.server.ts) does
--   db.from("case_work_product").upsert(rows, { onConflict: "case_id,document_type" })
-- which requires a genuine UNIQUE constraint (or exclusion constraint) on
-- exactly those columns. The table was only ever created with a plain,
-- non-unique index (case_work_idx, see 20260621014359_...sql), so every
-- upsert has been failing with:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
-- This is the migration the code comment in engines.server.ts explicitly
-- says must be run before that upsert-based code could work.

-- Safety step: deduplicate any existing (case_id, document_type) rows
-- before adding the constraint, in case any duplicates accumulated from
-- the earlier delete-then-reinsert pattern or a retried run. Keeps the
-- most recently updated row per (case_id, document_type) pair.
DELETE FROM public.case_work_product a
USING public.case_work_product b
WHERE a.case_id = b.case_id
  AND a.document_type = b.document_type
  AND a.updated_at < b.updated_at;

-- If any exact ties remain (identical updated_at), keep the one with the
-- lexicographically greater id so exactly one survives per pair.
DELETE FROM public.case_work_product a
USING public.case_work_product b
WHERE a.case_id = b.case_id
  AND a.document_type = b.document_type
  AND a.updated_at = b.updated_at
  AND a.id < b.id;

-- The plain index is now redundant with the unique constraint below
-- (a UNIQUE constraint creates its own backing index).
DROP INDEX IF EXISTS public.case_work_idx;

ALTER TABLE public.case_work_product
  ADD CONSTRAINT case_work_product_case_doctype_key
  UNIQUE (case_id, document_type);
