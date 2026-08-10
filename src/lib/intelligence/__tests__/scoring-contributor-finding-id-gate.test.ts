// Regression test for orphan scoring contributors (finding_id: null or
// pointing at a finding that doesn't exist).
//
// case_scores.positive_contributors/negative_contributors fall back to the
// raw LLM contributor array whenever the deterministic scorecard
// (computeDeterministicScorecard) finds zero contributors across every
// dimension — a thin/sparse case. The deterministic path is always safe:
// its contributors are built from `f.id` on real, already-persisted Finding
// rows. The LLM's own JSON schema for these fields explicitly allows
// finding_id: string|null, and before this fix the raw fallback persisted
// that array with no finding_id check at all — a labeled, weighted
// contributor with finding_id: null (or an invented finding_id) rendered in
// the report indistinguishable from a real, evidence-backed one.
// scrubScoringContributors is the gate: every contributor must resolve to a
// finding_id that is both present AND belongs to one of this case's own
// persisted findings.
import { describe, it, expect } from "vitest";
import { scrubScoringContributors } from "@/lib/intelligence/scoring.server";

describe("scrubScoringContributors", () => {
  const validFindingIds = new Set(["finding-1", "finding-2"]);

  it("drops a contributor with finding_id: null — the real reported bug", () => {
    const arr = [{ label: "Testimonio consistente", weight: 40, finding_id: null }];
    expect(scrubScoringContributors(arr, { criminalLike: false, validFindingIds })).toEqual([]);
  });

  it("drops a contributor with a missing finding_id entirely", () => {
    const arr = [{ label: "Documentación completa", weight: 30 }];
    expect(scrubScoringContributors(arr, { criminalLike: false, validFindingIds })).toEqual([]);
  });

  it("drops a contributor whose finding_id references a finding that doesn't exist for this case", () => {
    const arr = [{ label: "Prueba pericial sólida", weight: 25, finding_id: "finding-invented" }];
    expect(scrubScoringContributors(arr, { criminalLike: false, validFindingIds })).toEqual([]);
  });

  it("keeps a contributor whose finding_id is a real, persisted finding for this case", () => {
    const arr = [{ label: "Interés jurídico acreditado", weight: 60, finding_id: "finding-1" }];
    const result = scrubScoringContributors(arr, { criminalLike: false, validFindingIds });
    expect(result).toHaveLength(1);
    expect(result[0].finding_id).toBe("finding-1");
  });

  it("still applies the pre-existing off-domain label scrub alongside the new finding_id gate", () => {
    const arr = [
      { label: "Chain of Custody gap", weight: 50, finding_id: "finding-1" },
      { label: "Interés jurídico acreditado", weight: 60, finding_id: "finding-2" },
    ];
    const result = scrubScoringContributors(arr, { criminalLike: false, validFindingIds });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Interés jurídico acreditado");
  });

  it("allows the off-domain label through when criminalLike, but a valid finding_id is still required", () => {
    const arr = [
      { label: "Chain of Custody gap", weight: 50, finding_id: "finding-1" },
      { label: "Chain of Custody gap", weight: 50, finding_id: null },
    ];
    const result = scrubScoringContributors(arr, { criminalLike: true, validFindingIds });
    expect(result).toHaveLength(1);
    expect(result[0].finding_id).toBe("finding-1");
  });

  it("returns an empty array for a case with no findings at all, even if the LLM invents contributors", () => {
    const arr = [{ label: "Fabricated contributor", weight: 90, finding_id: "finding-1" }];
    expect(
      scrubScoringContributors(arr, { criminalLike: false, validFindingIds: new Set() }),
    ).toEqual([]);
  });
});
