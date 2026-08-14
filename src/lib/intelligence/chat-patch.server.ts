// Talk-to-Case Finding Patch Set — "Push to Report" architecture fix.
//
// PROBLEM this replaces: the old "Update Report" action packaged the chat
// exchange as a synthetic "case-chat-clarification-*.txt" document and ran
// it through the SAME full-pipeline rerun the Evidence tab uses
// (addEvidenceAndRerun -> queueCaseForPipeline -> drivePipeline -> every
// analyzer/agent re-executes against the whole corpus). The only defense
// against a stale finding reappearing was a prompt instruction telling the
// regenerating analyzers to "reconcile, not duplicate" plus a best-effort
// LLM backstop (case-state-reconciliation.server.ts's
// reconcileSupersededFindings). Neither is a guarantee: the analyzers
// regenerate from the SAME unchanged source corpus every time, so a
// "corrected" finding can come right back.
//
// FIXED ARCHITECTURE: Talk-to-Case reviews the EXISTING findings directly
// against the chat exchange and produces an explicit, individually-grounded
// patch set (keep | amend | remove | merge | create). "Push to Report"
// applies the patches transactionally to case_findings — never deleting a
// row, only marking it superseded with full provenance in
// case_finding_patches — then regenerates ONLY the report from the updated
// findings state. It does NOT touch documents (no permanent evidence
// ingestion), does NOT call queueCaseForPipeline/drivePipeline, and does
// NOT re-run any analyzer/agent/engine stage.
//
// Grounding discipline matches reconcileSupersededFindings and every other
// gate in this codebase: a patch decision is applied ONLY when its quote
// independently re-locates in its cited source text (the chat exchange, or
// an already-attached document) — an unverified claim is dropped, not
// trusted. "Rerun Case" (queueCaseForPipeline, full engines) remains a
// completely separate, untouched code path for when an attorney adds real
// new evidence.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { mexicoLock, groundingContract, getReportLocale } from "@/lib/mexico-lock";
import { callGroq, parseJsonLoose, GROQ_DEFAULT_MODEL } from "@/lib/groq.server";
import { lightNormalize } from "./evidence-provenance.server";
import { listFindings, addFindings } from "./findings.server";
import type { EvidenceRef, EvidenceRefStatus, NewFinding, Severity } from "./types";
import type { SelfAuditNotice } from "./patterns.server";

type Db = SupabaseClient<Database>;

const MODEL = GROQ_DEFAULT_MODEL;
const VALID_SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];
const VALID_DISPUTE_STATUSES: readonly EvidenceRefStatus[] = [
  "disputed",
  "superseded",
  "withdrawn",
];

/** Continuous Legal Intelligence — see migration 20260813232206_intelligence_lessons.sql.
 *  Mirrors the Postgres enum intelligence_error_type exactly. */
export type IntelligenceErrorType =
  | "unsupported_claim"
  | "bad_evidence_link"
  | "wrong_evidence_interpretation"
  | "duplicate_finding"
  | "contradiction_misclassification"
  | "wrong_legal_authority"
  | "wrong_procedural_rule"
  | "wrong_severity"
  | "wrong_confidence"
  | "missing_finding"
  | "false_positive"
  | "false_negative"
  | "temporal_error"
  | "source_classification_error"
  | "report_rendering_error"
  | "other";
const VALID_ERROR_TYPES: readonly IntelligenceErrorType[] = [
  "unsupported_claim",
  "bad_evidence_link",
  "wrong_evidence_interpretation",
  "duplicate_finding",
  "contradiction_misclassification",
  "wrong_legal_authority",
  "wrong_procedural_rule",
  "wrong_severity",
  "wrong_confidence",
  "missing_finding",
  "false_positive",
  "false_negative",
  "temporal_error",
  "source_classification_error",
  "report_rendering_error",
  "other",
];

/** Mirrors the Postgres check constraint on documents.purpose (see migration
 *  20260813232500_document_purpose_classification.sql) — why a document was
 *  uploaded, separate from evidence_scope's corpus-inclusion gate. */
export type DocumentPurpose =
  | "case_evidence"
  | "correction_support"
  | "finding_correction"
  | "report_correction"
  | "context_only"
  | "user_instruction"
  | "counter_evidence"
  | "duplicate"
  | "irrelevant";
const VALID_DOCUMENT_PURPOSES: readonly DocumentPurpose[] = [
  "case_evidence",
  "correction_support",
  "finding_correction",
  "report_correction",
  "context_only",
  "user_instruction",
  "counter_evidence",
  "duplicate",
  "irrelevant",
];

export type FindingPatchAction =
  | "keep"
  | "amend"
  | "remove"
  | "merge"
  | "create"
  | "dispute_evidence";

/** Raw shape the LLM is asked to return — untrusted until grounded. */
type RawPatch = {
  action?: unknown;
  finding_ids?: unknown;
  reason?: unknown;
  quote?: unknown;
  source_document_id?: unknown;
  confidence?: unknown;
  new_title?: unknown;
  new_description?: unknown;
  new_category?: unknown;
  new_severity?: unknown;
  disputed_doc_id?: unknown;
  dispute_status?: unknown;
  error_type?: unknown;
  source_document_purpose?: unknown;
};

export type FindingPatch = {
  action: FindingPatchAction;
  /** Existing finding ids this patch targets. Empty for "create"; exactly
   *  one for keep/amend/remove/dispute_evidence; two or more for "merge". */
  finding_ids: string[];
  reason: string;
  /** Verbatim quote from the chat exchange (or the cited document) that
   *  grounds this decision. Required for every action except "keep". */
  quote: string;
  source_document_id: string | null;
  confidence: number;
  new_title?: string;
  new_description?: string;
  new_category?: string;
  new_severity?: Severity;
  /** dispute_evidence only: the doc_id of the EXISTING evidence_ref inside
   *  the target finding whose citation is being challenged. The finding
   *  itself, and any OTHER evidence_ref it carries, is left untouched — a
   *  document can be wrong for this one proposition while still being good
   *  evidence elsewhere. */
  disputed_doc_id?: string;
  /** dispute_evidence only: active|disputed|superseded|withdrawn — defaults
   *  to 'disputed' when omitted. 'superseded' additionally records
   *  source_document_id (if set) as the replacement. */
  dispute_status?: EvidenceRefStatus;
  /** Continuous Legal Intelligence (§6): why the ORIGINAL finding was wrong
   *  — only meaningful for remove/amend/dispute_evidence (the actions that
   *  imply the prior state was in some way incorrect; "merge"/"create"
   *  don't correct an error, they consolidate/add). Feeds recordLesson's
   *  error-taxonomy tag; never required, never blocks the patch if absent
   *  or invalid. */
  error_type?: IntelligenceErrorType;
  /** Set alongside source_document_id when the exchange includes an
   *  attachment — classifies WHY that document was uploaded (§2), written
   *  to documents.purpose only once this patch is approved and applied.
   *  Never the corpus-inclusion decision (that remains evidence_scope). */
  source_document_purpose?: DocumentPurpose;
};

