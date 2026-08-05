// Regression tests for the report RELEASE ORDERING contract.
//
// Contract (pipeline correctness fix):
//   1. The report is generated and saved first.
//   2. Post-generation quality checks + the final multi-agent review run
//      against that COMPLETED report.
//   3. Only then is the release decision made, and the final status written
//      exactly once by the final review.
//
// Consequences covered here:
//   - The pre-report multi_agent pass is PRELIMINARY: it must not write the
//     case's release status (deferRelease) and its verdict must never block
//     report generation. A report can never be blocked simply because it has
//     not been generated/reviewed yet.
//   - A report can never be marked "released" before a completed report has
//     been reviewed: runFinalReleaseReview() refuses to release (and writes
//     no "released" status) when no saved report exists.
//   - A reviewed report that fails the gates is marked "needs_revision".
//
// No case IDs, parties or documents are hardcoded — all fixtures are
// synthetic and generic.
import { describe, it, expect } from "vitest";

const GUARD_MESSAGE_FRAGMENT = "Multi-Agent Review's release gate failed";

describe("report generation is never blocked by a pre-report release verdict", () => {
  // Minimal fake db: satisfies the blocking-engine pre-flight generically,
  // and reports a latest multi_agent row whose preliminary verdict failed.
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

  it("does not block generation when the preliminary multi_agent verdict was negative", async () => {
    const result = await runGuardOnly({
      meta: { released: null, preliminary_released: false, release_deferred: true, run_id: "run-x" },
    });
    if (result.threw) {
      expect(result.message).not.toContain(GUARD_MESSAGE_FRAGMENT);
    }
  });

  it("does not block generation when the preliminary verdict passed", async () => {
    const result = await runGuardOnly({
      meta: { released: null, preliminary_released: true, release_deferred: true, run_id: "run-x" },
    });
    if (result.threw) {
      expect(result.message).not.toContain(GUARD_MESSAGE_FRAGMENT);
    }
  });

  it("does not block generation when multi_agent has never run", async () => {
    const result = await runGuardOnly(null);
    if (result.threw) {
      expect(result.message).not.toContain(GUARD_MESSAGE_FRAGMENT);
    }
  });
});

describe("release decision requires a completed, reviewed report", () => {
  type Update = { table: string; values: Record<string, unknown> };

  // Permissive fake db: every query resolves to empty data, except the
  // `reports` row which the test controls. Records every update so we can
  // assert on what status (if any) was written.
  function makeReviewDb(opts: { report: Record<string, unknown> | null; updates: Update[] }) {
    const makeChain = (table: string): Record<string, unknown> => {
      const data = table === "reports" ? opts.report : null;
      const chain: Record<string, unknown> = {};
      const passthrough = ["eq", "neq", "in", "not", "is", "order", "limit", "gte", "lte", "like", "filter"];
      for (const m of passthrough) chain[m] = () => chain;
      chain["select"] = () => chain;
      chain["maybeSingle"] = async () => ({ data, error: null });
      chain["single"] = async () => ({ data, error: null });
      chain["insert"] = () => chain;
      chain["upsert"] = () => chain;
      chain["delete"] = () => chain;
      chain["update"] = (values: Record<string, unknown>) => {
        opts.updates.push({ table, values });
        return chain;
      };
      chain["then"] = (resolve: (v: unknown) => void) =>
        resolve({ data: table === "reports" ? (data ? [data] : []) : [], error: null, count: 0 });
      return chain;
    };
    return { from: (table: string) => makeChain(table), rpc: async () => ({ data: null, error: null }) };
  }

  it("never releases — and writes no released status — when no completed report exists", async () => {
    const updates: Update[] = [];
    const { runFinalReleaseReview } = await import("@/lib/agents/orchestrator.server");
    const review = await runFinalReleaseReview({
      db: makeReviewDb({ report: null, updates }) as never,
      caseId: "case-1",
      userId: "user-1",
      apiKey: "key",
      apiKeys: ["key"],
    });

    expect(review.reviewed).toBe(false);
    expect(review.released).toBe(false);
    expect(review.status).toBe("failed");
    expect(updates.some((u) => u.table === "cases" && u.values["status"] === "released")).toBe(false);
  });

  it("marks a reviewed report that fails the gates as needs_revision, writing status once", async () => {
    const updates: Update[] = [];
    const { runFinalReleaseReview } = await import("@/lib/agents/orchestrator.server");
    const review = await runFinalReleaseReview({
      db: makeReviewDb({ report: { case_id: "case-1", full_report: null }, updates }) as never,
      caseId: "case-1",
      userId: "user-1",
      apiKey: "key",
      apiKeys: ["key"],
    });

    expect(review.reviewed).toBe(true);
    expect(review.released).toBe(false);
    expect(review.status).toBe("needs_revision");
    const statusWrites = updates.filter((u) => u.table === "cases" && "status" in u.values);
    expect(statusWrites.length).toBe(1);
    expect(statusWrites[0]?.values["status"]).toBe("needs_revision");
  });
});

describe("the pre-report multi_agent pass defers the release decision", () => {
  it("passes deferRelease into the orchestrator from both pipeline runners", async () => {
    const fs = await import("node:fs/promises");
    for (const file of ["src/lib/pipeline.server.ts", "src/lib/pipeline-runner.server.ts"]) {
      const src = await fs.readFile(file, "utf8");
      const stage = src.slice(src.indexOf("runMultiAgentPipeline({"));
      expect(stage.slice(0, 600)).toContain("deferRelease: true");
    }
  });

  it("skips the case status write when deferRelease is set", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/agents/orchestrator.server.ts", "utf8");
    expect(src).toContain("if (args.deferRelease)");
    expect(src).toContain("releaseDeferred: true");
  });
});
