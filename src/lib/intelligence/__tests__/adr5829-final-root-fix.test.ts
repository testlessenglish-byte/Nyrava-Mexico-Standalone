import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("ADR5829 final root fixes", () => {
  it("reconciles personal-notice duty across the verified corpus", () => {
    const source = fs.readFileSync("src/lib/intelligence/findings.server.ts", "utf8");
    expect(source).toContain("corpusDeniesPersonalNoticeDuty");
    expect(source).toContain("isPersonalNoticeDefectClaim");
  });
  it("blocks forward motions for concluded audits while preserving full analysis", () => {
    const source = fs.readFileSync("src/lib/pipeline.server.ts", "utf8");
    expect(source).toContain('reportCaseAnalysisMode === "concluded_audit" ? false : ess.allowMotionGeneration');
    expect(source).toContain("concluded_audit_blocked");
    expect(source).toContain("personalNoticeNoDuty");
  });
});