type CurrentFindingRow = {
  evidence_refs: unknown;
  source_doc_ids: string[] | null;
  metadata: Record<string, unknown> | null;
  category: string;
  title?: string;
};

/** Builds the UPDATE payload shared by "amend" (single row) and "merge"
 *  (primary row absorbing the rest) — same fields, same audit-trail-in-
 *  metadata convention, differing only in which row's existing evidence/
 *  metadata is being extended. */
function buildAmendUpdatePayload(
  patch: FindingPatch,
  currentRow: CurrentFindingRow | null,
  nowIso: string,
  mergedFromIds?: string[],
): Record<string, unknown> {
  const existingRefs = Array.isArray(currentRow?.evidence_refs)
    ? (currentRow!.evidence_refs as unknown[])
    : [];
  const newRef = patch.source_document_id
    ? { doc_id: patch.source_document_id, quote: patch.quote }
    : { quote: patch.quote };
  const existingHistory = Array.isArray(
    (currentRow?.metadata as { chat_patch_history?: unknown })?.chat_patch_history,
  )
    ? (currentRow!.metadata as { chat_patch_history: unknown[] }).chat_patch_history
    : [];
  const payload: Record<string, unknown> = {
    title: patch.new_title,
    description: patch.new_description,
    category: patch.new_category || currentRow?.category || "general",
    evidence_refs: [...existingRefs, newRef],
    source_doc_ids: patch.source_document_id
      ? [...new Set([...(currentRow?.source_doc_ids ?? []), patch.source_document_id])]
      : (currentRow?.source_doc_ids ?? []),
    metadata: {
      ...(currentRow?.metadata ?? {}),
      chat_patch_history: [
        ...existingHistory,
        {
          at: nowIso,
          action: patch.action,
          reason: patch.reason,
          quote: patch.quote,
          ...(mergedFromIds ? { merged_from: mergedFromIds } : {}),
        },
      ],
    },
    updated_at: nowIso,
    // Same row, corrected in place — see the "amend"/"merge" doc comments
    // in applyFindingPatchSet for why this is a lifecycle transition, not a
    // supersession.
    lifecycle_status: "corrected",
    // §15's evidence->finding dependency graph, persisted: a merge's
    // surviving row is genuinely derived from the ids it absorbed. "amend"
    // (mergedFromIds undefined) leaves this untouched — the row corrected
    // itself, it wasn't derived from another finding.
    ...(mergedFromIds ? { derived_from_finding_ids: mergedFromIds } : {}),
  };
  if (patch.new_severity) payload.severity = patch.new_severity;
  return payload;
}

export type PatchApplyOutcome = {
  action: FindingPatchAction;
  finding_ids: string[];
  result_finding_id: string | null;
  applied: boolean;
  skip_reason?: "ungrounded" | "invalid_finding_ids" | "invalid_shape" | "write_failed";
  /** id of the case_finding_patches audit row this outcome wrote, so the
   *  caller can backfill report_version once the report's new version
   *  number is known (see pushCaseChatCorrectionsToReport). NULL when the
   *  audit insert itself failed — a best-effort write, per the function doc
   *  comment below. */
  auditRowId: string | null;
  /** The finding's title BEFORE this patch changed it (captured pre-update
   *  from whichever row-fetch each branch already does) — feeds
   *  recordLesson's original_claim. Null for "create" (nothing existed
   *  before) or when the write failed before any row was read. */
  originalClaim: string | null;
};

export type FindingPatchSetResult = {
  ran: boolean;
  patches: FindingPatch[];
  ungrounded: number;
  /** Self-audit (Phase B, §7): findings NOT touched by this patch set that
   *  historically resemble a category NYRAVA has demonstrated a verified
   *  recurring weakness in. Informational only — never applied, never
   *  blocks anything; the attorney sees it in the correction preview and
   *  decides whether to look closer. */
  selfAuditNotices: Array<{ findingId: string; findingTitle: string } & SelfAuditNotice>;
};

type ChatExchange = {
  question: string;
  answer: string;
  /** Any documents already attached to the case that the exchange or the
   *  attorney explicitly referenced, so their text is available to ground
   *  quotes cited from a source other than the conversation itself. */
  attachedDocs: Array<{ id: string; filename: string; extracted_text: string | null }>;
};

type ActiveFindingForPrompt = {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  confidence: number;
  /** doc_ids this finding currently cites with an active (not already
   *  disputed/superseded/withdrawn) evidence_ref — the only valid targets
   *  for a "dispute_evidence" patch's disputed_doc_id. */
  evidence_doc_ids: string[];
};

const MAX_MEMORY_ITEMS = 5;

/**
 * "Correction memory" — not a model-retraining mechanism, a bounded reminder
 * of past case_finding_patches decisions relevant to what's currently in
 * view, so this case doesn't repeat a mistake Talk-to-Case already
 * corrected once. Relevance-scoped (a patch is included only if it touched
 * a finding currently shown to the LLM, or cited a document attached to
 * THIS exchange) and hard-capped at MAX_MEMORY_ITEMS — never the case's
 * full correction history, which would blow the prompt budget and bury the
 * signal in noise.
 */
async function buildCorrectionMemoryBlock(
  db: Db,
  caseId: string,
  visibleFindingIds: Set<string>,
  attachedDocIds: Set<string>,
): Promise<string | null> {
  if (visibleFindingIds.size === 0 && attachedDocIds.size === 0) return null;
  const { data: rows } = await db
    .from("case_finding_patches")
    .select("action,reason,finding_id,result_finding_id,source_document_id,applied_at")
    .eq("case_id", caseId)
    .order("applied_at", { ascending: false })
    .limit(50);
  const relevant = (
    (rows ?? []) as Array<{
      action: string;
      reason: string;
      finding_id: string | null;
      result_finding_id: string | null;
      source_document_id: string | null;
      applied_at: string;
    }>
  ).filter(
    (r) =>
      (r.finding_id && visibleFindingIds.has(r.finding_id)) ||
      (r.result_finding_id && visibleFindingIds.has(r.result_finding_id)) ||
      (r.source_document_id && attachedDocIds.has(r.source_document_id)),
  );
  if (relevant.length === 0) return null;
  const lines = relevant
    .slice(0, MAX_MEMORY_ITEMS)
    .map(
      (r) =>
        `- Previously ${r.action}ed (finding ${r.finding_id ?? r.result_finding_id}): ${r.reason}`,
    );
  return `KNOWN PRIOR CORRECTIONS IN THIS CASE — do not repeat a mistake already corrected here:\n${lines.join("\n")}`;
}

