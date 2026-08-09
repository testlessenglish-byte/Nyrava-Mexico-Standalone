// Talk to Case as a CASE-STATE UPDATE, not just another uploaded document.
//
// Bug (confirmed on Matter 3E87F221 — Amparo Directo en Revisión 3684/2012):
// a Talk-to-Case attorney clarification is uploaded as a plain .txt document
// (see CaseChatPanel.tsx's `case-chat-clarification-*.txt` naming) and fed
// through the exact same extraction → analyzer/agent pipeline as any other
// evidence file. Each analyzer/agent module wipes and rewrites ONLY its own
// findings on rerun (clearFindingsByModule) — nothing tells the regenerating
// prompts that a clarification in the corpus should RECONCILE a conclusion
// it corrects rather than sit alongside it, and nothing retires a finding
// from a DIFFERENT module that the clarification also affects. The result:
// the report reads as the original analysis with new, sometimes
// contradictory findings appended — not one internally-consistent
// re-analysis.
//
// Two coordinated pieces close this gap:
//   1. getCaseStateUpdateNotice() — injected into analyzerPreamble/
//      areaPreamble (pipeline.server.ts) whenever a clarification document is
//      present, instructing the SAME regenerating call to reconcile instead
//      of duplicate. This is the primary fix, since clearFindingsByModule
//      already wipes-and-replaces each module's own findings every rerun —
//      if the fresh pass itself doesn't re-emit the stale conclusion, there
//      is nothing left to coexist with the corrected one.
//   2. reconcileSupersededFindings() — a deterministic-backstop LLM pass
//      (defense-in-depth for findings from a DIFFERENT module than the one
//      whose corpus-derived conclusion the clarification corrects) that
//      marks specific EXISTING findings superseded. Never trusts the
//      model's own claim: a finding is only marked superseded when the
//      justification's quote independently re-locates in the clarification
//      document's own text (the same grounding discipline as every other
//      gate in this codebase) — see resolveSource() in
//      completed-case-audit.server.ts for the established pattern this
//      mirrors.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { mexicoLock, groundingContract, getReportLocale } from "@/lib/mexico-lock";
import { callGroq, parseJsonLoose, GROQ_DEFAULT_MODEL } from "@/lib/groq.server";
import { locateQuoteInText } from "./evidence-provenance.server";
import { listFindings } from "./findings.server";

type Db = SupabaseClient<Database>;

export const CASE_STATE_UPDATE_FILENAME_PREFIX = "case-chat-clarification-";

export type DocLike = { id: string; filename: string; extracted_text: string | null };

/** Pure — true when at least one document is a Talk-to-Case clarification
 *  (see CaseChatPanel.tsx's file-naming convention). Never guesses from
 *  content; the filename is a deliberate, stable signal set at upload time. */
export function hasCaseStateUpdateDocs(docs: DocLike[]): boolean {
  return docs.some((d) => d.filename.startsWith(CASE_STATE_UPDATE_FILENAME_PREFIX));
}

/**
 * The preamble block instructing analyzers/agents to treat a Talk-to-Case
 * clarification as a verified case-state update: reconcile, don't duplicate.
 * `null` (no-op) when there is nothing to reconcile — every case without a
 * clarification document is completely unaffected.
 */
export function getCaseStateUpdateNotice(hasUpdates: boolean, locale: "es" | "en"): string | null {
  if (!hasUpdates) return null;
  const es = locale !== "en";
  return es
    ? `=== ACTUALIZACIÓN DE ESTADO DEL CASO (Talk to Case) ===\n` +
        `El corpus incluye una o más aclaraciones del abogado enviadas desde Talk to Case (documentos con nombre "${CASE_STATE_UPDATE_FILENAME_PREFIX}*"). Trátalas como una ACTUALIZACIÓN VERIFICADA del estado del caso, no como evidencia incidental más.\n` +
        `Si una aclaración corrige, resuelve o contradice una conclusión a la que llegarías a partir del resto del corpus, tu salida debe reflejar ÚNICAMENTE la conclusión actualizada — NO emitas un hallazgo que repita la conclusión anterior ahora superada junto con la nueva. Esto es una reescritura del análisis afectado, no un apéndice.\n` +
        `Si la aclaración no resuelve el punto por completo, dilo explícitamente en el hallazgo (p. ej. "la aclaración del abogado establece X, pero Y permanece sin verificar") en lugar de emitir ambas conclusiones como hallazgos separados y contradictorios.`
    : `=== CASE STATE UPDATE (Talk to Case) ===\n` +
        `The corpus includes one or more attorney clarifications sent from Talk to Case (documents named "${CASE_STATE_UPDATE_FILENAME_PREFIX}*"). Treat these as a VERIFIED update to the case state, not incidental additional evidence.\n` +
        `If a clarification corrects, resolves, or contradicts a conclusion you would otherwise reach from the rest of the corpus, your output must reflect ONLY the updated conclusion — do NOT emit a finding restating the now-superseded prior conclusion alongside the new one. This is a rewrite of the affected analysis, not an appendix.\n` +
        `If the clarification does not fully resolve the point, say so explicitly within the finding (e.g. "the attorney's clarification establishes X, but Y remains unverified") rather than emitting both conclusions as separate, contradictory findings.`;
}

