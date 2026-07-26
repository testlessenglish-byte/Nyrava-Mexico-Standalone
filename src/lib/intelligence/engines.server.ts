// Server-only intelligence engines. Each engine reads case context (documents, findings,
// analyses, agents) and writes structured outputs into its dedicated table while
// emitting unified findings for cross-system propagation.
//
// TODO(calibration): every confidence/percentage number produced by these
// engines (theory confidence, opportunity confidence, jury_conviction_pct,
// plaintiff_success_pct, etc. — see runTrialPrepEngine) is the model's raw
// self-report, persisted with no calibration against real case outcomes and
// no confidence interval. Fixing this needs a new outcomes-tracking table
// (predicted score at generation time -> actual case result) that doesn't
// exist yet; this file intentionally doesn't invent that table. Until it
// exists, treat every score in this file as a single point estimate, not a
// validated probability.
//
// TODO(suppression modeling): there is no suppression-probability model or
// harmless-error analysis anywhere in this codebase (confirmed by grep
// across this file and litigation.server.ts). "motion_to_suppress" exists
// only as a document-type string (see the work-product allowed-types enum
// below) and litigation.server.ts's suppression_opportunities bucket is
// keyword-matching, not a probability. This is a capability to build, not a
// regression to fix, and is out of scope for this pass.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mexicoLock, getReportLocale } from "@/lib/mexico-lock";
import type { Database } from "@/integrations/supabase/types";
import { callGroq, parseJsonLoose, GROQ_DEFAULT_MODEL } from "../groq.server";
import {
  addFindings,
  addGatedFindings,
  listFindings,
  clearFindingsByModule,
  normalizeLlmFindings,
} from "./findings.server";
import type { Theory, Opportunity, WitnessProfile, TrialPrep, WorkProductDoc } from "./types";
import { computeRoleAwareCredibility } from "./mx-witness-roles";

// Findings created by the engines below feed computeCanonicalFindingId()
// (see canonical-id.ts), which uses source_doc_ids as its primary merge
// discriminator. The evidence gate already resolves a document per gated
// item (as source_document_id, plus a fuller citations[] list when a
// finding cites more than one document) — this just carries that same
// information into the source_doc_ids array so canonical-id.ts's doc-based
// merge key actually has something to key on, instead of every finding in
// a case silently colliding on category+claim_type alone.
function gatedSourceDocIds(
  g: { source_document_id?: string | null; citations?: Array<{ document_id?: string | null }> } | undefined,
): string[] {
  if (!g) return [];
  const ids = new Set<string>();
  for (const c of g.citations ?? []) {
    if (typeof c.document_id === "string" && c.document_id) ids.add(c.document_id);
  }
  if (typeof g.source_document_id === "string" && g.source_document_id) ids.add(g.source_document_id);
  return Array.from(ids);
}

// Previously hardcoded here as a second, independent "openai/gpt-oss-120b"
// literal while litigation.server.ts sourced the same value from
// GROQ_DEFAULT_MODEL — two model-selection sources for one platform, with
// real drift risk if either changes without the other. Now shares the same
// source of truth as litigation.server.ts.
//
// VERIFY BEFORE DEPLOY: groq.server.ts wasn't available when this fix was
// made, so this assumes GROQ_DEFAULT_MODEL currently resolves to
// "openai/gpt-oss-120b" (the value this file used before). If it resolves
// to something else, confirm that's an intentional model change before
// shipping this file.
const MODEL = GROQ_DEFAULT_MODEL;
type Db = SupabaseClient<Database>;
type J = import("@/integrations/supabase/types").Json;

// litigation.server.ts's perspectives/strategy engines use a 4-tier
// confidence_label ("confirmed"/"likely"/"possible"/"unknown") alongside a
// numeric confidence — a genuinely useful fact-vs-inference distinction.
// This file's theory/opportunity engines only ever produced the bare
// numeric confidence, so the platform has had two disconnected confidence
// vocabularies. This computes the same label deterministically from the
// numeric score so both engines speak the same vocabulary.
//
// NOT WIRED INTO case_theories / case_opportunities INSERTS BELOW: doing so
// safely requires confirming those tables actually have a confidence_label
// column (mirroring case_perspectives) — that wasn't visible from the files
// in scope for this fix. Search below for "confidenceLabel(" to find the 2
// spots to wire it in, and add the column via migration first if needed:
//   ALTER TABLE case_theories ADD COLUMN confidence_label text;
//   ALTER TABLE case_opportunities ADD COLUMN confidence_label text;
function confidenceLabel(n: number): "confirmed" | "likely" | "possible" | "unknown" {
  if (n >= 0.85) return "confirmed";
  if (n >= 0.6) return "likely";
  if (n >= 0.3) return "possible";
  return "unknown";
}

