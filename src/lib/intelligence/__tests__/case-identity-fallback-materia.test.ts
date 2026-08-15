// Regression test for a real production crash on ADR-4640-2017-180212,
// discovered live after the "Fix the Verified Case Identity Architecture"
// PR merged: a brand-new case whose identity genuinely resolved to
// caseType: null (no declared value, no CONFIRMED evidence, no attorney
// lock) hit `_runAnalyzersInner`'s last-resort fallback, which used the
// string "general_civil" — a scoring-dimension dictionary key from
// scoring.server.ts, never a recognized Mexican materia — as if it were a
// real classification. normalizePracticeArea/mxPartyRoleEnum/
// buildCaseTypeManifest are strict (they call requireMexicanCaseType, which
// throws for any unrecognized value), so the analyzer stage crashed
// outright with "Materia desconocida en normalizePracticeArea:
// 'general_civil'" instead of ever running. `ensureRequiredEngines` had the
// identical bug with a different invalid sentinel, "unverified".
//
// The fix (pipeline.server.ts) keeps two separate values apart: a real,
// valid materia ("civil") used ONLY where a strict validator structurally
// needs one to build a JSON schema/manifest, and a genuinely-null value
// preserved for every POLICY decision (isFindingAllowed / isAnalyzerAllowed
// via their tolerant resolvers), so an unverified identity still degrades
// to safe defaults there instead of the fallback schema materia leaking
// into filtering decisions.
import { describe, it, expect } from "vitest";
import { normalizePracticeArea, isFindingAllowed } from "@/lib/intelligence/practice-areas";
import { mxPartyRoleEnum, isStageRelevantForCaseType, resolveMxProfile } from "@/lib/execution/mx-pipeline";
import { buildJurisdictionProfile } from "@/lib/intelligence/mx-jurisdiction";

describe("case-identity-fallback-materia: the exact production crash on ADR-4640-2017-180212", () => {
  it("reproduces why the old fallback sentinels crashed the strict validators", () => {
    expect(() => normalizePracticeArea("general_civil")).toThrow();
    expect(() => normalizePracticeArea("unverified")).toThrow();
    expect(() => mxPartyRoleEnum("general_civil")).toThrow();
  });

  it("'civil' — the new last-resort schema fallback — is a real, valid materia the strict validators accept", () => {
    expect(() => normalizePracticeArea("civil")).not.toThrow();
    expect(normalizePracticeArea("civil")).toBe("civil");
    expect(() => mxPartyRoleEnum("civil")).not.toThrow();
    expect(mxPartyRoleEnum("civil")).toContain("parte_actora");
  });

  it("buildCaseTypeManifest also requires a real materia and now gets one", async () => {
    const { buildCaseTypeManifest } = await import("@/lib/intelligence/practice-areas");
    expect(() => buildCaseTypeManifest("unverified", [])).toThrow();
    expect(() => buildCaseTypeManifest("civil", [])).not.toThrow();
  });

  it("the schema fallback never leaks into policy decisions — an unverified identity (null) still degrades to universal-only findings, not civil-specific ones", () => {
    // A civil-specific finding module must be allowed once "civil" is
    // actually resolved/confirmed...
    expect(isFindingAllowed("civil", "analyzer:contrato")).toBe(true);
    // ...but must NOT be allowed just because the schema fallback happens
    // to be "civil" — the policy check must be fed the real (possibly
    // null) identity value, never the schema-generation fallback.
    expect(isFindingAllowed(null, "analyzer:contrato")).toBe(false);
    // A universal module stays allowed regardless.
    expect(isFindingAllowed(null, "analyzer:extraction")).toBe(true);
  });

  it("an unverified identity (null) also stays permissive for stage-selection, unaffected by the schema fallback", () => {
    expect(isStageRelevantForCaseType(null, "constitutional")).toBe(true);
    expect(isStageRelevantForCaseType(null, "witness")).toBe(true);
  });
});

// A second, related production crash on the SAME case immediately after the
// first fix shipped: jurisdiction-intel.server.ts and legal-qa.server.ts
// both fed a possibly-null identity.caseType straight into resolveMxProfile
// under the mistaken belief (documented in their own now-corrected code
// comments) that it "accepts null gracefully." resolveMxProfile is actually
// just an alias for requireMxProfile — strict, throws for null/unrecognized
// input — so a genuinely unusable identity (unverified-with-nothing, or an
// attorney-lock-vs-evidence conflict) crashed both stages outright with
// "Materia desconocida en requireMxProfile", which then blocked
// procedural_compliance and report downstream. This reproduced on
// ADR-4640-2017-180212 after the user manually locked case_type to "amparo"
// while the deterministic classifier's own reading of the corpus (heavy
// with civil-procedure vocabulary, since the amparo's underlying dispute is
// a civil appeal) plausibly disagreed — a real conflict, not a bug in the
// conflict detection itself; the bug was crashing instead of degrading.
describe("case-identity-fallback-materia: jurisdiction_intel / legal_qa crash on a null/conflicted identity", () => {
  it("resolveMxProfile (used directly by legal-qa.server.ts) throws for null, confirming the prior 'accepts null gracefully' comment was wrong", () => {
    expect(() => resolveMxProfile(null)).toThrow();
    expect(() => resolveMxProfile(undefined)).toThrow();
  });

  it("buildJurisdictionProfile (used by jurisdiction-intel.server.ts) also throws for a null caseType — it calls resolveMxProfile internally", () => {
    expect(() => buildJurisdictionProfile({ caseType: null })).toThrow();
  });

  it("both now get a real fallback ('civil') instead of null and no longer throw", () => {
    expect(() => resolveMxProfile("civil")).not.toThrow();
    expect(() => buildJurisdictionProfile({ caseType: "civil" })).not.toThrow();
    const profile = buildJurisdictionProfile({ caseType: "civil" });
    expect(profile).toBeTruthy();
  });
});
