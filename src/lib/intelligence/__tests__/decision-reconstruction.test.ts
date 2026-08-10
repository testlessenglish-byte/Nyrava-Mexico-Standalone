// Regression tests for Phase 2's Decision Reconstruction / Case Baseline
// data model (decision-reconstruction.ts) — a pure type module plus a
// couple of small constructors. Not yet consumed anywhere; these tests
// exist to lock in the "never invent a value" contract before anything
// depends on it.
import { describe, it, expect } from "vitest";
import {
  sourced,
  unsourced,
  emptyReconstruction,
  type EvidenceRef,
} from "../decision-reconstruction";

const ref: EvidenceRef = { doc_n: 1, quote: "el juzgador resuelve..." };

describe("sourced()", () => {
  it("builds a PRESENT value carrying its source refs", () => {
    const s = sourced("Juzgado Segundo de Distrito", [ref]);
    expect(s.status).toBe("PRESENT");
    expect(s.value).toBe("Juzgado Segundo de Distrito");
    expect(s.source_refs).toEqual([ref]);
  });

  it("refuses to build a PRESENT value with zero source refs", () => {
    expect(() => sourced("anything", [])).toThrow(/at least one source_ref/);
  });
});

describe("unsourced()", () => {
  it("builds a NOT_FOUND_IN_CORPUS value with a null value and no refs", () => {
    const s = unsourced("NOT_FOUND_IN_CORPUS");
    expect(s.status).toBe("NOT_FOUND_IN_CORPUS");
    expect(s.value).toBeNull();
    expect(s.source_refs).toEqual([]);
  });

  it("carries an optional note for UNCERTAIN/NOT_APPLICABLE", () => {
    const s = unsourced("NOT_APPLICABLE", "single-instance matter — no precedent to cite");
    expect(s.status).toBe("NOT_APPLICABLE");
    expect(s.note).toMatch(/single-instance/);
  });
});

describe("emptyReconstruction()", () => {
  it("defaults every scalar field to NOT_FOUND_IN_CORPUS and every array field to empty", () => {
    const r = emptyReconstruction("case-1", "2026-08-10T00:00:00.000Z");
    expect(r.case_id).toBe("case-1");
    expect(r.matter_identity.status).toBe("NOT_FOUND_IN_CORPUS");
    expect(r.matter_identity.value).toBeNull();
    expect(r.court.status).toBe("NOT_FOUND_IN_CORPUS");
    expect(r.disposition_remedy.status).toBe("NOT_FOUND_IN_CORPUS");
    expect(r.parties).toEqual([]);
    expect(r.court_holding).toEqual([]);
    expect(r.cited_precedent).toEqual([]);
  });

  it("never populates a value alongside a non-PRESENT status", () => {
    const r = emptyReconstruction("case-1", "2026-08-10T00:00:00.000Z");
    const scalarFields = [
      r.matter_identity,
      r.court,
      r.jurisdiction,
      r.procedural_posture,
      r.disposition_remedy,
    ];
    for (const f of scalarFields) {
      expect(f.status).not.toBe("PRESENT");
      expect(f.value).toBeNull();
    }
  });
});
