// Canonical Reconciliation Design (2026-08-16) — real-case regression guard.
//
// pipeline.server.ts's report-generation stage writes its own per-sub-engine
// audit rows to pipeline_engine_runs (a count of what the report-writer's
// own "intelligence" JSON chunk carried) AFTER the real engines.server.ts
// theory/strategy/opportunity engines have already run and written their
// own rows under the SAME table. buildEnginesSummary() below is documented
// to be last-created-wins BY DESIGN (a genuine re-run overwriting a stale
// failure is supposed to win) — but that only works when both rows
// legitimately describe the SAME engine. Before this fix, the report-writer
// reused the real engines' own key strings ("theory"/"strategy"/
// "opportunity"), so its row — always written later, in the report stage —
// silently clobbered the real engine's runtime_ms/generated/rejected
// telemetry with zeros, making a real, fully-executed engine indistinguishable
// from one that never ran. Confirmed live on case ADR-4640-2017 before the
// fix (renamed to report_theory/report_strategy/report_opportunity in
// pipeline.server.ts). This test exercises the real, unexported-nowhere
// buildEnginesSummary() directly to prove the two rows now coexist.
import { describe, it, expect } from "vitest";
import { buildEnginesSummary } from "@/lib/intelligence/engine-audit.server";

const CASE_ID = "case-engine-summary-1";

function makeFakeDb(rows: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq: () => ({
              order: () => Promise.resolve({ data: table === "pipeline_engine_runs" ? rows : [], error: null }),
            }),
          };
        },
      };
    },
  };
}

describe("buildEnginesSummary: report-writer audit rows must not clobber the real engine's row", () => {
  it("keeps the real theory engine's nonzero runtime/generated counts distinct from the report-writer's own row", async () => {
    const rows = [
      {
        engine: "theory",
        status: "completed",
        runtime_ms: 5400,
        generated: 3,
        accepted: 2,
        rejected: 1,
        suppressed_ess: 0,
        suppressed_validator: 0,
        skipped_reason: null,
        error: null,
        started_at: "2026-08-16T07:20:00.000Z",
        ended_at: "2026-08-16T07:20:05.400Z",
      },
      // Written later, in the report-generation stage — this used to share
      // the "theory" key and win via last-wins ordering.
      {
        engine: "report_theory",
        status: "completed",
        runtime_ms: 0,
        generated: 0,
        accepted: 0,
        rejected: 0,
        suppressed_ess: 0,
        suppressed_validator: 0,
        skipped_reason: null,
        error: null,
        started_at: "2026-08-16T07:27:49.547Z",
        ended_at: "2026-08-16T07:27:49.547Z",
      },
    ];
    const db = makeFakeDb(rows) as never;

    const summary = (await buildEnginesSummary(db, CASE_ID)) as Record<string, { runtime_ms: number; generated: number }>;

    // The real engine's row survives, un-clobbered.
    expect(summary.theory.runtime_ms).toBe(5400);
    expect(summary.theory.generated).toBe(3);
    // The report-writer's own row is present too, under its own key.
    expect(summary.report_theory.runtime_ms).toBe(0);
    expect(summary.report_theory.generated).toBe(0);
  });

  it("still applies last-wins for two rows of the SAME real engine (a genuine re-run overwriting a stale failure)", async () => {
    const rows = [
      { engine: "extraction", status: "failed", runtime_ms: 100, generated: 0, accepted: 0 },
      { engine: "extraction", status: "completed", runtime_ms: 2200, generated: 5, accepted: 5 },
    ];
    const db = makeFakeDb(rows) as never;

    const summary = (await buildEnginesSummary(db, CASE_ID)) as Record<string, { status: string; generated: number }>;

    expect(summary.extraction.status).toBe("completed");
    expect(summary.extraction.generated).toBe(5);
  });
});
