// Regression test for the report-quality audit's §4 fix: the Executive
// Dashboard previously showed one flat "Findings: N" number, which reads
// as if every finding carried the same evidentiary weight — the same
// failure class as calling all of them "verified" regardless of whether
// they're a directly-cited fact/holding, an inference, or an unsupported
// AI theory. computeFindingTypeCounts (export.ts) breaks that total down
// by finding_type instead.
import { describe, it, expect } from "vitest";
import { computeFindingTypeCounts } from "@/lib/export";

describe("computeFindingTypeCounts", () => {
  it("the real audited scenario: a mixed set tallies each finding_type separately, never as one 'verified' bucket", () => {
    const findings = [
      { finding_type: "DIRECT_EVIDENCE" },
      { finding_type: "DIRECT_EVIDENCE" },
      { finding_type: "EVIDENCE_BASED_INFERENCE" },
      { finding_type: "AI_THEORY" },
      { finding_type: "AI_THEORY" },
      { finding_type: "AI_THEORY" },
    ];
    expect(computeFindingTypeCounts(findings)).toEqual({ direct: 2, inference: 1, theory: 3 });
  });

  it("counts add up to the total finding count", () => {
    const findings = [
      { finding_type: "DIRECT_EVIDENCE" },
      { finding_type: "EVIDENCE_BASED_INFERENCE" },
      { finding_type: "AI_THEORY" },
    ];
    const c = computeFindingTypeCounts(findings);
    expect(c.direct + c.inference + c.theory).toBe(findings.length);
  });

  it("a finding with no finding_type (legacy row, or a path that never ran the evidence gate) is not silently counted as any bucket", () => {
    const findings = [{ finding_type: "DIRECT_EVIDENCE" }, {}, { finding_type: null }];
    const c = computeFindingTypeCounts(findings);
    expect(c.direct).toBe(1);
    expect(c.direct + c.inference + c.theory).toBe(1);
  });

  it("returns all zeros for an empty findings array", () => {
    expect(computeFindingTypeCounts([])).toEqual({ direct: 0, inference: 0, theory: 0 });
  });

  it("ignores an unrecognized finding_type value rather than crashing", () => {
    const findings = [{ finding_type: "SOMETHING_UNEXPECTED" }, { finding_type: "DIRECT_EVIDENCE" }];
    expect(computeFindingTypeCounts(findings)).toEqual({ direct: 1, inference: 0, theory: 0 });
  });
});
