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
import { locateQuoteInText } from "./evidence-provenance.server";
import { listFindings, addFindings } from "./findings.server";
import type { NewFinding, Severity } from "./types";

type Db = SupabaseClient<Database>;

const MODEL = GROQ_DEFAULT_MODEL;
const VALID_SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export type FindingPatchAction = "keep" | "amend" | "remove" | "merge" | "create";

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
};

export type FindingPatch = {
  action: FindingPatchAction;
  /** Existing finding ids this patch targets. Empty for "create"; exactly
   *  one for keep/amend/remove; two or more for "merge". */
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
};

type CurrentFindingRow = {
  evidence_refs: unknown;
  source_doc_ids: string[] | null;
  metadata: Record<string, unknown> | null;
  category: string;
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
};

export type FindingPatchSetResult = {
  ran: boolean;
  patches: FindingPatch[];
  ungrounded: number;
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
};

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
  }));

  const locale = await getReportLocale(db, caseId);
  const { resolveProviderKeys } = await import("@/lib/ai-key-router.server");
  const { keys } = await resolveProviderKeys(db, userId, "groq");
  const apiKeys = apiKey ? [apiKey, ...keys] : keys;

  const docsBlock = exchange.attachedDocs
    .map(
      (d) => `=== DOCUMENT ${d.id} (${d.filename}) ===\n${(d.extracted_text ?? "").slice(0, 6000)}`,
    )
    .join("\n\n");

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
You may also propose "create" for a genuinely new finding the exchange establishes that has no existing counterpart — finding_ids must be empty for this action. Do NOT create a finding merely restating something an existing finding already covers.
Every patch (except "keep", which you do not need to emit at all) MUST include a "quote" field: a SINGLE verbatim excerpt copied character-for-character from either the chat exchange text or one of the attached documents (never paraphrased, never from the finding itself) that grounds the decision. If citing an attached document, also set source_document_id to that document's id. A patch without a real, exact quote will be discarded. Output JSON only.`,
      userContent: `CHAT EXCHANGE:\nAttorney: ${exchange.question}\n\nNyrava Intelligence: ${exchange.answer}\n\n${docsBlock ? `ATTACHED DOCUMENTS:\n${docsBlock}\n\n` : ""}EXISTING FINDINGS (id, title, description, category, severity, confidence):\n${JSON.stringify(findingsForPrompt).slice(0, 14_000)}\n\nReturn STRICT JSON: { "patches": [ { "action": "amend"|"remove"|"merge"|"create", "finding_ids": string[] (existing ids this targets — must be from the list above; empty only for "create"), "reason": string, "quote": string (verbatim from the chat exchange or an attached document), "source_document_id": string|null, "confidence": number (0-1), "new_title": string (amend/merge/create only), "new_description": string (amend/merge/create only), "new_category": string (amend/merge/create only), "new_severity": "critical"|"high"|"medium"|"low"|"info" (amend/merge/create only) } ] }. Return an empty array if the exchange doesn't warrant any change.`,
    });
  } catch (e) {
    console.error("[chat-patch] LLM call failed", e);
    return { ran: true, patches: [], ungrounded: 0 };
  }

  const parsed = parseJsonLoose<{ patches?: RawPatch[] }>(r.text);
  const raw = Array.isArray(parsed?.patches) ? parsed!.patches : [];
  const validIds = new Set(findingsForPrompt.map((f) => f.id));
  const docsById = new Map(exchange.attachedDocs.map((d) => [d.id, d]));

  const patches: FindingPatch[] = [];
  let ungrounded = 0;

  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const action = p.action;
    if (action !== "amend" && action !== "remove" && action !== "merge" && action !== "create")
      continue;

    const findingIds = Array.isArray(p.finding_ids)
      ? p.finding_ids.filter((id): id is string => typeof id === "string" && validIds.has(id))
      : [];
    if (action === "create" && findingIds.length !== 0) continue;
    if (action !== "create" && findingIds.length === 0) continue;
    if (action !== "merge" && action !== "create" && findingIds.length !== 1) continue;
    if (action === "merge" && findingIds.length < 2) continue;

    const quote = typeof p.quote === "string" ? p.quote.trim() : "";
    const sourceDocId = typeof p.source_document_id === "string" ? p.source_document_id : null;
    const sourceDoc = sourceDocId ? docsById.get(sourceDocId) : undefined;
    const groundedInExchange =
      !!quote &&
      (locateQuoteInText(quote, exchange.question) || locateQuoteInText(quote, exchange.answer));
    const groundedInDoc =
      !!quote && !!sourceDoc?.extracted_text && locateQuoteInText(quote, sourceDoc.extracted_text);
    if (!quote || (!groundedInExchange && !groundedInDoc)) {
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
    if (needsNewContent && (!newTitle || !newDescription)) continue;

    const newSeverityRaw = typeof p.new_severity === "string" ? p.new_severity : null;
    const newSeverity: Severity | undefined = VALID_SEVERITIES.includes(newSeverityRaw as Severity)
      ? (newSeverityRaw as Severity)
      : undefined;

    patches.push({
      action,
      finding_ids: findingIds,
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
    });
  }

  return { ran: true, patches, ungrounded };
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

    try {
      if (patch.action === "remove") {
        const findingId = patch.finding_ids[0];
        const { error } = await db
          .from("case_findings")

          .update({
            superseded_at: nowIso,
            superseded_reason: `${patch.reason} — "${patch.quote}"`,
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
          .select("evidence_refs,source_doc_ids,metadata,category")
          .eq("id", findingId)
          .eq("case_id", caseId)
          .maybeSingle();
        const currentRow = current.data as CurrentFindingRow | null;
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
          .select("id,evidence_refs,source_doc_ids,metadata,category")
          .in("id", patch.finding_ids)
          .eq("case_id", caseId);
        const allRows = (rows ?? []) as Array<CurrentFindingRow & { id: string }>;
        const primaryRow = allRows.find((r) => r.id === primaryId) ?? null;
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            .eq("id", otherId)
            .eq("case_id", caseId);
          if (error) throw error;
        }
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
      });
      continue;
    }

    // Audit row — best-effort; a failure here doesn't roll back the
    // finding-level change above, since the audit table is a supplementary
    // record, not the source of truth (case_findings.superseded_reason is).
    const { error: auditError } = await db.from("case_finding_patches").insert({
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
    } as any);
    if (auditError) {
      console.error("[chat-patch] failed to write audit row", patch.action, auditError);
    }

    outcomes.push({
      action: patch.action,
      finding_ids: patch.finding_ids,
      result_finding_id: resultFindingId,
      applied,
    });
  }

  return outcomes;
}
