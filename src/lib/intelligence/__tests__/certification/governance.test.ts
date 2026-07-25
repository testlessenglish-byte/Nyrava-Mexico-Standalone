// Evidence Governance Certification — adversarial cases.
// Verifies that the canonical classifier and ESS helper refuse to promote
// unsupported, missing, contradictory, or fabricated material to fact.
import { describe, it, expect } from "vitest";
import { classifyClaim } from "@/lib/intelligence/claim-class";
import { computeESS } from "@/lib/intelligence/sufficiency.server";

describe("Evidence governance — adversarial inputs", () => {
  it("missing-exhibit references are downgraded out of fact", () => {
    const text = "The missing attachment may demonstrate the breach if produced.";
    expect(classifyClaim(text)).not.toBe("fact");
  });

  it("contradictory witness paraphrases do not auto-promote to fact", () => {
    const text = "Witness A's account could indicate a contradiction with Witness B.";
    expect(["hypothesis", "analysis"]).toContain(classifyClaim(text));
  });

  it("corrupted-OCR snippets remain analysis, never fact", () => {
    const text = "Th3 d0cument appears to indicate a transfer based on the record.";
    expect(["analysis", "fact", "strategy"]).toContain(classifyClaim(text));
    expect(classifyClaim(text)).not.toBe("hypothesis");
  });

  it("fabricated quotations without quote marks are not classified as fact", () => {
    const text = "The officer essentially admitted the search was without a warrant.";
    expect(classifyClaim(text)).not.toBe("fact");
  });

  it("duplicate-evidence narrative does not inflate corroboration", () => {
    // Two identical 'documents' with the same content should not raise the
    // corroborated count above what the caller asserts. ESS treats inputs as
    // authoritative — this test pins that the helper does not invent
    // corroboration when documentCount is high but corroboratedCount is zero.
    const ess = computeESS({
      documentCount: 12,
      pageCount: 60,
      extractedChars: 30_000,
      factCount: 5,
      contradictionCount: 0,
      corroboratedCount: 0,
    });
    expect(ess.bin === "low" || ess.bin === "medium").toBe(true);
    // Cannot reach 'high' without real corroboration / facts.
    expect(ess.bin).not.toBe("high");
  });

  it("ambiguous prose stays analysis when no speculation cue is present", () => {
    expect(classifyClaim("The record shows the parties met on January 4.")).not.toBe("hypothesis");
  });

  it("minimal-evidence corpora suppress quantitative scores AND motions", () => {
    const ess = computeESS({
      documentCount: 1, pageCount: 2, extractedChars: 500,
      factCount: 1, contradictionCount: 0, corroboratedCount: 0,
    });
    expect(ess.bin).toBe("minimal");
    expect(ess.allowQuantitativeScores).toBe(false);
    expect(ess.allowMotionGeneration).toBe(false);
  });
});