export async function logUsage(
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

async function setCase(db: Db, caseId: string, patch: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db
    .from("cases")
    .update(patch as any)
    .eq("id", caseId);
}

// Build a compact context bundle for engines from existing case data.
export async function buildContext(db: Db, caseId: string) {
  const [docs, analysis, agents, findings] = await Promise.all([
    db
      .from("documents")
      .select("filename,metadata,entities,extracted_text,status")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    db.from("analyses").select("*").eq("case_id", caseId).maybeSingle(),
    db.from("agent_findings").select("agent_type,summary,findings,confidence").eq("case_id", caseId),
    listFindings(db, caseId),
  ]);
  const corpus = (docs.data ?? [])
    .filter((d) => d.status === "extracted")
    .map((d, i) => `=== DOC ${i + 1}: ${d.filename} ===\n${(d.extracted_text ?? "").slice(0, 12000)}`)
    .join("\n\n")
    .slice(0, 120000);
  const findingsLite = findings.map((f) => ({
    id: f.id,
    category: f.category,
    severity: f.severity,
    title: f.title,
    confidence: f.confidence,
    affected_party: f.affected_party,
  }));
  return {
    corpus,
    analysis: analysis.data,
    agents: agents.data ?? [],
    findings,
    findingsLite,
  };
}

// =========================================================================
// THEORY ENGINE — generates Prosecution/Defense/Alternative/Unknown theories
//
// TODO(red-team): theories are generated independently per type with no
// adversarial cross-check — two mutually exclusive theories can both carry
// high confidence with nothing reconciling them. litigation.server.ts's
// runPerspectivesEngine now has a lightweight, code-only reconciliation
// pass for exactly this problem (see OPPOSING_PAIRS / RECONCILE_* in that
// file) that flags unreconciled symmetric high scores as a weakness entry
// on both rows, without adding a new LLM call. The same pattern applies
// here (e.g. prosecution vs defense theory confidence) and is a reasonable
// next step, intentionally not added in this pass to keep this fix
// contained to what's fully verified against the code as written.
// =========================================================================
export async function runTheoryEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, { status_message: "Generating case theories", progress: 30 });

  const ctx = await buildContext(db, caseId);
  if (!ctx.corpus) throw new Error("No extracted documents.");

  // Evidence-first: only generate theories supported by extracted evidence.
  // The model is told to return an empty array when it cannot back a theory
  // with at least 2 verbatim citations.
  const { applyEvidenceGate, getAnalysisMode, textMatchesCaseType } = await import("./evidence-gate.server");
  const { buildGroundingCorpus } = await import("./grounding.server");
  const { resolveCaseType, isCriminalCaseType } = await import("../pipeline.server");
  const mode = await getAnalysisMode(db, caseId);
  const caseType = await resolveCaseType(db, caseId, ctx.corpus.slice(0, 4000));
  const civil = !isCriminalCaseType(caseType);
  const { data: docsForGround } = await db
    .from("documents")
    .select("id,filename,extracted_text,status")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const groundCorpus = buildGroundingCorpus(
    (docsForGround ?? [])
      .filter((d) => d.status === "extracted")
      .map((d) => ({ id: d.id as string, filename: d.filename, extracted_text: d.extracted_text })),
  );
  const allowedTheoryTypes = civil ? `"plaintiff"|"defense"|"alternative"` : `"prosecution"|"defense"|"alternative"`;
  const caseFrame = civil
    ? `This is a CIVIL matter (case_type=${caseType}). NEVER produce a "prosecution" theory. Use civil terminology only.`
    : `This is a CRIMINAL matter (case_type=${caseType}). Criminal terminology is appropriate.`;

  const r = await callGroq({
    apiKey,
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) + "\n\n" +
      "You are a senior litigation strategist. ONLY generate theories that are supported by at least TWO verbatim quotes from the corpus. " +
      "If the corpus does not support a coherent theory, return an empty `theories` array — do NOT invent theories. " +
      'Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ' +
      "Output STRICT JSON only.",
    userContent: `${caseFrame}

Return STRICT JSON. Every theory MUST include a "citations" array with AT LEAST 2 verbatim quotes copied from the corpus.
If you cannot back a theory with 2 verbatim quotes, omit it. An empty array is a valid response.

{
  "theories": [
    {
      "theory_type": ${allowedTheoryTypes},

      "narrative": string (3-6 sentences, every concrete claim cites [DOC N]),
      "supporting_evidence": string[],
      "contradicting_evidence": string[],
      "missing_evidence": string[],
      "confidence": number (0-1),
      "risk": string,
      "key_assumptions": string[],
      "citations": [ { "doc_n": number, "quote": string (verbatim, <=200 chars) } ]
    }
  ]
}

CASE CORPUS:
${ctx.corpus}

ANALYSIS:
${JSON.stringify(ctx.analysis).slice(0, 40000)}

KNOWN FINDINGS:
${JSON.stringify(ctx.findingsLite).slice(0, 20000)}`,
    json: true,
    temperature: 0.3,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "theory",
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
  const parsed = parseJsonLoose<{ theories?: Array<Theory & { citations?: any[] }> }>(r.text) ?? {};
  const rawTheories = (parsed.theories ?? []).filter((t) => {
    // Drop prosecution theories from civil matters and any theory whose text
    // contains criminal-only vocabulary in a civil case.
    if (civil && String(t.theory_type ?? "").toLowerCase() === "prosecution") return false;
    return textMatchesCaseType(`${t.theory_type ?? ""} ${t.narrative ?? ""}`, caseType);
  });

  // Gate every theory through the evidence validator. Strict mode requires
  // verbatim corpus support; rejected theories are simply not persisted.
  const gateInput = rawTheories.map((t) => ({
    title: `${t.theory_type ?? "theory"} theory`,
    description: t.narrative ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    citations: (t.citations as any) ?? [],
    confidence: typeof t.confidence === "number" ? t.confidence : 0.5,
  }));
  const { items: gated, audit } = applyEvidenceGate(gateInput, { mode, corpus: groundCorpus });
  // Map gated items back to the originals by description equality (order-preserving).
  const keptTheories: typeof rawTheories = [];
  let gi = 0;
  for (const t of rawTheories) {
    const g = gated[gi];
    if (g && g.description === (t.narrative ?? "")) {
      keptTheories.push(t);
      gi += 1;
    }
  }

  await db.from("case_theories").delete().eq("case_id", caseId);
  if (keptTheories.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from("case_theories").insert(
      keptTheories.map((t, idx) => ({
        case_id: caseId,
        user_id: userId,
        theory_type: t.theory_type,
        narrative: t.narrative ?? "",
        supporting_evidence: (t.supporting_evidence ?? []) as J,
        contradicting_evidence: (t.contradicting_evidence ?? []) as J,
        missing_evidence: (t.missing_evidence ?? []) as J,
        confidence: typeof t.confidence === "number" ? t.confidence : 0.5,
        risk: t.risk ?? null,
        key_assumptions: (t.key_assumptions ?? []) as J,
        finding_type: gated[idx]?.finding_type ?? "DIRECT_EVIDENCE",
        citations: (gated[idx]?.citations ?? []) as J,
      })) as any,
    );
  }

  await clearFindingsByModule(db, caseId, "engine:theory");
  await addFindings(
    db,
    keptTheories.map((t, idx) => ({
      case_id: caseId,
      user_id: userId,
      source_module: `engine:theory:${t.theory_type}`,
      category: "theory",
      title: `${String(t.theory_type ?? "theory").toUpperCase()} theory of the case`,
      description: t.narrative ?? "",
      severity: "info" as const,
      confidence: typeof t.confidence === "number" ? t.confidence : 0.5,
      legal_significance: `Competing case theory (${t.theory_type})`,
      potential_impact: t.risk ?? null,
      affected_party:
        t.theory_type === "defense"
          ? "defense"
          : String(t.theory_type) === "prosecution" || String(t.theory_type) === "plaintiff"
            ? "prosecution"
            : "both",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({
        finding_type: gated[idx]?.finding_type,
        source_document_id: gated[idx]?.source_document_id,
        source_doc_ids: gatedSourceDocIds(gated[idx]),
        source_quote: gated[idx]?.source_quote,
        source_page: gated[idx]?.source_page,
      } as any),
      metadata: { theory: t as unknown as Record<string, unknown>, gate_audit: audit },
    })),
  );

  await setCase(db, caseId, { theories_at: new Date().toISOString() });
  return { theories: keptTheories, audit };
}