/**
 * Grounding check for a correction quote against chat-exchange text (or an
 * attached document's extracted text) — same case/accent-insensitive exact-
 * substring requirement as locateQuoteInText (evidence-provenance.server.ts),
 * PLUS collapsing runs of whitespace (including line breaks) before
 * comparing.
 *
 * Real reported bug: an attorney's "Nyrava Intelligence" answer is routinely
 * multi-paragraph and bulleted (numbered findings, "- " bullet items). When
 * the patch-generation model is asked to copy a verbatim quote out of that
 * answer, it reliably reproduces wrapped text joined by an ordinary space —
 * "...quejoso, particularly focusing..." — while the SOURCE text has a real
 * newline or bullet marker at that exact point. locateQuoteInText does not
 * collapse whitespace (deliberately — it also computes a character OFFSET
 * into the raw text for document-citation provenance elsewhere, where a
 * whitespace-collapsed match would no longer correspond to a real
 * contiguous span). That made nearly every correction proposed against a
 * normal multi-line answer come back "ungrounded" with no way to recover —
 * the exact "always fails" symptom reported from a live case. This file
 * never reads locateQuoteInText's offset, only whether the quote re-locates
 * at all, so it's safe to relax whitespace here without touching the
 * stricter shared function other callers depend on for real offsets.
 */
function isGroundedLoosely(quote: string, text: string | null | undefined): boolean {
  if (!quote || !text) return false;
  const collapse = (s: string) => lightNormalize(s).replace(/\s+/g, " ").trim();
  const normQuote = collapse(quote);
  return normQuote.length >= 8 && collapse(text).includes(normQuote);
}

/**
 * Reviews the case's current active findings against a Talk-to-Case
 * exchange and produces a grounded patch set. Pure generation — does not
 * write anything to case_findings (or any other table). Runs even when
 * there are zero active findings yet, since the exchange may still warrant
 * a "create" patch (a genuinely new finding with no existing counterpart).
 * `patches` is empty (with `ungrounded: 0`) whenever the LLM call itself
 * fails — degrades to "no changes identified" rather than throwing, since a
 * failed patch-review must never block the attorney from still seeing the
 * chat answer.
 */
