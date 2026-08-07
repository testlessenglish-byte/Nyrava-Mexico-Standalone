// Server-only — Phase 2/3/4 intelligence engines.
// All engines read from the cached SharedBrief (single master extraction)
// instead of reprocessing the full corpus, dramatically reducing tokens.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mexicoLock, getReportLocale } from "@/lib/mexico-lock";
import type { Database } from "@/integrations/supabase/types";
import { callGroq, parseJsonLoose, GROQ_DEFAULT_MODEL } from "../groq.server";
import { getOrBuildSharedBrief, briefToPrompt } from "./shared-brief.server";
import { resolveProviderKeys } from "../ai-key-router.server";
import { addFindings, addGatedFindings, clearFindingsByModule } from "./findings.server";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

const MODEL = GROQ_DEFAULT_MODEL;
type Db = SupabaseClient<Database>;
type J = import("@/integrations/supabase/types").Json;

// Every engine in this file starts by building/fetching the shared brief.
// That single call previously had no error handling of its own — if it
// threw (e.g. a transient provider outage, or the payload-too-large class
// of error now guarded against in shared-brief.server.ts), the exception
// skipped straight past the cooldown/checkpoint handling every other Groq
// call in this file uses, and hard-failed the whole stage instantly. This
// wraps it in the same isGroqCooldownOrRateLimit -> CheckpointRequired
// pattern so a transient failure yields for the next worker tick instead.
async function getSharedBriefResilient(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKeys: string[];
  stage: string;
}) {
  const { db, caseId, userId, apiKeys, stage } = args;
  try {
    return await getOrBuildSharedBrief({ db, caseId, userId, apiKeys });
  } catch (e) {
    const { isCheckpointError, isGroqCooldownOrRateLimit, CheckpointRequired } =
      await import("../pipeline-checkpoint.server");
    if (isCheckpointError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (isGroqCooldownOrRateLimit(msg)) {
      throw new CheckpointRequired(stage, `shared brief build failed transiently, yielding: ${msg}`);
    }
    throw e;
  }
}

const ALL_PERSPECTIVES = [
  "ministerio_publico",
  "defensa",
  "parte_actora",
  "parte_demandada",
  "quejoso",
  "autoridad_responsable",
  "juzgador",
  "independiente",
] as const;
type Perspective = (typeof ALL_PERSPECTIVES)[number];

async function logUsage(
  db: Db,
  args: {
    userId: string;
    caseId: string;
    operation: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    latencyMs: number;
    success: boolean;
    error?: string;
    provider?: string;
    keyIndex?: number;
  },
) {
  const { getKeyIdByIndex } = await import("../ai-key-router.server");
  const provider = (args.provider ?? "groq") as "groq" | "openai" | "gemini" | "anthropic" | "openrouter";
  const groqKeyId = getKeyIdByIndex(args.userId, provider, args.keyIndex);
  await db.from("ai_usage").insert({
    user_id: args.userId,
    case_id: args.caseId,
    model: args.model,
    operation: args.operation,
    provider_type: args.provider ?? null,
    input_tokens: args.inputTokens ?? null,
    output_tokens: args.outputTokens ?? null,
    total_tokens: args.totalTokens ?? null,
    latency_ms: args.latencyMs,
    success: args.success,
    error: args.error ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...((groqKeyId ? { groq_key_id: groqKeyId } : {}) as any),
  });
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "CancelledError";
  }
}

async function setCase(db: Db, caseId: string, patch: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (db as any).from("cases").select("cancel_requested").eq("id", caseId).maybeSingle();
  if (row?.cancel_requested) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .from("cases")
      .update({
        status: "cancelled",
        status_message: "Cancelled by user",
        cancel_requested: false,
      })
      .eq("id", caseId);
    throw new CancelledError();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db
    .from("cases")
    .update(patch as any)
    .eq("id", caseId);
}

async function getKeys(db: Db, userId: string, override?: string): Promise<string[]> {
  const resolved = await resolveProviderKeys(db, userId, "groq");
  if (override) return [override, ...resolved.keys.filter((k) => k !== override)];
  return resolved.keys;
}