// =========================================================================
// DEFENSE OPPORTUNITY + PROSECUTION RECOVERY ENGINE
// =========================================================================
export async function runOpportunityEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, { status_message: "Identifying defense opportunities", progress: 50 });

  const ctx = await buildContext(db, caseId);
  if (!ctx.corpus) throw new Error("No extracted documents.");

  const { diagnoseEvidenceGate, getAnalysisMode, filterByCaseType, isCivilCaseType } =
    await import("./evidence-gate.server");
  const { buildGroundingCorpus } = await import("./grounding.server");
  const { resolveCaseType } = await import("../pipeline.server");
  const caseType = await resolveCaseType(db, caseId, ctx.corpus.slice(0, 4000));
  const mode = await getAnalysisMode(db, caseId);
  const civil = isCivilCaseType(caseType);

  const { data: docsForGround } = await db
    .from("documents")
    .select("id,filename,extracted_text,status")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const groundCorpus = buildGroundingCorpus(
    (docsForGround ?? [])
      .filter((d) => d.status === "extracted")
      .map((d) => ({ id: d.id as string, filename: d.filename, extracted_text: d.extracted_text })),
  );

  const allowedCategories = civil
    ? "discovery, witness_attack, timeline_attack, evidence_attack, credibility_attack, damages, liability, comparative_fault, settlement_leverage"
    : "suppression, discovery, witness_attack, timeline_attack, evidence_attack, credibility_attack, constitutional";
  const caseFrame = civil
    ? `This is a CIVIL matter (case_type=${caseType}). Use civil terminology only — liability, comparative fault, damages, settlement, credibility, discovery, insurance exposure. NEVER use criminal terms (conviction, acquittal, Miranda, Brady, suppression, search and seizure, reasonable doubt, prosecution strategy).`
    : `This is a CRIMINAL matter (case_type=${caseType}). Criminal terminology is appropriate.`;

  const r = await callGroq({
    apiKey,
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) + "\n\n" +
      "You are a dual-perspective trial strategist. Every opportunity MUST cite at least one structured evidence citation with a verbatim quote copied from the corpus. " +
      "If you cannot back an opportunity with a corpus quote, omit it — an empty array is a valid response. " +
      'Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ' +
      "Output STRICT JSON only.",
    userContent: `${caseFrame}

Identify opportunities ONLY in these categories: ${allowedCategories}.
Each opportunity MUST include a "citations" array with at least one structured citation copied from the corpus. Do not use alternate keys like support/evidence without citations.

Return STRICT JSON:
{
  "opportunities": [
    {
      "side": "${civil ? "plaintiff" : "defense"}",
      "opportunity_type": string (from allowed categories),
      "title": string,
      "description": string,
      "recommended_motions": string[],
      "recommended_questions": string[],
      "recommended_investigations": string[],
      "counter_response": string,
      "severity": "low"|"medium"|"high"|"critical",
      "confidence": number (0-1),
      "citations": [ { "doc_n": number, "document": string (filename), "page": number|null, "quote": string (verbatim, <=200 chars) } ]
    }
  ]
}

CASE CORPUS:
${ctx.corpus}

ANALYSIS:
${JSON.stringify(ctx.analysis).slice(0, 20000)}

KNOWN FINDINGS:
${JSON.stringify(ctx.findingsLite).slice(0, 15000)}`,
    json: true,
    temperature: 0.25,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "opportunity",
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
  const parsed =
    parseJsonLoose<{
      opportunities?: Array<
        Opportunity & { citations?: any[]; citation?: any; evidence?: any; support?: any; supporting_evidence?: any }
      >;
    }>(r.text) ?? {};
  const rawOpps = parsed.opportunities ?? [];
  console.info(
    `[engine:opportunity] case=${caseId} llm_raw=${rawOpps.length} llm_text_chars=${r.text?.length ?? 0} llm_preview=${JSON.stringify((r.text ?? "").slice(0, 240))}`,
  );

  // 1) Drop opportunities that conflict with the locked case type.
  const typeFiltered = filterByCaseType(rawOpps, caseType);

  // 2) Evidence-gate every opportunity. Strict mode requires verbatim corpus support.
  const gateInput = typeFiltered.map((o) => ({
    title: o.title ?? "Opportunity",
    description: o.description ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    citations: (o.citations as any) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    citation: (o as any).citation,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evidence: (o as any).evidence,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    support: (o as any).support,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supporting_evidence: (o as any).supporting_evidence,
    confidence: typeof o.confidence === "number" ? o.confidence : 0.6,
  }));
  const { accepted: gatedAccepted, audit } = diagnoseEvidenceGate(gateInput, { mode, corpus: groundCorpus });
  const kept = gatedAccepted.map((g) => typeFiltered[g.index]).filter(Boolean) as typeof typeFiltered;
  const gated = gatedAccepted.map((g) => g.gated);
  const acceptedIndexes = new Set(gatedAccepted.map((g) => g.index));
  const rejectedForReview = audit.rejections
    .map((rej) => ({ rej, original: typeFiltered[rej.index] }))
    .filter(
      (x): x is { rej: (typeof audit.rejections)[number]; original: (typeof typeFiltered)[number] } => !!x.original,
    );
  console.info(
    `[engine:opportunity] case=${caseId} llm=${rawOpps.length} type_filtered=${typeFiltered.length} after_gate=${gated.length} kept=${kept.length} corpus_chars=${groundCorpus.text?.length ?? 0} rejections=${JSON.stringify(audit.rejections.slice(0, 12))}`,
  );

  // LLM legitimately returned no opportunities → no-op success, preserve prior.
  if (rawOpps.length === 0) {
    await setCase(db, caseId, { opportunities_at: new Date().toISOString() });
    return {
      opportunities: [],
      potential_opportunities: [],
      audit: { ...audit, kept: 0, rejected: 0, rejections: [] as unknown[] },
    };
  }
  // LLM produced items but evidence rejected them: keep them visible as
  // attorney-review-only, never as verified opportunities.
  await db.from("case_opportunities").delete().eq("case_id", caseId);
  if (kept.length || rejectedForReview.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from("case_opportunities").insert([
      ...kept.map((o, idx) => ({
        case_id: caseId,
        user_id: userId,
        side: o.side ?? (civil ? "plaintiff" : "defense"),
        opportunity_type: o.opportunity_type ?? "general",
        title: o.title ?? "Opportunity",
        description: o.description ?? "",
        recommended_motions: (o.recommended_motions ?? []) as J,
        recommended_questions: (o.recommended_questions ?? []) as J,
        recommended_investigations: (o.recommended_investigations ?? []) as J,
        counter_response: o.counter_response ?? null,
        severity: o.severity ?? "medium",
        confidence: typeof o.confidence === "number" ? o.confidence : 0.6,
        finding_type: gated[idx]?.finding_type,
        citations: (gated[idx]?.citations ?? []) as J,
      })),
      ...rejectedForReview.map(({ original: o, rej }) => ({
        case_id: caseId,
        user_id: userId,
        side: o.side ?? (civil ? "plaintiff" : "defense"),
        opportunity_type: `requires_attorney_review:${o.opportunity_type ?? "general"}`,
        title: `Potential Opportunity (Requires Attorney Review): ${o.title ?? "Opportunity"}`,
        description: `${o.description ?? "The AI identified a possible opportunity, but evidence verification did not fully pass."}\n\nVerification issue: ${rej.detail}`,
        recommended_motions: (o.recommended_motions ?? []) as J,
        recommended_questions: (o.recommended_questions ?? []) as J,
        recommended_investigations: (o.recommended_investigations ?? []) as J,
        counter_response: `Attorney review required — ${rej.reason}`,
        severity: o.severity ?? "medium",
        confidence: typeof o.confidence === "number" ? o.confidence : 0.6,
        finding_type: "AI_THEORY",
        citations: [] as unknown as J,
      })),
    ] as any);
  }

  await clearFindingsByModule(db, caseId, "engine:opportunity");
  await addFindings(
    db,
    kept.map((o, idx) => ({
      case_id: caseId,
      user_id: userId,
      source_module: `engine:opportunity:${o.opportunity_type}`,
      category: "opportunity",
      title: o.title ?? "Opportunity",
      description: o.description ?? "",
      severity: o.severity,
      confidence: typeof o.confidence === "number" ? o.confidence : 0.6,
      legal_significance: `${civil ? "Plaintiff/defense" : "Defense"} opportunity (${o.opportunity_type})`,
      potential_impact: o.counter_response ? `Opposing response: ${o.counter_response}` : null,
      affected_party: (civil ? "plaintiff" : "defense") as "defense" | "plaintiff",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({
        finding_type: gated[idx]?.finding_type,
        source_document_id: gated[idx]?.source_document_id,
        source_doc_ids: gatedSourceDocIds(gated[idx]),
        source_quote: gated[idx]?.source_quote,
        source_page: gated[idx]?.source_page,
      } as any),
      metadata: {
        opportunity: o as unknown as Record<string, unknown>,
        gate_audit: audit,
        verification_status: "verified",
        gate_index: gatedAccepted[idx]?.index,
      },
    })),
  );

  await setCase(db, caseId, { opportunities_at: new Date().toISOString() });
  return {
    opportunities: kept,
    potential_opportunities: rejectedForReview.map((x) => x.original),
    audit: {
      ...audit,
      kept: kept.length,
      rejected: Math.max(0, typeFiltered.length - kept.length),
      accepted_indexes: [...acceptedIndexes],
    },
  };
}

// =========================================================================
// DISCOVERY GAP ENGINE
// =========================================================================
export async function runDiscoveryGapEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, { status_message: "Auditing discovery", progress: 60 });

  const ctx = await buildContext(db, caseId);
  if (!ctx.corpus) throw new Error("No extracted documents.");

  const r = await callGroq({
    apiKey,
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) + "\n\n" +
      "You audit criminal/civil case discovery. Identify evidence categories that SHOULD exist for this case type but appear absent. Flag potential Brady/disclosure failures. " +
      'Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ' +
      "Output STRICT JSON only.",
    userContent: `Return STRICT JSON:
{
  "expected_evidence": string[],
  "received_evidence": string[],
  "missing_evidence": [ { "item": string, "why_critical": string, "severity": "low"|"medium"|"high"|"critical", "brady_risk": boolean, "potential_motion": string|null } ],
  "discovery_violations": [ { "violation": string, "rule": string, "severity": "low"|"medium"|"high"|"critical" } ]
}

CASE CORPUS:
${ctx.corpus}`,
    json: true,
    temperature: 0.2,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "discovery_gap",
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
  const missing = Array.isArray(parsed.missing_evidence) ? parsed.missing_evidence : [];
  const violations = Array.isArray(parsed.discovery_violations) ? parsed.discovery_violations : [];

  // Case-type aware: Brady is criminal-only. Strip Brady fields/tags for civil.
  const { getLockedCaseType, isCivilCaseType, evidenceDependenciesSatisfied, stripBradyForCivil } =
    await import("./evidence-gate.server");
  const caseType = await getLockedCaseType(db, caseId);
  const civil = isCivilCaseType(caseType);
  const corpusFlat = ctx.corpus;

  await clearFindingsByModule(db, caseId, "engine:discovery");
  const missingRows = missing
    // Drop missing items whose category is fundamentally about evidence we
    // can't even confirm should exist — we still display "not found in
    // uploaded documents" for the actual document categories the corpus
    // already discusses; reject ones the corpus never mentions.
    .map(
      (m: {
        item?: unknown;
        why_critical?: unknown;
        severity?: unknown;
        brady_risk?: unknown;
        potential_motion?: unknown;
      }) => {
        const bradyRisk = !!m.brady_risk && !civil;
        return {
          case_id: caseId,
          user_id: userId,
          source_module: "engine:discovery:missing",
          category: "discovery_gap",
          title: `${String(m.item ?? "Item")} Not Found In Uploaded Documents`,
          description: (m.why_critical as string) ?? "",
          severity: (m.severity as "low" | "medium" | "high" | "critical") ?? "medium",
          confidence: 0.7,
          legal_significance: bradyRisk ? "Potential Brady disclosure failure" : "Discovery gap",
          potential_impact: (m.potential_motion as string) ?? null,
          affected_party: "defense" as const,
          tags: bradyRisk ? ["brady"] : [],
          metadata: { missing: m },
        };
      },
    );
  const violationRows = violations.map((v: { violation?: unknown; rule?: unknown; severity?: unknown }) => ({
    case_id: caseId,
    user_id: userId,
    source_module: "engine:discovery:violation",
    category: "procedural",
    title: `Discovery violation: ${(v.violation as string) ?? "unspecified"}`,
    description: (v.rule as string) ?? "",
    severity: (v.severity as "low" | "medium" | "high" | "critical") ?? "high",
    confidence: 0.7,
    legal_significance: "Discovery rule violation",
    potential_impact: "May support motion to compel or sanctions",
    affected_party: "defense" as const,
    tags: [] as string[],
    metadata: { violation: v },
  }));
  // Reject items whose underlying evidence categories aren't represented in
  // the corpus at all (mention ≠ existence) — and strip Brady for civil.
  const all = [...missingRows, ...violationRows]
    .filter((r) => evidenceDependenciesSatisfied(`${r.title} ${r.description}`, corpusFlat).ok)
    .map((r) => stripBradyForCivil(r, caseType))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  // Discovery-gap findings surface ABSENCE — they cannot carry a verbatim
  // corpus quote by design. Route through the evidence gate for mode-aware
  // annotation + audit, with exemptCitation=true so they are not dropped.
  const gate = await addGatedFindings(db, caseId, all, { exemptCitation: true });
  // Stage completion contract: record persistence event so the UI can mark
  // the engine complete even when strict gating legitimately yields zero rows.
  await setCase(db, caseId, { discovery_at: new Date().toISOString() });
  return {
    ...parsed,
    findings_gate: gate.audit,
    findings_gate_mode: gate.mode,
    findings_gate_corpus: gate.corpus,
  };
}

