// Real Estate (inmobiliario) practice-area gating — regression coverage.
//
// There was previously no test coverage at all for the current Mexican
// materia vocabulary (MX_CASE_TYPES) — the only existing test file that
// exercises practice-areas.ts (__tests__/case_type/policy.test.ts) tests a
// stale, pre-Mexico-migration vocabulary ("criminal", "civil_rights",
// "family", ...) that no longer exists in mexico-types.ts, and is already
// failing on main independent of this change (16 failed / 14 passed,
// verified separately). This file exercises the vocabulary that's
// actually in production use.
//
// This directly answers the runtime question "does the Transaction Center
// tab only appear for inmobiliario cases, and are the other twelve materias
// unaffected" — without needing a browser or a live database, since tab
// visibility is a pure function of materia (getApplicableTabs), not
// something that depends on fetched data.
import { describe, it, expect } from "vitest";
import { getApplicableTabs, PRACTICE_AREA_LABELS } from "@/lib/intelligence/practice-areas";
import { MX_CASE_TYPES, type MexicanCaseType } from "@/lib/jurisdiction/mexico-types";

describe("inmobiliario tab gating — Transaction Center visibility", () => {
  it("shows transaction_center only for inmobiliario, never for the other twelve materias", () => {
    for (const materia of MX_CASE_TYPES) {
      const tabs = getApplicableTabs(materia);
      if (materia === "inmobiliario") {
        expect(tabs.has("transaction_center")).toBe(true);
      } else {
        expect(tabs.has("transaction_center")).toBe(false);
      }
    }
  });

  it("does not show litigation-only tabs (trial, strategy, theories) for inmobiliario", () => {
    const tabs = getApplicableTabs("inmobiliario");
    for (const litigationOnlyTab of ["trial", "strategy", "theories"]) {
      expect(tabs.has(litigationOnlyTab)).toBe(false);
    }
  });

  it("every materia still resolves to a label — no regression from adding the 13th", () => {
    const seen = new Set<MexicanCaseType>();
    for (const materia of MX_CASE_TYPES) {
      expect(typeof PRACTICE_AREA_LABELS[materia]).toBe("string");
      expect(PRACTICE_AREA_LABELS[materia].length).toBeGreaterThan(0);
      seen.add(materia);
    }
    // Exactly 13: the original 12 plus inmobiliario, no accidental duplicate
    // or dropped entry from the Phase 1 edits.
    expect(seen.size).toBe(13);
    expect(MX_CASE_TYPES).toContain("inmobiliario");
  });

  it("universal tabs (evidence, chat, report, dashboard) remain available for every materia, including inmobiliario", () => {
    for (const materia of MX_CASE_TYPES) {
      const tabs = getApplicableTabs(materia);
      for (const universal of ["dashboard", "evidence", "chat", "report"]) {
        expect(tabs.has(universal)).toBe(true);
      }
    }
  });
});