type ActiveFinding = {
  id: string;
  title: string;
  description: string;
  category: string;
  audit_classification: string | null;
};

export type SupersessionDecision = {
  finding_id: string;
  reason: string;
  quote: string;
};

export type ReconciliationResult = {
  ran: boolean;
  checked: number;
  superseded: string[];
  skipped_ungrounded: string[];
};

const MODEL = GROQ_DEFAULT_MODEL;

/**
 * Deterministic-backstop reconciliation pass: identifies existing findings a
 * Talk-to-Case clarification supersedes and marks them (superseded_at/
 * superseded_reason), never deleting the row — the audit trail always shows
 * what changed and why. A no-op whenever no clarification document exists
 * for this case. Every superseded decision the model returns is
 * independently re-verified — its quote must actually appear in the
 * clarification document's own text — before being applied; an unverified
 * claim is dropped, not trusted.
 */
export async function reconcileSupersededFindings(
  db: Db,
  caseId: string,
  userId: string,
  apiKey?: string,
): Promise<ReconciliationResult> {
  const { data: docsRaw } = await db
    .from("documents")
    .select("id,filename,extracted_text")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const docs = (docsRaw ?? []) as DocLike[];
  const clarificationDocs = docs.filter((d) =>
    d.filename.startsWith(CASE_STATE_UPDATE_FILENAME_PREFIX),
  );
  if (clarificationDocs.length === 0) {
    return { ran: false, checked: 0, superseded: [], skipped_ungrounded: [] };
  }

  const activeFindings = await listFindings(db, caseId);
  const findingsForPrompt: ActiveFinding[] = activeFindings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description.slice(0, 500),
    category: f.category,
    audit_classification: f.audit_classification ?? null,
  }));
  if (findingsForPrompt.length === 0) {
    return { ran: false, checked: 0, superseded: [], skipped_ungrounded: [] };
  }

  const clarificationText = clarificationDocs
    .map((d, i) => `=== CLARIFICATION ${i + 1}: ${d.filename} ===\n${d.extracted_text ?? ""}`)
    .join("\n\n");

  const locale = await getReportLocale(db, caseId);
  const { resolveProviderKeys } = await import("@/lib/ai-key-router.server");
  const { keys } = await resolveProviderKeys(db, userId, "groq");
  const apiKeys = apiKey ? [apiKey, ...keys] : keys;

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
You determine which EXISTING case findings a new attorney clarification (Talk to Case) supersedes — corrects, resolves, or contradicts. This is case-state reconciliation, not a search for new findings: you are NOT generating new findings here, only identifying which of the findings listed below are now stale because of the clarification. A finding is superseded ONLY when the clarification text directly and specifically addresses that finding's exact claim — never supersede a finding merely because it is topically related. When uncertain, do not include it. Every decision MUST include a "quote" field: a SINGLE verbatim excerpt copied character-for-character from the clarification text (not paraphrased, not from the finding) that establishes the supersession — a decision without a real, exact quote will be discarded. Output JSON only.`,
      userContent: `CLARIFICATION TEXT:\n${clarificationText.slice(0, 12_000)}\n\nEXISTING FINDINGS (id, title, description, category, audit_classification):\n${JSON.stringify(findingsForPrompt).slice(0, 12_000)}\n\nReturn STRICT JSON: { "supersessions": [ { "finding_id": string (must be one of the ids above), "reason": string (plain-language explanation), "quote": string (verbatim from the clarification text) } ] }. Return an empty array if the clarification does not clearly supersede any listed finding.`,
    });
  } catch (e) {
    console.error("[case-state-reconciliation] LLM call failed", e);
    return { ran: true, checked: findingsForPrompt.length, superseded: [], skipped_ungrounded: [] };
  }

  const parsed = parseJsonLoose<{ supersessions?: SupersessionDecision[] }>(r.text);
  const decisions = Array.isArray(parsed?.supersessions) ? parsed!.supersessions : [];
  const validIds = new Set(findingsForPrompt.map((f) => f.id));

  const superseded: string[] = [];
  const skipped_ungrounded: string[] = [];
  const nowIso = new Date().toISOString();

  for (const d of decisions) {
    if (!d || typeof d.finding_id !== "string" || !validIds.has(d.finding_id)) continue;
    const quote = typeof d.quote === "string" ? d.quote.trim() : "";
    const groundedInAnyClarification = clarificationDocs.some(
      (doc) => doc.extracted_text && locateQuoteInText(quote, doc.extracted_text),
    );
    if (!quote || !groundedInAnyClarification) {
      skipped_ungrounded.push(d.finding_id);
      continue;
    }
    const reason =
      (typeof d.reason === "string" && d.reason.trim()) ||
      "Superseded by Talk to Case clarification.";
    const update = {
      superseded_at: nowIso,
      superseded_reason: `${reason} — "${quote}"`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const { error } = await db
      .from("case_findings")
      .update(update)
      .eq("id", d.finding_id)
      .eq("case_id", caseId);
    if (error) {
      console.error(
        "[case-state-reconciliation] failed to mark finding superseded",
        d.finding_id,
        error,
      );
      continue;
    }
    superseded.push(d.finding_id);
  }

  return { ran: true, checked: findingsForPrompt.length, superseded, skipped_ungrounded };
}
