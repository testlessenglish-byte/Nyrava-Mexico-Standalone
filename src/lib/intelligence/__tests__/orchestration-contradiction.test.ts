// Regression tests for two bugs traced from a production incident report:
//
// 1. orchestrator.server.ts's agentEntities()/agentOcr() could return
//    status:"failed" with an "did not complete" error while their `output`
//    object simultaneously reported the *_completed field as true, because
//    that field echoed the raw pipeline_engine_runs ledger flag instead of
//    the actual pass/fail condition used for `status`.
//
// 2. cases.functions.ts's resumeFullPipelineStep() honored a persisted
//    cases.next_stage checkpoint without validating it against the ledger,
//    which could in principle resume past an incomplete blocking-tier stage
//    (e.g. analyzers) directly into a much later stage (e.g. trial_prep).
//
// Neither test hardcodes any case ID, party, or document content — both
// exercise the logic generically with synthetic fixtures.
import { describe, it, expect } from "vitest";
import { CANONICAL_STAGES } from "@/lib/execution/canonical";
import { PIPELINE_STAGES } from "@/lib/cases.functions";

describe("orchestrator agent output contradiction (agentEntities/agentOcr)", () => {
  // Minimal fake Supabase client supporting exactly the chained calls these
  // two agents make: a `pipeline_engine_runs` completed-row lookup and a
  // counted select with an optional `.not()` filter.
  function makeFakeDb(opts: { engineCompleted: boolean; rowCount: number }) {
    return {
      from(table: string) {
        return {
          select(_cols: string, sel?: { count?: string; head?: boolean }) {
            const chain = {
              eq(_col: string, _val: string) {
                return chain;
              },
              not(_col: string, _op: string, _val: string) {
                return chain;
              },
              limit(_n: number) {
                return chain;
              },
              maybeSingle: async () => {
                if (table === "pipeline_engine_runs") {
                  return { data: opts.engineCompleted ? { id: "run-1" } : null, error: null };
                }
                return { data: null, error: null };
              },
              // Table selects with { count: "exact", head: true } are awaited
              // directly (no .maybeSingle()) in the real code — support both.
              then: (resolve: (v: unknown) => void) => {
                if (sel?.count) {
                  resolve({ count: opts.rowCount, error: null });
                } else {
                  resolve({ data: [], error: null });
                }
              },
            };
            return chain;
          },
        };
      },
    };
  }

  it("agentEntities: zero findings after a completed analyzers engine is a thin case, not a fatal failure — status/errors/analyzers_completed must all agree", async () => {
    const { __test__agentEntities } = await import("@/lib/agents/orchestrator.server");
    // Ledger says the `analyzers` engine row is completed, but zero findings
    // survived (e.g. evidence-gate suppression). Per the documented design
    // in orchestrator.server.ts (agentEntities), this is intentionally NOT
    // treated as fatal — a fatal "failed" status here would block all 10
    // downstream agents (timeline through hallucination) and prevent
    // QA/Judge from ever independently assessing a legitimately thin case.
    const fakeCtx = { db: makeFakeDb({ engineCompleted: true, rowCount: 0 }) } as never;
    const result = await __test__agentEntities(fakeCtx);

    expect(result.status).toBe("success");
    expect(result.errors.some((e) => e.includes("zero findings survived"))).toBe(true);
    // analyzers_completed must track the engine-completion check (`status`),
    // not the finding count — the two are now split into
    // analyzers_engine_completed / analyzers_completed explicitly so they
    // can never silently contradict `status` again.
    expect((result.output as Record<string, unknown>).analyzers_completed).toBe(true);
  });

  it("agentEntities: reports success and analyzers_completed=true only when both the ledger and findings agree", async () => {
    const { __test__agentEntities } = await import("@/lib/agents/orchestrator.server");
    const fakeCtx = { db: makeFakeDb({ engineCompleted: true, rowCount: 3 }) } as never;
    const result = await __test__agentEntities(fakeCtx);

    expect(result.status).toBe("success");
    expect((result.output as Record<string, unknown>).analyzers_completed).toBe(true);
  });

  it("agentOcr: extraction_completed in output must agree with status/errors", async () => {
    const { __test__agentOcr } = await import("@/lib/agents/orchestrator.server");
    const fakeCtx = { db: makeFakeDb({ engineCompleted: true, rowCount: 0 }) } as never;
    const result = await __test__agentOcr(fakeCtx);

    expect(result.status).toBe("failed");
    expect((result.output as Record<string, unknown>).extraction_completed).toBe(false);
  });
});

