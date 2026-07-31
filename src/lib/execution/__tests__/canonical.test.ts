import { describe, it, expect } from "vitest";
import {
  CANONICAL_STAGES,
  STAGE_BY_KEY,
  STAGE_BY_ENGINE,
  REPORT_BLOCKING_ENGINES,
  REPORT_ENRICHING_ENGINES,
  computeProgress,
  computeStageViews,
  canGenerateReport,
  latestRowsByEngine,
  deriveStageState,
  type ExecutionRow,
} from "../canonical";

const now = new Date().toISOString();

function row(engine: string, status: ExecutionRow["status"], overrides: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    id: `${engine}-${status}-${Math.random()}`,
    engine,
    status,
    started_at: now,
    ended_at: status === "completed" || status === "failed" ? now : null,
    created_at: now,
    ...overrides,
  };
}

describe("canonical execution architecture", () => {
  it("exposes exactly one stage list with unique keys and engines", () => {
    const keys = new Set(CANONICAL_STAGES.map((s) => s.key));
    const engines = new Set(CANONICAL_STAGES.map((s) => s.engine));
    expect(keys.size).toBe(CANONICAL_STAGES.length);
    expect(engines.size).toBe(CANONICAL_STAGES.length);
  });

  it("bidirectional indexes stay in sync", () => {
    for (const s of CANONICAL_STAGES) {
      expect(STAGE_BY_KEY.get(s.key)).toBe(s);
      expect(STAGE_BY_ENGINE.get(s.engine)).toBe(s);
    }
  });

  it("dependency graph is acyclic and references known stages", () => {
    const keys = new Set(CANONICAL_STAGES.map((s) => s.key));
    for (const s of CANONICAL_STAGES) {
      for (const dep of s.dependsOn) {
        expect(keys.has(dep)).toBe(true);
        expect(dep).not.toBe(s.key);
      }
    }
    // Topological sort must succeed with the declared order.
    const seen = new Set<string>();
    for (const s of CANONICAL_STAGES) {
      for (const dep of s.dependsOn) expect(seen.has(dep)).toBe(true);
      seen.add(s.key);
    }
  });

  it("classifies every stage except report_generator and multi_agent as blocking for the report gate (2026-07-31: widened from the requirement:'blocking' subset per explicit direction — report must not generate until everything has run)", () => {
    const expected = CANONICAL_STAGES.filter((s) => s.engine !== "report_generator" && s.key !== "multi_agent").map(
      (s) => s.engine,
    );
    expect([...REPORT_BLOCKING_ENGINES].sort()).toEqual([...expected].sort());
    expect(REPORT_BLOCKING_ENGINES).not.toContain("report_generator");
    expect(REPORT_BLOCKING_ENGINES).not.toContain("multi_agent");
    expect(REPORT_ENRICHING_ENGINES.length).toBeGreaterThan(0);
  });

  it("report gate blocks when any blocking engine has not completed", () => {
    const partial = REPORT_BLOCKING_ENGINES.slice(0, -1).map((e) => row(e, "completed"));
    const gate = canGenerateReport(partial);
    expect(gate.ok).toBe(false);
    expect(gate.missingBlocking.length).toBeGreaterThan(0);
  });

  it("report gate passes when every blocking engine is completed or skipped", () => {
    const rows = REPORT_BLOCKING_ENGINES.map((e, i) => row(e, i === 0 ? "skipped" : "completed"));
    expect(canGenerateReport(rows).ok).toBe(true);
  });

  it("deriveStageState respects upstream state before promoting to waiting", () => {
    const latest = latestRowsByEngine([row("extraction", "running")]);
    const upstream = new Map<string, "running" | "complete">([["extraction", "running"]]);
    expect(deriveStageState("analyzers", latest, upstream)).toBe("locked");
    upstream.set("extraction", "complete");
    const latest2 = latestRowsByEngine([row("extraction", "completed")]);
    expect(deriveStageState("analyzers", latest2, upstream)).toBe("waiting");
  });

  it("computeStageViews returns every stage in canonical order", () => {
    const views = computeStageViews([]);
    expect(views.length).toBe(CANONICAL_STAGES.length);
    for (let i = 0; i < CANONICAL_STAGES.length; i++) {
      expect(views[i].key).toBe(CANONICAL_STAGES[i].key);
    }
  });

  it("computeProgress percent tracks completed + skipped, excluding multi_agent", () => {
    const rows = [row("extraction", "completed"), row("analyzers", "completed"), row("agents", "skipped")];
    const p = computeProgress(rows);
    // 3 counted out of (CANONICAL_STAGES.length - 1) since multi_agent is excluded.
    expect(p.completedStages).toBe(3);
    expect(p.totalStages).toBe(CANONICAL_STAGES.length - 1);
    expect(p.percent).toBe(Math.round((3 / (CANONICAL_STAGES.length - 1)) * 100));
    expect(p.hasFailures).toBe(false);
    expect(p.isRunning).toBe(false);
  });

  it("latestRowsByEngine keeps the most recent row per engine", () => {
    const older = row("extraction", "failed", { created_at: "2026-01-01T00:00:00Z" });
    const newer = row("extraction", "completed", { created_at: "2026-06-01T00:00:00Z" });
    const map = latestRowsByEngine([older, newer]);
    expect(map.get("extraction")?.status).toBe("completed");
  });
});
