// Regression test for the PROCEDURAL TYPE LOCK — the hard constraint added
// after a real stress test showed an Amparo Directo en Revisión being
// reasoned about (and having documents requested for it) as if it were a
// generic new amparo or a criminal-procedure intake. Exercises the REAL
// pure getProceduralTypeLock() from case-analysis-mode.ts.
import { describe, it, expect } from "vitest";
import {
  allowsProspectiveWorkProduct,
  getProceduralTypeLock,
} from "@/lib/intelligence/case-analysis-mode";

describe("getProceduralTypeLock", () => {
  it("is a no-op (null) when there is no source-confirmed proceeding type", () => {
    expect(getProceduralTypeLock(null, "es")).toBeNull();
    expect(getProceduralTypeLock(null, "en")).toBeNull();
  });

  it("locks Spanish reasoning to the exact confirmed proceeding type and forbids other-stage recommendations", () => {
    const lock = getProceduralTypeLock("AMPARO DIRECTO EN REVISIÓN", "es");
    expect(lock).toContain('"AMPARO DIRECTO EN REVISIÓN"');
    expect(lock).toMatch(/RESTRICCIÓN OBLIGATORIA/);
    expect(lock).toMatch(/incidente de suspensión de primera instancia/);
    expect(lock).toMatch(/auto de vinculación a proceso/);
  });

  it("locks English reasoning the same way", () => {
    const lock = getProceduralTypeLock("AMPARO DIRECTO EN REVISIÓN", "en");
    expect(lock).toContain('"AMPARO DIRECTO EN REVISIÓN"');
    expect(lock).toMatch(/MANDATORY CONSTRAINT/);
    expect(lock).toMatch(/generic amparo\/criminal checklist/);
  });
});


describe("allowsProspectiveWorkProduct", () => {
  it("blocks new pleadings in retrospective concluded and judgment audits", () => {
    expect(allowsProspectiveWorkProduct("concluded_audit")).toBe(false);
    expect(allowsProspectiveWorkProduct("judgment_audit")).toBe(false);
  });

  it("allows prospective work only for ongoing matters or explicit appeal-route analysis", () => {
    expect(allowsProspectiveWorkProduct("ongoing")).toBe(true);
    expect(allowsProspectiveWorkProduct("appeal_routes")).toBe(true);
  });
});
