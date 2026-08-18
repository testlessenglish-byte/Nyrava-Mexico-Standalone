import { describe, expect, it } from "vitest";
import {
  filterUnsupportedLegalFilingRecommendations,
  hasStructuredRecommendationSupport,
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

  it("keeps filing advice when a real canonical finding id supports it", () => {
    const result = filterUnsupportedLegalFilingRecommendations([
      {
        title: "Interponer recurso de revisión",
        supportingFindingIds: ["0d8f4a4c-5e4f-4d0b-8a19-8ecf2d41d0c7"],
        supportingEvidence: [],
      },
    ]);
    expect(result.items).toHaveLength(1);
  });

  it("keeps filing advice when pinpoint evidence supports it", () => {
    const result = filterUnsupportedLegalFilingRecommendations([
      {
        title: "Interponer recurso de revisión",
        supportingFindingIds: [],
        supportingEvidence: ["[DOC 1 p.4] La resolución fue notificada el..."],
      },
    ]);
    expect(result.items).toHaveLength(1);
  });

  it("does not treat workflow dependencies as evidentiary support", () => {
    expect(
      hasStructuredRecommendationSupport({
        title: "Interponer recurso de revisión",
        depends_on: ["revisar engrose"],
      }),
    ).toBe(false);
  });

  it("does not treat uncited generated factual-basis prose as support", () => {
    expect(
      hasStructuredRecommendationSupport({
        title: "Promover amparo indirecto",
        factual_basis: ["La parte considera que existe una violación procesal."],
      }),
    ).toBe(false);
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

  it("does not let intel next_action depends_on strings authorize a filing", () => {
    const merged = mergeCanonicalRecommendations({
      intelParsed: {
        next_actions: [
          {
            action: "Interponer recurso de revisión",
            why: "Para impugnar la resolución",
            depends_on: ["revisar engrose"],
          },
        ],
      },
    });
    expect(merged).toHaveLength(0);
  });

  it("does not let uncited memo factual basis authorize a filing", () => {
    const merged = mergeCanonicalRecommendations({
      memoParsed: {
        legal_memorandum: {
          recommended_motions: [
            {
              motion: "Promover amparo indirecto",
              legal_standard: "Ley de Amparo",
              factual_basis: ["Se aprecia una posible afectación."],
              likelihood: "Medium",
            },
          ],
        },
      },
    });
    expect(merged).toHaveLength(0);
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
