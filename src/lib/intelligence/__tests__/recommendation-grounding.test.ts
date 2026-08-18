import { describe, expect, it } from "vitest";
import {
  filterUnsupportedLegalFilingRecommendations,
  isLegalFilingRecommendation,
  scrubUnsupportedLegalFilingSentences,
} from "../recommendation-grounding";
import { mergeCanonicalRecommendations } from "../report-recommendations";

describe("legal filing recommendation grounding", () => {
  it("recognizes filing/remedy advice", () => {
    expect(isLegalFilingRecommendation("Se recomienda presentar un recurso de revisión ante el Tribunal Colegiado de Circuito.")).toBe(true);
    expect(isLegalFilingRecommendation("Verificar el engrose y los puntos resolutivos.")).toBe(false);
  });

  it("drops an unsupported filing recommendation", () => {
    const result = filterUnsupportedLegalFilingRecommendations([
      {
        title: "Presentar recurso de revisión",
        supportingFindingIds: [],
        supportingEvidence: [],
      },
      {
        title: "Verificar el engrose",
        supportingFindingIds: [],
        supportingEvidence: [],
      },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.items[0].title).toBe("Verificar el engrose");
  });

  it("keeps filing advice only when structured support exists", () => {
    const result = filterUnsupportedLegalFilingRecommendations([
      {
        title: "Interponer recurso de revisión",
        supportingFindingIds: ["f-1"],
        supportingEvidence: [],
      },
    ]);
    expect(result.items).toHaveLength(1);
  });

  it("prevents unsupported narrative filing advice from entering the canonical action list", () => {
    const merged = mergeCanonicalRecommendations({
      narrativeParsed: {
        prose: {
          recommendations:
            "Se recomienda presentar un recurso de revisión ante el Tribunal Colegiado de Circuito.\nVerificar el engrose y los puntos resolutivos.",
        },
      },
    });
    expect(merged.some((r) => /recurso de revisión/i.test(r.title))).toBe(false);
  });

  it("scrubs unsupported filing sentences from free prose without inventing replacement advice", () => {
    const result = scrubUnsupportedLegalFilingSentences(
      "La SCJN declaró inoperante el agravio. Se recomienda presentar un recurso de revisión ante el Tribunal Colegiado. Verificar el engrose.",
    );
    expect(result.text).toContain("La SCJN declaró inoperante el agravio.");
    expect(result.text).not.toContain("presentar un recurso");
    expect(result.text).toContain("Verificar el engrose.");
    expect(result.removed).toBe(1);
  });
});
