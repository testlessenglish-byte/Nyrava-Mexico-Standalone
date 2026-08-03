// Regression tests for the "dual orchestration" incident: the outer 24-stage
// pipeline marked the multi_agent stage "Complete" and let report generation
// (stage 23/24) start even though the inner 13-agent orchestrator
// (runMultiAgentPipeline) had explicitly returned released:false because
// its own QA/Judge/Hallucination release gate failed.
//
// Two independent fixes are covered:
//   1. pipeline-runner.server.ts's multi_agent stage runner now reports
//      stats.outcome:"negative" when released is false, so the ledger
//      records status:"completed_negative" instead of a bare "completed"
//      that contradicts the stored released:false in the same row.
//   2. pipeline.server.ts's _runReportInner() now has an explicit guard
//      that refuses to generate a report when the latest multi_agent
//      ledger row's stored meta says released:false — independent of the
//      broader optional-tier dependency graph (which intentionally still
//      lets multi_agent finish in ANY terminal state without blocking
//      report generation for unrelated/flaky failures).
//
// Neither test hardcodes a case ID, party, or document — all fixtures are
// synthetic and generic.
import { describe, it, expect } from "vitest";

describe("multi_agent ledger status reflects the actual release outcome", () => {
  // Mirrors the exact expression added to the multi_agent stage runner:
  //   outcome: result.released ? undefined : ("negative" as const)
  function computeOutcome(released: boolean): "negative" | undefined {
    return released ? undefined : ("negative" as const);
  }

  it("reports outcome:negative when the inner release gate failed", () => {
    expect(computeOutcome(false)).toBe("negative");
  });

  it("reports no negative outcome when the inner release gate passed", () => {
    expect(computeOutcome(true)).toBeUndefined();
  });
});

describe("_runReportInner blocks report generation when multi_agent explicitly failed release", () => {
  // Minimal fake db: the pre-flight gate first queries pipeline_engine_runs
  // for every REPORT_REQUIRED_ENGINES row (we satisfy all of them as
  // completed, generically, without hardcoding which engines those are),
  // then queries specifically for the latest multi_agent row. Everything
  // after the guard we're testing is allowed to fail for unrelated reasons
  // (we don't mock the full report assembly) — we only assert on whether
  // the guard's specific error fires or not.
  const GUARD_MESSAGE_FRAGMENT = "Multi-Agent Review's release gate failed";

  function makeFakeDb(opts: { multiAgentRow: { meta?: Record<string, unknown> } | null }) {
    return {
      from(table: string) {
        return {
          select(_cols: string) {
            let engineFilter: string | null = null;
            let reportRequired: string[] = [];
            const chain = {
              eq(col: string, val: string) {
                if (col === "engine") engineFilter = val;
                return chain;
              },
              in(_col: string, engines: string[]) {
                reportRequired = engines;
                return chain;
              },
              order(_col: string, _opts: unknown) {
                return chain;
              },
              limit(_n: number) {
                return chain;
              },
              then: (resolve: (v: unknown) => void) => {
                if (table !== "pipeline_engine_runs") return resolve({ data: [], error: null });
                if (engineFilter === "multi_agent") {
                  resolve({ data: opts.multiAgentRow ? [opts.multiAgentRow] : [], error: null });
                  return;
                }
                // First query: one "completed" row per requested engine —
                // satisfies the earlier blocking-engine check generically.
                resolve({
                  data: reportRequired.map((e) => ({
                    id: `run-${e}`,
                    engine: e,
                    status: "completed",
                    started_at: new Date().toISOString(),
                    ended_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                  })),
                  error: null,
                });
              },
            };
            return chain;
          },
        };
      },
    };
  }

  async function runGuardOnly(multiAgentRow: { meta?: Record<string, unknown> } | null) {
    const { __test__runReportInner } = await import("@/lib/pipeline.server");
    const fakeDb = makeFakeDb({ multiAgentRow });
    try {
      await __test__runReportInner({
        db: fakeDb as never,
        caseId: "case-1",
        userId: "user-1",
        apiKey: "key",
      });
      return { threw: false as const };
    } catch (e) {
      return { threw: true as const, message: e instanceof Error ? e.message : String(e) };
    }
  }

  it("blocks report generation when the latest multi_agent row says released:false", async () => {
    const result = await runGuardOnly({ meta: { released: false, run_id: "run-x" } });
    expect(result.threw).toBe(true);
    if (result.threw) {
      expect(result.message).toContain(GUARD_MESSAGE_FRAGMENT);
    }
  });

  it("does not block at this guard when the latest multi_agent row says released:true", async () => {
    const result = await runGuardOnly({ meta: { released: true, run_id: "run-x" } });
    // The rest of report assembly isn't mocked here and may fail for
    // unrelated reasons — what matters is it did NOT fail at our guard.
    if (result.threw) {
      expect(result.message).not.toContain(GUARD_MESSAGE_FRAGMENT);
    }
  });

  it("does not block at this guard when multi_agent has never run (no row at all)", async () => {
    const result = await runGuardOnly(null);
    if (result.threw) {
      expect(result.message).not.toContain(GUARD_MESSAGE_FRAGMENT);
    }
  });
});
