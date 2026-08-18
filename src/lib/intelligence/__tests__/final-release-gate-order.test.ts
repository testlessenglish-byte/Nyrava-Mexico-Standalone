import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("final release gate order", () => {
  it("runs hallucination reconciliation before Judge", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/agents/orchestrator.server.ts"),
      "utf8",
    );
    const finalReview = source.slice(source.indexOf("async function _runFinalReleaseReview"));
    const hallucination = finalReview.indexOf('["hallucination", agentHallucination]');
    const judge = finalReview.indexOf('["judge", agentJudge]');
    expect(hallucination).toBeGreaterThan(-1);
    expect(judge).toBeGreaterThan(-1);
    expect(hallucination).toBeLessThan(judge);
  });
});
