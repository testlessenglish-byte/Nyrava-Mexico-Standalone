// Server-only: shared analysis brief.
//
// Generates a compact, structured master analysis from the raw extracted
// corpus *once per case* and caches it on `cases.shared_brief`. All
// downstream agents (perspectives, evidence intel, strategy, etc.) read
// from this brief instead of re-processing the full corpus, dramatically
// reducing token consumption and cost.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mexicoLock, getReportLocale } from "@/lib/mexico-lock";
import type { Database } from "@/integrations/supabase/types";
import { callGroq, parseJsonLoose, GROQ_DEFAULT_MODEL } from "../groq.server";
import { parseResolutivos } from "./resolutivo-parser";

type Db = SupabaseClient<Database>;

export interface SharedBrief {
  case_summary: string;
  jurisdiction_guess?: string;
  case_type_guess?: string;
  parties: Array<{ name: string; role: string }>;
  key_entities: Array<{ name: string; type: string; note?: string }>;
  timeline: Array<{ date?: string; event: string; doc_ref?: string }>;
  key_facts: Array<{ fact: string; doc_ref?: string }>;
  issues: Array<{
    issue: string;
    type: "constitutional" | "evidentiary" | "procedural" | "substantive" | "other";
  }>;
  evidence_inventory: Array<{
    item: string;
    doc_ref?: string;
    role: "corroborating" | "contradictory" | "weak" | "supporting" | "neutral";
    note?: string;
  }>;
  contradictions: Array<{ statement_a: string; statement_b: string; note?: string }>;
  open_questions: string[];
  document_index: Array<{ n: number; id: string; filename: string }>;
  generated_at: string;
  model: string;
  source_doc_ids: string[];
  /**
   * Verbatim RESUELVE/SE RESUELVE dispositive text, extracted
   * deterministically (resolutivo-parser.ts, no AI) from each document's
   * FULL (un-truncated) extracted_text — never from the length-capped
   * `corpus` string this brief's own summary was generated from. One or
   * more dispositions, labeled by source document, joined into a single
   * block; null when no document in the corpus contains a RESUELVE header.
   *
   * WHY: every downstream engine (perspectives, strategy synthesis, report
   * writer) reads ONLY this brief, never the raw corpus — so if the
   * summary LLM call above ever inverts or garbles the case's actual
   * holding (a truncated corpus cutting off the dispositive section, which
   * usually sits at the very end of a Mexican judgment, is one concrete
   * way that happens), every downstream consumer inherits the same error
   * simultaneously. Real case: Amparo Directo en Revisión 5829/2025 —
   * multi-agent perspectives AND strategy synthesis both asserted the
   * opposite of what the sentencia's own resolutivo SEGUNDO actually
   * granted. This field gives every downstream prompt (via briefToPrompt)
   * a literal, un-truncatable anchor to the court's own words, with
   * explicit instructions that it overrides any conflicting inference.
   */
  resolutivo_verbatim: string | null;
}

export interface SharedBriefArgs {
  db: Db;
  caseId: string;
  userId: string;
  apiKeys: string[];
  /** Force regeneration even if cached. */
  refresh?: boolean;
}

async function loadCorpus(db: Db, caseId: string) {
  const { data: docs } = await db
    .from("documents")
    .select("id,filename,extracted_text,status,evidence_scope")
    .eq("case_id", caseId)
    // Analysis corpus only — Talk-to-Case attachments not yet promoted are
    // excluded (see migration 20260813224813_document_evidence_scope).
    .neq("evidence_scope", "revision_context")
    // Secondary sort on `id` so document numbering (doc_n = index+1, used
    // as the citation reference every engine's prompt and grounding
    // verification both depend on) is deterministic even when two
    // documents share an identical created_at — plausible for bulk-
    // uploaded/seeded corpora. Without a tiebreaker, Postgres does not
    // guarantee the same row order across two separate queries, so this
    // function's doc_n numbering (which the LLM is shown and cites) could
    // silently drift from a different call site's independent re-query of
    // the same documents (e.g. grounding.server.ts's own corpus build),
    // misattributing a citation to the wrong document.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  const extracted = (docs ?? []).filter((d) => d.status === "extracted");
  return extracted;
}

