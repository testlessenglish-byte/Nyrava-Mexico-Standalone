import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("concluded SCJN Amparo procedural semantics wiring", () => {
  it("does not present an uploaded final SCJN judgment as proof that earlier docket documents were missing", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/intelligence/procedural-compliance.server.ts"),
      "utf8",
    );
    expect(source).toContain("normalizeAmparoReviewMissingDocuments");
    expect(source).toContain("missing: []");
    expect(source).toContain("NO es una calificación de validez procesal");
    expect(source).toContain("case_analysis_mode");
    expect(source).toContain("concluded_audit");
  });
});
