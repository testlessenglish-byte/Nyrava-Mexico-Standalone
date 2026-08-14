// Report-quality audit §3: the six-state audit_classification taxonomy
// (VERIFIED_FACT/VERIFIED_COURT_HOLDING/VERIFIED_LEGAL_RULE/SUPPORTED_INFERENCE/
// POTENTIAL_ISSUE/EVIDENCE_GAP/NOT_FOUND) was already in every agent's JSON
// schema unconditionally, and attorney-workproduct.ts's groupForFinding()
// already reads it for every report regardless of case_analysis_mode — but
// the instructions explaining what each value MEANS only shipped inside
// getCaseAnalysisObjective(), which is null for "ongoing" mode (the default
// almost every case is actually in). This left ordinary cases with a schema
// slot for the classification and no guidance on how to fill it.
import { describe, it, expect } from "vitest";
import {
  getAuditClassificationInstructions,
  getCaseAnalysisObjective,
} from "@/lib/intelligence/case-analysis-mode";

describe("getAuditClassificationInstructions", () => {
  it("is never null — the classification taxonomy applies to every case, not just completed-case audits", () => {
    expect(getAuditClassificationInstructions("es")).toBeTruthy();
    expect(getAuditClassificationInstructions("en")).toBeTruthy();
  });

  it("lists all six audit_classification values with their definitions, in Spanish", () => {
    const text = getAuditClassificationInstructions("es");
    expect(text).toContain("VERIFIED_FACT");
    expect(text).toContain("VERIFIED_COURT_HOLDING");
    expect(text).toContain("VERIFIED_LEGAL_RULE");
    expect(text).toContain("SUPPORTED_INFERENCE");
    expect(text).toContain("POTENTIAL_ISSUE");
    expect(text).toContain("EVIDENCE_GAP");
    expect(text).toContain("NOT_FOUND");
  });

  it("lists all six audit_classification values with their definitions, in English", () => {
    const text = getAuditClassificationInstructions("en");
    expect(text).toContain("VERIFIED_FACT");
    expect(text).toContain("VERIFIED_COURT_HOLDING");
    expect(text).toContain("VERIFIED_LEGAL_RULE");
    expect(text).toContain("SUPPORTED_INFERENCE");
    expect(text).toContain("POTENTIAL_ISSUE");
    expect(text).toContain("EVIDENCE_GAP");
    expect(text).toContain("NOT_FOUND");
  });

  it("carries the NEVER CONFUSE guardrails and no longer references the nonexistent INSUFFICIENT_DATA value", () => {
    const es = getAuditClassificationInstructions("es");
    const en = getAuditClassificationInstructions("en");
    expect(es).toMatch(/NUNCA CONFUNDIR/);
    expect(en).toMatch(/NEVER CONFUSE/);
    expect(es).not.toContain("INSUFFICIENT_DATA");
    expect(en).not.toContain("INSUFFICIENT_DATA");
  });
});

describe("getCaseAnalysisObjective still carries the classification instructions for completed-case modes", () => {
  it("returns null for 'ongoing' (unchanged behavior — every existing case's prompt stays byte-for-byte the same)", () => {
    expect(getCaseAnalysisObjective("ongoing", "es")).toBeNull();
    expect(getCaseAnalysisObjective("ongoing", "en")).toBeNull();
  });

  it("still includes the full classification taxonomy for 'concluded_audit', not just the objective framing", () => {
    const objective = getCaseAnalysisObjective("concluded_audit", "es");
    expect(objective).toBeTruthy();
    expect(objective as string).toContain("VERIFIED_COURT_HOLDING");
    expect(objective as string).toContain("SUPPORTED_INFERENCE");
    expect(objective as string).toMatch(/NUNCA CONFUNDIR/);
  });

  it("is not duplicated inside itself — getAuditClassificationInstructions() text appears exactly once", () => {
    const objective = getCaseAnalysisObjective("judgment_audit", "en") as string;
    const occurrences = objective.split("VERIFIED_COURT_HOLDING").length - 1;
    expect(occurrences).toBe(1);
  });
});
