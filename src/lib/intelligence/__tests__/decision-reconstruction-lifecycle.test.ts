import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("decision reconstruction lifecycle", () => {
  it("waits for extracted_at and reruns stale pre-extraction markers", () => {
    const source = fs.readFileSync(
      path.resolve("src/lib/intelligence/decision-reconstruction-extractor.server.ts"),
      "utf8",
    );
    const ensure = source.slice(
      source.indexOf("export async function ensureDecisionReconstruction"),
    );
    expect(ensure).toContain('.select("extracted_at")');
    expect(ensure).toContain("if (!Number.isFinite(extractedAt)) return null");
    expect(ensure).toContain("latestCreatedAt >= extractedAt");
    expect(ensure).toContain("return buildDecisionReconstruction(db, caseId, userId, apiKey)");
  });

  it("promotes the decision core immediately after successful extraction", () => {
    const source = fs.readFileSync(path.resolve("src/lib/pipeline-runner.server.ts"), "utf8");
    const extractionCompletion = source.indexOf(
      'if (key === "extraction" && outcome.kind === "success")',
    );
    expect(extractionCompletion).toBeGreaterThan(
      source.indexOf("const outcome = await runOneStage"),
    );
    expect(source.slice(extractionCompletion, extractionCompletion + 180)).toContain(
      "await ensureAndPromoteDecisionCore()",
    );
  });
});

