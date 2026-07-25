// Real-Workload Certification — runs every benchmark profile through the
// canonical ESS helper and locks the expected bin / score / motion gates.
import { describe, it, expect } from "vitest";
import { computeESS } from "@/lib/intelligence/sufficiency.server";
import { BENCHMARKS, BENCHMARK_VERSION } from "@/lib/certification/benchmarks";

describe(`Real-workload certification (${BENCHMARK_VERSION})`, () => {
  it("benchmark set covers every required matter type", () => {
    const types = new Set(BENCHMARKS.map((b) => b.case_type));
    for (const t of ["criminal", "civil", "appellate", "family", "contracts", "multi_doc", "ocr_heavy", "poor_scan", "mixed"]) {
      expect(types.has(t as never)).toBe(true);
    }
  });

  for (const b of BENCHMARKS) {
    it(`${b.id} — ${b.case_type} — ESS bin and gates`, () => {
      const ess = computeESS({
        documentCount: b.documentCount,
        pageCount: b.pageCount,
        extractedChars: b.extractedChars,
        factCount: b.factCount,
        contradictionCount: b.contradictionCount,
        corroboratedCount: b.corroboratedCount,
      });
      expect(ess.bin).toBe(b.expectedBin);
      expect(ess.allowQuantitativeScores).toBe(b.expectScores);
      expect(ess.allowMotionGeneration).toBe(b.expectMotions);
      // Minimal-bin corpora must carry an insufficient-evidence notice.
      if (b.expectedBin === "minimal") expect(ess.insufficientEvidenceNotice).toBeTruthy();
    });
  }
});
