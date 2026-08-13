-- ============================================================================
-- Document evidence scope — stops a Talk-to-Case chat attachment from
-- silently contaminating the permanent case corpus.
--
-- Bug this fixes: `uploadCaseEvidence` (the "attach a file inside Talk to
-- Case" mutation) and `addEvidenceAndRerun` (the Evidence tab's permanent
-- upload) both insert into this SAME `documents` table with no distinguishing
-- column. Every corpus-consuming engine (analyzers, agents, the shared
-- analysis brief, evidence_intelligence, the evidence map) reads ALL of a
-- case's documents unconditionally, so a document a user drops into a chat
-- exchange ("use this to correct Finding #3") was already indistinguishable
-- from ordinary case evidence the moment a full pipeline rerun happened next
-- — exactly the failure mode this fix closes.
--
-- 'case_corpus' (default) = ordinary evidence, read by every full-pipeline
-- analysis engine. 'revision_context' = uploaded via Talk-to-Case; still
-- extracted (so the chat AI and the finding-patch generator can read it) and
-- still usable as grounding for a correction, but excluded from the corpus
-- analyzers/agents/evidence-intel/evidence-map build findings from, until a
-- user explicitly promotes it (see promoteRevisionDocument in
-- cases.functions.ts).
-- ============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS evidence_scope text NOT NULL DEFAULT 'case_corpus';

ALTER TABLE public.documents
  ADD CONSTRAINT documents_evidence_scope_check
  CHECK (evidence_scope IN ('case_corpus', 'revision_context'));

CREATE INDEX IF NOT EXISTS documents_evidence_scope_idx
  ON public.documents(case_id, evidence_scope);

COMMENT ON COLUMN public.documents.evidence_scope IS
  'case_corpus = ordinary evidence, included in every full-pipeline analysis engine''s corpus read. revision_context = uploaded via Talk-to-Case; extracted and usable for grounding a correction, but excluded from the analysis corpus until explicitly promoted.';
