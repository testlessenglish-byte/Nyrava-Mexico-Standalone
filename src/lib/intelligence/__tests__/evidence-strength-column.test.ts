// Regression test for a real bug found on the ADR 4640/2017 completed-case
// audit: case_findings.evidence_strength (a numeric column added by the
// "Intelligence Aggregation Refactor" migration, 20260730052549,
// specifically so evidence STRENGTH could be tracked separately from legal
// SEVERITY) was null on every single finding in every case — nothing in
// findings.server.ts's single insert choke point ever wrote to it. That's
// the literal mechanism behind spec item #9: "HIGH severity while evidence
// is only Moderada" reads as inconsistent because the report had no
// separate evidence-strength signal to show.
//
// The fix reuses a signal that already existed one field over:
// deriveConfidenceDimensions() (confidence-dimensions.ts) already computes
// evidence_quality per finding from real corroboration signals (how many
// independent evidence_refs a finding cites) — never the model's
// self-report. evidenceStrengthFromDimensions() maps that already-computed,
// already-deterministic level onto the flat numeric column the schema
// provisioned for exactly this purpose.
import { describe, it, expect } from "vitest";
import {
  deriveConfidenceDimensions,
  evidenceStrengthFromDimensions,
} from "../confidence-dimensions";

describe("evidenceStrengthFromDimensions", () => {
  it("maps each evidence_quality level to a distinct numeric strength", () => {
    expect(
      evidenceStrengthFromDimensions({ evidence_quality: { level: "high", reason: "" } } as never),
    ).toBe(0.85);
    expect(
      evidenceStrengthFromDimensions({
        evidence_quality: { level: "moderate", reason: "" },
      } as never),
    ).toBe(0.55);
    expect(
      evidenceStrengthFromDimensions({ evidence_quality: { level: "low", reason: "" } } as never),
    ).toBe(0.25);
  });

  it("never invents a number for 'indeterminate' or missing dimensions — stays null, honestly", () => {
    expect(
      evidenceStrengthFromDimensions({
        evidence_quality: { level: "indeterminate", reason: "" },
      } as never),
    ).toBeNull();
    expect(evidenceStrengthFromDimensions(null)).toBeNull();
    expect(evidenceStrengthFromDimensions(undefined)).toBeNull();
  });

  it("reflects the real-world case: a HIGH-severity finding backed by only one uncorroborated quote gets MODERATE evidence strength, not implicitly 'confirmed'", () => {
    // Real content from ADR 4640/2017: "Inoperancia de Agravios Nuevos",
    // severity high, exactly one evidence_refs entry.
    const dims = deriveConfidenceDimensions({
      raw: {},
      overallConfidence: 0.9,
      evidenceRefCount: 1,
      sourceDocCount: 1,
    });
    expect(dims.evidence_quality.level).toBe("moderate");
    expect(evidenceStrengthFromDimensions(dims)).toBe(0.55);
    // The point of the fix: severity (high, set elsewhere) and this number
    // are independent — nothing here forces evidence_strength up to match
    // a high-severity label.
  });

  it("two independent corroborating references earn HIGH evidence strength", () => {
    const dims = deriveConfidenceDimensions({
      raw: {},
      overallConfidence: 0.9,
      evidenceRefCount: 2,
      sourceDocCount: 2,
    });
    expect(dims.evidence_quality.level).toBe("high");
    expect(evidenceStrengthFromDimensions(dims)).toBe(0.85);
  });
});
