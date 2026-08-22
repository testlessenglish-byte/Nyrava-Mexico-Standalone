import { describe, expect, it } from "vitest";
import {
  computeESS,
  detectDocTypeSignals,
} from "@/lib/intelligence/sufficiency.server";

describe("SCJN judicial source completeness", () => {
  it("does not treat a published project fragment as a complete judgment", () => {
    const signals = detectDocTypeSignals([
      {
        filename: "ADR-2239-2018-180906.pdf",
        extracted_text:
          "AMPARO DIRECTO EN REVISIÓN 2239/2018. Se publica únicamente un fragmento del proyecto de sentencia correspondiente al estudio de constitucionalidad.",
      },
    ]);

    expect(signals.hasOnlyIncompleteJudicialPublication).toBe(true);
    expect(signals.highWeightTypes).not.toContain("final_judgment");

    const ess = computeESS({
      documentCount: 1,
      pageCount: 18,
      extractedChars: 38_000,
      factCount: 12,
      contradictionCount: 0,
      corroboratedCount: 0,
      highWeightDocTypeCount: signals.highWeightDocTypeCount,
      distinctDocTypeCount: signals.distinctDocTypeCount,
      hasChargingDocument: signals.hasChargingDocument,
      hasOnlyIncompleteJudicialPublication:
        signals.hasOnlyIncompleteJudicialPublication,
      locale: "es",
    });

    expect(ess.fullAnalysisOverride).toBe(false);
    expect(ess.allowQuantitativeScores).toBe(false);
    expect(ess.allowMotionGeneration).toBe(false);
    expect(ess.allowLegalTheories).toBe(false);
    expect(ess.insufficientEvidenceNotice).toMatch(/fragmento|proyecto/i);
  });

  it("still recognizes a complete signed judgment", () => {
    const signals = detectDocTypeSignals([
      {
        filename: "engrose_firmado.pdf",
        extracted_text:
          "SENTENCIA DEFINITIVA. AMPARO DIRECTO EN REVISIÓN 2239/2018. PUNTOS RESOLUTIVOS.",
      },
    ]);

    expect(signals.hasOnlyIncompleteJudicialPublication).toBe(false);
    expect(signals.highWeightTypes).toContain("final_judgment");
  });
});
