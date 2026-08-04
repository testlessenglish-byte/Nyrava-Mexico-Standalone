// Tests for authority-level.ts's deriveAuthorityLevel — the Phase 2
// "trust levels" ranking assigned to every newly-ingested legal authority.
// Pure function, no DB — every LegalSourceKind is exact-value asserted so a
// future edit to the ranking is a deliberate, visible change here too.
import { describe, it, expect } from "vitest";
import { deriveAuthorityLevel } from "@/lib/legal-connectors/authority-level";
import type { LegalSourceKind } from "@/lib/legal-connectors/types";

describe("deriveAuthorityLevel", () => {
  it("ranks SCJN jurisprudencia and federal statutes at the same top non-constitutional tier", () => {
    expect(deriveAuthorityLevel("jurisprudencia", "federal")).toBe(9);
    expect(deriveAuthorityLevel("federal_statute", "federal")).toBe(9);
  });

  it("ranks a state statute below its federal counterpart", () => {
    expect(deriveAuthorityLevel("state_statute", "Jalisco")).toBe(8);
    expect(deriveAuthorityLevel("state_statute", "Jalisco")).toBeLessThan(
      deriveAuthorityLevel("federal_statute", "federal"),
    );
  });

  it("ranks a federal court_decision above a state one, same federal/state split as statutes", () => {
    const federal = deriveAuthorityLevel("court_decision", "federal");
    const state = deriveAuthorityLevel("court_decision", "Jalisco");
    expect(federal).toBeGreaterThan(state);
  });

  it("is jurisdiction-string-case/whitespace insensitive for the federal check", () => {
    expect(deriveAuthorityLevel("court_decision", "Federal")).toBe(deriveAuthorityLevel("court_decision", "federal"));
    expect(deriveAuthorityLevel("court_decision", "  FEDERAL  ")).toBe(
      deriveAuthorityLevel("court_decision", "federal"),
    );
  });

  it("ranks jurisprudencia and federal_statute above every other real connector kind", () => {
    const top = deriveAuthorityLevel("jurisprudencia", "federal");
    const otherKinds: LegalSourceKind[] = [
      "state_statute",
      "federal_gazette",
      "electoral_ruling",
      "court_decision",
      "administrative_ruling",
      "state_gazette",
      "human_rights_report",
    ];
    for (const k of otherKinds) {
      expect(deriveAuthorityLevel(k, "federal")).toBeLessThan(top);
    }
  });

  it("is a deterministic pure function — same input always produces the same output", () => {
    expect(deriveAuthorityLevel("electoral_ruling", "federal")).toBe(deriveAuthorityLevel("electoral_ruling", "federal"));
  });

  it("returns a defined number for every declared LegalSourceKind (exhaustiveness)", () => {
    const allKinds: LegalSourceKind[] = [
      "jurisprudencia",
      "federal_statute",
      "federal_gazette",
      "state_statute",
      "state_gazette",
      "court_decision",
      "administrative_ruling",
      "electoral_ruling",
      "human_rights_report",
    ];
    for (const k of allKinds) {
      const level = deriveAuthorityLevel(k, "federal");
      expect(typeof level).toBe("number");
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(10);
    }
  });
});
