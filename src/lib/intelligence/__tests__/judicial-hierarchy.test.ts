// Regression tests for the judicial-hierarchy attribution gate — the fix for
// a real production defect: a Tribunal Colegiado holding the SCJN's Pleno
// expressly revoked (ADR 5829/2025) rendered in the Executive Dashboard
// indistinguishably from an actual adopted SCJN holding, because Finding had
// no record of who asserted a proposition or whether the highest instance in
// the case adopted it. See judicial-hierarchy.ts for the full writeup.
import { describe, it, expect } from "vitest";
import {
  excludeRejectedFromScoring,
  filterExecutiveDashboardEligible,
  hasAttribution,
  isRejectedOrSuperseded,
  type AttributedProposition,
} from "@/lib/intelligence/judicial-hierarchy";

function prop(overrides: Partial<AttributedProposition> & { id: string }): AttributedProposition & { id: string } {
  return { speaker_role: null, proposition_type: null, adoption_status: null, ...overrides };
}

describe("judicial-hierarchy: Executive Dashboard eligibility", () => {
  // Test A: lower court says X; SCJN says X is incorrect. Expected: X
  // suppressed; SCJN holding shown.
  it("Test A — a Tribunal Colegiado holding the SCJN rejected is suppressed; the SCJN's adopted holding survives", () => {
    const findings = [
      prop({
        id: "tc-holding",
        speaker_role: "tribunal_colegiado",
        proposition_type: "rejected_holding",
        adoption_status: "rejected",
      }),
      prop({
        id: "scjn-holding",
        speaker_role: "scjn",
        proposition_type: "holding",
        adoption_status: "adopted",
      }),
    ];
    const eligible = filterExecutiveDashboardEligible(findings).map((f) => f.id);
    expect(eligible).not.toContain("tc-holding");
    expect(eligible).toContain("scjn-holding");
  });

  // Test B: party argues Y; court does not resolve Y. Expected: Y appears
  // only as an argument, never as a dashboard-eligible finding.
  it("Test B — an unresolved party argument never qualifies for the Executive Dashboard", () => {
    const findings = [
      prop({
        id: "quejoso-argument",
        speaker_role: "quejoso",
        proposition_type: "argument",
        adoption_status: "unresolved",
      }),
      prop({
        id: "scjn-holding",
        speaker_role: "scjn",
        proposition_type: "holding",
        adoption_status: "adopted",
      }),
    ];
    const eligible = filterExecutiveDashboardEligible(findings).map((f) => f.id);
    expect(eligible).not.toContain("quejoso-argument");
    expect(eligible).toContain("scjn-holding");
  });

  // Test C: court discusses conventionality/a topic in background but does
  // not perform the analysis / rule on it — an "issue" framed but not
  // resolved must not surface as a finding either.
  it("Test C — an issue the court frames but does not resolve is excluded, not promoted to a finding", () => {
    const findings = [
      prop({
        id: "framed-issue",
        speaker_role: "scjn",
        proposition_type: "issue",
        adoption_status: "unresolved",
      }),
      prop({
        id: "scjn-holding",
        speaker_role: "scjn",
        proposition_type: "holding",
        adoption_status: "adopted",
      }),
    ];
    const eligible = filterExecutiveDashboardEligible(findings).map((f) => f.id);
    expect(eligible).not.toContain("framed-issue");
    expect(eligible).toContain("scjn-holding");
  });

  it("passes every finding through unchanged when the case carries no attribution at all", () => {
    const findings = [
      prop({ id: "civil-finding-1" }),
      prop({ id: "civil-finding-2" }),
    ];
    expect(filterExecutiveDashboardEligible(findings).map((f) => f.id)).toEqual([
      "civil-finding-1",
      "civil-finding-2",
    ]);
  });

  it("keeps an adopted Tribunal Colegiado holding when no higher instance is present in the case (precedent mode: TC sentencia definitiva, no SCJN review)", () => {
    const findings = [
      prop({
        id: "tc-only-holding",
        speaker_role: "tribunal_colegiado",
        proposition_type: "holding",
        adoption_status: "adopted",
      }),
      prop({
        id: "quejoso-argument",
        speaker_role: "quejoso",
        proposition_type: "argument",
        adoption_status: "unresolved",
      }),
    ];
    const eligible = filterExecutiveDashboardEligible(findings).map((f) => f.id);
    expect(eligible).toEqual(["tc-only-holding"]);
  });

  it("excludes a historical (superseded intermediate) position even when adopted at the time it was made", () => {
    const findings = [
      prop({
        id: "sala-original",
        speaker_role: "tribunal_local",
        proposition_type: "holding",
        adoption_status: "historical",
      }),
      prop({
        id: "scjn-final",
        speaker_role: "scjn",
        proposition_type: "holding",
        adoption_status: "adopted",
      }),
    ];
    expect(filterExecutiveDashboardEligible(findings).map((f) => f.id)).toEqual(["scjn-final"]);
  });
});

describe("judicial-hierarchy: helpers", () => {
  it("hasAttribution is false only when all three fields are absent", () => {
    expect(hasAttribution(prop({ id: "x" }))).toBe(false);
    expect(hasAttribution(prop({ id: "x", speaker_role: "scjn" }))).toBe(true);
    expect(hasAttribution(prop({ id: "x", proposition_type: "holding" }))).toBe(true);
    expect(hasAttribution(prop({ id: "x", adoption_status: "adopted" }))).toBe(true);
  });

  it("isRejectedOrSuperseded matches on either adoption_status or proposition_type", () => {
    expect(isRejectedOrSuperseded(prop({ id: "x", adoption_status: "rejected" }))).toBe(true);
    expect(isRejectedOrSuperseded(prop({ id: "x", proposition_type: "rejected_holding" }))).toBe(true);
    expect(isRejectedOrSuperseded(prop({ id: "x", adoption_status: "adopted" }))).toBe(false);
  });
});

describe("judicial-hierarchy: scoring exclusion", () => {
  it("drops rejected/superseded propositions but keeps adopted holdings from any instance", () => {
    const findings = [
      prop({ id: "rejected", adoption_status: "rejected" }),
      prop({ id: "rejected-holding-type", proposition_type: "rejected_holding" }),
      prop({ id: "adopted-tc", speaker_role: "tribunal_colegiado", adoption_status: "adopted" }),
      prop({ id: "unattributed" }),
    ];
    const kept = excludeRejectedFromScoring(findings).map((f) => f.id);
    expect(kept).toEqual(["adopted-tc", "unattributed"]);
  });
});