export async function generateFindingPatchSet(
  db: Db,
  caseId: string,
  userId: string,
  exchange: ChatExchange,
  apiKey?: string,
): Promise<FindingPatchSetResult> {
  const activeFindings = await listFindings(db, caseId);
  const findingsForPrompt: ActiveFindingForPrompt[] = activeFindings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description.slice(0, 500),
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    evidence_doc_ids: [
      ...new Set(
        (f.evidence_refs ?? [])
          .filter((e) => !e.status || e.status === "active")
          .map((e) => e.doc_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ],
  }));
  const evidenceDocIdsByFindingId = new Map(
    findingsForPrompt.map((f) => [f.id, new Set(f.evidence_doc_ids)]),
  );

  // Self-audit (Phase B, §7) — informational only, computed independently
  // of whatever the LLM proposes below. Never blocks/modifies anything;
  // just tells the attorney which of the EXISTING findings resemble a
  // category NYRAVA has a verified recurring weakness in, so the preview
  // can flag it for extra scrutiny.
  const selfAuditNotices: FindingPatchSetResult["selfAuditNotices"] = [];
  if (activeFindings.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caseRow } = await (db as any)
      .from("cases")
      .select("case_type,jurisdiction")
      .eq("id", caseId)
      .maybeSingle();
    const matterType = (caseRow as { case_type?: string | null } | null)?.case_type ?? null;
    const { auditFindingAgainstPatterns } = await import("./patterns.server");
    const seenCategories = new Map<string, ActiveFindingForPrompt>();
    for (const f of findingsForPrompt) {
      if (!seenCategories.has(f.category)) seenCategories.set(f.category, f);
    }
    // One audit query per DISTINCT category among the active findings, not
    // per finding — a case with 40 findings across 6 categories issues 6
    // queries, not 40, while still covering every finding via the map
    // below.
    const noticeByCategory = new Map<
      string,
      Awaited<ReturnType<typeof auditFindingAgainstPatterns>>
    >();
    for (const category of seenCategories.keys()) {
      noticeByCategory.set(
        category,
        await auditFindingAgainstPatterns(db, {
          userId,
          matterType,
          jurisdictionCountry: "MX",
          findingCategory: category,
        }),
      );
    }
    for (const f of findingsForPrompt) {
      const notice = noticeByCategory.get(f.category);
      if (notice) selfAuditNotices.push({ findingId: f.id, findingTitle: f.title, ...notice });
    }
  }

  const locale = await getReportLocale(db, caseId);
  const { resolveProviderKeys } = await import("@/lib/ai-key-router.server");
  const { keys } = await resolveProviderKeys(db, userId, "groq");
  const apiKeys = apiKey ? [apiKey, ...keys] : keys;

  const docsBlock = exchange.attachedDocs
    .map(
      (d) => `=== DOCUMENT ${d.id} (${d.filename}) ===\n${(d.extracted_text ?? "").slice(0, 6000)}`,
    )
    .join("\n\n");

  // Correction memory — NOT a model-retraining mechanism, just a bounded
  // reminder of past mistakes this exact case already made, so the review
  // doesn't repeat them. Scoped to what's actually relevant (findings
  // currently in view, or documents attached to this exchange), never the
  // full case history — an unbounded dump would blow the prompt budget and
  // bury the signal.
  const memoryBlock = await buildCorrectionMemoryBlock(
    db,
    caseId,
    new Set(findingsForPrompt.map((f) => f.id)),
    new Set(exchange.attachedDocs.map((d) => d.id)),
  );

  let r: Awaited<ReturnType<typeof callGroq>>;
  try {
    r = await callGroq({
      apiKeys,
      userId,
      model: MODEL,
      temperature: 0.1,
      json: true,
      systemInstruction: `${mexicoLock(locale)}
${groundingContract(locale)}
You review an attorney's Talk-to-Case exchange against the EXISTING findings already in this case's record and decide what changes it warrants. This is NOT a new analysis pass — do not re-derive findings from scratch, do not restate findings that the exchange does not actually address. For each EXISTING finding the exchange clearly bears on, decide exactly one action:
- "keep": the exchange doesn't change this finding — do not emit a patch for findings the exchange never addresses at all.
- "amend": the exchange corrects/refines this finding's content but the underlying issue is still real — provide new_title/new_description/new_category/new_severity for the corrected version.
- "remove": the exchange establishes this finding is simply wrong or no longer applicable.
- "merge": the exchange shows two or more existing findings are the same underlying issue — list all their ids in finding_ids and provide the consolidated new_title/new_description.
- "dispute_evidence": the exchange challenges ONE specific document cited by an existing finding, but the finding's underlying issue may still stand (either on its other evidence, or pending review) — do NOT remove or amend the whole finding for this. Set disputed_doc_id to that document's id (it must be a doc_id actually cited by the finding) and dispute_status to "disputed" (the citation is now contested but not resolved), "superseded" (the exchange/attached document establishes a replacement — also set source_document_id to the replacement's id), or "withdrawn" (the citation should no longer be relied on at all). A document can be wrong for ONE finding's proposition while remaining perfectly good evidence elsewhere — this never touches the document's use in any other finding.
You may also propose "create" for a genuinely new finding the exchange establishes that has no existing counterpart — finding_ids must be empty for this action. Do NOT create a finding merely restating something an existing finding already covers.
Every patch (except "keep", which you do not need to emit at all) MUST include a "quote" field: a SINGLE verbatim excerpt copied character-for-character from either the chat exchange text or one of the attached documents (never paraphrased, never from the finding itself) that grounds the decision. If citing an attached document, also set source_document_id to that document's id. A patch without a real, exact quote will be discarded. If the "Nyrava Intelligence" turn in the chat exchange already contains an explicit "Quote:" line, that IS the evidentiary quote — copy it EXACTLY as written there (do not re-type it from memory, do not copy the "Correction:"/"Revised Finding:" text instead, do not shorten or "clean up" its punctuation). Never invent a finding-target from a number like "Finding #2" mentioned in conversation — that is display numbering, not an id; every entry in finding_ids MUST be one of the real ids listed in EXISTING FINDINGS below.
GROUNDING DISCIPLINE FOR CORRECTIONS TO AN "ABSENCE" FINDING: when the finding being corrected states that something was NOT found/identified/argued in the corpus, the corrected claim may only assert what the quote ITSELF literally states happened in this case — never a stronger affirmative conclusion the quote merely makes possible in the abstract. A quote of the applicable legal rule or general doctrine (e.g. what a judge is empowered or permitted to do) does not, by itself, establish that anything was actually argued or done in this case; do not amend "no se identificó una argumentación expresa" into "se identificó una argumentación implícita" (or any similarly stronger claim) unless the quote is a case-specific fact that plainly says so. If the only available quote is rule/doctrine text with no case-specific fact, do not emit a patch for that finding at all.
For "remove"/"amend"/"dispute_evidence" patches only, also classify WHY the original finding was wrong via "error_type": one of unsupported_claim, bad_evidence_link, wrong_evidence_interpretation, duplicate_finding, contradiction_misclassification, wrong_legal_authority, wrong_procedural_rule, wrong_severity, wrong_confidence, missing_finding, false_positive, false_negative, temporal_error, source_classification_error, report_rendering_error, other. Omit it if genuinely unclear — never guess.
Whenever you cite an attached document (source_document_id is set), also classify its purpose in THIS exchange via "source_document_purpose": one of case_evidence (genuinely new case evidence, not a correction), correction_support (supports correcting an existing finding), finding_correction (specifically corrects one finding), report_correction (corrects report-level content), context_only (background, not evidentiary), user_instruction (the attorney's instruction, not a document to cite as evidence), counter_evidence (contradicts an existing finding), duplicate (already in the corpus), irrelevant. Output JSON only.`,
      userContent: `CHAT EXCHANGE:\nAttorney: ${exchange.question}\n\nNyrava Intelligence: ${exchange.answer}\n\n${docsBlock ? `ATTACHED DOCUMENTS:\n${docsBlock}\n\n` : ""}${memoryBlock ? `${memoryBlock}\n\n` : ""}EXISTING FINDINGS (id, title, description, category, severity, confidence):\n${JSON.stringify(findingsForPrompt).slice(0, 14_000)}\n\nReturn STRICT JSON: { "patches": [ { "action": "amend"|"remove"|"merge"|"create"|"dispute_evidence", "finding_ids": string[] (existing ids this targets — must be from the list above; empty only for "create"), "reason": string, "quote": string (verbatim from the chat exchange or an attached document), "source_document_id": string|null, "confidence": number (0-1), "new_title": string (amend/merge/create only), "new_description": string (amend/merge/create only), "new_category": string (amend/merge/create only), "new_severity": "critical"|"high"|"medium"|"low"|"info" (amend/merge/create only), "disputed_doc_id": string (dispute_evidence only — a doc_id this finding actually cites), "dispute_status": "disputed"|"superseded"|"withdrawn" (dispute_evidence only), "error_type": string|omitted (remove/amend/dispute_evidence only, one of the 16 values above), "source_document_purpose": string|omitted (only when source_document_id is set, one of the 9 values above) } ] }. Return an empty array if the exchange doesn't warrant any change.`,
    });
  } catch (e) {
    console.error("[chat-patch] LLM call failed", e);
    return { ran: true, patches: [], ungrounded: 0, selfAuditNotices };
  }

  const parsed = parseJsonLoose<{ patches?: RawPatch[] }>(r.text);
  const raw = Array.isArray(parsed?.patches) ? parsed!.patches : [];
  const validIds = new Set(findingsForPrompt.map((f) => f.id));
  const docsById = new Map(exchange.attachedDocs.map((d) => [d.id, d]));

  const patches: FindingPatch[] = [];
  let ungrounded = 0;

  // Diagnostics (§ correction-mapping investigation): trace exactly why a
  // patch the LLM proposed never became an applyable correction — never
  // fabricate a match, never weaken the grounding gate, but make its
  // decision legible. "Finding #2" in a chat answer is presentation
  // numbering, not identity; this logs the RAW finding_ids the model
  // actually returned in the SECOND (patch-generation) call, so a
  // resolution failure (model referenced something that isn't a real
  // case_findings.id from the list it was given) is distinguishable from a
  // genuine quote-grounding failure. Truncated previews only — never logs
  // full case/document text.
  const discardLog: Array<Record<string, unknown>> = [];

  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const action = p.action;
    if (
      action !== "amend" &&
      action !== "remove" &&
      action !== "merge" &&
      action !== "create" &&
      action !== "dispute_evidence"
    )
      continue;

    const rawFindingIds = Array.isArray(p.finding_ids) ? p.finding_ids : [];
    const findingIds = rawFindingIds.filter(
      (id): id is string => typeof id === "string" && validIds.has(id),
    );
    if (action !== "create" && rawFindingIds.length > 0 && findingIds.length !== rawFindingIds.length) {
      // The model referenced at least one id that isn't in the real active-
      // findings list it was given — the exact "Finding #2 is not a stable
      // identity" failure mode. Logged even when other valid ids still let
      // the patch proceed, since a partial miss on a merge/dispute target
      // is still a real resolution defect worth seeing.
      discardLog.push({
        stage: "finding_id_resolution",
        action,
        raw_finding_ids: rawFindingIds,
        resolved_finding_ids: findingIds,
        unresolved: rawFindingIds.filter((id) => !findingIds.includes(id as string)),
      });
    }
    if (action === "create" && findingIds.length !== 0) continue;
    if (action !== "create" && findingIds.length === 0) {
      discardLog.push({
        stage: "finding_id_resolution",
        skip_reason: "no_finding_ids_resolved",
        action,
        raw_finding_ids: rawFindingIds,
      });
      continue;
    }
    if (action !== "merge" && action !== "create" && findingIds.length !== 1) continue;
    if (action === "merge" && findingIds.length < 2) continue;

    // dispute_evidence must target a doc_id the finding actually cites —
    // never let the LLM invent a citation to dispute.
    const disputedDocId = typeof p.disputed_doc_id === "string" ? p.disputed_doc_id : undefined;
    if (action === "dispute_evidence") {
      if (!disputedDocId) continue;
      const validDocIds = evidenceDocIdsByFindingId.get(findingIds[0]);
      if (!validDocIds?.has(disputedDocId)) continue;
    }
    const disputeStatusRaw = typeof p.dispute_status === "string" ? p.dispute_status : null;
    const disputeStatus: EvidenceRefStatus | undefined = VALID_DISPUTE_STATUSES.includes(
      disputeStatusRaw as EvidenceRefStatus,
    )
      ? (disputeStatusRaw as EvidenceRefStatus)
      : undefined;

    const quote = typeof p.quote === "string" ? p.quote.trim() : "";
    const sourceDocId = typeof p.source_document_id === "string" ? p.source_document_id : null;
    const sourceDoc = sourceDocId ? docsById.get(sourceDocId) : undefined;
    const groundedInQuestion = isGroundedLoosely(quote, exchange.question);
    const groundedInAnswer = isGroundedLoosely(quote, exchange.answer);
    const groundedInExchange = groundedInQuestion || groundedInAnswer;
    const groundedInDoc = isGroundedLoosely(quote, sourceDoc?.extracted_text ?? null);
    if (!quote || (!groundedInExchange && !groundedInDoc)) {
      // The single most important trace point for "chat proposed a
      // correction, but no report patch resulted": the model's OWN quote
      // failed to re-locate, character-for-character (accent/typography-
      // insensitive), in either half of the exchange or the cited
      // document. Truncated preview only.
      discardLog.push({
        stage: "grounding",
        action,
        finding_ids: findingIds,
        quote_preview: quote.slice(0, 160),
        quote_length: quote.length,
        source_document_id: sourceDocId,
        source_document_attached: !!sourceDoc,
        source_document_has_text: !!sourceDoc?.extracted_text,
        grounded_in_question: groundedInQuestion,
        grounded_in_answer: groundedInAnswer,
        grounded_in_doc: groundedInDoc,
      });
      ungrounded += 1;
      continue;
    }

    const reason = (typeof p.reason === "string" && p.reason.trim()) || "Talk to Case review.";
    const confidence =
      typeof p.confidence === "number" && Number.isFinite(p.confidence)
        ? Math.min(1, Math.max(0, p.confidence))
        : 0.5;

    const needsNewContent = action === "amend" || action === "merge" || action === "create";
    const newTitle = typeof p.new_title === "string" ? p.new_title.trim() : "";
    const newDescription = typeof p.new_description === "string" ? p.new_description.trim() : "";
    if (needsNewContent && (!newTitle || !newDescription)) {
      discardLog.push({
        stage: "content_shape",
        skip_reason: "missing_new_title_or_description",
        action,
        finding_ids: findingIds,
        has_new_title: !!newTitle,
        has_new_description: !!newDescription,
      });
      continue;
    }

    const newSeverityRaw = typeof p.new_severity === "string" ? p.new_severity : null;
    const newSeverity: Severity | undefined = VALID_SEVERITIES.includes(newSeverityRaw as Severity)
      ? (newSeverityRaw as Severity)
      : undefined;

    // Continuous Legal Intelligence (§6/§2) — additive classification only,
    // never gates whether the patch itself is accepted. error_type only
    // makes sense where the prior state was actually wrong; source_document_purpose
    // only where a document is actually cited (groundedInDoc, not just any
    // sourceDocId the model may have echoed back ungrounded).
    const errorTypeRaw = typeof p.error_type === "string" ? p.error_type : null;
    const errorType: IntelligenceErrorType | undefined =
      (action === "remove" || action === "amend" || action === "dispute_evidence") &&
      VALID_ERROR_TYPES.includes(errorTypeRaw as IntelligenceErrorType)
        ? (errorTypeRaw as IntelligenceErrorType)
        : undefined;
    const documentPurposeRaw =
      typeof p.source_document_purpose === "string" ? p.source_document_purpose : null;
    const documentPurpose: DocumentPurpose | undefined =
      groundedInDoc && VALID_DOCUMENT_PURPOSES.includes(documentPurposeRaw as DocumentPurpose)
        ? (documentPurposeRaw as DocumentPurpose)
        : undefined;

    patches.push({
      action,
      finding_ids: findingIds,
      ...(errorType ? { error_type: errorType } : {}),
      ...(documentPurpose ? { source_document_purpose: documentPurpose } : {}),
      reason,
      quote,
      source_document_id: groundedInDoc ? sourceDocId : null,
      confidence,
      ...(needsNewContent
        ? {
            new_title: newTitle,
            new_description: newDescription,
            new_category:
              typeof p.new_category === "string" ? p.new_category.trim() || undefined : undefined,
            new_severity: newSeverity,
          }
        : {}),
      ...(action === "dispute_evidence"
        ? { disputed_doc_id: disputedDocId, dispute_status: disputeStatus ?? "disputed" }
        : {}),
    });
  }

  // Always emitted (not just on failure) so the happy path is equally
  // traceable — "how many patches did the model propose, how many actually
  // survived, and exactly where did the rest fall out" for every Talk-to-
  // Case correction review, not only ones a developer happens to reproduce
  // live. Truncated/count-only — never logs full case or document text.
  console.info(
    JSON.stringify({
      event: "chat_patch_review",
      case_id: caseId,
      raw_patches_proposed: raw.length,
      patches_applied_grounded: patches.length,
      ungrounded_count: ungrounded,
      discarded: discardLog,
    }),
  );

  return { ran: true, patches, ungrounded, selfAuditNotices };
}

