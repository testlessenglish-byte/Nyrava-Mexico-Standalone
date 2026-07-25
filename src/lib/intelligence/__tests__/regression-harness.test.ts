// Regression harness — Phase 6.5 acceptance milestone.
//
// One command (`vitest run regression-harness`) runs a set of canonical
// fictional cases through the pipeline's *pure* logic layer and asserts the
// attorney-grade outputs (dependency propagation, blocked/failed shape,
// completion counts) match golden expectations.
//
// The harness deliberately AVOIDS network / AI calls — every fixture supplies
// deterministic pre-computed engine outputs. The point is to catch
// regressions in the deterministic layers that assemble AI output into
// attorney-grade artifacts. AI-side regressions are caught by
// response-schema validation on live runs, not here.
//
// Fixture stage keys MUST match CANONICAL_STAGES[i].key from
// src/lib/execution/canonical.ts (theories, opportunities, witness,
// evidence_intel, discovery, constitutional, ...). Add a new fixture under
// fixtures/regression/*.json following the RegressionCase shape.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_STAGES } from "../../execution/canonical";
import { sha256Hex } from "../../ai/telemetry.server";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures", "regression");

type Status = "complete" | "failed" | "blocked";
type EngineOutcome = { status: Status; findings?: number };

type RegressionCase = {
  id: string;
  description: string;
  stageOutcomes: Record<string, EngineOutcome>;
  expected: {
    stageCount: number;
    failedStages: string[];
    blockedStages: string[];
    completeStages: string[];
    outputHash?: string;
  };
};

function loadFixtures(): RegressionCase[] {
  let files: string[] = [];
  try {
    files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files.map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8")) as RegressionCase);
}

/**
 * Propagate failures/blocks along CANONICAL_STAGES.dependsOn. Mirrors the
 * runtime logic in pipeline-runner.server.ts so regressions in dependency
 * shape are detected without spinning up the actual runner.
 */
function propagate(outcomes: Record<string, EngineOutcome>): Array<{ key: string; status: Status }> {
  const failed = new Set<string>();
  const blocked = new Set<string>();
  const complete = new Set<string>();
  for (const stage of CANONICAL_STAGES) {
    const o = outcomes[stage.key];
    if (!o) continue;
    const unmet = stage.dependsOn.filter((d) => failed.has(d) || blocked.has(d));
    if (unmet.length > 0) { blocked.add(stage.key); continue; }
    if (o.status === "failed") failed.add(stage.key);
    else if (o.status === "blocked") blocked.add(stage.key);
    else complete.add(stage.key);
  }
  const results: Array<{ key: string; status: Status }> = [];
  for (const stage of CANONICAL_STAGES) {
    if (!(stage.key in outcomes)) continue;
    if (failed.has(stage.key)) results.push({ key: stage.key, status: "failed" });
    else if (blocked.has(stage.key)) results.push({ key: stage.key, status: "blocked" });
    else if (complete.has(stage.key)) results.push({ key: stage.key, status: "complete" });
  }
  return results;
}

function canonicalHash(input: unknown): string {
  return sha256Hex([JSON.stringify(input)]);
}

describe("regression harness", () => {
  const fixtures = loadFixtures();

  it("has at least one canonical fixture", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const c of fixtures) {
    it(`case ${c.id}: ${c.description}`, () => {
      const results = propagate(c.stageOutcomes);
      const complete = results.filter((r) => r.status === "complete").map((r) => r.key).sort();
      const failed = results.filter((r) => r.status === "failed").map((r) => r.key).sort();
      const blocked = results.filter((r) => r.status === "blocked").map((r) => r.key).sort();

      expect(results.length).toBe(c.expected.stageCount);
      expect(failed).toEqual([...c.expected.failedStages].sort());
      expect(blocked).toEqual([...c.expected.blockedStages].sort());
      expect(complete).toEqual([...c.expected.completeStages].sort());

      if (c.expected.outputHash) {
        expect(canonicalHash({ complete, failed, blocked })).toBe(c.expected.outputHash);
      }
    });
  }
});
