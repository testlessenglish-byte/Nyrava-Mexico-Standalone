// Regression test for a real production bug: computeESS's
// insufficientEvidenceNotice was a hardcoded English string with no locale
// awareness. pipeline.server.ts prepends it onto the report's
// executive_summary whenever the corpus lands in the "minimal" bin,
// regardless of report_language — so a Spanish report got an English
// paragraph injected at the top of its executive summary. CONFIRMED LIVE
// (ADR5829/2025, report_language "es", strict mode): the injected English
// text ("Insufficient evidence...") tripped the QA agent's language-drift
// check ("Report language drift (es): Evidence.") and, combined with the
// Judge agent's citation-density gate, forced the case to needs_revision.
import { describe, it, expect } from "vitest";
import { computeESS, type ESSInputs } from "@/lib/intelligence/sufficiency.server";

// A corpus small enough to land in the "minimal" bin deterministically.
const MINIMAL_INPUTS: ESSInputs = {
  documentCount: 1,
  pageCount: 1,
  extractedChars: 500,
  factCount: 1,
  contradictionCount: 0,
  corroboratedCount: 0,
};

describe("computeESS: insufficientEvidenceNotice locale", () => {
  it("defaults to English when no locale is given (backward compatible)", () => {
    const ess = computeESS(MINIMAL_INPUTS);
    expect(ess.bin).toBe("minimal");
    expect(ess.insufficientEvidenceNotice).toMatch(/^Insufficient evidence/);
  });

  it("returns the English notice when locale is 'en'", () => {
    const ess = computeESS({ ...MINIMAL_INPUTS, locale: "en" });
    expect(ess.insufficientEvidenceNotice).toMatch(/^Insufficient evidence/);
  });

  // This is the exact bug: a Spanish report must never get an English
  // paragraph injected into executive_summary.
  it("returns a Spanish notice when locale is 'es' — never the English string", () => {
    const ess = computeESS({ ...MINIMAL_INPUTS, locale: "es" });
    expect(ess.insufficientEvidenceNotice).toMatch(/^Evidencia insuficiente/);
    expect(ess.insufficientEvidenceNotice).not.toMatch(/\bInsufficient\b/i);
    expect(ess.insufficientEvidenceNotice).not.toMatch(/\bEvidence\b/);
  });

  it("is null outside the minimal bin regardless of locale — nothing to translate", () => {
    const richInputs: ESSInputs = {
      documentCount: 10,
      pageCount: 50,
      extractedChars: 60_000,
      factCount: 30,
      contradictionCount: 5,
      corroboratedCount: 8,
      locale: "es",
    };
    const ess = computeESS(richInputs);
    expect(ess.bin).not.toBe("minimal");
    expect(ess.insufficientEvidenceNotice).toBeNull();
  });
});
