// Case AI Chat — Llama 4 Scout constrained to the case's intelligence.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mexicoLock, getReportLocale } from "@/lib/mexico-lock";
import type { Database } from "@/integrations/supabase/types";
import { callGroq } from "../groq.server";
import { listFindings } from "./findings.server";

type Db = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Context cache.
//
// Previously, every single chat message re-fetched and re-serialized the
// entire case intelligence bundle (findings, analysis, agent findings,
// score, theories, opportunities, witnesses, trial prep, full document
// list) from six parallel queries — tens of thousands of characters
// re-tokenized on every turn of a conversation. litigation.server.ts solved
// the equivalent problem with a SharedBrief cache; this applies the same
// idea here, scoped to what's achievable without new infrastructure:
//
// - This is a process-local, in-memory, time-boxed cache (no new DB table,
//   no Redis). It will NOT be shared across server instances, and it will
//   NOT be invalidated the instant an intelligence engine reruns mid-chat —
//   only after CONTEXT_CACHE_TTL_MS elapses. That's a real tradeoff, not a
//   full fix: a genuinely consistent cross-instance cache, invalidated
//   precisely on every engine write, would need a shared cache/DB signal,
//   which is new infrastructure and intentionally not added here. This is
//   the honest, code-only version of the fix.
// ---------------------------------------------------------------------------
const CONTEXT_CACHE_TTL_MS = 60_000;

type ChatSections = {
  docList: Array<{ filename: string; type: string | null; status: string | null; has_text: boolean; chars: number }>;
  findings: Array<{
    id: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    affected_party: string | null;
  }>;
  analysis: unknown;
  agents: Array<{ agent_type: string | null; summary: string | null; findings: unknown }>;
  score: unknown;
  theories: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  witnesses: Array<Record<string, unknown>>;
  trial: unknown;
};

const sectionsCache = new Map<string, { builtAt: number; sections: ChatSections; corpus: string }>();
// Backward-compat alias so any external references to the old name still resolve.
const contextCache = sectionsCache;

// Overall character budget for the assembled context string. Previously each
// field was truncated independently (8K + 40K + 20K + 15K + 8K + 15K + 15K +
// 15K + 10K ≈ 146K chars of *ceilings*, with no combined cap), so a
// data-heavy case could still sum well past the model's effective context
// even though no single field looked oversized on its own.
const MAX_TOTAL_CONTEXT_CHARS = 100_000;

async function fetchChatSections(db: Db, caseId: string): Promise<{ sections: ChatSections; corpus: string }> {
  const [findings, analysis, agents, score, theories, opps, witnesses, trial, docs] = await Promise.all([
    listFindings(db, caseId),
    db.from("analyses").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("agent_findings").select("agent_type,summary,findings").eq("case_id", caseId),
    db.from("case_scores").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("case_theories").select("*").eq("case_id", caseId),
    db.from("case_opportunities").select("*").eq("case_id", caseId),
    db.from("case_witnesses").select("*").eq("case_id", caseId),
    db.from("case_trial_prep").select("*").eq("case_id", caseId).maybeSingle(),
    db
      .from("documents")
      .select("filename,mime_type,status,size_bytes,extracted_text")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
  ]);

  const docList = (docs.data ?? []).map((d) => ({
    filename: d.filename,
    type: d.mime_type,
    status: d.status,
    has_text: !!(d.extracted_text && d.extracted_text.length > 50),
    chars: d.extracted_text?.length ?? 0,
  }));

  // Corpus text for grounding checks — reuses the same document rows already
  // fetched for docList instead of an extra query.
  const corpus = (docs.data ?? [])
    .filter((d) => d.status === "extracted")
    .map((d, i) => `=== DOC ${i + 1}: ${d.filename} ===\n${(d.extracted_text ?? "").slice(0, 12000)}`)
    .join("\n\n")
    .slice(0, 120_000);

  const sections: ChatSections = {
    docList,
    findings: findings.map((f) => ({
      id: f.id,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description.slice(0, 300),
      affected_party: f.affected_party,
    })),
    analysis: analysis.data,
    agents: (agents.data ?? []) as ChatSections["agents"],
    score: score.data,
    theories: (theories.data ?? []) as Array<Record<string, unknown>>,
    opportunities: (opps.data ?? []) as Array<Record<string, unknown>>,
    witnesses: (witnesses.data ?? []) as Array<Record<string, unknown>>,
    trial: trial.data,
  };

  return { sections, corpus };
}