export type CorrectionImpact = {
  /** Other active findings that depend on a changed finding — either via
   *  an explicit related_finding_ids link, or by sharing a
   *  canonical_finding_id (same real-world claim, per canonical-id.ts). */
  dependentFindingIds: string[];
  /** True when the case's current case_scores row was built from at least
   *  one finding this correction touches (case_scores.source_finding_ids) —
   *  the signal pushCaseChatCorrectionsToReport uses to decide whether
   *  scoring needs to re-run at all. */
  scoreAffected: boolean;
  /** case_opportunities rows whose source_finding_ids overlaps the changed
   *  set. */
  affectedOpportunityIds: string[];
  /** Count of entries in reports.citations whose finding_id is a changed
   *  finding — the raw material findStaleCitations (see below) resolves
   *  into an actual stale-content warning list. */
  affectedCitationCount: number;
};

/**
 * Pure read: resolves what a patch set's finding-level changes would ripple
 * into, using existing columns rather than a new dependency-graph schema —
 * case_findings.related_finding_ids / canonical_finding_id for dependent
 * findings, case_scores.source_finding_ids / case_opportunities.source_finding_ids
 * for dependent risk-and-score rows, reports.citations[].finding_id for
 * dependent report content. Never writes anything. Called BOTH by the
 * preview step (so the attorney sees "Affected items" before approving) and
 * by pushCaseChatCorrectionsToReport (so scoring only re-runs when this
 * correction genuinely touches something the score was built from —
 * targeted re-evaluation instead of always/never rescoring).
 */
