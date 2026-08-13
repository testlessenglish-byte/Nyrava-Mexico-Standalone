-- ============================================================================
-- Document purpose classification — "why was this document uploaded?",
-- separate from evidence_scope's "should the analysis corpus read it?"
--
-- evidence_scope (see 20260813224813_document_evidence_scope.sql) stays
-- exactly as-is: the binary corpus-inclusion gate 4 analysis-engine call
-- sites already filter on. Overloading it with a finer 9-value purpose
-- taxonomy would either break those filters' correctness (a purpose value
-- like 'context_only' would silently fail the existing
-- `.neq(evidence_scope, 'revision_context')` check and leak into the
-- corpus) or require touching every one of those call sites again for a
-- concern they don't need to know about. A separate column keeps the
-- load-bearing gate simple and adds the richer classification alongside it
-- — the same "additive, not a replacement" principle as
-- case_findings.lifecycle_status next to superseded_at.
--
-- Set by generateFindingPatchSet (chat-patch.server.ts) when a Talk-to-Case
-- exchange includes an attachment — it already reasons about whether a
-- document supports a correction, so this reuses that same grounded call
-- rather than a second, unguarded classification pass. NULL for every
-- document uploaded before this column existed, or where nothing has
-- classified it (the overwhelming majority of ordinary Evidence-tab
-- uploads, which don't need this — evidence_scope already says
-- 'case_corpus').
-- ============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS purpose text;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_purpose_check
  CHECK (
    purpose IS NULL OR purpose IN (
      'case_evidence',
      'correction_support',
      'finding_correction',
      'report_correction',
      'context_only',
      'user_instruction',
      'counter_evidence',
      'duplicate',
      'irrelevant'
    )
  );

COMMENT ON COLUMN public.documents.purpose IS
  'Why this document was uploaded, as classified by generateFindingPatchSet when it appears in a Talk-to-Case exchange. NULL for documents no chat exchange has classified (including ordinary Evidence-tab uploads, which do not need this). Never the corpus-inclusion gate — that remains evidence_scope, unchanged.';
