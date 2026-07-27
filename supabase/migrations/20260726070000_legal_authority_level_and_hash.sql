-- Phase 1.5: authority_level + content_hash columns on legal_authorities.
--
-- SAFE BY CONSTRUCTION: legal_authorities is not read from or written to by
-- any part of the case pipeline, report generation, Talk-to-Case, or Legal
-- QA — confirmed by direct code search during Phase 1 (zero matches across
-- pipeline.server.ts, chat.server.ts, legal-qa.server.ts, export.ts). These
-- are additive, nullable columns on a currently fully-isolated table; there
-- is no code path by which this can affect an active case.

ALTER TABLE public.legal_authorities
  ADD COLUMN IF NOT EXISTS authority_level smallint;

COMMENT ON COLUMN public.legal_authorities.authority_level IS
  'Legal authority ranking, 1 (lowest, secondary/academic) to 10 (highest, binding constitutional/SCJN authority). Used by report generation and Talk-to-Case to weight which sources to trust more heavily when multiple authorities are relevant. NULL until backfilled/set by ingestion.';

-- Backfill for the 12 existing seed rows, based on their actual kind/jurisdiction:
UPDATE public.legal_authorities SET authority_level = 10 WHERE kind = 'constitution';
UPDATE public.legal_authorities SET authority_level = 9  WHERE kind IN ('code','law') AND jurisdiction = 'Federal';
UPDATE public.legal_authorities SET authority_level = 8  WHERE kind IN ('code','law') AND jurisdiction <> 'Federal';

ALTER TABLE public.legal_authorities
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN public.legal_authorities.content_hash IS
  'SHA-256 hex digest of the body column, computed at ingestion time. Lets a future report-freshness check cheaply detect whether an authority has actually changed via a hash comparison instead of a full text diff. NULL until an ingestion or backfill computes it. Population logic is a separate, later change to versioning.server.ts — not included here, this migration only adds the column.';

ALTER TABLE public.legal_authority_versions
  ADD COLUMN IF NOT EXISTS content_hash text;