export async function computeCorrectionImpact(
  db: Db,
  caseId: string,
  patches: FindingPatch[],
): Promise<CorrectionImpact> {
  const changedIds = new Set(patches.flatMap((p) => p.finding_ids));
  if (changedIds.size === 0) {
    return {
      dependentFindingIds: [],
      scoreAffected: false,
      affectedOpportunityIds: [],
      affectedCitationCount: 0,
    };
  }
  const changedIdList = [...changedIds];

  const [
    { data: changedRows },
    { data: relatedRows },
    { data: scoreRow },
    { data: oppRows },
    { data: reportRow },
  ] = await Promise.all([
    db
      .from("case_findings")
      .select("id,canonical_finding_id")
      .eq("case_id", caseId)
      .in("id", changedIdList),
    db
      .from("case_findings")
      .select("id,related_finding_ids,canonical_finding_id")
      .eq("case_id", caseId)
      .is("superseded_at", null),
    db.from("case_scores").select("source_finding_ids").eq("case_id", caseId).maybeSingle(),
    db.from("case_opportunities").select("id,source_finding_ids").eq("case_id", caseId),
    db.from("reports").select("citations").eq("case_id", caseId).maybeSingle(),
  ]);

  const canonicalIds = new Set(
    (changedRows ?? [])
      .map((r) => (r as { canonical_finding_id: string | null }).canonical_finding_id)
      .filter((v): v is string => !!v),
  );
  const dependentFindingIds = (
    (relatedRows ?? []) as Array<{
      id: string;
      related_finding_ids: string[] | null;
      canonical_finding_id: string | null;
    }>
  )
    .filter(
      (r) =>
        !changedIds.has(r.id) &&
        ((r.related_finding_ids ?? []).some((id) => changedIds.has(id)) ||
          (!!r.canonical_finding_id && canonicalIds.has(r.canonical_finding_id))),
    )
    .map((r) => r.id);

  const scoreSourceIds =
    (scoreRow as { source_finding_ids: string[] | null } | null)?.source_finding_ids ?? [];
  const scoreAffected = scoreSourceIds.some((id) => changedIds.has(id));

  const affectedOpportunityIds = (
    (oppRows ?? []) as Array<{
      id: string;
      source_finding_ids: string[] | null;
    }>
  )
    .filter((o) => (o.source_finding_ids ?? []).some((id) => changedIds.has(id)))
    .map((o) => o.id);

  const citations = Array.isArray((reportRow as { citations: unknown } | null)?.citations)
    ? (reportRow as { citations: Array<{ finding_id?: string | null }> }).citations
    : [];
  const affectedCitationCount = citations.filter(
    (c) => typeof c.finding_id === "string" && changedIds.has(c.finding_id),
  ).length;

  return { dependentFindingIds, scoreAffected, affectedOpportunityIds, affectedCitationCount };
}

export type StaleCitation = {
  citationId: string | null;
  quote: string | null;
  findingId: string;
  documentId: string | null;
  page: number | null;
};

/**
 * Bounded, safe subset of spec's "revision consistency check": flags
 * reports.citations entries that still reference a finding this correction
 * just superseded (a "remove"/"merge" target — NOT "amend"/"dispute_evidence",
 * which keep the same finding id, so a citation still pointing at it is
 * correct, not stale). Does NOT auto-rewrite report prose — full automatic
 * LLM correction of already-generated report text is a separate, larger
 * piece of work (see the case-revision architecture plan's Phase 2); this
 * only detects and returns what a human should review. Call AFTER
 * runReport() has regenerated the report, so it inspects the freshly
 * rebuilt citations, not the pre-correction ones.
 */
export async function findStaleCitations(
  db: Db,
  caseId: string,
  changedFindingIds: string[],
): Promise<StaleCitation[]> {
  if (changedFindingIds.length === 0) return [];
  const { data: supersededRows } = await db
    .from("case_findings")
    .select("id")
    .eq("case_id", caseId)
    .in("id", changedFindingIds)
    .not("superseded_at", "is", null);
  const supersededIds = new Set(((supersededRows ?? []) as Array<{ id: string }>).map((r) => r.id));
  if (supersededIds.size === 0) return [];

  const { data: reportRow } = await db
    .from("reports")
    .select("citations")
    .eq("case_id", caseId)
    .maybeSingle();
  const citations = Array.isArray((reportRow as { citations: unknown } | null)?.citations)
    ? (reportRow as { citations: Array<Record<string, unknown>> }).citations
    : [];
  return citations
    .filter((c) => typeof c.finding_id === "string" && supersededIds.has(c.finding_id as string))
    .map((c) => ({
      citationId: typeof c.id === "string" ? c.id : null,
      quote: typeof c.quote === "string" ? c.quote : null,
      findingId: c.finding_id as string,
      documentId: typeof c.document_id === "string" ? c.document_id : null,
      page: typeof c.page === "number" ? c.page : null,
    }));
}

/**
 * Applies an already-generated, already-grounded patch set to case_findings
 * transactionally (per-patch — a single failed write is reported, not
 * allowed to silently corrupt the rest of the set). Never deletes a row:
 * "remove"/"amend"/"merge" mark the superseded input(s) via
 * superseded_at/superseded_reason (never NULLed out again — see
 * migration 20260809150000). Every patch, including "keep" decisions the
 * caller chooses to log, gets a case_finding_patches audit row.
 */
