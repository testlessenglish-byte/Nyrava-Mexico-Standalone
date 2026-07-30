// Multi-agent orchestrator (server-only).
// Implements the 13-agent blueprint as a thin coordination layer over the
// existing pipeline engines. Every agent writes a row into agent_logs with
// the common API shape: { status, confidence, processingTime, tokensUsed,
// outputFile, errors }.
//
// Release rule: the final report is only marked "released" if QA, Judge, and
// Hallucination all PASS. Anything else leaves the case in "needs_revision".

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AGENT_DEFINITIONS, type AgentResult, type AgentDefinition } from "./types";
import { attachAgentStats, buildAgentStatistics } from "./statistics.server";
import { isCheckpointError } from "@/lib/pipeline-checkpoint.server";

type Db = SupabaseClient<Database>;

type CitationCandidate = {
  source_document_id?: string | null;
  source_doc_ids?: string[] | null;
  source_quote?: string | null;
};

function hasTraceableCitation(f: CitationCandidate): boolean {
  const hasDoc =
    typeof f.source_document_id === "string" && f.source_document_id.trim().length > 0
      ? true
      : Array.isArray(f.source_doc_ids) && f.source_doc_ids.some((id) => typeof id === "string" && id.trim().length > 0);
  const hasQuote = typeof f.source_quote === "string" && f.source_quote.trim().length > 0;
  return hasDoc && hasQuote;
}

function collectReportText(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReportText(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectReportText(item, out);
  }
  return out;
}

function detectReportLanguageLeaks(text: string, locale: "es" | "en"): string[] {
  const checks: Array<[RegExp, string]> =
    locale === "es"
      ? [
          [/\bExecutive Summary\b/i, "Executive Summary"],
          [/\bEvidence\b/i, "Evidence"],
          [/\bDiscovery(?:\s+Violation)?\b/i, "Discovery"],
          [/\bWitness(?:es)?\b/i, "Witness"],
          [/\bStrategy\b/i, "Strategy"],
          [/\bTimeline\b/i, "Timeline"],
          [/\bFindings?\b/i, "Findings"],
          [/\bRecommendations?\b/i, "Recommendations"],
          [/\bcorroborating\b/i, "corroborating"],
          [/\bPlaintiff\b/i, "Plaintiff"],
          [/\bDefendant\b/i, "Defendant"],
          [/\bjury\b/i, "jury"],
        ]
      : [
          [/\bResumen ejecutivo\b/i, "Resumen ejecutivo"],
          [/\bHallazgos?\b/i, "Hallazgos"],
          [/\bCronolog[ií]a\b/i, "Cronología"],
          [/\bEstrategia\b/i, "Estrategia"],
          [/\bRecomendaciones\b/i, "Recomendaciones"],
        ];
  return checks.filter(([rx]) => rx.test(text)).map(([, label]) => label);
}

export interface OrchestratorArgs {
  db: Db;
  userId: string;
  caseId: string;
  apiKey: string;
  apiKeys: string[];
}

type AnalysisMode = "strict" | "balanced" | "exploratory";
type RunCtx = OrchestratorArgs & { runId: string; analysisMode: AnalysisMode };

