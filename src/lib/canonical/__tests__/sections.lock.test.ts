import { describe, expect, it } from "vitest";
import {
  assertSectionsLocked,
  getLockedSectionViolations,
  LOCKED_CANONICAL_SECTIONS,
  REPORT_ENGINE_VERSION,
} from "../sections.lock";
import { CANONICAL_SECTIONS } from "../case-analysis";

describe("Report Engine v1.0 section lock", () => {
  it("is tagged v1.0.0", () => {
    expect(REPORT_ENGINE_VERSION).toBe("1.0.0");
  });

  it("locks exactly 17 sections", () => {
    expect(LOCKED_CANONICAL_SECTIONS).toHaveLength(17);
    expect(new Set(LOCKED_CANONICAL_SECTIONS).size).toBe(17);
  });

  it("matches the canonical section list in the running binary", () => {
    // This assertion will fail at test time if a code change mutates the
    // canonical section list without updating the lock contract.
    expect(() => assertSectionsLocked(CANONICAL_SECTIONS)).not.toThrow();
    expect(CANONICAL_SECTIONS).toEqual([...LOCKED_CANONICAL_SECTIONS]);
  });

  it("rejects extra sections", () => {
    const violations = getLockedSectionViolations([...LOCKED_CANONICAL_SECTIONS, "NewSection"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].section).toBe("NewSection");
    expect(violations[0].message).toMatch(/Report Engine v1\.0\.0/);
  });

  it("rejects reordered sections", () => {
    const reordered = [...LOCKED_CANONICAL_SECTIONS].reverse();
    expect(() => assertSectionsLocked(reordered)).toThrow(/section lock violation/);
  });

  it("rejects removed sections", () => {
    const missing = LOCKED_CANONICAL_SECTIONS.slice(1);
    expect(() => assertSectionsLocked(missing)).toThrow(/section lock violation/);
  });
});
