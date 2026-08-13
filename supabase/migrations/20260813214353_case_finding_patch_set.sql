-- ============================================================================
-- Talk-to-Case Finding Patch Set — structured audit trail for "Push to
-- Report".
--
-- Bug this replaces: Talk-to-Case's "Update Report" action used to package
-- the chat exchange as a synthetic "case-chat-clarification-*.txt" document
-- and run it through the SAME full-pipeline rerun the Evidence tab uses
-- (addEvidenceAndRerun -> queueCaseForPipeline -> drivePipeline -> every
-- analyzer/agent stage re-executes against the whole corpus). The only
-- safeguard against a stale finding reappearing was a prompt instruction
-- ("reconcile, don't duplicate") plus a best-effort LLM backstop pass
-- (reconcileSupersededFindings) — neither is a guarantee, since the
-- analyzers/agents regenerate from the full corpus text, which hasn't
-- changed, every time.
--
-- Fixed architecture: Talk-to-Case now produces an explicit, reviewable
-- patch set against the EXISTING findings (keep | amend | remove | merge |
-- create), grounded the same way every other gate in this codebase is
-- (the decision's quote must independently re-locate in its cited source).
-- "Push to Report" applies the patches transactionally — no engine rerun,
-- no new evidence ingestion — then regenerates the report from the updated
-- findings state only. This table is the structured audit record of every
-- patch ever applied, independent of case_findings.superseded_reason (which
-- still gets a human-readable summary, but this table keeps the full
-- machine-readable provenance: exact source, page, quote, confidence).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.case_finding_patches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The existing finding this patch targets. NULL only for a pure "create"
  -- (a brand-new finding with no prior existing row).
  finding_id uuid REFERENCES public.case_findings(id) ON DELETE SET NULL,

  -- The finding row this patch produced, when applicable: the new
  -- corrected row for "amend", the new row for "create", or the surviving
  -- finding for "merge". NULL for "remove" and "keep".
  result_finding_id uuid REFERENCES public.case_findings(id) ON DELETE SET NULL,

  action text NOT NULL CHECK (action IN ('keep', 'amend', 'remove', 'merge', 'create')),
  reason text NOT NULL,

  -- Grounding: exactly where this decision came from. source_document_id is
  -- nullable because the source is routinely the chat conversation itself
  -- (case_chat_messages), not an uploaded document.
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  source_page integer,
  source_quote text,
  confidence numeric,

  -- The Talk-to-Case exchange that produced this patch decision.
  chat_message_id uuid REFERENCES public.case_chat_messages(id) ON DELETE SET NULL,

  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.case_finding_patches TO authenticated;
GRANT ALL ON public.case_finding_patches TO service_role;
ALTER TABLE public.case_finding_patches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_finding_patches_owner_select ON public.case_finding_patches;
CREATE POLICY case_finding_patches_owner_select ON public.case_finding_patches
  FOR SELECT USING (user_id = auth.uid() AND private.owns_case(case_id));

CREATE INDEX IF NOT EXISTS case_finding_patches_case_idx
  ON public.case_finding_patches(case_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS case_finding_patches_finding_idx
  ON public.case_finding_patches(finding_id) WHERE finding_id IS NOT NULL;

COMMENT ON TABLE public.case_finding_patches IS
  'Structured, grounded audit trail of every Talk-to-Case "Push to Report" patch (keep/amend/remove/merge/create) applied to case_findings. Never a substitute for case_findings itself — case_findings.superseded_at/superseded_reason remains the source of truth for whether a finding is active; this table records WHY and from WHAT source each change was made.';