async function recordAgent(db: Db, ctx: RunCtx, def: AgentDefinition, startedAt: number, result: AgentResult) {
  const finishedAt = new Date().toISOString();
  const outputObj =
    result.output && typeof result.output === "object" && !Array.isArray(result.output)
      ? (result.output as Record<string, unknown>)
      : {};
  // Every agent_logs row carries the run's analysis_mode so the ledger UI
  // and post-hoc audit can attribute results to strict/balanced/exploratory
  // without reverse-engineering it from the report.
  const outputWithMode: Record<string, unknown> = { ...outputObj, analysis_mode: ctx.analysisMode };
  const stats =
    outputObj.agent_stats && typeof outputObj.agent_stats === "object" && !Array.isArray(outputObj.agent_stats)
      ? (outputObj.agent_stats as Record<string, unknown>)
      : {};
  await db.from("agent_logs").insert({
    case_id: ctx.caseId,
    user_id: ctx.userId,
    run_id: ctx.runId,
    agent_key: def.key,
    agent_index: def.index,
    agent_name: def.name,
    status: result.status,
    confidence: result.confidence,
    processing_time_ms: Math.max(0, Date.now() - startedAt),
    tokens_used: result.tokensUsed,
    output_file: result.outputFile,
    documents_analyzed: Number(stats.documents_analyzed ?? 0),
    findings_generated: Number(stats.findings_generated ?? 0),
    findings_suppressed: Number(stats.findings_suppressed ?? 0),
    findings_promoted: Number(stats.findings_promoted ?? 0),
    findings_produced: Number(stats.findings_promoted ?? stats.visible_findings ?? 0),
    output_items: Number(stats.output_items ?? 0),
    no_output_reason: stats.no_output_reason ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output: outputWithMode as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errors: (result.errors.length ? result.errors : null) as any,
    started_at: new Date(startedAt).toISOString(),
    finished_at: finishedAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

async function safeRun(fn: () => Promise<AgentResult>, def: AgentDefinition): Promise<AgentResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return {
      ...r,
      processingTime: Date.now() - t0,
      outputFile: r.outputFile || def.outputFile,
    };
  } catch (e) {
    if (isCheckpointError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "failed",
      confidence: 0,
      processingTime: Date.now() - t0,
      tokensUsed: 0,
      outputFile: def.outputFile,
      errors: [msg],
    };
  }
}

// ----- Individual agent implementations -----

async function agentIntake(ctx: RunCtx): Promise<AgentResult> {
  const { data, error } = await ctx.db
    .from("documents")
    .select("id,filename,mime_type,size_bytes,content_hash,created_at")
    .eq("case_id", ctx.caseId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const files = data ?? [];
  const seenHash = new Set<string>();
  let duplicates = 0;
  for (const f of files) {
    const h = f.content_hash;
    if (h) {
      if (seenHash.has(h)) duplicates += 1;
      seenHash.add(h);
    }
  }
  return {
    status: files.length === 0 ? "failed" : "success",
    confidence: files.length === 0 ? 0 : 1,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "case_manifest.json",
    errors: files.length === 0 ? ["No files uploaded for this case."] : [],
    output: {
      file_count: files.length,
      duplicates,
      files: files.map((f) => ({
        evidence_id: f.id,
        name: f.filename,
        mime: f.mime_type,
        bytes: f.size_bytes,
      })),
    },
  };
}

async function hasCompletedEngine(db: Db, caseId: string, engine: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("pipeline_engine_runs")
    .select("id")
    .eq("case_id", caseId)
    .eq("engine", engine)
    .eq("status", "completed")
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function agentOcr(ctx: RunCtx): Promise<AgentResult> {
  // READ-ONLY release-gate check. This stage runs AFTER report generation
  // and its only job is to verify prior stages actually completed — it must
  // never trigger a live pipeline run itself. Silently re-running extraction
  // here (the old behavior) meant a "QA pass" on an already-published report
  // could mutate the underlying case data out from under it.
  const alreadyDone = await hasCompletedEngine(ctx.db, ctx.caseId, "extraction");
  const { count } = await ctx.db
    .from("document_pages")
    .select("id", { count: "exact", head: true })
    .eq("case_id", ctx.caseId);
  const ok = alreadyDone && (count ?? 0) > 0;
  return {
    status: ok ? "success" : "failed",
    confidence: ok ? 0.95 : 0,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "ocr_output.json",
    errors: ok ? [] : ["Extraction stage did not complete before the release gate ran; nothing to verify."],
    output: { pages_extracted: count ?? 0, extraction_completed: alreadyDone },
  };
}

async function agentEntities(ctx: RunCtx): Promise<AgentResult> {
  // READ-ONLY release-gate check — see agentOcr comment.
  const alreadyDone = await hasCompletedEngine(ctx.db, ctx.caseId, "analyzers");
  const { count: findingsCount } = await ctx.db
    .from("case_findings")
    .select("id", { count: "exact", head: true })
    .eq("case_id", ctx.caseId);
  const ok = alreadyDone && (findingsCount ?? 0) > 0;
  return {
    status: ok ? "success" : "failed",
    confidence: ok ? 0.85 : 0,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "entities.json",
    errors: ok ? [] : ["Analyzers stage did not complete before the release gate ran; nothing to verify."],
    output: { findings_count: findingsCount ?? 0, analyzers_completed: alreadyDone },
  };
}

async function agentTimeline(ctx: RunCtx): Promise<AgentResult> {
  const m = await import("@/lib/intelligence/canonical-timeline.server");
  const tl = await m.buildCanonicalTimeline(ctx.db, ctx.caseId);
  return {
    status: "success",
    confidence: tl.totals.dated > 0 ? 0.9 : 0.4,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "timeline.json",
    errors: [],
    output: JSON.parse(JSON.stringify(tl.totals)),
  };
}

async function agentEvidence(ctx: RunCtx): Promise<AgentResult> {
  const m = await import("@/lib/intelligence/evidence-map.server");
  const em = await m.buildEvidenceMap(ctx.db, ctx.caseId);
  return {
    status: "success",
    confidence: em.totals.missing_evidence === 0 ? 0.9 : 0.6,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "evidence_analysis.json",
    errors: [],
    output: JSON.parse(JSON.stringify(em.totals)),
  };
}

async function agentContradictions(ctx: RunCtx): Promise<AgentResult> {
  // Derived — Analyzers already produced grounded contradictions in one
  // batched pass. Re-running the standalone LLM engine here duplicated work
  // and burned through the 30K TPM cap on any large corpus.
  const m = await import("@/lib/intelligence/derived-engines.server");
  const out = await m.deriveContradictions(ctx.db, ctx.caseId);
  return {
    status: "success",
    confidence: 0.8,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "contradictions.json",
    errors: [],
    output: JSON.parse(JSON.stringify(out.value)),
  };
}

async function agentLegal(ctx: RunCtx): Promise<AgentResult> {
  // READ-ONLY release-gate check. Previously this UNCONDITIONALLY called
  // pipe.runAgents() on every single release-gate pass — meaning every time
  // this "QA" stage ran, it silently re-triggered a live LLM re-analysis of
  // the case (chain_of_custody / constitutional_compliance /
  // procedural_violations / witness_credibility), potentially producing
  // different findings than what the report was already generated from.
  // A release gate must only verify, never regenerate.
  const alreadyDone = await hasCompletedEngine(ctx.db, ctx.caseId, "agents");
  const { count } = await ctx.db
    .from("agent_findings")
    .select("id", { count: "exact", head: true })
    .eq("case_id", ctx.caseId);
  const ok = alreadyDone && (count ?? 0) > 0;
  return {
    status: ok ? "success" : "failed",
    confidence: ok ? 0.8 : 0,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "legal_research.json",
    errors: ok ? [] : ["Agents stage did not complete before the release gate ran; nothing to verify."],
    output: { agent_findings: count ?? 0, agents_completed: alreadyDone },
  };
}

async function agentRisk(ctx: RunCtx): Promise<AgentResult> {
  // READ-ONLY release-gate check. Previously this UNCONDITIONALLY called
  // pipe.runScoring() on every release-gate pass — silently re-scoring the
  // case after the report (which embeds the score) had already been
  // generated and shown to the user. See agentLegal comment above.
  const alreadyDone = await hasCompletedEngine(ctx.db, ctx.caseId, "scoring");
  const { data: score } = await ctx.db.from("case_scores").select("*").eq("case_id", ctx.caseId).maybeSingle();
  const ok = alreadyDone && !!score;
  return {
    status: ok ? "success" : "failed",
    confidence: ok ? 0.85 : 0,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "risk_analysis.json",
    errors: ok ? [] : ["Scoring stage did not complete before the release gate ran; nothing to verify."],
    output: ok ? JSON.parse(JSON.stringify(score)) : null,
  };
}

async function agentReport(ctx: RunCtx): Promise<AgentResult> {
  // READ-ONLY release-gate check. Previously this UNCONDITIONALLY called
  // pipe.runReport() on every release-gate pass — meaning the "QA gate"
  // could regenerate the very report it was supposed to be validating,
  // right after the user already saw it marked "complete." A release gate
  // must only check whether a report exists and is well-formed (that's
  // agentQA's job below) — it must never (re)create one.
  const alreadyDone = await hasCompletedEngine(ctx.db, ctx.caseId, "report_generator");
  const { data: report } = await ctx.db
    .from("reports")
    .select("case_id,full_report,executive_summary")
    .eq("case_id", ctx.caseId)
    .maybeSingle();
  const ok = alreadyDone && !!report;
  return {
    status: ok ? "success" : "failed",
    confidence: ok ? 0.9 : 0,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "draft_report.md",
    errors: ok ? [] : ["Report stage did not complete before the release gate ran; nothing to verify."],
    output: { case_id: report?.case_id ?? null, report_completed: alreadyDone },
  };
}

async function agentQA(ctx: RunCtx): Promise<AgentResult> {
  // Validate formatting, references, consistency.
  const { data: report } = await ctx.db
    .from("reports")
    .select("case_id,full_report,executive_summary")
    .eq("case_id", ctx.caseId)
    .maybeSingle();
  const errors: string[] = [];
  if (!report) errors.push("Report missing.");
  const full = report?.full_report as Record<string, unknown> | null;
  if (!full) errors.push("Report has no full_report payload.");
  const summary = report?.executive_summary;
  if (!summary || String(summary).trim().length < 80) {
    errors.push("Executive summary missing or too short (<80 chars).");
  }
  const { count: findingsCount } = await ctx.db
    .from("case_findings")
    .select("id", { count: "exact", head: true })
    .eq("case_id", ctx.caseId);
  if ((findingsCount ?? 0) === 0) errors.push("No findings to support the report.");

  const { getReportLocale } = await import("@/lib/mexico-lock");
  const locale = await getReportLocale(ctx.db, ctx.caseId);
  const reportText = collectReportText([summary, full]).join("\n").slice(0, 200_000);
  const languageLeaks = detectReportLanguageLeaks(reportText, locale);
  if (languageLeaks.length > 0) {
    errors.push(`Report language drift (${locale}): ${Array.from(new Set(languageLeaks)).slice(0, 8).join(", ")}.`);
  }

  const pass = errors.length === 0;
  return {
    status: pass ? "success" : "failed",
    confidence: pass ? 0.95 : 0.3,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "qa_report.json",
    errors,
    output: { pass, checked: ["report_exists", "summary_length", "findings_present", "single_language"], locale },
  };
}

// Mode-aware thresholds. Strict raises the bar for release; exploratory
// lowers it so pre-release drafts still surface. Balanced is the current
// production default and preserves prior behavior exactly.
const JUDGE_THRESHOLDS: Record<AnalysisMode, { reject: number; needsRevision: number }> = {
  strict: { reject: 0.4, needsRevision: 0.7 },
  balanced: { reject: 0.25, needsRevision: 0.5 },
  exploratory: { reject: 0.15, needsRevision: 0.3 },
};
const HALLUCINATION_THRESHOLDS: Record<AnalysisMode, number> = {
  strict: 0.85,
  balanced: 0.7,
  exploratory: 0.5,
};

async function agentJudge(ctx: RunCtx): Promise<AgentResult> {
  // Independent review: sanity-checks the report against structural quality
  // signals (citation density, contradiction load, finding confidence).
  // A finding counts as cited only when it has BOTH a source document and a
  // verbatim source quote — the exact same contract hallucination review uses.
  const t = JUDGE_THRESHOLDS[ctx.analysisMode];
  let verdict: "approve" | "needs_revision" | "reject" = "approve";
  const notes: string[] = [];
  const { data: allFindings } = await ctx.db
    .from("case_findings")
    .select("id,source_document_id,source_doc_ids,source_quote,source_module")
    .eq("case_id", ctx.caseId);
  const findings = (allFindings ?? []) as Array<{
    source_document_id: string | null;
    source_doc_ids: string[] | null;
    source_quote: string | null;
    source_module: string | null;
  }>;
  const totalN = findings.length;
  const cited = findings.filter(
    (f) => hasTraceableCitation(f),
  ).length;
  const citedRatio = totalN > 0 ? cited / totalN : 1;
  if (totalN === 0) {
    verdict = "reject";
    notes.push("No findings to evaluate.");
  } else if (citedRatio < t.reject) {
    verdict = "reject";
    notes.push(
      `Citation density ${(citedRatio * 100).toFixed(0)}% below ${ctx.analysisMode} reject threshold (${(t.reject * 100).toFixed(0)}%).`,
    );
  } else if (citedRatio < t.needsRevision) {
    verdict = "needs_revision";
    notes.push(
      `Citation density ${(citedRatio * 100).toFixed(0)}% below ${ctx.analysisMode} approval threshold (${(t.needsRevision * 100).toFixed(0)}%).`,
    );
  } else {
    notes.push(`Citation density ${(citedRatio * 100).toFixed(0)}% passes ${ctx.analysisMode} approval threshold.`);
  }
  const contraCount = findings.filter((f) => f.source_module === "contradictions").length;
  if (contraCount > 50 && verdict === "approve") {
    verdict = "needs_revision";
    notes.push(`High contradiction count (${contraCount}) warrants revision.`);
  }
  const pass = verdict === "approve";
  return {
    status: pass ? "success" : "failed",
    confidence: verdict === "approve" ? 0.85 : verdict === "needs_revision" ? 0.65 : 0.3,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "judge_report.json",
    errors: pass ? [] : [`Judge verdict: ${verdict}`, ...notes],
    output: {
      verdict,
      notes,
      mode: ctx.analysisMode,
      thresholds: t,
      totals: { findings: totalN, cited, cited_ratio: citedRatio },
    },
  };
}

async function agentHallucination(ctx: RunCtx): Promise<AgentResult> {
  const m = await import("@/lib/intelligence/hallucination.server");
  const report = await m.runHallucinationReview({ db: ctx.db, caseId: ctx.caseId });
  const cited = report.verified + report.unverified;
  const verifiedRatio = cited > 0 ? report.verified / cited : 1;
  const citationCoverage = report.total > 0 ? cited / report.total : 0;
  const threshold = HALLUCINATION_THRESHOLDS[ctx.analysisMode];
  const pass = report.total > 0 && cited > 0 && verifiedRatio >= threshold;
  const errors: string[] = [];
  if (report.total === 0) errors.push("No findings available for hallucination review.");
  if (report.total > 0 && cited === 0) errors.push("No findings carry both a source document and verbatim quote.");
  if (cited > 0 && verifiedRatio < threshold) {
    errors.push(
      `Verified ratio ${(verifiedRatio * 100).toFixed(1)}% of cited findings below ${ctx.analysisMode} threshold (${(threshold * 100).toFixed(0)}%).`,
    );
  }
  return {
    status: pass ? "success" : "failed",
    confidence: verifiedRatio,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "hallucination_report.json",
    errors: pass ? [] : errors,
    output: {
      total: report.total,
      verified: report.verified,
      unverified: report.unverified,
      no_citation: report.no_citation,
      citation_coverage: citationCoverage,
      verification_ratio: verifiedRatio,
      mode: ctx.analysisMode,
      threshold,
    },
  };
}

// ----- Master loop -----

export async function runMultiAgentPipeline(args: OrchestratorArgs): Promise<{
  runId: string;
  released: boolean;
  results: Array<AgentResult & { agent: AgentDefinition }>;
}> {
  // Wrap the entire run in the ambient AI user scope so every callGroq()
  // call inside any agent (including agentEntities -> runAnalyzers) can
  // resolve this user's full provider/key rotation pool (Groq, Gemini,
  // etc.) from user_ai_keys — matching what pipeline-runner.server.ts
  // already does for the 5-stage pipeline. Without this, ambient scope is
  // empty here and agents silently fall back to Groq-only with no fallback.
  const { withAIUser } = await import("@/lib/ai/user-scope.server");
  return withAIUser(args.userId, () => _runMultiAgentPipeline(args));
}

async function _runMultiAgentPipeline(args: OrchestratorArgs): Promise<{
  runId: string;
  released: boolean;
  results: Array<AgentResult & { agent: AgentDefinition }>;
}> {
  const runId = crypto.randomUUID();
  const { getAnalysisMode } = await import("@/lib/intelligence/evidence-gate.server");
  const analysisMode = (await getAnalysisMode(args.db, args.caseId)) as AnalysisMode;
  const ctx: RunCtx = { ...args, runId, analysisMode };
  console.info(`[multi-agent] run ${runId} case=${args.caseId} mode=${analysisMode}`);
  const trace = (event: string, extra: Record<string, unknown> = {}) => {
    console.info(
      `[multi-agent] ${JSON.stringify({
        t: new Date().toISOString(),
        event,
        runId,
        caseId: args.caseId,
        ...extra,
      })}`,
    );
  };
  trace("multi_agent.start", { mode: analysisMode, agents_loaded: AGENT_DEFINITIONS.length });

  const runners: Record<string, (c: RunCtx) => Promise<AgentResult>> = {
    intake: agentIntake,
    ocr: agentOcr,
    entities: agentEntities,
    timeline: agentTimeline,
    evidence: agentEvidence,
    contradictions: agentContradictions,
    legal: agentLegal,
    risk: agentRisk,
    report: agentReport,
    qa: agentQA,
    judge: agentJudge,
    hallucination: agentHallucination,
  };

  const results: Array<AgentResult & { agent: AgentDefinition }> = [];
  const FATAL = new Set(["intake", "ocr", "entities"]);

  for (const def of AGENT_DEFINITIONS) {
    if (def.key === "orchestrator") continue; // handled separately as final summary
    const fn = runners[def.key];
    const t0 = Date.now();
    trace("agent.start", { agent_index: def.index, agent_key: def.key, agent_name: def.name });
    const rawResult = await safeRun(() => fn(ctx), def);
    const result = await attachAgentStats(args.db, args.caseId, def, rawResult, t0);
    results.push({ ...result, agent: def });
    await recordAgent(args.db, ctx, def, t0, result);
    trace("agent.complete", {
      agent_index: def.index,
      agent_key: def.key,
      status: result.status,
      runtime_ms: Date.now() - t0,
    });
    if (result.status === "failed" && FATAL.has(def.key)) {
      // Mark remaining downstream agents blocked and bail out.
      for (const rest of AGENT_DEFINITIONS) {
        if (rest.key === "orchestrator") continue;
        if (rest.index <= def.index) continue;
        const blockedRaw: AgentResult = {
          status: "blocked",
          confidence: 0,
          processingTime: 0,
          tokensUsed: 0,
          outputFile: rest.outputFile,
          errors: [`Blocked by upstream failure at ${def.name}`],
        };
        const blocked = await attachAgentStats(args.db, args.caseId, rest, blockedRaw, Date.now());
        results.push({ ...blocked, agent: rest });
        await recordAgent(args.db, ctx, rest, Date.now(), blocked);
        trace("agent.blocked", { agent_index: rest.index, agent_key: rest.key, blocked_by: def.key });
      }
      break;
    }
  }

  // Release gate: QA + Judge + Hallucination must all be success.
  const byKey = new Map(results.map((r) => [r.agent.key, r]));
  const qaOk = byKey.get("qa")?.status === "success";
  const judgeOk = byKey.get("judge")?.status === "success";
  const halOk = byKey.get("hallucination")?.status === "success";
  const released = qaOk && judgeOk && halOk;

  // Final orchestrator log entry (Agent 13).
  const orchDef = AGENT_DEFINITIONS.find((d) => d.key === "orchestrator")!;
  const orchResult: AgentResult = {
    status: released ? "success" : "failed",
    confidence: released ? 1 : 0.5,
    processingTime: 0,
    tokensUsed: 0,
    outputFile: "orchestrator_log.json",
    errors: released ? [] : ["Release gate failed — QA/Judge/Hallucination did not all pass."],
    output: {
      run_id: runId,
      released,
      gates: { qa: qaOk, judge: judgeOk, hallucination: halOk, mode: ctx.analysisMode },
      agents: results.map((r) => ({
        index: r.agent.index,
        key: r.agent.key,
        status: r.status,
        confidence: r.confidence,
      })),
    },
  };
  const orchStarted = Date.now();
  trace("agent.start", { agent_index: orchDef.index, agent_key: orchDef.key, agent_name: orchDef.name });
  const orchWithStats = await attachAgentStats(args.db, args.caseId, orchDef, orchResult, orchStarted);
  await recordAgent(args.db, ctx, orchDef, orchStarted, orchWithStats);
  results.push({ ...orchWithStats, agent: orchDef });
  trace("agent.complete", {
    agent_index: orchDef.index,
    agent_key: orchDef.key,
    status: orchWithStats.status,
    runtime_ms: Date.now() - orchStarted,
  });

  // The report writer runs before QA/Judge/Hallucination/Orchestrator finish.
  // Restamp the saved report with the completed run's measurable agent output
  // so exports cannot claim agents executed without showing produced/skipped/
  // suppressed counts for every applicable agent.
  try {
    const agentStatistics = await buildAgentStatistics(args.db, args.caseId, { runId });
    const { data: report } = await args.db
      .from("reports")
      .select("full_report")
      .eq("case_id", args.caseId)
      .maybeSingle();
    const full =
      report?.full_report && typeof report.full_report === "object" && !Array.isArray(report.full_report)
        ? { ...(report.full_report as Record<string, unknown>) }
        : {};
    full.agent_statistics = agentStatistics as unknown as Record<string, unknown>;
    await args.db
      .from("reports")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ full_report: full as any })
      .eq("case_id", args.caseId);
  } catch (e) {
    console.warn("[multi-agent] failed to restamp report agent statistics", e);
  }

  // Stamp the case with the release decision.
  const { data: beforeStatus } = await args.db
    .from("cases")
    .select("status,status_message")
    .eq("id", args.caseId)
    .maybeSingle();
  await args.db
    .from("cases")
    .update({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: (released ? "released" : "needs_revision") as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status_message: (released
        ? "Multi-agent run released report."
        : "Multi-agent release blocked — see QA/Judge/Hallucination logs.") as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", args.caseId);
  trace("case.status.write", {
    source: "multi_agent.release_gate",
    previous_status: beforeStatus?.status ?? null,
    new_status: released ? "released" : "needs_revision",
    gates: { qa: qaOk, judge: judgeOk, hallucination: halOk },
  });
  trace("multi_agent.complete", { released, agents_executed: results.length });

  return { runId, released, results };
}