export async function applyFindingPatchSet(
  db: Db,
  caseId: string,
  userId: string,
  patches: FindingPatch[],
  chatMessageId: string | null,
): Promise<PatchApplyOutcome[]> {
  const outcomes: PatchApplyOutcome[] = [];
  const nowIso = new Date().toISOString();

  for (const patch of patches) {
    let resultFindingId: string | null = null;
    let applied = false;
    // The finding's title/description BEFORE this patch mutates it —
    // captured per-branch below, from whatever row-fetch that branch
    // already does. Feeds recordLesson's original_claim (Continuous Legal
    // Intelligence, §6): a lesson must record what NYRAVA originally
    // concluded, not just what it was corrected to. Null for "create"
    // (nothing existed to have a prior claim).
    let originalClaim: string | null = null;

    try {
      if (patch.action === "remove") {
        const findingId = patch.finding_ids[0];
        const { data: beforeRemove } = await db
          .from("case_findings")
          .select("title")
          .eq("id", findingId)
          .eq("case_id", caseId)
          .maybeSingle();
        originalClaim = (beforeRemove as { title?: string } | null)?.title ?? null;
        const { error } = await db
          .from("case_findings")
          .update({
            superseded_at: nowIso,
            superseded_reason: `${patch.reason} — "${patch.quote}"`,
            lifecycle_status: "superseded",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .eq("id", findingId)
          .eq("case_id", caseId);
        if (error) throw error;
        applied = true;
      } else if (patch.action === "amend") {
        // Update the SAME row in place rather than superseding it and
        // inserting a replacement through addFindings(). addFindings() runs
        // the engine-oriented semantic-dedup pass (dedupSemantically), which
        // treats an already-persisted row as the identity "anchor" any
        // sufficiently-similar new row clusters into — exactly the case for
        // an amendment, since a corrected version of a finding is usually
        // still textually close to the original. That would silently UPDATE
        // the original row via the dedup path and return no new id, which
        // this function would then immediately mark superseded — the
        // opposite of what "amend" means. Updating the row directly avoids
        // that collision entirely and, as a bonus, keeps the same finding id
        // stable, so any related_finding_ids/citations pointing at it never
        // dangle.
        const findingId = patch.finding_ids[0];
        const current = await db
          .from("case_findings")
          .select("title,evidence_refs,source_doc_ids,metadata,category")
          .eq("id", findingId)
          .eq("case_id", caseId)
          .maybeSingle();
        const currentRow = current.data as CurrentFindingRow | null;
        originalClaim = currentRow?.title ?? null;
        const updatePayload = buildAmendUpdatePayload(patch, currentRow, nowIso);
        const { error } = await db
          .from("case_findings")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(updatePayload as any)
          .eq("id", findingId)
          .eq("case_id", caseId);
        if (error) throw error;
        resultFindingId = findingId;
        applied = true;
      } else if (patch.action === "merge") {
        // Same rationale as "amend" above: update the surviving (primary)
        // row in place with the consolidated content and union its evidence
        // with every other input finding's, then supersede only the OTHER
        // ids — never the primary, which keeps its id and absorbs the rest.
        const primaryId = patch.finding_ids[0];
        const otherIds = patch.finding_ids.slice(1);
        const { data: rows } = await db
          .from("case_findings")
          .select("id,title,evidence_refs,source_doc_ids,metadata,category")
          .in("id", patch.finding_ids)
          .eq("case_id", caseId);
        const allRows = (rows ?? []) as Array<CurrentFindingRow & { id: string }>;
        const primaryRow = allRows.find((r) => r.id === primaryId) ?? null;
        originalClaim =
          allRows
            .map((r) => r.title)
            .filter(Boolean)
            .join(" | ") || null;
        const mergedRefs = allRows.flatMap((r) =>
          Array.isArray(r.evidence_refs) ? (r.evidence_refs as unknown[]) : [],
        );
        const mergedDocIds = [...new Set(allRows.flatMap((r) => r.source_doc_ids ?? []))];
        const updatePayload = buildAmendUpdatePayload(
          patch,
          primaryRow
            ? { ...primaryRow, evidence_refs: mergedRefs, source_doc_ids: mergedDocIds }
            : null,
          nowIso,
          otherIds,
        );
        const { error: updateErr } = await db
          .from("case_findings")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update(updatePayload as any)
          .eq("id", primaryId)
          .eq("case_id", caseId);
        if (updateErr) throw updateErr;
        resultFindingId = primaryId;

        for (const otherId of otherIds) {
          const { error } = await db
            .from("case_findings")
            .update({
              superseded_at: nowIso,
              superseded_reason: `${patch.reason} — merged into finding ${primaryId} — "${patch.quote}"`,
              lifecycle_status: "superseded",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            .eq("id", otherId)
            .eq("case_id", caseId);
          if (error) throw error;
        }
        applied = true;
      } else if (patch.action === "dispute_evidence") {
        // Proposition-level correction: mutate ONE evidence_ref entry inside
        // the finding's own array, in place. The finding row itself (title/
        // description/severity/other evidence_refs) is untouched, and the
        // disputed document is never flagged anywhere else it might be
        // cited — this is deliberately narrower than "amend"/"remove".
        const findingId = patch.finding_ids[0];
        const current = await db
          .from("case_findings")
          .select("title,evidence_refs")
          .eq("id", findingId)
          .eq("case_id", caseId)
          .maybeSingle();
        originalClaim = (current.data as { title?: string } | null)?.title ?? null;
        const currentRefs = Array.isArray(
          (current.data as { evidence_refs: unknown } | null)?.evidence_refs,
        )
          ? ((current.data as { evidence_refs: EvidenceRef[] }).evidence_refs as EvidenceRef[])
          : [];
        const targetIdx = currentRefs.findIndex((e) => e.doc_id === patch.disputed_doc_id);
        if (targetIdx === -1) {
          throw new Error(
            `evidence_ref for doc_id ${patch.disputed_doc_id} not found on finding ${findingId}`,
          );
        }
        const status = patch.dispute_status ?? "disputed";
        const updatedRefs = [...currentRefs];
        updatedRefs[targetIdx] = {
          ...updatedRefs[targetIdx],
          status,
          status_reason: `${patch.reason} — "${patch.quote}"`,
          ...(status === "superseded" && patch.source_document_id
            ? { superseded_by_doc_id: patch.source_document_id }
            : {}),
        };
        // A replacement document, when provided, becomes its own new
        // (active) evidence_ref rather than overwriting the disputed one in
        // place — the disputed citation's own history (who cited it, why it
        // was disputed) stays intact for audit purposes.
        if (status === "superseded" && patch.source_document_id) {
          updatedRefs.push({
            doc_id: patch.source_document_id,
            quote: patch.quote,
            status: "active",
          });
        }
        const { error } = await db
          .from("case_findings")
          .update({
            evidence_refs: updatedRefs,
            updated_at: nowIso,
            lifecycle_status: "challenged",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .eq("id", findingId)
          .eq("case_id", caseId);
        if (error) throw error;
        resultFindingId = findingId;
        applied = true;
      } else if (patch.action === "create") {
        const newRow: NewFinding = {
          case_id: caseId,
          user_id: userId,
          source_module: "chat:talk_to_case_patch",
          category: patch.new_category || "general",
          title: patch.new_title!,
          description: patch.new_description!,
          severity: patch.new_severity ?? "medium",
          confidence: patch.confidence,
          legal_significance: null,
          potential_impact: null,
          affected_party: null,
          source_doc_ids: patch.source_document_id ? [patch.source_document_id] : [],
          evidence_refs: patch.source_document_id
            ? [{ doc_id: patch.source_document_id, quote: patch.quote }]
            : [{ quote: patch.quote }],
          tags: [],
          metadata: { chat_patch: true, reason: patch.reason },
        };
        const inserted = await addFindings(db, [newRow]);
        resultFindingId =
          Array.isArray(inserted) && inserted.length > 0
            ? ((inserted[0] as { id?: string })?.id ?? null)
            : null;
        // addFindings()'s insert payload doesn't carry lifecycle_status (it
        // is not part of NewFinding/Finding — see types.ts), so this is a
        // best-effort follow-up, same as the audit row below: it must never
        // block or unwind the finding this branch just created.
        if (resultFindingId) {
          const { error: lifecycleError } = await db
            .from("case_findings")
            .update({ lifecycle_status: "active" } as never)
            .eq("id", resultFindingId)
            .eq("case_id", caseId);
          if (lifecycleError) {
            console.error(
              "[chat-patch] failed to set lifecycle_status on created finding",
              lifecycleError,
            );
          }
        }
        applied = true;
      }
    } catch (e) {
      console.error("[chat-patch] failed to apply patch", patch.action, patch.finding_ids, e);
      outcomes.push({
        action: patch.action,
        finding_ids: patch.finding_ids,
        result_finding_id: null,
        applied: false,
        skip_reason: "write_failed",
        auditRowId: null,
        originalClaim: null,
      });
      continue;
    }

    // Audit row — best-effort; a failure here doesn't roll back the
    // finding-level change above, since the audit table is a supplementary
    // record, not the source of truth (case_findings.superseded_reason is).
    const { data: auditRow, error: auditError } = await db
      .from("case_finding_patches")
      .insert({
        case_id: caseId,
        user_id: userId,
        finding_id: patch.finding_ids[0] ?? null,
        result_finding_id: resultFindingId,
        action: patch.action,
        reason: patch.reason,
        source_document_id: patch.source_document_id,
        source_quote: patch.quote,
        confidence: patch.confidence,
        chat_message_id: chatMessageId,
        applied_at: nowIso,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select("id")
      .maybeSingle();
    if (auditError) {
      console.error("[chat-patch] failed to write audit row", patch.action, auditError);
    }

    // Document purpose classification (§2) — written only now that the
    // patch it was classified alongside has actually been approved and
    // applied, never at generation/preview time. Best-effort, same
    // reasoning as the audit row above.
    if (patch.source_document_id && patch.source_document_purpose) {
      const { error: purposeError } = await db
        .from("documents")
        .update({ purpose: patch.source_document_purpose } as never)
        .eq("id", patch.source_document_id)
        .eq("case_id", caseId);
      if (purposeError) {
        console.error("[chat-patch] failed to write document purpose", purposeError);
      }
    }

    outcomes.push({
      action: patch.action,
      finding_ids: patch.finding_ids,
      result_finding_id: resultFindingId,
      applied,
      auditRowId: (auditRow as { id?: string } | null)?.id ?? null,
      originalClaim,
    });
  }

  return outcomes;
}

/**
 * Continuous Legal Intelligence — the learning ledger (see migration
 * 20260813232206_intelligence_lessons.sql). Writes one row per applied,
 * already-approved patch, reshaping the SAME event case_finding_patches
 * already recorded (never a second source of truth — source_patch_id ties
 * every lesson back to its audit row). Best-effort: a failure here must
 * never unwind or block the correction itself, matching the audit-row
 * write's own "supplementary record" reasoning in applyFindingPatchSet.
 *
 * validation_status is ALWAYS written as 'ai_supported' — never
 * 'human_confirmed'/'multi_source_verified'. Those promotions require
 * mechanisms this Phase A does not build (cross-case corroboration or an
 * explicit reviewer action) — a model calling this function is not
 * grounds to self-promote a lesson's trust level.
 *
 * No-ops for "keep" (never reaches this function — generateFindingPatchSet
 * never emits a "keep" patch) and for any outcome that wasn't actually
 * applied.
 */
export async function recordLesson(
  db: Db,
  caseId: string,
  userId: string,
  patch: FindingPatch,
  outcome: PatchApplyOutcome,
  matterType: string | null,
  jurisdictionCountry: string,
): Promise<void> {
  if (!outcome.applied || !outcome.auditRowId) return;

  const findingId = outcome.result_finding_id ?? patch.finding_ids[0] ?? null;
  let canonicalFindingId: string | null = null;
  if (findingId) {
    const { data: findingRow } = await db
      .from("case_findings")
      .select("canonical_finding_id")
      .eq("id", findingId)
      .eq("case_id", caseId)
      .maybeSingle();
    canonicalFindingId =
      (findingRow as { canonical_finding_id?: string | null } | null)?.canonical_finding_id ?? null;
  }

  const evidenceRefs = patch.source_document_id
    ? [{ document_id: patch.source_document_id, quote: patch.quote }]
    : [{ quote: patch.quote }];

  const { error } = await db.from("intelligence_lessons").insert({
    case_id: caseId,
    user_id: userId,
    source_patch_id: outcome.auditRowId,
    finding_id: findingId,
    canonical_finding_id: canonicalFindingId,
    matter_type: matterType,
    jurisdiction_country: jurisdictionCountry,
    error_type: patch.error_type ?? null,
    original_claim:
      outcome.originalClaim ??
      (patch.action === "create" ? "(no prior finding — newly created)" : patch.reason),
    corrected_claim: patch.new_title ?? null,
    reason: patch.reason,
    evidence_refs: evidenceRefs,
    authority_refs: [],
    validation_status: "ai_supported",
    confidence: patch.confidence,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (error) {
    console.error("[chat-patch] failed to record lesson", patch.action, error);
    return;
  }

  // Phase B — refresh this lesson's pattern bucket now that it has a new
  // member. Only buckets with a real error_type exist (patterns are keyed
  // on it, NOT NULL) — a "create"/"merge" lesson with no error_type
  // contributes to intelligence_lessons but not to cross-case pattern
  // aggregation, which is correct: those actions don't correct a prior
  // error, so there is no error category to aggregate into.
  if (patch.error_type) {
    const { upsertIntelligencePattern } = await import("./patterns.server");
    await upsertIntelligencePattern(db, userId, {
      matterType,
      jurisdictionCountry,
      jurisdictionState: null,
      errorType: patch.error_type,
    });
  }
}