// =========================================================================
// WITNESS INTELLIGENCE ENGINE
// =========================================================================
// Weights for the deterministic credibility_risk composite below. Each
// component contributes its "risk direction" — e.g. low reliability raises
// risk, so it's (100 - reliability), not reliability itself. Weights are a
// starting hypothesis (documented as such), not a calibrated model — see
// the TODO in computeCredibilityRisk.
const CREDIBILITY_RISK_WEIGHTS = {
  reliability: 0.3,
  bias: 0.25,
  consistency: 0.2,
  corroboration: 0.15,
  observationOpportunity: 0.1,
} as const;

/**
 * Computes credibility_risk deterministically from the other 5 witness
 * scores instead of trusting the LLM's own independent guess for it.
 * Previously credibility_risk was requested as a 6th, unrelated number with
 * no rationale field and nothing checking it against the other 5 — a model
 * could say reliability=90, bias=10, corroboration=90 (all low-risk
 * signals) yet still return credibility_risk=80, and nothing would catch or
 * explain the contradiction. This makes the composite fully auditable: it's
 * always traceable to its 5 inputs and their fixed, documented weights.
 *
 * TODO(calibration): CREDIBILITY_RISK_WEIGHTS above is a reasonable starting
 * hypothesis (reliability and bias weighted heaviest), not something
 * derived from real case outcomes. Once an outcomes-tracking table exists
 * (see the TODO in report-quality-gate.ts / sufficiency.server.ts), these
 * weights should be re-derived from it rather than left as hand-picked
 * constants indefinitely.
 */
function computeCredibilityRisk(w: {
  reliability?: number | null;
  bias?: number | null;
  consistency?: number | null;
  corroboration?: number | null;
  observation_opportunity?: number | null;
}): { risk: number; breakdown: string } {
  const reliability = clamp0to100(w.reliability);
  const bias = clamp0to100(w.bias);
  const consistency = clamp0to100(w.consistency);
  const corroboration = clamp0to100(w.corroboration);
  const observationOpportunity = clamp0to100(w.observation_opportunity);

  const contributions = {
    reliability: (100 - reliability) * CREDIBILITY_RISK_WEIGHTS.reliability,
    bias: bias * CREDIBILITY_RISK_WEIGHTS.bias,
    consistency: (100 - consistency) * CREDIBILITY_RISK_WEIGHTS.consistency,
    corroboration: (100 - corroboration) * CREDIBILITY_RISK_WEIGHTS.corroboration,
    observationOpportunity: (100 - observationOpportunity) * CREDIBILITY_RISK_WEIGHTS.observationOpportunity,
  };
  const risk = Math.round(
    contributions.reliability +
      contributions.bias +
      contributions.consistency +
      contributions.corroboration +
      contributions.observationOpportunity,
  );

  // Name the top 1-2 drivers so the composite reads as an explanation, not
  // just a number — this is what closes the "opaque score" gap.
  const ranked = Object.entries(contributions).sort((a, b) => b[1] - a[1]);
  const topDrivers = ranked
    .slice(0, 2)
    .filter(([, v]) => v > 5)
    .map(([k]) => k.replace(/([A-Z])/g, " $1").toLowerCase())
    .join(" and ");
  const breakdown = topDrivers
    ? `Computed from reliability=${reliability}, bias=${bias}, consistency=${consistency}, corroboration=${corroboration}, observation_opportunity=${observationOpportunity} (weights: reliability 30%, bias 25%, consistency 20%, corroboration 15%, observation opportunity 10%). Largest driver(s): ${topDrivers}.`
    : `Computed from reliability=${reliability}, bias=${bias}, consistency=${consistency}, corroboration=${corroboration}, observation_opportunity=${observationOpportunity} (weights: reliability 30%, bias 25%, consistency 20%, corroboration 15%, observation opportunity 10%). No single dimension dominates.`;

  return { risk: Math.max(0, Math.min(100, risk)), breakdown };
}

function clamp0to100(n: number | null | undefined): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 50; // neutral default when the model omits a score
  return Math.max(0, Math.min(100, n));
}