// =====================================================================
// PHASE 2 — Multi-Perspective Engine
// =====================================================================
export async function runPerspectivesEngine(args: { db: Db; caseId: string; userId: string; apiKey?: string }) {
  const { db, caseId, userId } = args;
  await setCase(db, caseId, {
    status: "intelligence_running",
    status_message: "Building shared analysis brief",
    progress: 10,
  });

  const apiKeys = await getKeys(db, userId, args.apiKey);
  // Single master extraction — cached and reused by every agent.
  const brief = await getSharedBriefResilient({ db, caseId, userId, apiKeys, stage: "perspectives" });
  const briefText = briefToPrompt(brief);

  await setCase(db, caseId, {
    status_message: "Analyzing every perspective from shared brief",
    progress: 25,
  });

  // Clear stale rows so re-runs replace
  await db.from("case_perspectives").delete().eq("case_id", caseId);

  // Evidence-first: only run perspectives that actually apply to this case
  // type (e.g. don't run "prosecution" or "jury" for a medical-malpractice).
  const { determineApplicablePerspectives } = await import("./evidence-gate.server");
  const { resolveCaseType } = await import("../pipeline.server");
  const caseType = await resolveCaseType(db, caseId, briefText.slice(0, 6000));
  const PERSPECTIVES = determineApplicablePerspectives(caseType) as readonly Perspective[];

  let done = 0;
  const failures: string[] = [];

  // Wall-clock checkpoint — same pattern as extraction/analyzers/agents.
  // Without this, a case with enough applicable perspectives (up to 6) can
  // run past the worker's outer timeout with no way to resume mid-stage.
  const { budgetFor, CheckpointRequired } = await import("../pipeline-checkpoint.server");
  const stageBudgetMs = budgetFor("perspectives");
  const stageStartedAt = Date.now();

  // ROLLBACK APPLIED (2026-08-07): this ran 3 perspectives at a time for
  // wall-clock speed. withAiSlot's process-wide cap bounds TOTAL concurrent
  // provider calls, but it does nothing about 3 calls from the SAME stage
  // landing on the SAME one or two configured Groq keys in the same instant
  // — that's a correlated burst against a single key's per-key rate limit,
  // not 3 independent coin flips. Because this stage only succeeds as a
  // whole when every individual perspective call succeeds (a total failure
  // throws — see below), that correlated-burst risk showed up in practice
  // as "Multi-Perspective Analysis" repeatedly reporting zero output across
  // many cases where every other (single-call) engine succeeded fine.
  // Serializing trades some wall-clock time for actually finishing.
  const { withAiSlot } = await import("../ai/concurrency.server");
  const PERSPECTIVE_CONCURRENCY = 1;
  const batches: Perspective[][] = [];
  for (let i = 0; i < PERSPECTIVES.length; i += PERSPECTIVE_CONCURRENCY) {
    batches.push(PERSPECTIVES.slice(i, i + PERSPECTIVE_CONCURRENCY));
  }

  const runOnePerspective = async (perspective: Perspective) => {
    const t0 = Date.now();
    try {
      const r = await withAiSlot(async () => callGroq({
        apiKeys,
        model: MODEL,
        systemInstruction:
          mexicoLock(await getReportLocale(db, caseId)) +
          "\n\n" +
          `You are a neutral senior litigation analyst examining a case from the ${perspective.toUpperCase()} perspective. ` +
          `Your job is to reveal the strongest case this side can build, the weaknesses they must address, ` +
          `what the opposing side will argue, and how those arguments can be countered. ` +
          `Use the four-tier confidence labels: confirmed (directly supported by evidence), ` +
          `likely (strongly supported but not proven), possible (insufficient information), unknown. ` +
          `Write like a senior litigation attorney, not an AI describing a case: one direct, confident sentence over three hedged ones. ` +
          `FORBIDDEN filler/hedge phrases — rewrite around every instance: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ` +
          `Output STRICT JSON only.`,
        userContent: `Return STRICT JSON:
{
  "summary": string (3-5 sentences),
  "confidence_label": "confirmed"|"likely"|"possible"|"unknown",
  "confidence": number 0-1,
  "strength_score": int 0-100,
  "risk_score": int 0-100,
  "strengths": [ { "title": string, "detail": string, "confidence_label": "confirmed"|"likely"|"possible"|"unknown" } ],
  "weaknesses": [ { "title": string, "detail": string, "confidence_label": "confirmed"|"likely"|"possible"|"unknown" } ],
  "opposing_arguments": [ { "argument": string, "strength": "high"|"medium"|"low" } ],
  "counter_arguments": [ { "argument": string, "rationale": string } ],
  "key_evidence": [ { "item": string, "why_it_matters": string } ],
  "recommended_actions": [ { "action": string, "priority": "high"|"medium"|"low" } ]
}

PERSPECTIVE: ${perspective}

SHARED CASE BRIEF (single source of truth — do not request more documents):
${briefText}`,
        json: true,
        temperature: 0.2,
      }));
      await logUsage(db, {
        userId,
        caseId,
        operation: `perspective:${perspective}`,
        model: r.model,
        provider: r.provider,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        latencyMs: r.latencyMs,
        success: true,
        keyIndex: r.keyIndex,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = parseJsonLoose<any>(r.text) ?? {};
      // supabase-js does NOT throw on a rejected insert — it returns { error }.
      // Swallowing it made a constraint/RLS rejection look like a successful
      // model call, so the stage reported "4/4 calls ok" and then died on
      // persistence verification with zero rows and no cause.
      const { error: insertError } = await db.from("case_perspectives").insert({
        case_id: caseId,
        user_id: userId,
        perspective,
        summary: p.summary ?? null,
        confidence_label: p.confidence_label ?? null,
        confidence: typeof p.confidence === "number" ? p.confidence : null,
        strength_score: typeof p.strength_score === "number" ? p.strength_score : null,
        risk_score: typeof p.risk_score === "number" ? p.risk_score : null,
        strengths: (p.strengths ?? []) as J,
        weaknesses: (p.weaknesses ?? []) as J,
        opposing_arguments: (p.opposing_arguments ?? []) as J,
        counter_arguments: (p.counter_arguments ?? []) as J,
        key_evidence: (p.key_evidence ?? []) as J,
        recommended_actions: (p.recommended_actions ?? []) as J,
      });
      if (insertError) {
        throw new Error(`case_perspectives insert failed for "${perspective}": ${insertError.message}`);
      }
      return { perspective, ok: true as const };
    } catch (e) {
      const { rethrowIfCheckpoint } = await import("../pipeline-checkpoint.server");
      rethrowIfCheckpoint(e);
      const msg = e instanceof Error ? e.message : String(e);
      await logUsage(db, {
        userId,
        caseId,
        operation: `perspective:${perspective}`,
        model: MODEL,
        latencyMs: Date.now() - t0,
        success: false,
        error: msg,
      });
      const { isGroqCooldownOrRateLimit } = await import("../pipeline-checkpoint.server");
      if (isGroqCooldownOrRateLimit(msg)) {
        // Surfaced to the batch runner below, which converts this into a
        // CheckpointRequired throw once the current batch settles — keeping
        // the same "yield for worker retry" behavior as before, just at
        // batch granularity instead of per-item.
        return { perspective, ok: false as const, cooldown: true, msg };
      }
      return { perspective, ok: false as const, cooldown: false, msg };
    }
  };

  for (const batch of batches) {
    if (Date.now() - stageStartedAt > stageBudgetMs && done > 0 && done < PERSPECTIVES.length) {
      console.warn(`[perspectives] checkpoint reached after ${done}/${PERSPECTIVES.length} — yielding`);
      throw new CheckpointRequired("perspectives", `${done}/${PERSPECTIVES.length} perspectives`);
    }
    const results = await Promise.all(batch.map(runOnePerspective));
    for (const res of results) {
      done += 1;
      if (!res.ok) {
        if (res.cooldown) {
          console.warn(
            `[perspectives] Groq cooldown/rate limit reached after ${done} of ${PERSPECTIVES.length}; yielding for worker retry`,
          );
          throw new CheckpointRequired(
            "perspectives",
            `${res.perspective} after ${done - 1} successful — ${res.msg.slice(0, 300)}`,
          );
        }
        failures.push(`${res.perspective}: ${res.msg}`);
      }
    }
    await setCase(db, caseId, {
      status_message: `Perspectives ${done}/${PERSPECTIVES.length}`,
      progress: 20 + Math.floor((done / PERSPECTIVES.length) * 75),
    });
  }

  // If every perspective failed, this stage produced nothing — it must
  // THROW so the caller (persist.runCatalogedEngine) records a genuine
  // `failed` ledger row with the real underlying error attached, and so
  // dependents (theories, strategy) are correctly blocked. Previously this
  // path returned normally, which let `perspectives_at` get stamped as if
  // the stage completed, and surfaced only a generic "0 rows found"
  // persistence error instead of the actual cause (e.g. a rate limit).
  if (failures.length === PERSPECTIVES.length) {
    throw new Error(`All ${PERSPECTIVES.length} perspectives failed: ${failures.join("; ")}`);
  }

  // Adversarial reconciliation pass.
  //
  // Perspectives are generated independently — a "defense strength_score: 85"
  // and "prosecution strength_score: 85" can both be persisted with nothing
  // checking whether the aggregate scores make internal sense together. This
  // doesn't re-run generation (that would be new LLM-call surface); it's a
  // deterministic, code-only check that flags the specific failure mode —
  // both sides of an adversarial pair scoring high with no differentiation —
  // as a weakness entry on both rows, using the existing `weaknesses` JSON
  // column rather than a new schema field.
  const OPPOSING_PAIRS: Array<[Perspective, Perspective]> = [
    ["ministerio_publico", "defensa"],
    ["quejoso", "autoridad_responsable"],
    // Added after checking real report output: general civil case types
    // (employment, personal injury, general_civil, medical_malpractice) use
    // "defense" as the opposing side for "plaintiff", not "respondent" —
    // the original two pairs above never fired for any of those case
    // types, which is most of the platform's civil fixture corpus.
    ["parte_actora", "parte_demandada"],
  ];
  const RECONCILE_HIGH_THRESHOLD = 65;
  const RECONCILE_CLOSE_MARGIN = 15;
  try {
    for (const [a, b] of OPPOSING_PAIRS) {
      if (!PERSPECTIVES.includes(a) || !PERSPECTIVES.includes(b)) continue;
      const { data: rows } = await db
        .from("case_perspectives")
        .select("id,perspective,strength_score,weaknesses")
        .eq("case_id", caseId)
        .in("perspective", [a, b]);
      const rowA = (rows ?? []).find((r) => r.perspective === a);
      const rowB = (rows ?? []).find((r) => r.perspective === b);
      if (!rowA || !rowB) continue;
      const sA = typeof rowA.strength_score === "number" ? rowA.strength_score : null;
      const sB = typeof rowB.strength_score === "number" ? rowB.strength_score : null;
      if (sA === null || sB === null) continue;
      const bothHigh = sA >= RECONCILE_HIGH_THRESHOLD && sB >= RECONCILE_HIGH_THRESHOLD;
      const unreconciled = Math.abs(sA - sB) <= RECONCILE_CLOSE_MARGIN;
      if (bothHigh && unreconciled) {
        const locale = await getReportLocale(db, caseId);
        const note =
          locale === "en"
            ? {
                title: "Both sides scored similarly strong",
                detail: `The ${a} and ${b} analyses both came back with a high strength score (${sA} and ${sB}) and neither clearly outweighs the other. That's unusual — normally one side's evidence is stronger. Review both analyses together before relying on either score.`,
                confidence_label: "possible" as const,
              }
            : {
                title: "Ambas partes obtuvieron una puntuación de fortaleza igualmente alta",
                detail: `Los análisis de ${a} y ${b} obtuvieron cada uno una puntuación de fortaleza alta (${sA} y ${sB}) sin que una parte supere claramente a la otra. Esto es inusual — normalmente la evidencia de una de las partes es más sólida. Revise ambos análisis en conjunto antes de basarse en cualquiera de las dos puntuaciones.`,
                confidence_label: "possible" as const,
              };
        for (const row of [rowA, rowB]) {
          const existing = Array.isArray(row.weaknesses) ? row.weaknesses : [];
          await db
            .from("case_perspectives")
            .update({ weaknesses: [...existing, note] as unknown as J })
            .eq("id", row.id);
        }
      }
    }
  } catch (e) {
    // Reconciliation is a best-effort enhancement, not a required part of
    // the stage — a failure here must never fail the whole perspectives run.
    console.warn(
      `[perspectives] reconciliation pass failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  await setCase(db, caseId, {
    status: "intelligence_complete",
    status_message: failures.length ? `Perspectives done with ${failures.length} failures` : "Perspectives complete",
    progress: 100,
    perspectives_at: new Date().toISOString(),
    error: failures.length ? failures.join("; ").slice(0, 2000) : null,
  });
}

// =====================================================================
// PHASE 3 — Evidence Intelligence Engine
// =====================================================================
export async function runEvidenceIntelEngine(args: { db: Db; caseId: string; userId: string; apiKey?: string }) {
  const { db, caseId, userId } = args;
  await setCase(db, caseId, {
    status: "intelligence_running",
    status_message: "Classifying evidence and detecting gaps",
    progress: 25,
  });

  const apiKeys = await getKeys(db, userId, args.apiKey);
  const brief = await getSharedBriefResilient({ db, caseId, userId, apiKeys, stage: "evidence_intel" });
  const briefText = briefToPrompt(brief);
  const { data: currentDocs } = await db
    .from("documents")
    .select("id,filename,extracted_text,status")
    .eq("case_id", caseId)
    // Secondary sort on `id` for deterministic doc_n numbering — see the
    // identical note in shared-brief.server.ts's loadCorpus().
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  const docsById = new Map((currentDocs ?? []).map((d) => [d.id as string, d]));
  const citationDocs: Array<{ id: string; filename: string; extracted_text: string | null }> = [];
  let remainingCitationChars = 120_000;
  for (const ref of brief.document_index) {
    const d = docsById.get(ref.id);
    if (!d || d.status !== "extracted" || remainingCitationChars <= 0) continue;
    const fullText = d.extracted_text ?? "";
    const text = fullText.slice(0, remainingCitationChars);
    remainingCitationChars -= text.length;
    citationDocs.push({ id: d.id as string, filename: d.filename, extracted_text: text });
  }
  const { buildGroundingCorpus } = await import("./grounding.server");
  const promotionCorpus = buildGroundingCorpus(citationDocs);
  const citationCorpusText = citationDocs
    .map((d, i) => `=== DOC ${i + 1} (id=${d.id}): ${d.filename} ===\n${d.extracted_text ?? ""}`)
    .join("\n\n");

  await db.from("evidence_classifications").delete().eq("case_id", caseId);

  const docIndex = brief.document_index.map((d) => `DOC ${d.n} id=${d.id} :: ${d.filename}`).join("\n");

  const t0 = Date.now();
  const r = await callGroq({
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) +
      "\n\n" +
      "You are a forensic evidence analyst. Using the shared case brief, classify every piece of evidence by its role in the case. " +
      "Also identify evidence that SHOULD exist given the fact pattern but is missing. " +
      "Use confidence labels: confirmed | likely | possible | unknown. " +
      'Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ' +
      "Output STRICT JSON only.",
    userContent: `Return STRICT JSON:
{
  "classifications": [
    {
      "classification": "corroborating"|"contradictory"|"weak"|"missing"|"undisclosed"|"omision_probatoria"|"chain_of_custody"|"timeline_inconsistency",
      "doc_n": int|null,
      "title": string,
      "description": string,
      "severity": "low"|"medium"|"high"|"critical",
      "confidence_label": "confirmed"|"likely"|"possible"|"unknown",
      "confidence": number 0-1,
      "affected_party": "defense"|"prosecution"|"plaintiff"|"respondent"|"both",
      "citations": [ string ]
    }
  ]
}

CITATION RULES (critical):
- "citations" must be exact verbatim quotes copied character-for-character from the
  QUOTE VERIFICATION CORPUS below — the same substring must be findable by exact
  string search. Each quote should be a short, distinctive phrase or sentence
  (not a paraphrase, not a summary, not a document label).
- Do NOT put document labels like "DOC 6" in "citations" — which document a
  classification belongs to is already captured by "doc_n". "citations" is ONLY
  for the exact quoted evidence text supporting the classification.
- If you cannot find an exact quotable phrase supporting a classification, return
  citations: [] rather than inventing or paraphrasing one — a paraphrased quote will
  fail verification and be discarded.

DOCUMENT INDEX:
${docIndex}

QUOTE VERIFICATION CORPUS:
${citationCorpusText}

SHARED CASE BRIEF:
${briefText}`,
    json: true,
    temperature: 0.15,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "evidence_intel",
    model: r.model,
    provider: r.provider,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    latencyMs: r.latencyMs,
    success: true,
    keyIndex: r.keyIndex,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJsonLoose<{ classifications?: any[] }>(r.text) ?? {};
  const items = Array.isArray(parsed.classifications) ? parsed.classifications : [];

  const rows = items
    .map((c) => {
      const idx = typeof c.doc_n === "number" ? c.doc_n - 1 : -1;
      const docRef = idx >= 0 && idx < brief.document_index.length ? brief.document_index[idx] : null;
      return {
        case_id: caseId,
        user_id: userId,
        document_id: docRef?.id ?? null,
        classification: String(c.classification ?? "weak"),
        title: String(c.title ?? "Untitled").slice(0, 240),
        description: c.description ? String(c.description).slice(0, 4000) : null,
        severity: c.severity ?? null,
        confidence_label: c.confidence_label ?? null,
        confidence: typeof c.confidence === "number" ? c.confidence : null,
        affected_party: c.affected_party ?? null,
        citations: (Array.isArray(c.citations) ? c.citations : []) as J,
      };
    })
    .filter((r) =>
      [
        "corroborating",
        "contradictory",
        "weak",
        "missing",
        "undisclosed",
        "omision_probatoria",
        "chain_of_custody",
        "timeline_inconsistency",
      ].includes(r.classification),
    );

  if (rows.length > 0) {
    await db.from("evidence_classifications").insert(rows);
  }

  // Step 5: back-populate cross-reference columns on evidence_classifications
  // by joining (in-app) against case_findings / case_witnesses /
  // case_timeline_events. No LLM call — pure DB stitching.
  try {
    const docIds = Array.from(new Set(rows.map((r) => r.document_id).filter((x): x is string => !!x)));
    if (docIds.length > 0) {
      const [{ data: findingRows }, { data: witnessRows }, { data: timelineRows }] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any)
          .from("case_findings")
          .select("id, source_document_id, category, source_doc_ids")
          .eq("case_id", caseId)
          .not("source_module", "like", PROJECTION_LIKE),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).from("case_witnesses").select("id, source_document_id, source_doc_ids").eq("case_id", caseId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any)
          .from("case_timeline_events")
          .select("id, source_document_id, superseded_by")
          .eq("case_id", caseId)
          .is("superseded_by", null),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contradictionCats = new Set(["contradiction", "contradictory", "timeline_inconsistency"]);
      const findingByDoc = new Map<string, { supports: string[]; contradicts: string[] }>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const f of (findingRows as any[]) ?? []) {
        const ids: string[] = Array.isArray(f.source_doc_ids) ? f.source_doc_ids : [];
        if (f.source_document_id) ids.push(f.source_document_id);
        for (const did of ids) {
          const b = findingByDoc.get(did) ?? { supports: [], contradicts: [] };
          if (contradictionCats.has(String(f.category ?? ""))) b.contradicts.push(f.id);
          else b.supports.push(f.id);
          findingByDoc.set(did, b);
        }
      }
      const witByDoc = new Map<string, string[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const w of (witnessRows as any[]) ?? []) {
        const ids: string[] = Array.isArray(w.source_doc_ids) ? w.source_doc_ids : [];
        if (w.source_document_id) ids.push(w.source_document_id);
        for (const did of ids) {
          const arr = witByDoc.get(did) ?? [];
          arr.push(w.id);
          witByDoc.set(did, arr);
        }
      }
      const tlByDoc = new Map<string, string[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const t of (timelineRows as any[]) ?? []) {
        if (!t.source_document_id) continue;
        const arr = tlByDoc.get(t.source_document_id) ?? [];
        arr.push(t.id);
        tlByDoc.set(t.source_document_id, arr);
      }
      for (const did of docIds) {
        const f = findingByDoc.get(did) ?? { supports: [], contradicts: [] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .from("evidence_classifications")
          .update({
            supports_finding_ids: f.supports,
            contradicts_finding_ids: f.contradicts,
            referenced_by_doc_ids: [did],
            linked_witness_ids: witByDoc.get(did) ?? [],
            linked_timeline_event_ids: tlByDoc.get(did) ?? [],
          })
          .eq("case_id", caseId)
          .eq("document_id", did);
      }
    }
  } catch (e) {
    const { rethrowIfCheckpoint } = await import("../pipeline-checkpoint.server");
    rethrowIfCheckpoint(e);
    console.warn("[evidence_classifications] cross-ref stitching failed:", e instanceof Error ? e.message : e);
  }

  // Promotion rule: evidence-intelligence classifications are work product,
  // not decorative labels. Adverse classifications must become unified
  // findings so they appear in reports and agent statistics.
  const promotable = rows.filter((r) =>
    [
      "contradictory",
      "weak",
      "missing",
      "undisclosed",
      "omision_probatoria",
      "chain_of_custody",
      "timeline_inconsistency",
    ].includes(r.classification),
  );
  await clearFindingsByModule(db, caseId, "engine:evidence_intelligence");
  // Route through the shared evidence gate so the same verification that
  // Hallucination review will later apply is enforced at write time. Any
  // engine that inserts into case_findings without this gate becomes the
  // source of "verified findings that turn out not to verify".
  const promotedRows = promotable.map((r) => {
    const category =
      r.classification === "contradictory"
        ? "contradiction"
        : r.classification === "missing" || r.classification === "undisclosed"
          ? "missing_evidence"
          : r.classification;
    return {
      case_id: caseId,
      user_id: userId,
      source_module: `engine:evidence_intelligence:${r.classification}`,
      category,
      title: r.title,
      description: r.description ?? r.title,
      severity: (r.severity ?? "medium") as "low" | "medium" | "high" | "critical",
      confidence: typeof r.confidence === "number" ? r.confidence : 0.7,
      legal_significance:
        r.classification === "timeline_inconsistency"
          ? "Timeline inconsistency identified by evidence intelligence"
          : r.classification === "chain_of_custody"
            ? "Potential chain-of-custody issue"
            : r.classification === "missing" || r.classification === "undisclosed"
              ? "Potential missing or undisclosed evidence"
              : "Evidence intelligence classification requiring review",
      potential_impact: null,
      affected_party: (r.affected_party === "defense" ||
      r.affected_party === "prosecution" ||
      r.affected_party === "both"
        ? r.affected_party
        : "both") as "defense" | "prosecution" | "both",
      source_doc_ids: r.document_id ? [r.document_id] : [],
      // Must match the {quote, document_id} shape every other evidence_refs
      // producer uses (see evidence-gate.server.ts, findings.server.ts).
      // `{label: c}` silently broke primaryQuote lookups downstream — nothing
      // ever populated `.quote`, so promoted evidence-intelligence findings
      // always rendered with an empty citation.
      evidence_refs: (Array.isArray(r.citations) ? r.citations : []).map((c) => ({
        quote: String(c),
        document_id: r.document_id ?? null,
      })),
      tags: ["evidence_intelligence", r.classification],
      metadata: { classification: r },
    };
  });
  const sameDocumentSet =
    citationDocs.length === brief.source_doc_ids.length &&
    citationDocs.every((d, i) => d.id === brief.source_doc_ids[i]);
  const promoted = await addGatedFindings(db, caseId, promotedRows, {
    corpus: promotionCorpus,
    corpusAudit: {
      source: "evidence_intelligence.quote_verification_corpus",
      prompt_source: "same in-memory citationDocs used in prompt and promotion gate",
      prompt_text_chars: citationCorpusText.length,
      same_document_set_as_generation: sameDocumentSet,
      same_text_as_generation: true,
    },
  });

  await setCase(db, caseId, {
    status: "intelligence_complete",
    status_message: "Evidence intelligence complete",
    progress: 100,
    evidence_intel_at: new Date().toISOString(),
    error: null,
  });
  void t0;
  return {
    classifications: rows.length,
    promoted_findings: promoted.inserted,
    promotion_gate: promoted.audit,
    promotion_mode: promoted.mode,
    promotion_corpus: promoted.corpus,
  };
}

// =====================================================================
// PHASE 4 — Strategy Synthesis Engine
// =====================================================================
export async function runStrategyEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey?: string;
  perspective?: Perspective;
}) {
  const { db, caseId, userId } = args;
  const perspective: Perspective = args.perspective ?? "independiente";

  // STRICT-mode firewall — strategy/motion synthesis is not allowed.
  const { getAnalysisMode } = await import("./evidence-gate.server");
  const { engineAllowedInMode } = await import("./case-state.server");
  const mode = await getAnalysisMode(db, caseId);
  if (!engineAllowedInMode("strategy", mode)) {
    console.info(`[mode:${mode}] strategy engine skipped — strict mode produces no motions or strategies`);
    await setCase(db, caseId, {
      status: "intelligence_complete",
      status_message: `Strategy skipped (${mode} mode produces no motions or strategies)`,
      progress: 100,
    });
    return;
  }

  await setCase(db, caseId, {
    status: "intelligence_running",
    status_message: `Synthesizing strategy (${perspective})`,
    progress: 30,
  });

  const apiKeys = await getKeys(db, userId, args.apiKey);
  const brief = await getSharedBriefResilient({ db, caseId, userId, apiKeys, stage: "strategy" });
  const briefText = briefToPrompt(brief);

  // Pull supporting context: existing findings, perspectives, evidence intel
  const [{ data: findings }, { data: perspectives }, { data: evidence }] = await Promise.all([
    db
      .from("case_findings")
      .select("category,severity,title,description,confidence,affected_party")
      .eq("case_id", caseId)
      .not("source_module", "like", PROJECTION_LIKE)
      .limit(200),
    db
      .from("case_perspectives")
      .select("perspective,summary,strengths,weaknesses,opposing_arguments,strength_score,risk_score")
      .eq("case_id", caseId),
    db
      .from("evidence_classifications")
      .select("classification,title,description,severity,confidence_label,affected_party")
      .eq("case_id", caseId)
      .limit(200),
  ]);

  const { resolveCaseType, isCriminalCaseType } = await import("../pipeline.server");
  const caseType = await resolveCaseType(db, caseId, briefText.slice(0, 4000));
  const civil = !isCriminalCaseType(caseType);
  const caseFrame = civil
    ? `This is a CIVIL matter (case_type=${caseType}). Use civil terminology ONLY — liability, damages, comparative fault, settlement, discovery, credibility. NEVER use criminal terms (conviction, acquittal, Miranda, Brady, suppression, search and seizure, reasonable doubt, prosecution strategy). NEVER recommend criminal motions (motion to suppress, Brady motion).`
    : `This is a MEXICAN PENAL matter under the CNPP (case_type=${caseType}). Use Mexican penal terminology ONLY — Ministerio Público, imputado, víctima u ofendido, auto de vinculación a proceso, sentencia condenatoria/absolutoria, Juez de Control, Tribunal de Enjuiciamiento. NEVER use U.S. criminal-system terms (jury, plea bargain, indictment, felony, misdemeanor, grand jury, Miranda, Brady, prosecutor as a role title).`;

  const r = await callGroq({
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) +
      "\n\n" +
      `You are the head of strategy for the ${perspective.toUpperCase()} side. ` +
      `Produce a prioritized strategy: rank motions by realistic chance of success (High/Moderate/Low with rationale), ` +
      `list what the opposing side will argue and how to counter each, ` +
      `and produce a numbered list of next actions in priority order. ` +
      `EVERY motion ranking and counter-argument MUST cite at least one verbatim quote from the case brief — if you cannot, omit the item. ` +
      `Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ` +
      `Output STRICT JSON only.`,
    userContent: `${caseFrame}

Return STRICT JSON:
{
  "summary": string (3-5 sentences),
  "confidence_label": "confirmed"|"likely"|"possible"|"unknown",
  "case_strength_score": int 0-100,
  "risk_score": int 0-100,
  "motion_rankings": [
    {
      "motion": string,
      "strength": "high"|"moderate"|"low",
      "rationale": string,
      "supporting_evidence": [ string (verbatim quote, <=200 chars) ],
      "draft_outline": [ string ]
    }
  ],
  "anticipated_opposing": [
    { "argument": string, "likelihood": "high"|"medium"|"low", "impact": "high"|"medium"|"low" }
  ],
  "counter_arguments": [
    { "for_argument": string, "counter": string, "supporting_evidence": [ string (verbatim quote, <=200 chars) ] }
  ],
  "next_actions": [
    { "step": int, "action": string, "priority": "high"|"medium"|"low", "owner": "attorney"|"investigator"|"client"|"expert", "due_window": string }
  ]
}

PERSPECTIVE: ${perspective}

EXISTING PERSPECTIVES:
${JSON.stringify(perspectives ?? []).slice(0, 20000)}

EVIDENCE INTELLIGENCE:
${JSON.stringify(evidence ?? []).slice(0, 20000)}

UNIFIED FINDINGS:
${JSON.stringify(findings ?? []).slice(0, 20000)}

SHARED CASE BRIEF:
${briefText}`,
    json: true,
    temperature: 0.2,
  });

  await logUsage(db, {
    userId,
    caseId,
    operation: `strategy:${perspective}`,
    model: r.model,
    provider: r.provider,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    latencyMs: r.latencyMs,
    success: true,
    keyIndex: r.keyIndex,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = parseJsonLoose<any>(r.text) ?? {};

  const { textMatchesCaseType } = await import("./evidence-gate.server");
  // Drop motions/counters that have no supporting verbatim quote, or use
  // criminal terminology in a civil case.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterMotions = (arr: any[]) =>
    (Array.isArray(arr) ? arr : []).filter((m) => {
      const quotes = Array.isArray(m?.supporting_evidence)
        ? m.supporting_evidence.filter((q: unknown) => typeof q === "string" && q.trim().length > 5)
        : [];
      if (quotes.length === 0) return false;
      return textMatchesCaseType(`${m.motion ?? ""} ${m.rationale ?? ""}`, caseType);
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterCounters = (arr: any[]) =>
    (Array.isArray(arr) ? arr : []).filter((c) => {
      const quotes = Array.isArray(c?.supporting_evidence)
        ? c.supporting_evidence.filter((q: unknown) => typeof q === "string" && q.trim().length > 5)
        : [];
      if (quotes.length === 0) return false;
      return textMatchesCaseType(`${c.for_argument ?? ""} ${c.counter ?? ""}`, caseType);
    });

  const { error: strategyWriteError } = await db.from("case_strategy").upsert(
    {
      case_id: caseId,
      user_id: userId,
      perspective,
      summary: s.summary ?? null,
      confidence_label: s.confidence_label ?? null,
      case_strength_score: typeof s.case_strength_score === "number" ? s.case_strength_score : null,
      risk_score: typeof s.risk_score === "number" ? s.risk_score : null,
      motion_rankings: (filterMotions(s.motion_rankings) ?? []) as J,
      anticipated_opposing: (s.anticipated_opposing ?? []) as J,
      counter_arguments: (filterCounters(s.counter_arguments) ?? []) as J,
      next_actions: (s.next_actions ?? []) as J,
    },
    { onConflict: "case_id,perspective" },
  );
  // Supabase upsert() does NOT throw on its own — this write was previously
  // unchecked, exposing it to the same "ran successfully but wrote nothing"
  // failure mode already fixed for every other write in this codebase.
  if (strategyWriteError) {
    throw new Error(`case_strategy upsert failed: ${strategyWriteError.message}`);
  }

  await setCase(db, caseId, {
    status: "intelligence_complete",
    status_message: "Strategy synthesis complete",
    progress: 100,
    strategy_at: new Date().toISOString(),
    error: null,
  });
}

// =====================================================================
// LEGAL ATTACK SURFACE — derived purely from CASE_STATE findings.
// No new analysis, no LLM call. Each bucket lists ranked findings the
// renderer can attach to one of seven attack lanes.
//
// IMPORTANT — read before using these numbers in a report or UI: every
// bucket here (including exclusion_opportunities) is built by regex
// keyword-matching against each finding's title/description/category (see
// bucketFinding below). This is fast, deterministic, and useful for
// triage — but it is NOT a probability model. There is currently no
// exclusion-probability estimation anywhere in this codebase; this is
// the closest existing thing to it, and it should be presented to
// attorneys as "candidates for review," not as a likelihood.
// =====================================================================
export type AttackSurfaceItem = {
  finding_id: string;
  title: string;
  category: string;
  severity: string;
  priority: number;
  evidence_type: string | null;
  affected_party: string | null;
  source_quote?: string | null;
  source_document_id?: string | null;
};

export type AttackSurface = {
  /** Keyword-matched candidates for a prueba-ilícita exclusion incidente — NOT a probability. See file header above. */
  exclusion_opportunities: AttackSurfaceItem[];
  impeachment_opportunities: AttackSurfaceItem[];
  omision_probatoria_risks: AttackSurfaceItem[];
  cateo_irregular_risks: AttackSurfaceItem[];
  chain_of_custody_challenges: AttackSurfaceItem[];
  fundamentacion_probatoria_challenges: AttackSurfaceItem[];
  impugnacion_pericial_challenges: AttackSurfaceItem[];
  generated_at: string;
  finding_count: number;
};

function emptyAttackSurface(): AttackSurface {
  return {
    exclusion_opportunities: [],
    impeachment_opportunities: [],
    omision_probatoria_risks: [],
    cateo_irregular_risks: [],
    chain_of_custody_challenges: [],
    fundamentacion_probatoria_challenges: [],
    impugnacion_pericial_challenges: [],
    generated_at: new Date().toISOString(),
    finding_count: 0,
  };
}

export async function buildAttackSurface(db: Db, caseId: string): Promise<AttackSurface> {
  const { data: rows } = await db
    .from("case_findings")
    .select(
      "id,title,category,severity,priority,evidence_type,affected_party,source_quote,source_document_id,description",
    )
    .eq("case_id", caseId)
    .not("source_module", "like", PROJECTION_LIKE);
  const findings = rows ?? [];
  const out = emptyAttackSurface();
  out.finding_count = findings.length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toItem = (f: any): AttackSurfaceItem => ({
    finding_id: f.id,
    title: f.title,
    category: f.category,
    severity: f.severity,
    priority: f.priority ?? 4,
    evidence_type: f.evidence_type ?? null,
    affected_party: f.affected_party ?? null,
    source_quote: f.source_quote ?? null,
    source_document_id: f.source_document_id ?? null,
  });

  // REBUILT 2026-07-29: every regex below was English/U.S. doctrine
  // (miranda, fourth amendment, brady, franks, daubert) written before
  // this session's Mexican-terminology rebuild — none could match a real
  // Mexican finding's Spanish title/description, so this function
  // silently returned every bucket empty for every case. Rebuilt to match
  // the same Spanish vocabulary already established in classify.server.ts
  // and report-augment.server.ts's ISSUE_RULES.
  for (const f of findings) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = `${(f as any).category ?? ""} ${(f as any).title ?? ""} ${(f as any).description ?? ""}`.toLowerCase();
    if (
      /(debido\s+proceso|control\s+de\s+detenci[oó]n|cateo\s+sin\s+orden|cateo\s+irregular|detenci[oó]n\s+arbitraria|prueba\s+il[ií]cita|exclusi[oó]n\s+probatoria)/.test(
        blob,
      )
    ) {
      out.exclusion_opportunities.push(toItem(f));
    }
    if (
      /(sesgo\s+del\s+testigo|contradicci[oó]n\s+del\s+testigo|credibilidad|testigo\s+no\s+confiable|impugnaci[oó]n|declaraci[oó]n\s+previa\s+inconsistente)/.test(
        blob,
      )
    ) {
      out.impeachment_opportunities.push(toItem(f));
    }
    if (
      /(omisi[oó]n\s+de\s+investigaci[oó]n|dato\s+de\s+prueba\s+no\s+revelado|ocultamiento\s+de\s+evidencia|omisi[oó]n\s+probatoria)/.test(
        blob,
      )
    ) {
      out.omision_probatoria_risks.push(toItem(f));
    }
    if (
      /(datos\s+falsos\s+en\s+cateo|omisi[oó]n\s+sustancial\s+en\s+cateo|solicitud\s+de\s+cateo\s+irregular)/.test(blob)
    ) {
      out.cateo_irregular_risks.push(toItem(f));
    }
    if (
      /(cadena\s+de\s+custodia|ruptura\s+de\s+custodia|manejo\s+indebido\s+de\s+indicios|contaminaci[oó]n\s+de\s+indicio)/.test(
        blob,
      )
    ) {
      out.chain_of_custody_challenges.push(toItem(f));
    }
    if (
      /(licitud\s+de\s+la\s+prueba|fundamentaci[oó]n\s+probatoria|incorporaci[oó]n\s+de\s+prueba|valoraci[oó]n\s+probatoria)/.test(
        blob,
      )
    ) {
      out.fundamentacion_probatoria_challenges.push(toItem(f));
    }
    if (
      /(dictamen\s+pericial\s+deficiente|metodolog[ií]a\s+pericial\s+cuestionada|perito\s+sin\s+acreditaci[oó]n|contaminaci[oó]n\s+de\s+muestra|error\s+de\s+laboratorio)/.test(
        blob,
      )
    ) {
      out.impugnacion_pericial_challenges.push(toItem(f));
    }
  }

  // Rank each bucket by priority asc, severity rank
  const sev: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (const k of Object.keys(out) as Array<keyof AttackSurface>) {
    const v = out[k];
    if (Array.isArray(v)) {
      (v as AttackSurfaceItem[]).sort(
        (a, b) => (a.priority ?? 4) - (b.priority ?? 4) || (sev[a.severity] ?? 4) - (sev[b.severity] ?? 4),
      );
    }
  }
  return out;
}

export async function runAttackSurfaceEngine(args: { db: Db; caseId: string; userId: string }) {
  const { db, caseId } = args;
  const surface = await buildAttackSurface(db, caseId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await db
    .from("cases")
    .update({ attack_surface: surface as unknown as J } as any)
    .eq("id", caseId);
  // Same unchecked-write bug class as case_strategy above — Supabase
  // update() doesn't throw on its own, so this previously could "succeed"
  // while writing nothing.
  if (error) {
    throw new Error(`attack_surface update failed (case=${caseId}): ${error.message}`);
  }
  return surface;
}

// =====================================================================
// LITIGATION STRATEGY CENTER — synthesis-only engine.
//
// Deliberately the LAST engine in the pipeline. It does not touch the
// corpus and does not re-run evidence-gate verification: it reads the
// already-generated, already-gated output of the theory / opportunity /
// witness / perspective / strategy engines and synthesizes one
// attorney-facing "what wins this case" briefing from it.
//
// Two fields are computed in code, not asked from the model, so they can
// never drift out of sync with the narrative they summarize:
//   - winning_the_case_dashboard  (mirrors the other synthesized fields)
//   - lead_counsel_assessment     (built from the other fields; the
//                                  "Strategic analysis, not legal advice"
//                                  disclaimer is structurally guaranteed)
//
// The one grounding check this engine does perform on its own: if the
// model names a "most dangerous witness" who isn't actually in
// case_witnesses for this case, that field is dropped rather than trusted.
// =====================================================================
export async function runLitigationStrategyCenterEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey?: string;
}) {
  const { db, caseId, userId } = args;

  const { getAnalysisMode } = await import("./evidence-gate.server");
  const { engineAllowedInMode } = await import("./case-state.server");
  const mode = await getAnalysisMode(db, caseId);
  if (!engineAllowedInMode("litigation_strategy_center", mode)) {
    console.info(`[mode:${mode}] litigation strategy center skipped — not allowed in this mode`);
    return null;
  }

  await setCase(db, caseId, {
    status: "intelligence_running",
    status_message: "Building Litigation Strategy Center",
    progress: 95,
  });

  const [{ data: theories }, { data: opportunities }, { data: witnesses }, { data: perspectives }, { data: strategy }] =
    await Promise.all([
      db.from("case_theories").select("*").eq("case_id", caseId),
      db.from("case_opportunities").select("*").eq("case_id", caseId),
      db.from("case_witnesses").select("*").eq("case_id", caseId),
      db.from("case_perspectives").select("*").eq("case_id", caseId),
      db.from("case_strategy").select("*").eq("case_id", caseId),
    ]);

  // Legitimate zero: no theories and no opportunities means there is
  // nothing to synthesize a trial strategy from yet. No-op, not a failure
  // — same pattern used by the witness/theory engines.
  if (!(theories ?? []).length && !(opportunities ?? []).length) {
    console.info(`[engine:litigation_strategy_center] case=${caseId} no theories/opportunities — skipping (no-op)`);
    return null;
  }

  const apiKeys = await getKeys(db, userId, args.apiKey);
  const { resolveCaseType, isCriminalCaseType } = await import("../pipeline.server");
  const seedText = JSON.stringify({ theories: (theories ?? []).slice(0, 3) }).slice(0, 4000);
  const caseType = await resolveCaseType(db, caseId, seedText);
  const civil = !isCriminalCaseType(caseType);
  const caseFrame = civil
    ? `This is a CIVIL matter (case_type=${caseType}). Use civil terminology only — liability, damages, comparative fault, settlement, discovery, credibility. NEVER use criminal terms (conviction, acquittal, Miranda, Brady, suppression, reasonable doubt, prosecution).`
    : `This is a MEXICAN PENAL matter under the CNPP (case_type=${caseType}). Use Mexican penal terminology only — Ministerio Público, imputado, víctima u ofendido, sentencia condenatoria/absolutoria. NEVER use U.S. criminal-system terms (jury, plea bargain, indictment, felony, misdemeanor, grand jury, Miranda, Brady, prosecutor as a role title).`;

  const witnessNames = (witnesses ?? []).map((w) => String((w as { name?: unknown }).name ?? "")).filter(Boolean);

  // Strip DB-only columns (id, case_id, user_id, created_at, updated_at)
  // before stringifying — the model never needs them, and on a case with
  // many rows they were a large share of every payload. Cap by item
  // count AND verify against a character ceiling — an item-count guess
  // alone isn't checked against anything. Every other call site in this
  // codebase sending a comparable per-field JSON blob (ctx.findingsLite
  // in engines.server.ts) caps at 15,000-20,000 chars per field and runs
  // without erroring, so each field here is trimmed down to 15,000 chars
  // if the initial item-count cut isn't already under that — five fields
  // at a verified 15,000-char ceiling tops out at 75,000 chars combined,
  // well below the ~89,000 the original uncapped version was sending
  // when it hit the Groq 413.
  const DROP_COLUMNS = new Set(["id", "case_id", "user_id", "created_at", "updated_at"]);
  const FIELD_CHAR_CEILING = 15000;
  function slim<T extends Record<string, unknown>>(rows: T[] | null | undefined, maxItems: number): Partial<T>[] {
    let out = (rows ?? []).slice(0, maxItems).map((row) => {
      const stripped: Partial<T> = {};
      for (const [k, v] of Object.entries(row)) {
        if (!DROP_COLUMNS.has(k)) (stripped as Record<string, unknown>)[k] = v;
      }
      return stripped;
    });
    while (out.length > 0 && JSON.stringify(out).length > FIELD_CHAR_CEILING) {
      out = out.slice(0, Math.max(1, Math.floor(out.length * 0.9)));
    }
    return out;
  }

  const slimTheories = slim(theories, 10);
  const slimOpportunities = slim(opportunities, 15);
  const slimWitnesses = slim(witnesses, 15);
  const slimPerspectives = slim(perspectives, 10);
  const slimStrategy = slim(strategy, 5);

  const r = await callGroq({
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) +
      "\n\n" +
      "You are lead trial counsel synthesizing everything already known about this case into a single strategic " +
      "briefing. You are NOT generating new theories, evidence, or witnesses — you are synthesizing what has " +
      "already been produced and gated by other analysis. Only name a witness if their name appears verbatim in " +
      "the witness list provided. " +
      'Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ' +
      "Output STRICT JSON only.",
    userContent: `${caseFrame}

Return STRICT JSON:
{
  "primary_trial_theme": {
    "theme": string,
    "why": string,
    "supporting_evidence": string[],
    "presentation_guidance": string,
    "persuasion_likelihood": "high"|"moderate"|"low"
  },
  "biggest_weakness": { "weakness": string, "why_it_matters": string },
  "biggest_trial_risk": { "risk": string, "explanation": string },
  "settlement_leverage": [ { "item": string, "why_it_increases_pressure": string } ],
  "most_dangerous_witness": { "name": string, "reasons": string[], "recommended_approach": string[] } | null,
  "biggest_evidentiary_gap": {
    "item": string,
    "importance": "critical"|"high"|"moderate"|"low",
    "impact": string,
    "how_to_obtain": string[],
    "potential_benefit": string
  },
  "expected_defense": { "primary_defense": string, "supporting_arguments": string[], "weaknesses": string[] },
  "recommended_counter_strategy": string,
  "weekly_priorities": [
    { "priority": string, "action": string, "impact_stars": number (1-5), "reason": string }
  ]
}

Omit or return null for any field you cannot support from the material below — do not invent facts, evidence, or witnesses not already present in it.

WITNESSES ON RECORD (only these names may be used as "most_dangerous_witness"):
${JSON.stringify(witnessNames)}

CASE THEORIES:
${JSON.stringify(slimTheories)}

CASE OPPORTUNITIES:
${JSON.stringify(slimOpportunities)}

WITNESS PROFILES:
${JSON.stringify(slimWitnesses)}

PERSPECTIVES:
${JSON.stringify(slimPerspectives)}

STRATEGY SYNTHESIS:
${JSON.stringify(slimStrategy)}`,
    json: true,
    temperature: 0.2,
  });

  await logUsage(db, {
    userId,
    caseId,
    operation: "litigation_strategy_center",
    model: r.model,
    provider: r.provider,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    latencyMs: r.latencyMs,
    success: true,
    keyIndex: r.keyIndex,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJsonLoose<any>(r.text) ?? {};

  // Ground "most dangerous witness" against the actual witness table —
  // dropped, not trusted, if the model named someone not on record.
  let dangerousWitness: Record<string, unknown> | null = null;
  const mdw = parsed.most_dangerous_witness;
  if (mdw && typeof mdw === "object" && typeof mdw.name === "string" && mdw.name.trim()) {
    const match = (witnesses ?? []).find(
      (w) =>
        String((w as { name?: unknown }).name ?? "")
          .trim()
          .toLowerCase() === mdw.name.trim().toLowerCase(),
    );
    if (match) {
      dangerousWitness = {
        witness_id: (match as { id?: unknown }).id ?? null,
        name: (match as { name?: unknown }).name,
        reasons: Array.isArray(mdw.reasons) ? mdw.reasons : [],
        recommended_approach: Array.isArray(mdw.recommended_approach) ? mdw.recommended_approach : [],
      };
    } else {
      console.info(
        `[engine:litigation_strategy_center] case=${caseId} dropped ungrounded witness name="${mdw.name}" — not in case_witnesses`,
      );
    }
  }

  const theme = parsed.primary_trial_theme ?? {};
  const weakness = parsed.biggest_weakness ?? {};
  const risk = parsed.biggest_trial_risk ?? {};
  const leverage: Array<{ item?: string; why_it_increases_pressure?: string }> = Array.isArray(
    parsed.settlement_leverage,
  )
    ? parsed.settlement_leverage
    : [];
  const gap = parsed.biggest_evidentiary_gap ?? {};
  const defense = parsed.expected_defense ?? {};
  const counter = typeof parsed.recommended_counter_strategy === "string" ? parsed.recommended_counter_strategy : "";
  const priorities: Array<{ priority?: string; action?: string; impact_stars?: number; reason?: string }> =
    Array.isArray(parsed.weekly_priorities) ? parsed.weekly_priorities : [];

  // Computed in code — never asked from the model — so it can't drift out
  // of sync with the fields it summarizes.
  const dashboard = [
    { question: "What wins this case?", assessment: theme.theme ?? "—" },
    { question: "Biggest weakness", assessment: weakness.weakness ?? "—" },
    { question: "Biggest trial risk", assessment: risk.risk ?? "—" },
    {
      question: "Settlement leverage",
      assessment: leverage.length
        ? leverage
            .map((l) => l.item)
            .filter(Boolean)
            .join("; ")
        : "—",
    },
    { question: "Most dangerous witness", assessment: dangerousWitness ? String(dangerousWitness.name) : "—" },
    { question: "Biggest missing evidence", assessment: gap.item ?? "—" },
    { question: "Most likely defense", assessment: defense.primary_defense ?? "—" },
    { question: "Best counter", assessment: counter || "—" },
    {
      question: "Litigation posture",
      assessment: theme.persuasion_likelihood
        ? `${civil ? "Favorable a la parte actora" : "Favorable al Ministerio Público"} si el tema de persuasión de probabilidad ${String(theme.persuasion_likelihood).toLowerCase()} se sostiene`
        : "—",
    },
  ];

  const leadCounselParts: string[] = [];
  if (theme.theme)
    leadCounselParts.push(`The strongest path to success is ${theme.theme}${theme.why ? `. ${theme.why}` : "."}`);
  if (dangerousWitness) {
    const name = String(dangerousWitness.name);
    leadCounselParts.push(`Counsel should prioritize preserving testimony from ${name}.`);
  }
  if (gap.item)
    leadCounselParts.push(
      `Obtaining ${gap.item} is a priority discovery target${gap.impact ? `: ${gap.impact}` : "."}`,
    );
  if (leverage.length) {
    leadCounselParts.push(
      `Settlement leverage is likely to increase after key discovery milestones, particularly around ${leverage
        .map((l) => l.item)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ")}.`,
    );
  }
  const leadCounselAssessment =
    (leadCounselParts.length ? leadCounselParts.join(" ") : "Insufficient synthesized data to produce an assessment.") +
    "\n\nStrategic analysis, not legal advice.";

  const row = {
    case_id: caseId,
    user_id: userId,
    primary_trial_theme: theme as J,
    biggest_weakness: weakness as J,
    biggest_trial_risk: risk as J,
    settlement_leverage: leverage as unknown as J,
    most_dangerous_witness: (dangerousWitness ?? {}) as J,
    biggest_evidentiary_gap: gap as J,
    expected_defense: defense as J,
    recommended_counter_strategy: counter || null,
    weekly_priorities: priorities as unknown as J,
    winning_the_case_dashboard: dashboard as unknown as J,
    lead_counsel_assessment: leadCounselAssessment,
    generated_at: new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("case_strategy_center").upsert(row, { onConflict: "case_id" });
  if (error) {
    throw new Error(`case_strategy_center upsert failed: ${error.message}`);
  }

  await setCase(db, caseId, { strategy_center_at: new Date().toISOString() });

  return row;
}