export async function getOrBuildSharedBrief(args: SharedBriefArgs): Promise<SharedBrief> {
  const { db, caseId, userId, apiKeys, refresh } = args;

  if (!refresh) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cached } = await (db as any)
      .from("cases")
      .select("shared_brief")
      .eq("id", caseId)
      .maybeSingle();
    const brief = cached?.shared_brief as SharedBrief | null | undefined;
    if (brief && Array.isArray(brief.document_index)) {
      // Ensure the document set hasn't changed since the brief was built.
      const current = await loadCorpus(db, caseId);
      const sameSet =
        current.length === brief.source_doc_ids.length &&
        current.every((d) => brief.source_doc_ids.includes(d.id));
      if (sameSet) return brief;
    }
  }

  const docs = await loadCorpus(db, caseId);
  if (docs.length === 0) {
    throw new Error("No extracted documents — run Extraction first.");
  }

  const docIndex = docs.map((d, i) => ({ n: i + 1, id: d.id, filename: d.filename }));

  // Extracted from each document's FULL, un-truncated text — deliberately
  // BEFORE the per-doc/total budget caps below, since a Mexican judgment's
  // RESUELVE section usually sits at the very end of the document and would
  // otherwise be the first thing silently cut off. Every document that has
  // its own RESUELVE header contributes its own labeled block — a case
  // with both a first-instance ruling and a later SCJN revisión ruling in
  // the same corpus keeps both dispositions distinct rather than the brief
  // conflating them into one. Capped to a small budget of its own: this is
  // meant to be a short, literal anchor, not a second copy of the corpus.
  const RESOLUTIVO_CHAR_BUDGET = 6000;
  const resolutivoBlocks: string[] = [];
  for (const d of docs) {
    const parsed = parseResolutivos(d.extracted_text ?? "");
    if (!parsed.found || parsed.dispositions.length === 0) continue;
    const items = parsed.dispositions
      .map((disp) => `${disp.ordinal ? disp.ordinal + ". " : ""}${disp.text}`)
      .join("\n");
    resolutivoBlocks.push(`--- ${d.filename} ---\n${items}`);
  }
  const resolutivoVerbatim =
    resolutivoBlocks.length > 0 ? resolutivoBlocks.join("\n\n").slice(0, RESOLUTIVO_CHAR_BUDGET) : null;

  // Total payload budget for the single Groq call that builds this brief.
  // 160,000 chars (~40K tokens) was tripping Groq's HTTP 413 on larger
  // corpora — and worse, because the old code capped each doc at 12,000
  // chars and THEN sliced the joined string to 160,000 chars, any case
  // with more than ~13 documents silently dropped every document after
  // that point from the brief entirely (truncated mid-document, with the
  // rest never seen). Fix: pick a per-doc share of a much safer total
  // budget so every document contributes something, however small, to
  // the brief the whole pipeline is grounded on.
  const CORPUS_CHAR_BUDGET = 70000;
  const perDocCap = Math.max(
    400,
    Math.min(12000, Math.floor(CORPUS_CHAR_BUDGET / Math.max(1, docs.length))),
  );
  const corpus = docs
    .map(
      (d, i) =>
        `=== DOC ${i + 1} (id=${d.id}): ${d.filename} ===\n${(d.extracted_text ?? "").slice(0, perDocCap)}`,
    )
    .join("\n\n")
    .slice(0, CORPUS_CHAR_BUDGET);

  const r = await callGroq({
    apiKeys,
    model: GROQ_DEFAULT_MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) +
      "\n\n" +
      "You are the master analyst. Read the full case corpus once and produce a compact, structured brief that downstream agents will reuse. " +
      "Extract entities, parties, timeline, key facts, legal issues, evidence inventory, and contradictions. " +
      "Be precise; ground every item in the documents. Output STRICT JSON only.",
    userContent: `${
      resolutivoVerbatim
        ? `RESOLUTIVO_VERBATIM (extraído literalmente del expediente por un analizador determinístico, no por ti — es la fuente de verdad sobre el resultado del caso; "case_summary", "key_facts" e "issues" DEBEN ser consistentes con este texto, nunca contradecirlo ni invertirlo):\n${resolutivoVerbatim}\n\n`
        : ""
    }Return STRICT JSON only with this shape:
{
  "case_summary": string (4-7 sentences neutral overview),
  "jurisdiction_guess": string|null,
  "case_type_guess": string|null,
  "parties": [ { "name": string, "role": string } ],
  "key_entities": [ { "name": string, "type": "person"|"org"|"location"|"document"|"other", "note": string|null } ],
  "timeline": [ { "date": string|null, "event": string, "doc_ref": string|null } ],
  "key_facts": [ { "fact": string, "doc_ref": string|null } ],
  "issues": [ { "issue": string, "type": "constitutional"|"evidentiary"|"procedural"|"substantive"|"other" } ],
  "evidence_inventory": [ { "item": string, "doc_ref": string|null, "role": "corroborating"|"contradictory"|"weak"|"supporting"|"neutral", "note": string|null } ],
  "contradictions": [ { "statement_a": string, "statement_b": string, "note": string|null } ],
  "open_questions": [ string ]
}

DOCUMENT INDEX (use these as doc_ref values):
${docIndex.map((d) => `DOC ${d.n}: ${d.filename}`).join("\n")}

CASE CORPUS:
${corpus}`,
    json: true,
    temperature: 0.15,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (parseJsonLoose<any>(r.text) ?? {}) as Partial<SharedBrief>;

  const brief: SharedBrief = {
    case_summary: parsed.case_summary ?? "",
    jurisdiction_guess: parsed.jurisdiction_guess ?? undefined,
    case_type_guess: parsed.case_type_guess ?? undefined,
    parties: parsed.parties ?? [],
    key_entities: parsed.key_entities ?? [],
    timeline: parsed.timeline ?? [],
    key_facts: parsed.key_facts ?? [],
    issues: parsed.issues ?? [],
    evidence_inventory: parsed.evidence_inventory ?? [],
    contradictions: parsed.contradictions ?? [],
    open_questions: parsed.open_questions ?? [],
    document_index: docIndex,
    generated_at: new Date().toISOString(),
    model: r.model,
    source_doc_ids: docs.map((d) => d.id),
    resolutivo_verbatim: resolutivoVerbatim,
  };

  // Log usage and persist to cases row
  const { getKeyIdByIndex } = await import("../ai-key-router.server");
  const groqKeyId = getKeyIdByIndex(userId, "groq", r.keyIndex);
  await db.from("ai_usage").insert({
    user_id: userId,
    case_id: caseId,
    model: r.model,
    operation: "shared_brief",
    provider_type: r.provider ?? null,
    input_tokens: r.inputTokens ?? null,
    output_tokens: r.outputTokens ?? null,
    total_tokens: r.totalTokens ?? null,
    latency_ms: r.latencyMs,
    success: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...((groqKeyId ? { groq_key_id: groqKeyId } : {}) as any),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .from("cases")
    .update({ shared_brief: brief, shared_brief_at: brief.generated_at })
    .eq("id", caseId);

  return brief;
}

/**
 * Compact serialization of the shared brief for downstream prompts.
 * Strips noise to keep token usage minimal.
 */
export function briefToPrompt(brief: SharedBrief, maxChars = 16000): string {
  const compact = {
    summary: brief.case_summary,
    jurisdiction: brief.jurisdiction_guess,
    case_type: brief.case_type_guess,
    parties: brief.parties,
    timeline: brief.timeline,
    key_facts: brief.key_facts,
    issues: brief.issues,
    evidence: brief.evidence_inventory,
    contradictions: brief.contradictions,
    open_questions: brief.open_questions,
  };
  const compactJson = JSON.stringify(compact);
  if (!brief.resolutivo_verbatim) return compactJson.slice(0, maxChars);

  // The court's own verbatim dispositive text (see resolutivo_verbatim's
  // doc comment on SharedBrief) must never be silently dropped by a blind
  // end-of-string slice the way the rest of the brief can be — every
  // downstream engine that reads this prompt (perspectives, strategy
  // synthesis, report writer) needs it present to avoid inheriting a
  // holding inversion from the compact summary above. Budget the compact
  // JSON around it instead.
  const anchor =
    "\n\nRESOLUTIVO_VERBATIM (extracción literal y determinística del expediente, no generada por IA — " +
    "AUTORIDAD MÁXIMA sobre el resultado del caso: si cualquier otro campo anterior entra en conflicto " +
    "con este texto, este texto es el correcto):\n" +
    brief.resolutivo_verbatim;
  const budgetForCompact = Math.max(0, maxChars - anchor.length);
  return compactJson.slice(0, budgetForCompact) + anchor;
}