export async function runWitnessEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, { status_message: "Profiling witnesses", progress: 70 });

  const ctx = await buildContext(db, caseId);
  if (!ctx.corpus) throw new Error("No extracted documents.");

  const r = await callGroq({
    apiKey,
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) + "\n\n" +
      "You profile every witness in a case. ONLY include witnesses whose names appear verbatim in the corpus. " +
      "For each, score reliability, bias, consistency, corroboration, opportunity to observe, and credibility risk. " +
      "Every witness MUST include at least one verbatim quote (from the corpus) showing their testimony. " +
      'Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ' +
      "Output STRICT JSON only.",
    userContent: `Return STRICT JSON:
{
  "witnesses": [
    {
      "name": string,
      "role": string,
      "reliability": number (0-100),
      "bias": number (0-100, higher = more biased),
      "consistency": number (0-100),
      "corroboration": number (0-100),
      "observation_opportunity": number (0-100),
      "credibility_risk": number (0-100, higher = more risk, YOUR overall estimate — this will be cross-checked against a deterministic score computed from the other 5 numbers, so make it consistent with them rather than a separate impression),
      "cross_exam_questions": string[],
      "impeachment_questions": string[],
      "follow_up_questions": string[],
      "rationale": { "reliability": string, "bias": string, "consistency": string, "corroboration": string, "observation_opportunity": string, "credibility_risk": string },
      "citations": [ { "doc_n": number, "quote": string (verbatim from corpus) } ]
    }
  ]
}

CASE CORPUS:
${ctx.corpus}`,
    json: true,
    temperature: 0.2,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "witness",
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
  const parsed = parseJsonLoose<{ witnesses?: Array<WitnessProfile & { citations?: any[] }> }>(r.text) ?? {};
  const rawWitnesses = parsed.witnesses ?? [];
  console.info(
    `[engine:witness] case=${caseId} llm_raw=${rawWitnesses.length} llm_text_chars=${r.text?.length ?? 0} llm_preview=${JSON.stringify((r.text ?? "").slice(0, 240))}`,
  );

  // Validate: name must appear in extracted entities AND at least one
  // citation quote must be verifiable in the corpus.
  const { buildEntityIndex, witnessNameFound, applyEvidenceGate, getAnalysisMode } =
    await import("./evidence-gate.server");
  const { names, corpus: groundCorpus } = await buildEntityIndex(db, caseId);
  const mode = await getAnalysisMode(db, caseId);
  console.info(
    `[engine:witness] case=${caseId} entity_index_size=${names.size} corpus_chars=${groundCorpus.text?.length ?? 0} mode=${mode}`,
  );

  const validWitnesses = rawWitnesses.filter((w) => witnessNameFound(w.name ?? "", names));
  const witnessRejections = rawWitnesses.length - validWitnesses.length;
  const rejectedNames = rawWitnesses.filter((w) => !witnessNameFound(w.name ?? "", names)).map((w) => w.name ?? "");
  if (witnessRejections > 0) {
    console.info(
      `[engine:witness] case=${caseId} rejected_not_in_entities=${witnessRejections} rejected_names=${JSON.stringify(rejectedNames.slice(0, 10))}`,
    );
  }

  const witnessGateInput = validWitnesses.map((w) => ({
    title: w.name ?? "Unknown",
    description: w.role ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    citations: (w.citations as any) ?? [],
    confidence: 0.7,
  }));
  const { items: gated } = applyEvidenceGate(witnessGateInput, { mode, corpus: groundCorpus });
  // Preserve order — keep originals that survived gating.
  const witnesses: typeof validWitnesses = [];
  let gi = 0;
  for (const w of validWitnesses) {
    const g = gated[gi];
    if (g && g.title === (w.name ?? "Unknown")) {
      witnesses.push(w);
      gi += 1;
    }
  }
  console.info(
    `[engine:witness] case=${caseId} llm=${rawWitnesses.length} valid_names=${validWitnesses.length} after_gate=${witnesses.length} rejected_unverified=${validWitnesses.length - witnesses.length}`,
  );

  // If the LLM legitimately returned zero witness candidates, treat the run
  // as a successful no-op (many cases — e.g. Civil filings — genuinely have
  // no testifying witnesses to profile). Preserve any prior rows untouched.
  if (rawWitnesses.length === 0) {
    await setCase(db, caseId, { witnesses_at: new Date().toISOString() });
    return { witnesses: [], audit: { input: 0, rejected_not_in_entities: 0, rejected_unverified: 0, accepted: 0 } };
  }
  // LLM produced candidates but strict validation rejected every one. That is
  // a report warning, not a report blocker: mark the stage complete as a no-op
  // and preserve prior rows so General Civil cases with no verifiable
  // testifying witnesses can still generate the final report.
  if (witnesses.length === 0) {
    await setCase(db, caseId, { witnesses_at: new Date().toISOString() });
    return {
      witnesses: [],
      audit: {
        input: rawWitnesses.length,
        rejected_not_in_entities: witnessRejections,
        rejected_unverified: validWitnesses.length - witnesses.length,
        accepted: 0,
        warning: "No verified witness profiles; prior witness profiles preserved.",
      },
    };
  }
  await db.from("case_witnesses").delete().eq("case_id", caseId);
  // Deterministic, ROLE-AWARE credibility_risk per witness — computed once
  // here so both the DB row and the finding below use the same canonical,
  // auditable number instead of the LLM's independent guess. The Mexican
  // procedural role (perito, policía primer respondiente, autoridad
  // responsable, víctima, MP, patrón…) sets the dimension weights and the
  // structural bias floor the law itself presumes — see mx-witness-roles.ts.
  const witnessLocale = await getReportLocale(db, caseId);
  const computedRisk = witnesses.map((w) =>
    computeRoleAwareCredibility({ ...w, locale: witnessLocale === "en" ? "en" : "es" }),
  );
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from("case_witnesses").insert(
      witnesses.map((w, i) => ({
        case_id: caseId,
        user_id: userId,
        name: w.name ?? "Unknown",
        role: w.role ?? null,
        reliability: w.reliability ?? null,
        bias: w.bias ?? null,
        consistency: w.consistency ?? null,
        corroboration: w.corroboration ?? null,
        observation_opportunity: w.observation_opportunity ?? null,
        // Canonical value is now the deterministic composite, not the raw
        // LLM guess — see computeCredibilityRisk above.
        credibility_risk: computedRisk[i].risk,
        cross_exam_questions: (w.cross_exam_questions ?? []) as J,
        impeachment_questions: (w.impeachment_questions ?? []) as J,
        follow_up_questions: (w.follow_up_questions ?? []) as J,
        rationale: {
          ...((w.rationale ?? {}) as object),
          // The model's own credibility_risk guess is preserved here (not
          // silently discarded) so a large gap between it and the computed
          // value is itself visible to anyone auditing the row — it's a
          // useful signal, just no longer the number that drives severity.
          llm_credibility_risk_estimate: w.credibility_risk ?? null,
          credibility_risk_computed: computedRisk[i].breakdown,
          // Mexican procedural role resolved deterministically from the
          // engine's free-text role, with the authority that governs how the
          // declaration is valued and the structural bias the law presumes.
          mx_role: computedRisk[i].profile.role,
          mx_role_label_es: computedRisk[i].profile.label_es,
          mx_role_label_en: computedRisk[i].profile.label_en,
          mx_role_authority: computedRisk[i].profile.authority,
          mx_role_bias_note: computedRisk[i].profile.bias_note_es,
          mx_role_scrutiny: computedRisk[i].profile.scrutiny_es,
          mx_bias_applied: computedRisk[i].bias_applied,
        } as J,
        finding_type: gated[i]?.finding_type ?? "DIRECT_EVIDENCE",
        citations: (gated[i]?.citations ?? []) as J,
      })) as any,
    );
  }

  await clearFindingsByModule(db, caseId, "engine:witness");
  await addFindings(
    db,
    witnesses.map((w, i) => {
      const risk = computedRisk[i].risk;
      const sev = risk >= 75 ? "high" : risk >= 50 ? "medium" : "low";
      return {
        case_id: caseId,
        user_id: userId,
        source_module: `engine:witness`,
        category: "witness",
        title: `Witness profile: ${w.name}${w.role ? ` (${w.role})` : ""}`,
        description: `Reliability ${w.reliability ?? "?"}/100 · Bias ${w.bias ?? "?"} · Credibility risk ${risk}/100 (computed)`,
        severity: sev as "high" | "medium" | "low",
        confidence: 0.7,
        legal_significance: risk >= 50 ? "Witness credibility may be challenged on cross" : "Witness appears credible",
        potential_impact: null,
        affected_party: "both" as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({
          finding_type: gated[i]?.finding_type,
          source_document_id: gated[i]?.source_document_id,
          source_doc_ids: gatedSourceDocIds(gated[i]),
          source_quote: gated[i]?.source_quote,
          source_page: gated[i]?.source_page,
        } as any),
        metadata: { witness: w as unknown as Record<string, unknown> },
      };
    }),
  );

  await setCase(db, caseId, { witnesses_at: new Date().toISOString() });
  return {
    witnesses,
    audit: {
      input: rawWitnesses.length,
      rejected_not_in_entities: witnessRejections,
      rejected_unverified: validWitnesses.length - witnesses.length,
      accepted: witnesses.length,
    },
  };
}

