// Production Acceptance Regressions
// ----------------------------------
// These tests lock in the architectural guarantees called out in the
// NYRAVA Final Production Acceptance & Verification Directive. They run
// on pure helpers (no DB / no LLM) so they execute in CI and catch
// re-introduction of the bug classes:
//   1. Report generated before pipeline completion
//   2. Raw JSON / UUIDs leaking into rendered output
//   3. Execution-state derivation drift
//   4. Dashboard vs report disagreement on engine completion
import { describe, it, expect } from "vitest";
import {
  REPORT_REQUIRED_ENGINES,
  REPORT_BLOCKING_ENGINES,
  REPORT_ENRICHING_ENGINES,
  REPORT_MUST_BE_TERMINAL_ENGINES,
  canGenerateReport,
  missingRequiredEngines,
  completedPipelineStageCount,
  pipelineProgressPercent,
  latestRowsByEngine,
  PIPELINE_ENGINE_ORDER,
  COMMAND_CENTER_ENGINES,
  type ExecutionRow,
} from "@/lib/execution-state";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const JSON_OBJ_RE = /^\s*[{[]/;

function row(engine: string, status: ExecutionRow["status"], iso = "2026-01-01T00:00:00Z"): ExecutionRow {
  return { id: `${engine}-${iso}`, engine, status, started_at: iso, ended_at: iso, created_at: iso };
}

describe("Pre-flight report gate (single source of truth)", () => {
  // AUDIT B8/P1-4 — QUARANTINED, NOT FIXED. Do not "fix" these by guessing;
  // this needs an explicit team decision, per the audit's second-pass
  // verification report.
  //
  // These 4 tests describe a two-tier report-gate design (dated 2026-08-03
  // per the comment below): REPORT_BLOCKING_ENGINES narrowed to 6 stages
  // that gate on FAILURE, plus a separate REPORT_MUST_BE_TERMINAL_ENGINES
  // (22 stages) that gates on STILL RUNNING via a `stillInFlight` field on
  // canGenerateReport()'s result. That design is well-reasoned and
  // documented in-line — but it was never actually implemented:
  // `REPORT_MUST_BE_TERMINAL_ENGINES` does not exist in execution-state.ts,
  // `stillInFlight` does not exist on the real `ReportGate` type, and the
  // real `REPORT_BLOCKING_ENGINES` was instead widened to all 22 non-report
  // stages on 2026-07-31 (the code these tests' own comments say was
  // deliberately reverted FROM). `docs/BASELINE.md` §2 independently
  // describes a third, older version (4 named engines) and was never
  // updated either — three sources (code, this test, the frozen doc) each
  // describe different intended behavior.
  //
  // Fixing this requires deciding, not guessing: is the current
  // all-22-stages REPORT_BLOCKING_ENGINES the accepted design (update this
  // test and docs/BASELINE.md to match), or does the two-tier design this
  // test already describes need to actually be implemented (update
  // execution-state.ts/canonical.ts)? Whoever owns the pipeline-contract
  // freeze policy (docs/BASELINE.md §6) should decide, then this
  // `describe.skip` should come off and BASELINE.md updated in the same
  // commit, per that doc's own Freeze Policy.
  it.skip("REPORT_BLOCKING_ENGINES is the failure-gating set: only requirement:'blocking' stages, 6 of them", () => {
    // 2026-08-03: this is intentionally back down from the wider "every
    // stage" set this test asserted on 2026-07-31. That wider version
    // conflated two different concerns — "is this stage still running"
    // and "did this stage succeed" — into one list, which meant a single
    // transient FAILURE in any of ~15 inherently-probabilistic LLM stages
    // (theories, opportunities, strategy, witness_intelligence, etc.)
    // permanently wedged the case, matching the exact "report can't run"
    // failure mode this was meant to prevent in the first place.
    //
    // The corrected design (see REPORT_MUST_BE_TERMINAL_ENGINES /
    // stillInFlightEngines() in canonical.ts) separates the two concerns:
    // REPORT_BLOCKING_ENGINES gates on FAILURE, scoped to only the stages
    // truly required to assemble a report at all; REPORT_MUST_BE_TERMINAL_
    // ENGINES gates on STILL RUNNING, covering every stage, so the report
    // still can't generate while something is genuinely mid-flight (the
    // original work_product "dangling running engine next to a finished
    // report" bug this was all chasing) — without a non-critical failure
    // blocking the case forever.
    expect(REPORT_BLOCKING_ENGINES.length).toBe(6);
    expect(REPORT_BLOCKING_ENGINES).not.toContain("report_generator");
    expect(REPORT_BLOCKING_ENGINES).not.toContain("multi_agent");
    expect(new Set(REPORT_BLOCKING_ENGINES).size).toBe(REPORT_BLOCKING_ENGINES.length);
  });

  it.skip("REPORT_MUST_BE_TERMINAL_ENGINES covers every non-report stage (22) — this is what actually waits for everything", () => {
    // multi_agent now runs BEFORE the report (reordered), so it's a real
    // precondition and must appear here. trial_prep was removed from
    // CANONICAL_STAGES entirely (product decision, 2026-08-02), so the
    // total is 22, not 23.
    expect(REPORT_MUST_BE_TERMINAL_ENGINES.length).toBe(22);
    expect(REPORT_MUST_BE_TERMINAL_ENGINES).not.toContain("report_generator");
    expect(REPORT_MUST_BE_TERMINAL_ENGINES).not.toContain("trial_prep");
    expect(REPORT_MUST_BE_TERMINAL_ENGINES).toContain("multi_agent");
    expect(new Set(REPORT_MUST_BE_TERMINAL_ENGINES).size).toBe(REPORT_MUST_BE_TERMINAL_ENGINES.length);
  });

  it.skip("canGenerateReport refuses while a non-blocking stage is still running, even if every blocking stage succeeded", () => {
    const rows: ExecutionRow[] = [
      ...REPORT_BLOCKING_ENGINES.map((e) => row(e, "completed")),
      ...REPORT_ENRICHING_ENGINES.map((e) => row(e, "completed")),
      row("theory", "running"),
      row("multi_agent", "completed"),
    ];
    const gate = canGenerateReport(rows);
    expect(gate.ok).toBe(false);
    expect(gate.stillInFlight).toContain("theory");
  });

  it.skip("canGenerateReport does NOT permanently block on a non-blocking stage's failure, only on it still running", () => {
    const rows: ExecutionRow[] = [
      ...REPORT_BLOCKING_ENGINES.map((e) => row(e, "completed")),
      ...REPORT_ENRICHING_ENGINES.map((e) => row(e, "completed")),
      row("theory", "failed"),
      row("multi_agent", "completed"),
    ];
    const gate = canGenerateReport(rows);
    expect(gate.ok).toBe(true);
    expect(gate.stillInFlight).toEqual([]);
  });

  it("every required engine is also part of the dashboard command center", () => {
    for (const e of REPORT_REQUIRED_ENGINES) {
      expect(COMMAND_CENTER_ENGINES).toContain(e);
    }
  });

  it("every required engine is part of the canonical pipeline order", () => {
    for (const e of REPORT_REQUIRED_ENGINES) {
      expect(PIPELINE_ENGINE_ORDER).toContain(e);
    }
  });

  it("rejects report generation when any required engine has not completed", () => {
    const partial: ExecutionRow[] = REPORT_REQUIRED_ENGINES.slice(0, -1).map((e) => row(e, "completed"));
    const missing = missingRequiredEngines(partial);
    expect(missing).toEqual([REPORT_REQUIRED_ENGINES[REPORT_REQUIRED_ENGINES.length - 1]]);
  });

  it("rejects report when an engine is failed, queued, or running", () => {
    for (const bad of ["failed", "queued", "running"] as const) {
      const rows: ExecutionRow[] = REPORT_REQUIRED_ENGINES.map((e, i) => row(e, i === 0 ? bad : "completed"));
      const missing = missingRequiredEngines(rows);
      expect(missing).toEqual([REPORT_REQUIRED_ENGINES[0]]);
    }
  });

  it("uses the latest row per engine (no stale completions)", () => {
    const rows: ExecutionRow[] = [
      row("extraction", "completed", "2026-01-01T00:00:00Z"),
      row("extraction", "failed", "2026-01-02T00:00:00Z"),
      ...REPORT_REQUIRED_ENGINES.slice(1).map((e) => row(e, "completed")),
    ];
    expect(missingRequiredEngines(rows)).toEqual(["extraction"]);
  });

  it("allows report when every required engine is completed", () => {
    const rows: ExecutionRow[] = REPORT_REQUIRED_ENGINES.map((e) => row(e, "completed"));
    expect(missingRequiredEngines(rows)).toEqual([]);
  });
});

describe("Dashboard / pipeline / report agreement", () => {
  it("progress % is monotonic in completed engines", () => {
    const rows: ExecutionRow[] = [];
    let prev = -1;
    for (const e of PIPELINE_ENGINE_ORDER) {
      rows.push(row(e, "completed"));
      const pct = pipelineProgressPercent(rows);
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
    expect(pipelineProgressPercent(rows)).toBe(100);
    expect(completedPipelineStageCount(rows)).toBe(PIPELINE_ENGINE_ORDER.length);
  });

  it("derivation is pure — repeated reads yield identical results", () => {
    const rows: ExecutionRow[] = REPORT_REQUIRED_ENGINES.map((e) => row(e, "completed"));
    const a = JSON.stringify([...latestRowsByEngine(rows).entries()].sort());
    const b = JSON.stringify([...latestRowsByEngine(rows).entries()].sort());
    expect(a).toBe(b);
  });

  it("running/queued engines do NOT count toward completion", () => {
    const rows: ExecutionRow[] = [row("extraction", "running"), row("analyzers", "queued"), row("agents", "completed")];
    expect(completedPipelineStageCount(rows)).toBe(1);
  });
});

describe("Render sanitization (no raw JSON / UUIDs in reports)", () => {
  // Mirror of export.ts `asStr` — locked here so a regression in the
  // sanitizer is caught even before invoking jsPDF.
  function asStr(v: unknown, fallback = ""): string {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return fallback;
  }

  it("never stringifies objects or arrays into the output", () => {
    const cases: unknown[] = [
      { id: "f0e9c4a2-1234-4abc-9def-0123456789ab", text: "x" },
      [{ a: 1 }, { b: 2 }],
      new Map([["k", "v"]]),
      new Date(),
    ];
    for (const c of cases) {
      const out = asStr(c, "");
      expect(out).toBe("");
      expect(JSON_OBJ_RE.test(out)).toBe(false);
      expect(UUID_RE.test(out)).toBe(false);
    }
  });

  it("preserves legitimate text content untouched", () => {
    expect(asStr("Defendant moved to suppress.")).toBe("Defendant moved to suppress.");
    expect(asStr(42)).toBe("42");
    expect(asStr(true)).toBe("true");
  });

  it("UUID regex catches representative ids", () => {
    expect(UUID_RE.test("case_id=f0e9c4a2-1234-4abc-9def-0123456789ab")).toBe(true);
    expect(UUID_RE.test("Motion to Suppress")).toBe(false);
  });
});

describe("Engine identity (no silent drift between layers)", () => {
  it("execution-state ids are kebab/snake_case strings (no spaces)", () => {
    for (const e of PIPELINE_ENGINE_ORDER) {
      expect(e).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("REPORT_REQUIRED_ENGINES is a strict subset of PIPELINE_ENGINE_ORDER", () => {
    const order = new Set(PIPELINE_ENGINE_ORDER);
    for (const e of REPORT_REQUIRED_ENGINES) expect(order.has(e)).toBe(true);
  });
});
