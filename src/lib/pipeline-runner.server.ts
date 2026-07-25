// Server-only extraction of the full-pipeline runner so it can be invoked
// both from an authenticated server function (user click) and from the
// background worker route (cron / queue drain) with an admin client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PIPELINE_STAGES, runTimelineAudit, type PipelineStageKey } from "./cases.functions";

type Db = SupabaseClient<Database>;

const RUNNER_LEASE_EXTENSION_MS = 20 * 60 * 1000;

export type RunPipelineOpts = {
  caseId: string;
  startFrom?: string;
  reset?: boolean;
};

export async function runPipelineForCase(
  supabase: Db,
  userId: string,
  opts: RunPipelineOpts,
): Promise<{
  ok: boolean;
  cancelled?: boolean;
  completedStages: number;
  warnings?: Array<{ key: string; error: string }>;
  failedAt?: string;
}> {
  const { withAIUser } = await import("@/lib/ai/user-scope.server");
  return withAIUser(userId, () => _runPipelineForCase(supabase, userId, opts));
}

async function _runPipelineForCase(
  supabase: Db,
  userId: string,
  opts: RunPipelineOpts,
): Promise<{
  ok: boolean;
  cancelled?: boolean;
  completedStages: number;
  warnings?: Array<{ key: string; error: string }>;
  failedAt?: string;
}> {
  const { caseId, startFrom, reset } = opts;

  // Structured instrumentation — every stage transition and case-status write
  // logs a single JSON line so the full automatic execution path can be
  // reconstructed from worker logs. correlationId ties every line together.
  const correlationId = `run-${caseId}-${Date.now().toString(36)}`;
  const runStart = Date.now();
  const trace = (event: string, extra: Record<string, unknown> = {}) => {
    const payload = {
      t: new Date().toISOString(),
      corr: correlationId,
      caseId,
      userId,
      event,
      elapsed_ms: Date.now() - runStart,
      ...extra,
    };
    console.info(`[pipeline] ${JSON.stringify(payload)}`);
  };

  const updateCase = async (patch: Record<string, unknown>, source: string) => {
    const withHeartbeat: Record<string, unknown> = { ...patch };
    const statusValue = typeof patch.status === "string" ? patch.status : null;
    const terminalStatuses = new Set(["complete", "released", "needs_revision", "failed", "cancelled"]);
    const shouldExtendLease = statusValue === "intelligence_running" && !terminalStatuses.has(statusValue);
    if (shouldExtendLease) {
      withHeartbeat.worker_lease_until = new Date(Date.now() + RUNNER_LEASE_EXTENSION_MS).toISOString();
    } else if (statusValue && terminalStatuses.has(statusValue)) {
      withHeartbeat.worker_lease_until = null;
    }
    const includesStatus = Object.prototype.hasOwnProperty.call(patch, "status");
    let before: Record<string, unknown> | null = null;
    if (includesStatus) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("cases")
        .select("status,status_message,next_stage,queued_at,worker_lease_until")
        .eq("id", caseId)
        .maybeSingle();
      before = (data ?? null) as Record<string, unknown> | null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("cases")
      .update(withHeartbeat as any)
      .eq("id", caseId);
    if (error) throw new Error(`case update failed at ${source}: ${error.message}`);
    if (includesStatus) {
      trace("case.status.write", {
        source,
        previous_status: before?.status ?? null,
        new_status: patch.status ?? null,
        previous_next_stage: before?.next_stage ?? null,
        new_next_stage: withHeartbeat.next_stage ?? before?.next_stage ?? null,
        previous_lease_until: before?.worker_lease_until ?? null,
        new_lease_until: withHeartbeat.worker_lease_until,
      });
    }
  };

  if (reset) {
    const derivedTables = [
      "analyses",
      "agent_findings",
      "case_findings",
      "case_scores",
      "case_opportunities",
      "case_perspectives",
      "case_strategy",
      "case_theories",
      "case_trial_prep",
      "case_witnesses",
      "case_work_product",
      "evidence_classifications",
      "reports",
      "pipeline_engine_runs",
      "pipeline_events",
      "agent_logs",
    ];
    for (const t of derivedTables) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from(t).delete().eq("case_id", caseId);
    }
    await updateCase(
      {
        extracted_at: null,
        analysis_at: null,
        agents_at: null,
        scored_at: null,
        report_at: null,
        theories_at: null,
        opportunities_at: null,
        trial_prep_at: null,
        witnesses_at: null,
        perspectives_at: null,
        evidence_intel_at: null,
        strategy_at: null,
        contradiction_at: null,
        discovery_at: null,
        hallucination_at: null,
        work_product_at: null,
        hallucination_report: null,
        // attack_surface is `jsonb NOT NULL DEFAULT '{}'::jsonb` — writing
        // `null` here violates that constraint and throws, which aborts
        // this ENTIRE update (Postgres rejects the whole statement, not
        // just this column), so none of the other reset fields below ever
        // get written either. That's the real reason Rerun could look like
        // it "does nothing": the reset silently failed here every time,
        // leaving the case at status=queued with stale pipeline_engine_runs
        // rows and no error surfaced anywhere but the browser console.
        attack_surface: {},
        error: null,
        status_message: null,
        progress: 0,
        cancel_requested: false,
        report_checkpoint_count: 0,
      },
      "pipeline.reset",
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from("cases")
      .update({ cancel_requested: false } as any)
      .eq("id", caseId);
  }

  // 2026-07 audit: the previous bypass here (apiKey/apiKeys hardcoded empty)
  // was left over from a period when the platform's Groq key was dead. Groq
  // is confirmed healthy again (Admin → AI Providers), so resolve the user's
  // active Groq key(s) explicitly, same as every other provider. This is
  // additive, not exclusive — router.server.ts ALSO resolves the user's
  // full key set (any provider) via the ambient userId passed in baseArgs
  // below, so nothing regresses if this resolution comes back empty (e.g.
  // no user-added Groq key, falling back to the platform GROQ_API_KEY).
  let apiKey = "";
  let keys: string[] = [];
  try {
    const { resolveProviderKeys } = await import("@/lib/ai-key-router.server");
    const resolved = await resolveProviderKeys(supabase, userId, "groq");
    keys = resolved.keys;
    apiKey = keys[0] ?? "";
  } catch (e) {
    console.warn(
      "[pipeline-runner] resolveProviderKeys(groq) failed — falling back to ambient userId resolution only",
      e,
    );
  }
  const baseArgs = { db: supabase, caseId, userId, apiKey, apiKeys: keys };

  const pipe = await import("@/lib/pipeline.server");
  const eng = await import("@/lib/intelligence/engines.server");
  const lit = await import("@/lib/intelligence/litigation.server");
  const hal = await import("@/lib/intelligence/hallucination.server");
  const prog = await import("@/lib/intelligence/progress.server");
  const persist = await import("@/lib/intelligence/engine-persistence.server");
  const audit = await import("@/lib/intelligence/engine-audit.server");

  // Bug 2 (fix A): witness / discovery / evidence_intel are wired to the
  // REAL LLM engines (runWitnessEngine / runDiscoveryGapEngine /
  // runEvidenceIntelEngine). The prior `derive*` stubs counted findings
  // categories that no upstream stage actually produced, so every dashboard
  // count returned 0. The real engines already batch, gate, and cite; they
  // just were never wired into this runner map.
  //
  // Phase 3 (reliability freeze): every audit.runEngine call for an engine
  // that writes to the database is routed through persist.runCatalogedEngine,
  // which re-queries the target table(s) after the engine returns. A silent
  // insert failure → verification failure → engine marked `failed` →
  // downstream dependents marked `blocked` by the loop below. No engine may
  // report `completed` unless its persistence has been confirmed.
  const runners: Record<
    PipelineStageKey,
    { run: () => Promise<unknown>; stage?: import("@/lib/intelligence/progress.server").StageKey; engine?: string }
  > = {
    extraction: { run: () => pipe.runExtraction(baseArgs), stage: "extraction" },
    agents: { run: () => pipe.runAgents(baseArgs), stage: "agents" },
    analyzers: { run: () => pipe.runAnalyzers(baseArgs), stage: "analyzers" },
    scoring: { run: () => pipe.runScoring(baseArgs), stage: "scoring", engine: "scoring" },
    // Inteligencia de Jurisdicción — deterministic resolution of país/estado/
    // fuero/materia and the codes that govern the matter.
    jurisdiction_intel: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "jurisdiction_intel" }, async () => {
          const { runJurisdictionIntelligence } = await import("@/lib/intelligence/jurisdiction-intel.server");
          const value = await runJurisdictionIntelligence({ db: supabase, caseId });
          return {
            value,
            stats: {
              generated: 1,
              accepted: 1,
              rows_written: 1,
              db_write_confirmed: true,
              meta: {
                source: "deterministic",
                materia: value.materia,
                fuero: value.fuero,
                state: value.state?.name ?? null,
                state_source: value.state_source,
              },
            },
          };
        }),
    },
    // Análisis de Cumplimiento Procesal — materia checklist over the corpus.
    procedural_compliance: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "procedural_compliance" }, async () => {
          const { runProceduralCompliance } = await import("@/lib/intelligence/procedural-compliance.server");
          const value = await runProceduralCompliance({ db: supabase, caseId, userId });
          return {
            value,
            stats: {
              generated: value.evaluated,
              accepted: value.satisfied,
              rejected: value.evaluated - value.satisfied,
              rows_written: value.findings_written,
              db_write_confirmed: true,
              meta: {
                source: "deterministic",
                materia: value.materia,
                score: value.score,
                missing_required: value.missing_required,
              },
            },
          };
        }),
    },
    // Control de Calidad Jurídica — terminal gate before the report. Throws
    // when a blocking violation survives remediation, which fails this stage
    // and blocks `report` (its dependent).
    legal_qa: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "legal_qa" }, async () => {
          const { runLegalQaGate } = await import("@/lib/intelligence/legal-qa.server");
          const value = await runLegalQaGate({ db: supabase, caseId });
          return {
            value,
            stats: {
              generated: value.checked_fields,
              accepted: value.checked_fields - value.warnings.length,
              rejected: value.warnings.length,
              rows_written: value.remediated_fields,
              db_write_confirmed: true,
              meta: {
                source: "deterministic",
                materia: value.materia,
                locale: value.locale,
                remediated_fields: value.remediated_fields,
                warnings: value.warnings.length,
              },
            },
          };
        }),
    },
    report: { run: () => pipe.runReport(baseArgs), stage: "report", engine: "report_generator" },
    timeline: { run: () => runTimelineAudit({ supabase, userId, caseId }) },
    evidence_map: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "evidence_map" }, async () => {
          const m = await import("@/lib/intelligence/evidence-map.server");
          const em = await m.buildEvidenceMap(supabase, caseId);
          return {
            value: em,
            stats: { generated: em.totals.total, accepted: em.totals.total - em.totals.missing_evidence },
          };
        }),
    },
    contradictions: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "contradictions" }, async () => {
          const d = await import("@/lib/intelligence/derived-engines.server");
          const result = await d.deriveContradictions(supabase, caseId);
          await updateCase({ contradiction_at: new Date().toISOString() }, "pipeline.contradictions");
          return result;
        }),
      stage: "contradictions",
    },
    // Task-9/10 stat plumbing: engines whose output is a mix of LLM + deterministic
    // templates now return real generated/accepted/rejected counts. Row counts come
    // from the target case_* tables (source of truth), audit numbers come from the
    // engine's own return value where available. Meta.source labels the pipeline
    // ("llm" | "template" | "hybrid") so the UI stops showing 0/0/0 for engines
    // that produced legitimate deterministic output.
    witness: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "witness_intelligence" }, async () => {
          const value = (await eng.runWitnessEngine(baseArgs)) as {
            witnesses?: unknown[];
            audit?: { input?: number; accepted?: number };
          };
          const { count } = await supabase
            .from("case_witnesses")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const rows = count ?? value.witnesses?.length ?? 0;
          const gen = Math.max(value.audit?.input ?? 0, rows);
          const acc = Math.max(value.audit?.accepted ?? 0, rows);
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: Math.max(0, gen - acc),
              rows_written: rows,
              meta: { source: "hybrid" },
            },
          };
        }),
      stage: "witness_intel",
    },
    evidence_intel: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "evidence_intelligence" }, async () => {
          const value = (await lit.runEvidenceIntelEngine(baseArgs)) as {
            classifications?: number;
            promoted_findings?: number;
            promotion_gate?: unknown;
            promotion_mode?: unknown;
            promotion_corpus?: unknown;
          };
          const gen = value.classifications ?? 0;
          const acc = value.promoted_findings ?? gen;
          await updateCase({ evidence_intel_at: new Date().toISOString() }, "pipeline.evidence_intel");
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: Math.max(0, gen - acc),
              rows_written: gen,
              meta: {
                source: "hybrid",
                evidence_gate: {
                  mode: value.promotion_mode,
                  audit: value.promotion_gate,
                  corpus: value.promotion_corpus,
                },
              },
            },
          };
        }),
      stage: "evidence_intel",
    },
    constitutional: {
      // PRACTICE-AREA GATE: this stage previously ran unconditionally for
      // every case type, independently of the identically-named (and
      // already-gated) stage in pipeline.server.ts. Because this file's
      // worker-tick loop runs the "constitutional" stage AFTER the "agents"
      // stage (which correctly records constitutional_compliance as skipped
      // via runAgents()'s internal gate), this ungated copy would overwrite
      // that skipped row with a stub "completed" row — producing the
      // release-gate "silent_activation:constitutional_compliance" failure.
      // Mirrors the gate already used in runAgents() and
      // pipeline.server.ts's own constitutional stage.
      run: async () => {
        const { isAnalyzerAllowed, SKIP_REASON_NOT_APPLICABLE } = await import("./intelligence/practice-areas");
        const { getActiveDomains } = await import("./intelligence/cross-domain.server");
        const { recordSkipped } = await import("./intelligence/engine-audit.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: caseRow } = await supabase
          .from("cases")
          .select("case_type" as any)
          .eq("id", caseId)
          .maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const area = String((caseRow as any)?.case_type ?? "general_civil");
        const activeDomains = await getActiveDomains(supabase, caseId);

        if (!isAnalyzerAllowed(area, "constitutional_compliance", activeDomains)) {
          await recordSkipped(supabase, {
            caseId,
            userId,
            engine: "constitutional_compliance" as never,
            reason: SKIP_REASON_NOT_APPLICABLE,
          });
          return { skipped: true, reason: SKIP_REASON_NOT_APPLICABLE };
        }

        return persist.runCatalogedEngine(
          supabase,
          { caseId, userId, engine: "constitutional_compliance" },
          async () => ({
            value: { derived_from: "analyzers+agents" },
          }),
        );
      },
    },
    discovery: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "discovery_gaps" }, async () => {
          const value = (await eng.runDiscoveryGapEngine(baseArgs)) as {
            findings_gate?: unknown;
            findings_gate_mode?: unknown;
            findings_gate_corpus?: unknown;
          };
          const { count } = await supabase
            .from("case_findings")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId)
            .like("source_module", "engine:discovery%");
          const n = count ?? 0;
          await updateCase({ discovery_at: new Date().toISOString() }, "pipeline.discovery");
          return {
            value,
            stats: {
              generated: n,
              accepted: n,
              rows_written: n,
              meta: {
                source: "engine",
                evidence_gate: {
                  mode: value.findings_gate_mode,
                  audit: value.findings_gate,
                  corpus: value.findings_gate_corpus,
                },
              },
            },
          };
        }),
      stage: "discovery_gaps",
    },
    perspectives: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "perspectives" }, async () => {
          const value = await lit.runPerspectivesEngine(baseArgs);
          const { count } = await supabase
            .from("case_perspectives")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? 0;
          return { value, stats: { generated: n, accepted: n, rows_written: n, meta: { source: "engine" } } };
        }),
    },
    theories: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "theory" }, async () => {
          const value = (await eng.runTheoryEngine(baseArgs)) as {
            theories?: unknown[];
            audit?: { rejected?: number };
          };
          const { count } = await supabase
            .from("case_theories")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const acc = count ?? value.theories?.length ?? 0;
          const gen = acc + (value.audit?.rejected ?? 0);
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: Math.max(0, gen - acc),
              rows_written: acc,
              meta: { source: "engine" },
            },
          };
        }),
      stage: "theories",
    },
    opportunities: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "opportunity" }, async () => {
          const value = (await eng.runOpportunityEngine(baseArgs)) as {
            opportunities?: unknown[];
            potential_opportunities?: unknown[];
            audit?: { input?: number; rejected?: number; rejections?: unknown[] };
          };
          const { count } = await supabase
            .from("case_opportunities")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const verified = value.opportunities?.length ?? 0;
          const potential = value.potential_opportunities?.length ?? 0;
          const rows = count ?? verified + potential;
          const gen = Math.max(value.audit?.input ?? 0, verified + potential, rows);
          const rejected = Math.max(value.audit?.rejected ?? potential, gen - verified);
          return {
            value,
            stats: {
              generated: gen,
              accepted: verified,
              rejected,
              rows_written: rows,
              meta: {
                source: "engine",
                verified_opportunities: verified,
                potential_requires_review: potential,
                gate_rejections: value.audit?.rejections ?? [],
              },
            },
          };
        }),
    },
    trial_prep: {
      // PRACTICE-AREA GATE: same class of bug as "constitutional" above —
      // this stage ran unconditionally for every case type. trial_prep is
      // allowed for general_civil/personal_injury/medical_malpractice/
      // employment/criminal/civil_rights, but NOT for family or appellate
      // (see PRACTICE_ENGINES in practice-areas.ts). Without this gate, a
      // family or appellate case would get a "completed" trial_prep row that
      // the manifest says should be skipped — the same
      // release-gate "silent_activation" failure as constitutional_compliance.
      run: async () => {
        const { isAnalyzerAllowed, SKIP_REASON_NOT_APPLICABLE } = await import("./intelligence/practice-areas");
        const { getActiveDomains } = await import("./intelligence/cross-domain.server");
        const { recordSkipped } = await import("./intelligence/engine-audit.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: caseRow } = await supabase
          .from("cases")
          .select("case_type" as any)
          .eq("id", caseId)
          .maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const area = String((caseRow as any)?.case_type ?? "general_civil");
        const activeDomains = await getActiveDomains(supabase, caseId);

        if (!isAnalyzerAllowed(area, "trial_prep", activeDomains)) {
          await recordSkipped(supabase, {
            caseId,
            userId,
            engine: "trial_prep" as never,
            reason: SKIP_REASON_NOT_APPLICABLE,
          });
          return { skipped: true, reason: SKIP_REASON_NOT_APPLICABLE };
        }

        return persist.runCatalogedEngine(supabase, { caseId, userId, engine: "trial_prep" }, async () => {
          const value = (await eng.runTrialPrepEngine(baseArgs)) as {
            findings_gate?: unknown;
            findings_gate_mode?: unknown;
            findings_gate_corpus?: unknown;
          };
          const { count } = await supabase
            .from("case_trial_prep")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? (value ? 1 : 0);
          return {
            value,
            stats: {
              generated: n,
              accepted: n,
              rows_written: n,
              meta: {
                source: "engine",
                evidence_gate: {
                  mode: value.findings_gate_mode,
                  audit: value.findings_gate,
                  corpus: value.findings_gate_corpus,
                },
              },
            },
          };
        });
      },
    },
    strategy: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "strategy" }, async () => {
          const value = await lit.runStrategyEngine(baseArgs);
          const { count } = await supabase
            .from("case_strategy")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? 0;
          return { value, stats: { generated: n, accepted: n, rows_written: n, meta: { source: "engine" } } };
        }),
      stage: "strategy",
    },
    litigation_strategy_center: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "litigation_strategy_center" }, async () => {
          const value = await lit.runLitigationStrategyCenterEngine(baseArgs);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { count } = await (supabase as any)
            .from("case_strategy_center")
            .select("case_id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const n = count ?? (value ? 1 : 0);
          return { value, stats: { generated: n, accepted: n, rows_written: n, meta: { source: "engine" } } };
        }),
    },
    work_product: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "work_product" }, async () => {
          const value = (await eng.runWorkProductEngine(baseArgs)) as {
            documents?: unknown[];
            failed?: number;
            verification?: { total?: number; clean?: number; flagged?: number; rejected?: number; empty?: number };
          };
          const { count } = await supabase
            .from("case_work_product")
            .select("id", { count: "exact", head: true })
            .eq("case_id", caseId);
          const rows = count ?? 0;
          const gen = value.verification?.total ?? rows;
          const acc = value.verification?.clean ?? rows;
          const rej = (value.verification?.rejected ?? 0) + (value.verification?.empty ?? 0);
          return {
            value,
            stats: {
              generated: gen,
              accepted: acc,
              rejected: rej,
              rows_written: rows,
              meta: { source: "template", verification: value.verification ?? null },
            },
          };
        }),
    },
    hallucination: {
      run: () =>
        persist.runCatalogedEngine(supabase, { caseId, userId, engine: "hallucination" }, async () => ({
          value: await hal.runHallucinationReview({ db: supabase, caseId }),
        })),
    },
    multi_agent: {
      run: async () =>
        audit.runEngine(supabase, { caseId, userId, engine: "multi_agent" }, async () => {
          const { runMultiAgentPipeline } = await import("@/lib/agents/orchestrator.server");
          const result = await runMultiAgentPipeline({ db: supabase, userId, caseId, apiKey, apiKeys: keys });
          const successful = result.results.filter((r) => r.status === "success").length;
          return {
            value: result,
            stats: {
              generated: result.results.length,
              accepted: successful,
              rejected: result.results.length - successful,
              rows_written: result.results.length,
              db_write_confirmed: true,
              meta: { run_id: result.runId, released: result.released },
            },
          };
        }),
    },
  };

  // Dependency graph — derived from CANONICAL_STAGES so there is exactly
  // one place that defines stage dependencies platform-wide.
  const { CANONICAL_STAGES } = await import("@/lib/execution/canonical");
  const DEPENDS_ON = Object.fromEntries(CANONICAL_STAGES.map((s) => [s.key, [...s.dependsOn]])) as Record<
    PipelineStageKey,
    PipelineStageKey[]
  >;
  // "optional" stages (e.g. litigation_strategy_center, work_product,
  // trial_prep, theories, multi_agent) are documented in canonical.ts as
  // "decorative; never blocks" — the report gate (canGenerateReport) already
  // only checks blocking/enriching engines. But stageFailures below fed
  // hasFailures/finalStatus off EVERY blocked or failed stage regardless of
  // tier, so a harmless optional-stage block (e.g. one upstream engine that
  // itself failed) flipped the whole case to status "failed" even though
  // every blocking-tier stage — including the finished report — succeeded.
  // The case then sat at a non-running, non-"complete" terminal status with
  // nothing left to drive it, which only a refresh (re-deriving state from
  // the per-engine rows instead of the case row) made look finished. Gate
  // stageFailures on requirement tier so only a real blocking/enriching
  // failure can mark the pipeline as failed.
  const stageRequirement = (k: string): "blocking" | "enriching" | "optional" =>
    CANONICAL_STAGES.find((c) => c.key === k)?.requirement ?? "blocking";

  // Jurisdiction-aware sequence. Mexican practice doesn't run every engine for
  // every materia (e.g. no jury simulation in an ordinary penal case, no
  // witness intelligence in an amparo). Resolve the case's materia and drop the
  // stages that aren't legally relevant so they never occupy the ledger.
  let stages: (typeof PIPELINE_STAGES)[number][] = [...PIPELINE_STAGES];
  {
    const { isStageRelevantForCaseType } = await import("./execution/mx-pipeline");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mxCaseRow } = await (supabase as any)
      .from("cases")
      .select("case_type")
      .eq("id", caseId)
      .maybeSingle();
    const mxCaseType = (mxCaseRow as { case_type?: string | null } | null)?.case_type ?? null;
    stages = stages.filter((s) => isStageRelevantForCaseType(mxCaseType, s.key));
  }
  if (startFrom) {
    const idx = stages.findIndex((s) => s.key === startFrom);
    if (idx > 0) stages = stages.slice(idx);
  }


  const total = stages.length;
  const FATAL_STAGES = new Set<PipelineStageKey>(["extraction", "analyzers", "agents"]);
  const stageFailures: Array<{ key: string; error: string }> = [];
  const completed = new Set<PipelineStageKey>();
  const failed = new Set<PipelineStageKey>();
  const blocked = new Set<PipelineStageKey>();
  const { withCheckpointScope, budgetFor, WORKER_INVOCATION_BUDGET_MS, CHECKPOINT_SAFETY_BUFFER_MS } =
    await import("./pipeline-checkpoint.server");
  const invocationDeadlineAt = runStart + WORKER_INVOCATION_BUDGET_MS;

  // Cross-tick dependency correctness. `failed`/`blocked` above only track
  // what THIS invocation observes. A case resumes across separate worker
  // ticks via `startFrom`, which slices `stages` to start partway through —
  // so any stage before that point (e.g. `perspectives` failing on tick 1)
  // is invisible to tick 3's freshly-empty Sets, and a downstream dependent
  // (e.g. `work_product`) could run unblocked even though its real upstream
  // dependency never completed. Reconstruct the missing history from the
  // persisted ledger for exactly the stages this tick will NOT re-attempt.
  const resumeIdx = startFrom ? PIPELINE_STAGES.findIndex((s) => s.key === startFrom) : 0;
  if (resumeIdx > 0) {
    const engineForStage = (k: string) => CANONICAL_STAGES.find((c) => c.key === k)?.engine ?? k;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: priorRuns, error: priorErr } = await (supabase as any)
      .from("pipeline_engine_runs")
      .select("engine,status,started_at")
      .eq("case_id", caseId)
      .order("started_at", { ascending: true });
    if (priorErr) {
      // Fail loudly rather than silently proceeding with an incomplete
      // picture of prior failures — a swallowed error here is exactly the
      // kind of gap that let work_product run past a failed perspectives.
      throw new Error(`failed to read pipeline_engine_runs history for resume: ${priorErr.message}`);
    }
    const latestStatusByEngine = new Map<string, string>();
    for (const row of (priorRuns ?? []) as Array<{ engine: string; status: string }>) {
      latestStatusByEngine.set(row.engine, row.status); // ascending order → last write wins
    }
    const { seedResumeState } = await import("./pipeline-checkpoint.server");
    const seeded = seedResumeState({
      priorStageKeys: PIPELINE_STAGES.slice(0, resumeIdx).map((s) => s.key),
      engineForStage,
      latestStatusByEngine,
    });
    for (const k of seeded.failed) failed.add(k as PipelineStageKey);
    for (const k of seeded.blocked) blocked.add(k as PipelineStageKey);
    trace("pipeline.resume_state_seeded", {
      resume_from: startFrom,
      seeded_failed: [...failed],
      seeded_blocked: [...blocked],
    });
  }

  trace("pipeline.start", { total_stages: stages.length, reset: !!reset, startFrom: startFrom ?? null });

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const key = s.key as PipelineStageKey;
    const r = runners[key];
    const pct = Math.floor((i / total) * 95);

    // Dependency gate — record a `blocked` row so the ledger, UI, and report
    // gate all see the truth: this engine did not run because upstream failed.
    const unmet = (DEPENDS_ON[key] ?? []).filter((d) => failed.has(d) || blocked.has(d));
    if (unmet.length > 0) {
      blocked.add(key);
      const reason = `Blocked: upstream stage(s) failed — ${unmet.join(", ")}`;
      if (stageRequirement(key) !== "optional") stageFailures.push({ key: s.key, error: reason });
      trace("stage.blocked", { stage: s.key, index: i + 1, unmet });
      try {
        await prog.emitEvent(supabase, caseId, s.key, reason, { level: "warn" });
      } catch {
        /* noop */
      }
      try {
        const { CANONICAL_STAGES: stagesDef } = await import("@/lib/execution/canonical");
        const engineFor = (k: string) => stagesDef.find((st) => st.key === k)?.engine ?? k;
        const audit = await import("@/lib/intelligence/engine-audit.server");
        await audit.recordBlocked(supabase, {
          caseId,
          userId,
          engine: engineFor(key),
          blockingEngines: unmet.map(engineFor),
          reason,
        });
      } catch (recErr) {
        console.warn(`[pipeline] failed to record blocked row for ${s.key}`, recErr);
      }
      await updateCase(
        {
          status: "intelligence_running",
          status_message: `${s.label} blocked (${i + 1}/${total})`,
          progress: pct,
          next_stage: s.key,
        },
        `stage.blocked:${s.key}`,
      );
      console.warn(`[pipeline] ${s.key} BLOCKED — ${reason}`);
      continue;
    }

    await updateCase(
      {
        status: "intelligence_running",
        status_message: `${s.label} (${i + 1}/${total})`,
        progress: pct,
        next_stage: s.key,
      },
      `stage.start:${s.key}`,
    );

    const remainingInvocationMs = invocationDeadlineAt - Date.now();
    if (remainingInvocationMs <= CHECKPOINT_SAFETY_BUFFER_MS) {
      try {
        const { requeueForContinuation } = await import("@/lib/pipeline-stall.server");
        await requeueForContinuation(supabase, caseId, s.key);
      } catch (rqErr) {
        console.warn(`[pipeline] re-queue before ${s.key} checkpoint failed`, rqErr);
      }
      trace("stage.checkpoint_before_start", {
        stage: s.key,
        index: i + 1,
        remaining_invocation_ms: remainingInvocationMs,
      });
      try {
        await prog.emitEvent(
          supabase,
          caseId,
          s.key,
          `${s.label} checkpointed before start — will resume on next worker tick`,
          { level: "warn" },
        );
      } catch {
        /* noop */
      }
      return { ok: true, completedStages: i, warnings: [{ key: s.key, error: "checkpoint" }], failedAt: s.key };
    }

    trace("stage.start", { stage: s.key, index: i + 1, progress_pct: pct });
    try {
      await prog.emitEvent(supabase, caseId, s.key, `${s.label} started`);
    } catch {
      /* noop */
    }

    const stageStart = Date.now();
    try {
      // Open the AsyncLocalStorage checkpoint scope so router.server.ts's
      // assertCheckpointBudget / aiCallTimeoutForCheckpoint guards can see a
      // real deadline and yield with CheckpointRequired before the worker is
      // killed mid AI call. Without this scope those guards are no-ops and
      // only the coarse per-stage progress checks fire — which is exactly the
      // "died mid-Groq-call, never wrote terminal state" symptom.
      const stageBudgetMs = Math.min(budgetFor(s.key), WORKER_INVOCATION_BUDGET_MS);
      await withCheckpointScope(
        { stage: s.key, deadlineAt: Math.min(stageStart + stageBudgetMs, invocationDeadlineAt), correlationId },
        () => r.run(),
      );
      completed.add(key);
      trace("stage.complete", { stage: s.key, runtime_ms: Date.now() - stageStart });
      try {
        await prog.emitEvent(supabase, caseId, s.key, `${s.label} complete`);
      } catch {
        /* noop */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Cancelled by user" || (e instanceof Error && e.name === "CancelledError")) {
        await updateCase(
          { status: "cancelled", status_message: `Cancelled at ${s.label}` },
          `stage.cancelled:${s.key}`,
        );
        trace("pipeline.cancelled", { stage: s.key });
        return { ok: false, cancelled: true, failedAt: s.key, completedStages: i };
      }
      if (e instanceof Error && e.name === "CheckpointRequired") {
        try {
          const { requeueForContinuation } = await import("@/lib/pipeline-stall.server");
          await requeueForContinuation(supabase, caseId, s.key);
        } catch (rqErr) {
          console.warn(`[pipeline] re-queue after checkpoint failed`, rqErr);
        }
        trace("stage.checkpoint", { stage: s.key, runtime_ms: Date.now() - stageStart });
        try {
          await prog.emitEvent(supabase, caseId, s.key, `${s.label} checkpointed — will resume on next worker tick`, {
            level: "warn",
          });
        } catch {
          /* noop */
        }
        return { ok: true, completedStages: i, warnings: [{ key: s.key, error: "checkpoint" }], failedAt: s.key };
      }
      failed.add(key);
      trace("stage.failed", { stage: s.key, runtime_ms: Date.now() - stageStart, error: msg.slice(0, 500) });
      try {
        await prog.emitEvent(supabase, caseId, s.key, msg, { level: "error" });
      } catch {
        /* noop */
      }
      if (stageRequirement(key) !== "optional") stageFailures.push({ key: s.key, error: msg });
      if (FATAL_STAGES.has(key)) {
        await updateCase(
          {
            status: "failed",
            status_message: `Failed at ${s.label}`,
            error: msg.slice(0, 2000),
            next_stage: s.key,
          },
          `stage.failed:${s.key}`,
        );
        throw new Error(`[${s.label}] ${msg}`);
      }
      console.warn(`[pipeline] non-fatal failure at ${s.key}: ${msg}`);
    }
  }

  // Truthful final status. Multi-agent may have already stamped the case as
  // "released" or "needs_revision" — that is the authoritative post-pipeline
  // state and must NOT be overwritten by a blanket "complete". Only fall
  // back to complete/failed when multi-agent didn't stamp.
  const hasFailures = stageFailures.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postRun } = await (supabase as any)
    .from("cases")
    .select("status,status_message")
    .eq("id", caseId)
    .maybeSingle();
  const preserved = postRun?.status === "released" || postRun?.status === "needs_revision";
  const finalStatus = preserved ? postRun.status : hasFailures ? "failed" : "complete";
  const finalMessage = preserved
    ? (postRun.status_message ?? "Pipeline finalized by multi-agent release gate.")
    : hasFailures
      ? `Pipeline finished with ${stageFailures.length} failed/blocked stage(s): ${stageFailures.map((f) => f.key).join(", ")}`
      : "Full pipeline complete";
  await updateCase(
    {
      status: finalStatus,
      status_message: finalMessage,
      progress: 100,
      next_stage: null,
      error: hasFailures
        ? stageFailures
            .map((f) => `${f.key}: ${f.error}`)
            .join(" | ")
            .slice(0, 2000)
        : null,
    },
    "pipeline.finalize",
  );

  // Canonical projection — additive, never blocks legacy path. Projects every
  // engine table into the 17-section CaseAnalysis, validates, and upserts to
  // canonical_analysis. Validation failures are recorded on the row, not
  // thrown, so the legacy report path stays intact.
  try {
    const { runCanonicalGate } = await import("@/lib/canonical/gate.server");
    const reportMode = hasFailures ? "LIMITED" : "FULL";
    const gate = await runCanonicalGate(supabase, caseId, reportMode);
    trace("pipeline.canonical", {
      ok: gate.ok,
      status: gate.status,
      issues: gate.validation.issues.length,
    });
  } catch (canonErr) {
    console.warn("[pipeline] canonical projection failed:", canonErr);
    trace("pipeline.canonical.failed", { error: canonErr instanceof Error ? canonErr.message : String(canonErr) });
  }

  // Talk to Case reads case intelligence through a short-lived, in-memory
  // context cache (chat.server.ts). Every derived table this run may have
  // written to — findings, analyses, agent findings, scores, theories,
  // opportunities, witnesses, trial prep — is exactly what that cache
  // captures a snapshot of. Reaching this point means the run finished (even
  // if some non-fatal stages failed and finalStatus is "failed" — those
  // stages still wrote whatever partial data they produced), so the cache
  // must be dropped and rebuilt now rather than left to expire on its own
  // TTL. This is what makes "report and chat can briefly disagree after a
  // rerun" impossible instead of merely bounded to ~60s.
  try {
    const { invalidateAndRebuildChatContext } = await import("./intelligence/chat.server");
    await invalidateAndRebuildChatContext(supabase, caseId, {
      runId: correlationId,
      source: "pipeline.finalize",
    });
  } catch (cacheErr) {
    console.warn("[pipeline] talk-to-case cache invalidation failed:", cacheErr);
    trace("pipeline.chat_cache.failed", {
      error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
    });
  }

  trace("pipeline.finalized", {
    total_runtime_ms: Date.now() - runStart,
    final_status: finalStatus,
    preserved_from_multi_agent: preserved,
    failures: stageFailures.length,
    completed: completed.size,
    blocked: blocked.size,
  });
  return { ok: true, completedStages: total, warnings: stageFailures };
}