// =========================================================================
// TRIAL PREPARATION + JURY SIMULATION ENGINE
// =========================================================================
export async function runTrialPrepEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, { status_message: "Generando preparación para audiencia/juicio oral", progress: 80 });

  const ctx = await buildContext(db, caseId);
  if (!ctx.corpus) throw new Error("No extracted documents.");

  const { resolveCaseType } = await import("../pipeline.server");
  const { getActiveDomains, isCriminalEffective } = await import("./cross-domain.server");
  const caseType = await resolveCaseType(db, caseId, ctx.corpus.slice(0, 4000));
  const activeDomains = await getActiveDomains(db, caseId);
  const isCriminal = isCriminalEffective(caseType, activeDomains);

  // MEXICO (sistema penal acusatorio, CNPP): there is NO jury in ordinary
  // criminal proceedings — guilt is decided by a Tribunal de Enjuiciamiento
  // (bench). So the criminal branch estimates the real procedural outcomes:
  // vinculación a proceso, sentencia condenatoria/absolutoria, procedimiento
  // abreviado / acuerdo reparatorio, and success on recursos.
  const juryMetricsSchema = isCriminal
    ? `  "vinculacion_proceso_pct": number (0-100),
  "sentencia_condenatoria_pct": number (0-100),
  "sentencia_absolutoria_pct": number (0-100),
  "procedimiento_abreviado_pct": number (0-100),
  "recurso_exito_pct": number (0-100),`
    : `  "plaintiff_success_pct": number (0-100),
  "defense_success_pct": number (0-100),
  "settlement_probability_pct": number (0-100),
  "comparative_fault_estimate_pct": number (0-100),`;

  const caseFrame = isCriminal
    ? `Este es un asunto PENAL mexicano (case_type=${caseType}), regido por el CNPP y el sistema penal acusatorio.
PROHIBIDO ABSOLUTAMENTE: jurado, jury, "jury selection", "voir dire", simulación de jurado, "conviction by jury", plea bargain, indictment, prosecutor, felony, misdemeanor, discovery.
La culpabilidad la determina un Tribunal de Enjuiciamiento (juzgamiento colegiado/unitario), no un jurado.
Usa exclusivamente métricas y terminología del proceso penal acusatorio:
- vinculacion_proceso_pct: probabilidad de auto de vinculación a proceso (art. 316 CNPP) con los datos de prueba actuales.
- sentencia_condenatoria_pct / sentencia_absolutoria_pct: probabilidad de sentencia condenatoria o absolutoria ante el Tribunal de Enjuiciamiento (deben sumar aproximadamente 100).
- procedimiento_abreviado_pct: probabilidad de que el asunto se resuelva por procedimiento abreviado, acuerdo reparatorio o suspensión condicional.
- recurso_exito_pct: probabilidad de éxito en apelación o amparo directo.
El campo "jury_concerns" se reinterpreta como riesgos de percepción ante el juez de control y el Tribunal de Enjuiciamiento (NO menciones jurado). Las "likely_objections" son objeciones en audiencia oral conforme al CNPP.`
    : `Este es un asunto CIVIL/no penal (case_type=${caseType}) en jurisdicción mexicana. NUNCA produzcas probabilidades de condena, absolución ni veredicto penal, y nunca menciones jurado. Usa solo métricas civiles y terminología mexicana (responsabilidad, daños y perjuicios, daño moral, culpa concurrente, convenio, valoración probatoria, audiencia).`;

  const r = await callGroq({
    apiKey,
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) + "\n\n" +
      (isCriminal
        ? "Eres un litigante penal mexicano de alto nivel (defensa/asesoría jurídica) experto en el sistema penal acusatorio y el CNPP. Produce teoría del caso, orden de testigos, orden de prueba material, objeciones probables en audiencia, riesgos/fortalezas y una estimación de resultados ante el juez de control y el Tribunal de Enjuiciamiento. Jamás menciones jurado ni instituciones del common law. "
        : "Eres un litigante mexicano de alto nivel. Produce ejes de alegatos, orden de testigos, orden de pruebas, objeciones probables en audiencia, riesgos/fortalezas y una estimación de resultados apropiada a la materia. Jamás menciones jurado. ") +
      'Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". ' +
      "Output STRICT JSON only.",
    userContent: `${caseFrame}

Return STRICT JSON:
{
  "opening_themes": string[],
  "closing_themes": string[],
  "witness_order": [ { "name": string, "reason": string } ],
  "exhibit_order": [ { "exhibit": string, "reason": string } ],
  "likely_objections": [ { "objection": string, "counter": string } ],
  "trial_risks": string[],
  "trial_strengths": string[],
  "jury_concerns": string[],
${juryMetricsSchema}
  "most_persuasive_evidence": string[],
  "most_damaging_evidence": string[]
}

  "most_persuasive_evidence": string[],
  "most_damaging_evidence": string[]
}

CASE CORPUS:
${ctx.corpus.slice(0, 80000)}

KNOWN FINDINGS:
${JSON.stringify(ctx.findingsLite).slice(0, 15000)}`,
    json: true,
    temperature: 0.3,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "trial_prep",
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
  const p = parseJsonLoose<TrialPrep & Record<string, any>>(r.text) ?? ({} as TrialPrep);
  console.info(
    `[engine:trial_prep] case=${caseId} llm_text_chars=${r.text?.length ?? 0} opening=${(p.opening_themes ?? []).length} closing=${(p.closing_themes ?? []).length} risks=${(p.trial_risks ?? []).length} strengths=${(p.trial_strengths ?? []).length} witness_order=${(p.witness_order ?? []).length} exhibit_order=${(p.exhibit_order ?? []).length} llm_preview=${JSON.stringify((r.text ?? "").slice(0, 240))}`,
  );

  // MEXICO PENAL: the legacy columns are reused as storage slots for the
  // acusatorio outcome estimates (there is no jury, so no jury metric is ever
  // requested or written):
  //   jury_conviction_pct  -> sentencia condenatoria %
  //   jury_acquittal_pct   -> sentencia absolutoria %
  //   jury_appeal_pct      -> éxito en recurso (apelación / amparo directo) %
  //   jury_settlement_pct  -> procedimiento abreviado / salida alterna %
  // The full, explicitly named set (including vinculación a proceso) is
  // persisted in metadata as penal_metrics.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pa = p as any;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const condenatoria = isCriminal ? num(pa.sentencia_condenatoria_pct) : null;
  const absolutoria = isCriminal ? num(pa.sentencia_absolutoria_pct) : null;
  const recursoPct = isCriminal ? num(pa.recurso_exito_pct) : null;
  const vinculacion = isCriminal ? num(pa.vinculacion_proceso_pct) : null;
  const abreviado = isCriminal ? num(pa.procedimiento_abreviado_pct) : null;
  const conviction = condenatoria;
  const acquittal = absolutoria;
  const appealPct = recursoPct;
  const civilSettlement = isCriminal
    ? abreviado
    : (num(pa.settlement_probability_pct) ?? num(pa.jury_settlement_pct));

  // Preserve prior trial prep if this pass yielded an empty plan.
  const hasContent =
    (Array.isArray(p.opening_themes) && p.opening_themes.length > 0) ||
    (Array.isArray(p.closing_themes) && p.closing_themes.length > 0) ||
    (Array.isArray(p.trial_risks) && p.trial_risks.length > 0) ||
    (Array.isArray(p.trial_strengths) && p.trial_strengths.length > 0) ||
    (Array.isArray(p.witness_order) && p.witness_order.length > 0) ||
    (Array.isArray(p.exhibit_order) && p.exhibit_order.length > 0) ||
    conviction != null ||
    acquittal != null ||
    vinculacion != null ||
    civilSettlement != null;
  if (!hasContent) {
    throw new Error(
      "Trial prep engine produced no usable plan (empty themes, risks, and outcome estimates). Prior trial prep preserved.",
    );
  }


  const { error: trialPrepWriteError } = await db.from("case_trial_prep").upsert(
    {
      case_id: caseId,
      user_id: userId,
      opening_themes: (p.opening_themes ?? []) as J,
      closing_themes: (p.closing_themes ?? []) as J,
      witness_order: (p.witness_order ?? []) as J,
      exhibit_order: (p.exhibit_order ?? []) as J,
      likely_objections: (p.likely_objections ?? []) as J,
      trial_risks: (p.trial_risks ?? []) as J,
      trial_strengths: (p.trial_strengths ?? []) as J,
      jury_concerns: (p.jury_concerns ?? []) as J,
      jury_conviction_pct: conviction,
      jury_acquittal_pct: acquittal,
      jury_appeal_pct: appealPct,
      jury_settlement_pct: civilSettlement,
      most_persuasive_evidence: (p.most_persuasive_evidence ?? []) as J,
      most_damaging_evidence: (p.most_damaging_evidence ?? []) as J,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({
        case_type: caseType,
        penal_metrics: isCriminal
          ? {
              jurisdiction: "MX",
              system: "penal_acusatorio_cnpp",
              vinculacion_proceso_pct: vinculacion,
              sentencia_condenatoria_pct: condenatoria,
              sentencia_absolutoria_pct: absolutoria,
              procedimiento_abreviado_pct: abreviado,
              recurso_exito_pct: recursoPct,
              jury_applicable: false,
            }
          : null,
        civil_metrics: isCriminal
          ? null
          : {
              plaintiff_success_pct: num(pa.plaintiff_success_pct),
              defense_success_pct: num(pa.defense_success_pct),
              settlement_probability_pct: num(pa.settlement_probability_pct),
              comparative_fault_estimate_pct: num(pa.comparative_fault_estimate_pct),
            },
      } as any),

    } as any,
    { onConflict: "case_id" },
  );
  // Supabase upsert() returns { data, error } — it does NOT throw on its
  // own. Leaving this unchecked was the exact bug behind the "ran
  // successfully but produced nothing" split-brain state: the write to
  // case_trial_prep could silently fail (RLS, transient DB error, etc.)
  // while execution carried on to stamp trial_prep_at below, leaving a
  // case with a timestamp but no row. Fail loudly instead so the pipeline
  // records this as a real failure and the UI never shows a stale "ran
  // successfully" message for a write that didn't happen.
  if (trialPrepWriteError) {
    throw new Error(`case_trial_prep upsert failed: ${trialPrepWriteError.message}`);
  }

  await clearFindingsByModule(db, caseId, "engine:trial");
  const findings = normalizeLlmFindings({
    caseId,
    userId,
    sourceModule: "engine:trial:risk",
    defaultCategory: "trial_risk",
    items: (p.trial_risks ?? []).map((s) => ({ title: s, severity: "high", affected_party: "defense" })),
  }).concat(
    normalizeLlmFindings({
      caseId,
      userId,
      sourceModule: "engine:trial:strength",
      defaultCategory: "strength",
      items: (p.trial_strengths ?? []).map((s) => ({ title: s, severity: "info", affected_party: "defense" })),
    }),
  );
  // Trial risks/strengths are inferences drawn from the whole corpus and
  // don't carry per-item verbatim quotes. Route through the gate for audit
  // + mode-aware annotation; exemptCitation keeps them from being dropped.
  const gate = await addGatedFindings(db, caseId, findings, { exemptCitation: true });

  await setCase(db, caseId, { trial_prep_at: new Date().toISOString() });
  return {
    ...p,
    findings_gate: gate.audit,
    findings_gate_mode: gate.mode,
    findings_gate_corpus: gate.corpus,
  };
}

