// Regression test for the manual-override-vs-source-classification decision
// in updateCaseSettings (cases.functions.ts) — extracted as
// resolveCaseTypeSourceConflict() specifically so it's directly unit-testable
// without the createServerFn/auth-middleware plumbing. Demonstrates the
// explicit spec requirement: "manual override cannot silently replace a
// source-confirmed classification" — a conflicting override must be flagged
// (sourceConflict), not silently accepted, and recorded as
// manual_override_conflicting so case-classification.server.ts's own write
// path (see case-classification.test.ts) knows never to overwrite it later.
import { describe, it, expect } from "vitest";
import { resolveCaseTypeSourceConflict } from "@/lib/cases.functions";

describe("resolveCaseTypeSourceConflict", () => {
  it("flags a conflict when the requested case_type disagrees with a CONFIRMED source classification", () => {
    const result = resolveCaseTypeSourceConflict({ status: "CONFIRMED", value: "amparo" }, "civil");
    expect(result.sourceConflict).toEqual({
      field: "case_type",
      sourceValue: "amparo",
      requestedValue: "civil",
    });
    expect(result.case_type_source).toBe("manual_override_conflicting");
  });

  it("does not flag a conflict when the requested case_type matches the CONFIRMED source classification", () => {
    const result = resolveCaseTypeSourceConflict(
      { status: "CONFIRMED", value: "amparo" },
      "amparo",
    );
    expect(result.sourceConflict).toBeNull();
    expect(result.case_type_source).toBe("source_confirmed");
  });

  it("is a plain manual override (no conflict) when there is no CONFIRMED evidence yet", () => {
    expect(resolveCaseTypeSourceConflict(null, "civil").sourceConflict).toBeNull();
    expect(resolveCaseTypeSourceConflict(null, "civil").case_type_source).toBe("manual_override");

    expect(
      resolveCaseTypeSourceConflict({ status: "INSUFFICIENT_DATA", value: null }, "civil")
        .case_type_source,
    ).toBe("manual_override");

    expect(
      resolveCaseTypeSourceConflict({ status: "CONFLICT", value: null }, "civil").case_type_source,
    ).toBe("manual_override");
  });
});