// ---------------------------------------------------------------------------
// Question-relevance ranking.
//
// Previously every section was JSON.stringify'd in a fixed order and the
// WHOLE assembled string was slice(0, MAX_TOTAL_CONTEXT_CHARS) — a raw tail
// cut with no regard for relevance. On a data-heavy case (e.g. many
// witnesses + a large trial-prep block) that meant WITNESSES/TRIAL PREP
// could be silently dropped in their entirety just because they were
// serialized last, even when the attorney's question was specifically about
// a witness. This section reorders each list's ITEMS (not the section
// order itself, which stays stable for readability) by lexical overlap with
// the current question before truncation, so truncation drops the
// least-relevant items within a section first instead of an arbitrary tail.
// This is deliberately NOT semantic/embedding search — see the audit's
// grounding-vs-retrieval distinction — just cheap token-overlap re-ranking
// ahead of an existing character budget.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "by",
  "with",
  "from",
  "that",
  "this",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "as",
  "at",
  "it",
  "what",
  "which",
  "who",
  "whom",
  "does",
  "do",
  "did",
  "my",
  "our",
  "we",
  "case",
  "please",
  "tell",
  "me",
  "about",
]);

function questionTokens(question: string): Set<string> {
  return new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function relevanceScore(text: string, qTokens: Set<string>): number {
  if (qTokens.size === 0) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const t of qTokens) if (hay.includes(t)) hits += 1;
  return hits;
}

/** Stable-sorts items by relevance to the question, descending. Ties (including
 *  the common "no keyword overlap at all" case) preserve original order, so
 *  behavior degrades gracefully to today's ordering for generic questions
 *  like "Summarize this case." */