// =========================================================================
// ATTORNEY WORK PRODUCT GENERATOR
// =========================================================================
export async function runWorkProductEngine(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { db, caseId, userId, apiKey, apiKeys } = args;
  await setCase(db, caseId, { status_message: "Drafting attorney work product", progress: 90 });

  const ctx = await buildContext(db, caseId);
  if (!ctx.corpus) throw new Error("No extracted documents.");

  const { resolveCaseType, isCriminalCaseType } = await import("../pipeline.server");
  const { filterByCaseType } = await import("./evidence-gate.server");
  const { buildCorpusIndex, verifyWorkProductBody, formatUnsupportedBanner, insufficientEvidenceStub } =
    await import("./work-product-verify.server");
  const caseType = await resolveCaseType(db, caseId, ctx.corpus.slice(0, 4000));
  const isCriminal = isCriminalCaseType(caseType);
  const allowedTypes = isCriminal
    ? `"motion_to_suppress"|"motion_to_dismiss"|"discovery_request"|"cross_exam_plan"|"witness_prep"|"trial_outline"|"case_summary"`
    : `"motion_to_dismiss"|"motion_for_summary_judgment"|"discovery_request"|"cross_exam_plan"|"witness_prep"|"trial_outline"|"case_summary"|"settlement_demand"|"mediation_brief"`;
  const requiredList = isCriminal
    ? "case_summary, motion_to_suppress (if any 4A/5A issue), motion_to_dismiss (if appropriate), discovery_request, cross_exam_plan, trial_outline"
    : "case_summary, motion_for_summary_judgment (if appropriate), discovery_request, cross_exam_plan, trial_outline, settlement_demand";
  const caseFrame = isCriminal
    ? `This is a CRIMINAL matter (case_type=${caseType}). Criminal terminology is appropriate.`
    : `This is a CIVIL matter (case_type=${caseType}). NEVER produce motion_to_suppress, Miranda, Brady, search-and-seizure, or other criminal-only documents. Use civil terminology only.`;

  // Pull the raw document rows used to build the corpus index, so we can
  // ground every concrete claim in the generated drafts against verbatim
  // source text and the known filename list. Deterministic ordering.
  const docsRes = await db
    .from("documents")
    .select("filename,extracted_text,status")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const docRows = (docsRes.data ?? []).filter((d) => d.status === "extracted");
  const corpusIndex = buildCorpusIndex(docRows);
  const knownFilenames = docRows.map((d) => d.filename).filter(Boolean) as string[];
  const knownFilenamesList = knownFilenames.length
    ? knownFilenames.map((f) => `- ${f}`).join("\n")
    : "(no extracted documents)";

  const r = await callGroq({
    apiKey,
    apiKeys,
    model: MODEL,
    systemInstruction:
      mexicoLock(await getReportLocale(db, caseId)) + "\n\n" +
      'You draft attorney-ready legal work product. ABSOLUTE RULES: (1) Every concrete figure (dollar amount, percentage, date) MUST appear verbatim in the provided CASE CORPUS; if not present, say \'insufficient evidence\' instead. (2) NEVER reference a document filename that is not in the KNOWN DOCUMENTS list. (3) NEVER invent damages, settlement amounts, or fee figures. (4) Write like a senior litigation attorney: direct, confident sentences, not hedged AI prose. FORBIDDEN filler/hedge phrases: "significantly compromised", "heavily relies on", "characterized by", "overall risk", "aims to", "focuses on", "it is important to note", "plays a crucial role", "in order to". (5) Output STRICT JSON only.',
    userContent: `${caseFrame}

Return STRICT JSON:
{
  "documents": [
    {
      "document_type": ${allowedTypes},
      "title": string,
      "body_markdown": string (full draft with headings; every concrete figure/date/document reference must trace to the CASE CORPUS or KNOWN DOCUMENTS below)
    }
  ]
}
Generate at least: ${requiredList}.

KNOWN DOCUMENTS (the ONLY filenames you may reference):
${knownFilenamesList}

CASE CORPUS:
${ctx.corpus.slice(0, 80000)}

KEY FINDINGS:
${JSON.stringify(ctx.findingsLite).slice(0, 20000)}

REMINDER: if you cannot trace a concrete figure or document reference to the CASE CORPUS / KNOWN DOCUMENTS above, OMIT it and write "insufficient evidence to determine [X] from current corpus" instead. Do not invent settlement figures, damages totals, fee amounts, or document contents.`,
    json: true,
    temperature: 0.2,
  });
  await logUsage(db, {
    userId,
    caseId,
    operation: "work_product",
    model: r.model,
    provider: r.provider,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    latencyMs: r.latencyMs,
    success: true,
    keyIndex: r.keyIndex,
  });
  const parsed = parseJsonLoose<{ documents?: WorkProductDoc[] }>(r.text) ?? {};
  const typeFiltered = filterByCaseType(parsed.documents ?? [], caseType);
  const completeDocs = typeFiltered.filter(
    (d) => typeof d.body_markdown === "string" && d.body_markdown.trim().length > 0,
  );
  const emptyDocs = typeFiltered.filter(
    (d) => !(typeof d.body_markdown === "string" && d.body_markdown.trim().length > 0),
  );

  // ---- Evidence-gate the prose body of every complete draft ----
  type Verified = {
    doc: WorkProductDoc;
    status: "complete" | "unverified" | "rejected";
    body: string;
    unsupportedCount: number;
    summary: string | null;
  };
  const verified: Verified[] = completeDocs.map((d) => {
    const body = d.body_markdown ?? "";
    const unsupported = verifyWorkProductBody(body, corpusIndex);
    if (unsupported.length === 0) {
      return { doc: d, status: "complete", body, unsupportedCount: 0, summary: null };
    }
    // Density-based decision: if a draft is short and almost every concrete
    // claim is unverifiable, replace it with an explicit insufficient-evidence
    // stub. Otherwise keep the prose but prepend a prominent warning banner.
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    const dense = unsupported.length >= 4 && wordCount < 400;
    if (dense) {
      const stub = insufficientEvidenceStub(d.document_type ?? "Work Product", unsupported);
      return {
        doc: d,
        status: "rejected",
        body: stub,
        unsupportedCount: unsupported.length,
        summary: `Rejected: ${unsupported.length} unverifiable claim(s) in a thin draft`,
      };
    }
    const banner = formatUnsupportedBanner(unsupported);
    return {
      doc: d,
      status: "unverified",
      body: `${banner}\n${body}`,
      unsupportedCount: unsupported.length,
      summary: `${unsupported.length} unverifiable claim(s) flagged: ${unsupported
        .slice(0, 5)
        .map((u) => u.claim)
        .join(", ")}${unsupported.length > 5 ? "…" : ""}`,
    };
  });

  const verifiedCounts = {
    total: completeDocs.length,
    clean: verified.filter((v) => v.status === "complete").length,
    flagged: verified.filter((v) => v.status === "unverified").length,
    rejected: verified.filter((v) => v.status === "rejected").length,
    empty: emptyDocs.length,
  };
  console.info("[engine:work_product]", {
    case_id: caseId,
    case_type: caseType,
    known_filenames: knownFilenames.length,
    corpus_chars: corpusIndex.text.length,
    ...verifiedCounts,
    samples: verified
      .filter((v) => v.status !== "complete")
      .slice(0, 6)
      .map((v) => ({ document_type: v.doc.document_type, status: v.status, summary: v.summary })),
  });

  // Previously: `db.from("case_work_product").delete().eq("case_id", caseId)`
  // followed by a full reinsert — this wiped EVERY case_work_product row for
  // the case on every run, including any attorney's manual edits and any
  // document_type not even part of this run's batch. Replaced with a
  // per-document-type upsert: only the types generated in this run are
  // touched, and it requires a unique constraint on
  // (case_id, document_type) in the case_work_product table.
  //
  // MIGRATION REQUIRED BEFORE DEPLOYING THIS FILE: run
  //   ALTER TABLE case_work_product
  //     ADD CONSTRAINT case_work_product_case_doctype_key
  //     UNIQUE (case_id, document_type);
  // if that constraint doesn't already exist — otherwise Supabase will throw
  // "there is no unique or exclusion constraint matching the ON CONFLICT
  // specification" on this upsert (a loud, safe failure, not silent data
  // loss, but it does mean this won't work until the constraint is added).
  //
  // TODO(follow-up): this stops wiping OTHER document types, but a
  // document_type that IS regenerated this run will still overwrite an
  // attorney's manual edit to that same type, same as before — fully
  // closing that requires an `attorney_edited_at` (or similar) column to
  // guard against overwriting a hand-edited row, which is new schema and
  // intentionally not added here. Until then, treat batch regeneration of
  // an already-edited document_type the same as before: risky.
  const rows = [
    ...verified.map((v) => {
      const failed = v.status !== "complete";
      const errorMessage =
        v.status === "rejected"
          ? `Rejected by evidence gate (${v.unsupportedCount} unverifiable claim(s)).`
          : v.status === "unverified"
            ? `Flagged by evidence gate: ${v.summary ?? "unverifiable claims present"}.`
            : null;
      return {
        case_id: caseId,
        user_id: userId,
        document_type: v.doc.document_type,
        title: v.doc.title ?? v.doc.document_type,
        body_markdown: v.body,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({
          status: v.status,
          generation_failed: failed,
          error_message: errorMessage,
        } as any),
      };
    }),
    ...emptyDocs.map((d) => ({
      case_id: caseId,
      user_id: userId,
      document_type: d.document_type,
      title: d.title ?? d.document_type,
      body_markdown: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ status: "failed", generation_failed: true, error_message: "Generator returned an empty draft." } as any),
    })),
  ];
  if (rows.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: workProductWriteError } = await db
      .from("case_work_product")
      .upsert(rows as any, { onConflict: "case_id,document_type" });
    // Supabase upsert() does NOT throw on its own — check explicitly so a
    // failed write (e.g. the migration above not having been applied yet)
    // surfaces as a real error instead of silently vanishing.
    if (workProductWriteError) {
      throw new Error(`case_work_product upsert failed: ${workProductWriteError.message}`);
    }
  }
  await setCase(db, caseId, { work_product_at: new Date().toISOString() });
  return { documents: completeDocs, failed: emptyDocs.length, verification: verifiedCounts };
}