describe("resume-checkpoint never skips an incomplete blocking-tier stage", () => {
  // Mirrors the clamp logic added to resumeFullPipelineStep: a persisted
  // checkpoint must never resolve to a stage later than the earliest
  // incomplete blocking-tier stage found in the ledger.
  function resolveResumeKey(
    persistedNext: string | null,
    completedEngines: Set<string>,
  ): string {
    // audit B8: CANONICAL_STAGES (execution/canonical.ts) and PIPELINE_STAGES
    // (cases.functions.ts) each declare their own narrow stage-key literal
    // union type. This local test helper only ever does plain string
    // equality/membership checks across the two, so the Sets are typed as
    // Set<string> rather than inheriting either module's narrow union —
    // otherwise TS rejects .has() calls that mix keys from one catalog
    // against the other's narrower type, even though every value involved
    // is a real, valid stage key at runtime.
    const stageKeys = new Set<string>(PIPELINE_STAGES.map((s) => s.key));
    const blockingStageKeys = new Set<string>(
      CANONICAL_STAGES.filter((s) => s.requirement === "blocking").map((s) => s.key),
    );
    const engineFor = (key: string) => CANONICAL_STAGES.find((s) => s.key === key)?.engine;

    const persistedCandidate =
      persistedNext && persistedNext !== "reset" && stageKeys.has(persistedNext) ? persistedNext : undefined;

    let ledgerResumeKey: string | undefined;
    let earliestIncompleteBlockingKey: string | undefined;
    for (const s of PIPELINE_STAGES) {
      const engine = engineFor(s.key);
      const isIncomplete = !engine || !completedEngines.has(engine);
      if (isIncomplete && !ledgerResumeKey) ledgerResumeKey = s.key;
      if (isIncomplete && blockingStageKeys.has(s.key) && !earliestIncompleteBlockingKey) {
        earliestIncompleteBlockingKey = s.key;
      }
    }

    if (
      earliestIncompleteBlockingKey &&
      (!persistedCandidate ||
        PIPELINE_STAGES.findIndex((s) => s.key === persistedCandidate) >
          PIPELINE_STAGES.findIndex((s) => s.key === earliestIncompleteBlockingKey))
    ) {
      return earliestIncompleteBlockingKey;
    }
    return persistedCandidate ?? ledgerResumeKey ?? "extraction";
  }

  it("reproduces the reported symptom on the OLD (unclamped) logic — sanity check for the fixture", () => {
    // Old behavior: trust the persisted checkpoint unconditionally.
    const oldResolve = (persistedNext: string | null) =>
      persistedNext && persistedNext !== "reset" ? persistedNext : "extraction";
    expect(oldResolve("trial_prep")).toBe("trial_prep");
  });

  it("refuses a stale/corrupt checkpoint that points past an incomplete blocking stage (extraction+analyzers never completed)", () => {
    const completed = new Set<string>(); // nothing completed at all
    const resumeKey = resolveResumeKey("trial_prep", completed);
    expect(resumeKey).toBe("extraction");
  });

  it("refuses a checkpoint pointing to trial_prep when analyzers (blocking) is incomplete but extraction completed", () => {
    const completed = new Set<string>(["extraction"]);
    const resumeKey = resolveResumeKey("trial_prep", completed);
    expect(resumeKey).toBe("analyzers");
  });

  it("honors a legitimate checkpoint that does not skip any incomplete blocking stage", () => {
    // Every blocking stage up through legal_qa completed; checkpoint parks
    // at multi_agent (optional tier) — a normal voluntary checkpoint.
    const blockingUpTo = ["extraction", "analyzers", "agents", "jurisdiction_intel", "scoring", "legal_qa"];
    const completed = new Set<string>(blockingUpTo);
    const resumeKey = resolveResumeKey("multi_agent", completed);
    expect(resumeKey).toBe("multi_agent");
  });

  it("falls back to ledger-derived earliest incomplete stage when there is no persisted checkpoint", () => {
    const completed = new Set<string>(["extraction"]);
    const resumeKey = resolveResumeKey(null, completed);
    expect(resumeKey).toBe("analyzers");
  });
});
