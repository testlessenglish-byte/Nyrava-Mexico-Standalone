import { describe, expect, it } from "vitest";
import { isCanonicalFinding, selectFindings } from "../finding-selection";

describe("citation quarantine finding selection", () => {
  const verified = {
    source_module: "agent:constitutional_rights_mapping",
    verification_status: "verified",
    finding_status: "candidate",
  };
  const noCitation = {
    source_module: "agent:ways_out_analysis",
    verification_status: "no_citation",
    finding_status: "candidate",
  };
  const unverified = {
    source_module: "engine:procedural_compliance",
    verification_status: "unverified",
    finding_status: "candidate",
  };

  it("keeps verified engine/agent findings canonical", () => {
    expect(isCanonicalFinding(verified)).toBe(true);
  });

  it("keeps no-citation and unverified rows out of canonical report surfaces", () => {
    expect(isCanonicalFinding(noCitation)).toBe(false);
    expect(isCanonicalFinding(unverified)).toBe(false);
    expect(selectFindings([verified, noCitation, unverified])).toEqual([verified]);
  });

  it("allows audit tooling to request quarantined rows explicitly", () => {
    expect(
      selectFindings([verified, noCitation], { includeQuarantined: true }),
    ).toHaveLength(2);
  });

  it("preserves pre-verification behavior while a run is still in progress", () => {
    expect(
      isCanonicalFinding({
        source_module: "agent:procedural_violations",
        verification_status: null,
      }),
    ).toBe(true);
  });
});