// =========================================================================
// MASTER INTELLIGENCE RUN — runs every engine sequentially
// =========================================================================
export async function runFullIntelligence(args: {
  db: Db;
  caseId: string;
  userId: string;
  apiKey: string;
  apiKeys?: string[];
}) {
  const { getAnalysisMode } = await import("./evidence-gate.server");
  const { engineAllowedInMode } = await import("./case-state.server");
  const { runEvidenceIntelEngine, runPerspectivesEngine, runStrategyEngine, runLitigationStrategyCenterEngine } =
    await import("./litigation.server");
  const { isAnalyzerAllowed, SKIP_REASON_NOT_APPLICABLE } = await import("./practice-areas");
  const { getActiveDomains } = await import("./cross-domain.server");
  const { recordSkipped } = await import("./engine-audit.server");
  const mode = await getAnalysisMode(args.db, args.caseId);
  // Resolve the policy ONCE per run so every engine sees the same scope.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await args.db
    .from("cases")
    .select("case_type" as any)
    .eq("id", args.caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const area = String((caseRow as any)?.case_type ?? "general_civil");
  const activeDomains = await getActiveDomains(args.db, args.caseId);

  await setCase(args.db, args.caseId, {
    status: "intelligence_running",
    status_message: `Running intelligence engines (${mode} mode)`,
    progress: 10,
  });

  // STRICT mode: extraction + validation + evidence-backed contradictions +
  // missing-evidence flags + deterministic scoring ONLY. Interpretive engines
  // (theory, opportunity, work product, trial prep) are SKIPPED — not failed.
  //
  // PRACTICE-AREA gating layers on top: engines listed in PRACTICE_GATED_ENGINES
  // (trial_prep, cross_examination, constitutional_compliance) only run when
  // the active practice policy includes them. Skips are recorded in
  // pipeline_engine_runs so the dashboard surfaces them.
  const runs: Array<{
    key: Parameters<typeof engineAllowedInMode>[0];
    label: string;
    engineId: string;
    fn: () => Promise<unknown>;
  }> = [
    {
      key: "witness",
      label: "Witness Intelligence",
      engineId: "witness_intelligence",
      fn: () => runWitnessEngine(args),
    },
    {
      key: "evidence_intel",
      label: "Evidence Intelligence",
      engineId: "evidence_intelligence",
      fn: () => runEvidenceIntelEngine(args),
    },
    {
      key: "perspectives",
      label: "Multi-Perspective Analysis",
      engineId: "perspectives",
      fn: () => runPerspectivesEngine(args),
    },
    { key: "theory", label: "Theories", engineId: "theory", fn: () => runTheoryEngine(args) },
    { key: "opportunity", label: "Case Opportunities", engineId: "opportunity", fn: () => runOpportunityEngine(args) },
    { key: "trial_prep", label: "Trial Prep", engineId: "trial_prep", fn: () => runTrialPrepEngine(args) },
    {
      key: "work_product",
      label: "Attorney Work Product",
      engineId: "work_product",
      fn: () => runWorkProductEngine(args),
    },
    { key: "strategy", label: "Strategy Synthesis", engineId: "strategy", fn: () => runStrategyEngine(args) },
    {
      key: "litigation_strategy_center",
      label: "Litigation Strategy Center",
      engineId: "litigation_strategy_center",
      fn: () => runLitigationStrategyCenterEngine(args),
    },
  ];
  const skipped: string[] = [];
  let done = 0;
  for (const r of runs) {
    if (!isAnalyzerAllowed(area, r.engineId, activeDomains)) {
      skipped.push(`${r.key}:case_type`);
      await recordSkipped(args.db, {
        caseId: args.caseId,
        userId: args.userId,
        engine: r.engineId as never,
        reason: SKIP_REASON_NOT_APPLICABLE,
      });
      console.info(`[practice-area] skipping engine "${r.engineId}" — ${SKIP_REASON_NOT_APPLICABLE} (area=${area})`);
      continue;
    }
    if (!engineAllowedInMode(r.key, mode)) {
      skipped.push(r.key);
      console.info(`[mode:${mode}] skipping engine "${r.key}" — not allowed in this mode`);
      continue;
    }
    await setCase(args.db, args.caseId, {
      status: "intelligence_running",
      status_message: `Running ${r.label}`,
      progress: 10 + Math.floor((done / runs.length) * 80),
    });
    await r.fn();
    done += 1;
  }
  await setCase(args.db, args.caseId, {
    status: "intelligence_complete",
    status_message: skipped.length
      ? `Intelligence engines complete (${mode}; skipped: ${skipped.join(", ")})`
      : "Intelligence engines complete",
    progress: 100,
  });
}
