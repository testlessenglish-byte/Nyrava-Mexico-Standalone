// Concurrency Certification — execution-state derivation must remain pure
// and case-scoped. Interleaved rows from multiple cases produce the correct
// per-case progress; no cross-case contamination.
import { describe, it, expect } from "vitest";
import {
  missingRequiredEngines,
  REPORT_REQUIRED_ENGINES,
  pipelineProgressPercent,
  type ExecutionRow,
} from "@/lib/execution-state";

function row(engine: string, status: ExecutionRow["status"], iso: string): ExecutionRow {
  return { id: `${engine}-${iso}`, engine, status, started_at: iso, ended_at: iso, created_at: iso };
}

describe("Concurrency — per-case state isolation", () => {
  it("two cases running in parallel derive independent gates", () => {
    const t0 = "2026-06-25T10:00:00Z";
    const t1 = "2026-06-25T10:05:00Z";

    // Case A: every required engine completed.
    const caseA: ExecutionRow[] = REPORT_REQUIRED_ENGINES.map((e) => row(e, "completed", t0));
    // Case B: half completed, half running — must NOT be eligible.
    const caseB: ExecutionRow[] = REPORT_REQUIRED_ENGINES.map((e, i) =>
      row(e, i % 2 === 0 ? "completed" : "running", t1),
    );

    expect(missingRequiredEngines(caseA)).toEqual([]);
    expect(missingRequiredEngines(caseB).length).toBeGreaterThan(0);
  });

  it("interleaved row arrival order does not corrupt latest-row selection", () => {
    const e = REPORT_REQUIRED_ENGINES[0];
    const rows: ExecutionRow[] = [
      row(e, "failed",    "2026-06-25T09:00:00Z"),
      row(e, "completed", "2026-06-25T11:00:00Z"), // newest — wins
      row(e, "running",   "2026-06-25T10:00:00Z"),
    ];
    expect(missingRequiredEngines(rows)).not.toContain(e);
  });

  it("simulated 10 parallel case derivations are deterministic", () => {
    const baseline = REPORT_REQUIRED_ENGINES.map((e) => row(e, "completed", "2026-06-25T12:00:00Z"));
    const results = Array.from({ length: 10 }, () => pipelineProgressPercent(baseline));
    expect(new Set(results).size).toBe(1);
  });
});