function rankByQuestion<T>(items: T[], question: string, textOf: (item: T) => string): T[] {
  const qTokens = questionTokens(question);
  if (qTokens.size === 0) return items;
  return items
    .map((item, idx) => ({ item, idx, score: relevanceScore(textOf(item), qTokens) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((x) => x.item);
}

/** Assembles the final prompt-ready context string for a specific question.
 *  Cheap and synchronous over already-fetched/cached sections — safe to call
 *  on every chat turn without hitting the DB again. */
function assembleChatContext(sections: ChatSections, question: string): string {
  const findings = rankByQuestion(sections.findings, question, (f) => `${f.title} ${f.description} ${f.category}`);
  const theories = rankByQuestion(sections.theories, question, (t) => JSON.stringify(t));
  const opportunities = rankByQuestion(sections.opportunities, question, (o) => JSON.stringify(o));
  const witnesses = rankByQuestion(sections.witnesses, question, (w) => JSON.stringify(w));
  const agents = rankByQuestion(sections.agents, question, (a) => `${a.agent_type ?? ""} ${a.summary ?? ""}`);

  let ctx = `
EVIDENCE IN CASE FILE (${sections.docList.length} documents):
${JSON.stringify(sections.docList).slice(0, 8000)}

ALL FINDINGS (${findings.length}, most relevant to this question first):
${JSON.stringify(findings).slice(0, 40000)}

ANALYSIS:
${JSON.stringify(sections.analysis).slice(0, 20000)}

AGENT FINDINGS (most relevant first):
${JSON.stringify(agents).slice(0, 15000)}

SCORE:
${JSON.stringify(sections.score).slice(0, 8000)}

THEORIES (most relevant first):
${JSON.stringify(theories).slice(0, 15000)}

OPPORTUNITIES (most relevant first):
${JSON.stringify(opportunities).slice(0, 15000)}

WITNESSES (most relevant first):
${JSON.stringify(witnesses).slice(0, 15000)}

TRIAL PREP:
${JSON.stringify(sections.trial).slice(0, 10000)}`;

  if (ctx.length > MAX_TOTAL_CONTEXT_CHARS) {
    ctx = `${ctx.slice(0, MAX_TOTAL_CONTEXT_CHARS)}\n\n[...case intelligence truncated to fit context budget...]`;
  }
  return ctx;
}

export async function buildChatContext(
  db: Db,
  caseId: string,
  question = "",
): Promise<{ ctx: string; corpus: string }> {
  const cached = sectionsCache.get(caseId);
  if (cached && Date.now() - cached.builtAt < CONTEXT_CACHE_TTL_MS) {
    return { ctx: assembleChatContext(cached.sections, question), corpus: cached.corpus };
  }

  const { sections, corpus } = await fetchChatSections(db, caseId);
  sectionsCache.set(caseId, { builtAt: Date.now(), sections, corpus });
  return { ctx: assembleChatContext(sections, question), corpus };
}

/** Invalidate the cached context for a case immediately — call this from any
 *  engine/write path that changes case intelligence. The cache is keyed only
 *  by caseId (never by user), so one invalidation clears the context for
 *  every attorney viewing that case — there is no per-user copy that could
 *  independently go stale. */
export function invalidateChatContext(caseId: string) {
  contextCache.delete(caseId);
}

/**
 * Invalidate + eagerly rebuild the chat context for a case, and emit a
 * structured diagnostic log line.
 *
 * This is the single required call site for "an intelligence rerun just
 * finished" — it replaces relying on CONTEXT_CACHE_TTL_MS expiry. It:
 *
 *   1. Drops the cached context/corpus for the case immediately (no TTL
 *      wait), so any in-flight or subsequent Talk to Case request cannot
 *      read pre-rerun data.
 *   2. Immediately rebuilds the context from the just-written intelligence
 *      and repopulates the cache, so the very next chat request is both
 *      correct AND fast — it does not pay a rebuild latency itself.
 *   3. Logs case ID, run ID, cleared/rebuilt flags, and duration, so a
 *      stale-context incident is diagnosable from logs alone.
 *
 * Rebuild failures are logged and swallowed, not thrown: cache invalidation
 * must never be able to fail a pipeline run. If the eager rebuild fails, the
 * cache is still left empty (cleared), so the next real chat request falls
 * through to a fresh, correct buildChatContext() call instead of serving
 * anything stale.
 */
export async function invalidateAndRebuildChatContext(
  db: Db,
  caseId: string,
  opts: { runId: string; source?: string },
): Promise<{ cleared: boolean; rebuilt: boolean; durationMs: number }> {
  const start = Date.now();
  invalidateChatContext(caseId);

  let rebuilt = false;
  try {
    await buildChatContext(db, caseId);
    rebuilt = true;
  } catch (err) {
    console.warn(
      `[talk-to-case] context rebuild failed after rerun (case=${caseId}, run=${opts.runId}):`,
      err instanceof Error ? err.message : err,
    );
  }

  const durationMs = Date.now() - start;
  console.info(
    JSON.stringify({
      event: "pipeline_completed",
      case_id: caseId,
      run_id: opts.runId,
      source: opts.source ?? "pipeline.finalize",
      talk_to_case_cache: "invalidated",
      context: rebuilt ? "rebuilt" : "rebuild_failed",
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
    }),
  );

  return { cleared: true, rebuilt, durationMs };
}

// ---------------------------------------------------------------------------
// Report-update signal.
//
// The model is asked to end its reply with a marker line when — and only
// when — the exchange resolves something the report already flags (a
// documented gap gets filled, a contradiction gets clarified, a fact the
// report got wrong gets corrected). This is deliberately advisory, not
// automatic: the caller (CaseChatPanel) shows a "Regenerate report" button
// rather than triggering a rerun by itself. A full pipeline rerun is a real
// multi-agent LLM job, so it stays an explicit, attorney-confirmed action.
// ---------------------------------------------------------------------------
const RERUN_MARKER_RE = /\n?\[\[RERUN_SUGGESTED:\s*([^\]]{1,220})\]\]\s*$/;

function extractRerunSignal(text: string): { clean: string; suggestsRerun: boolean; reason: string | null } {
  const trimmed = text.trimEnd();
  const match = trimmed.match(RERUN_MARKER_RE);
  if (!match) return { clean: text, suggestsRerun: false, reason: null };
  return {
    clean: trimmed.slice(0, match.index).trimEnd(),
    suggestsRerun: true,
    reason: match[1].trim(),
  };
}

export async function answerCaseQuestion(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
  question: string;
}) {
  const { db, caseId, userId, apiKey, apiKeys, question } = args;

  // Persist user message
  await db.from("case_chat_messages").insert({
    case_id: caseId,
    user_id: userId,
    role: "user",
    content: question,
  });

  const [{ ctx, corpus }, history] = await Promise.all([
    buildChatContext(db, caseId, question),
    db.from("case_chat_messages").select("role,content").eq("case_id", caseId).order("created_at").limit(40),
  ]);

  const r = await callGroq({
    apiKey,
    apiKeys,
    userId,
    temperature: 0.15,

    systemInstruction: `${mexicoLock(await getReportLocale(db, caseId))}

You are Nyrava Intelligence — the embedded legal investigator and litigation strategist for this specific case. You are NOT a generic chatbot.

ABSOLUTE RULES — VIOLATION IS A CRITICAL FAILURE:

1. EVIDENCE-FIRST REASONING. Before answering, read every cited fact in the case intelligence and identify which party each fact supports. An unpaid invoice supports the party owed money. A late-filed police report undermines its author's credibility. A signed Miranda waiver supports the prosecution. NEVER state that a fact supports a party whose position it actually contradicts.

2. INFERENCE DIRECTION CHECK. Every time you cite a document or finding to support a legal conclusion, ask yourself: "If I were opposing counsel, would I cite this same fact for the OPPOSITE conclusion?" If yes, you have inverted the inference — rewrite it.

3. PARTY AWARENESS. Identify the user's client (plaintiff or defendant) from the case record. When asked "what is my strongest [claim/defense]?", every argument you list must be one the user's side would actually advance — not the opposing side's argument restated.

4. NO GENERIC NEXT STEPS. Do not suggest actions the case has already completed. Check the document list, findings, witnesses, opportunities, and trial-prep state before recommending anything. If discovery is complete, do not say "conduct discovery." If a witness statement exists, do not say "interview witnesses." Recommendations must be specific to what is actually missing in THIS case.

5. CITATION HONESTY. Cite documents by filename and quote specific text. If the intelligence does not contain a fact, say "Not in the case file." Never fabricate.

6. EVIDENCE GAPS. When the user's question reveals a true gap (no medical records, no financial records, no expert opinion), list the SPECIFIC documents to upload and explain how each would strengthen the case. The user can drag files into this chat.

7. REPORT UPDATE SIGNAL. If — and only if — this exchange resolves something the report already flags as missing, wrong, or unresolved (a newly uploaded document fills a documented evidence gap; the attorney corrects a fact the report got wrong; a flagged contradiction gets clarified with new information) — end your reply with exactly one line, after everything else, in this exact format: [[RERUN_SUGGESTED: <one sentence, under 25 words, naming what changed>]]. Do not include this line for ordinary questions, hypotheticals, requests for explanation, or anything that doesn't change the underlying case record. Never mention this marker to the user or explain that you're adding it — it is stripped before display.

OUTPUT FORMAT: Markdown. Concise. Concrete. Attorney-grade. Use Nyrava Intelligence terminology (Evidence Intelligence, Witness Intelligence, Motion Intelligence) — never "AI" language. Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to".`,

    userContent: `CASE INTELLIGENCE:
${ctx}

CONVERSATION SO FAR:
${(history.data ?? [])
  .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
  .join("\n\n")
  .slice(-12000)}

CURRENT QUESTION:
${question}`,
  });

  // Strip the report-update marker (rule 7 above) before anything else
  // touches the text — grounding checks and the stored/displayed content
  // should never see the raw marker.
  const { clean: cleanText, suggestsRerun, reason: rerunReason } = extractRerunSignal(r.text);

  // Grounding check — previously citation honesty (rule 5 above) was
  // enforced by prompt instruction only, unlike every generation path
  // elsewhere in the codebase (work product, motion drafts) which re-check
  // the model's output in code. Reuses the existing sentence-traceability
  // validator rather than building new verification logic. Chat answers
  // legitimately include general legal explanation not verbatim in the
  // corpus (procedural rules, definitions), so this flags low-groundedness
  // with an advisory banner rather than silently deleting sentences the way
  // validateProseAgainstCorpus does for narrative report sections — deleting
  // chunks out of a conversational reply would break its flow in a way that
  //'s fine for a formal report section but not for a chat answer.
  let finalAnswer = cleanText;
  if (corpus) {
    const { validateProseAgainstCorpus } = await import("./sufficiency.server");
    const { kept, dropped } = validateProseAgainstCorpus(cleanText, corpus);
    const total = kept + dropped;
    const groundingRatio = total > 0 ? kept / total : 1;
    if (total >= 4 && groundingRatio < 0.6) {
      finalAnswer = `> ⚠️ **Note:** several statements in this answer could not be directly traced to the uploaded case file. Verify against source documents before relying on them.\n\n${cleanText}`;
    }
  }

  const { getKeyIdByIndex } = await import("../ai-key-router.server");
  const groqKeyId = getKeyIdByIndex(userId, "groq", r.keyIndex);
  await db.from("ai_usage").insert({
    user_id: userId,
    case_id: caseId,
    model: r.model,
    operation: "chat",
    provider_type: r.provider ?? null,
    input_tokens: r.inputTokens ?? null,
    output_tokens: r.outputTokens ?? null,
    total_tokens: r.totalTokens ?? null,
    latency_ms: r.latencyMs,
    success: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...((groqKeyId ? { groq_key_id: groqKeyId } : {}) as any),
  });

  await db.from("case_chat_messages").insert({
    case_id: caseId,
    user_id: userId,
    role: "assistant",
    content: finalAnswer,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({
      metadata: suggestsRerun ? { suggests_rerun: true, rerun_reason: rerunReason } : {},
    } as any),
  });

  return { answer: finalAnswer, suggestsRerun, rerunReason };
}
