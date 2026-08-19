import { describe, expect, it } from "vitest";
import {
  filterConcludedCaseProspectiveRecommendations,
  filterUnsupportedLegalFilingRecommendations,
  hasConcludedPostureSupport,
  hasStructuredRecommendationSupport,
  isConcludedCaseProspectiveAction,
  isLegalFilingRecommendation,
  scrubConcludedCaseProspectiveSentences,
  scrubUnsupportedLegalFilingSentences,
} from "../recommendation-grounding";
import { mergeCanonicalRecommendations } from "../report-recommendations";

describe("legal filing recommendation grounding", () => {
  const findingId = "0d8f4a4c-5e4f-4d0b-8a19-8ecf2d41d0c7";

  it("recognizes filing/remedy advice", () => {
    expect(isLegalFilingRecommendation("Se recomienda presentar un recurso de revisión ante el Tribunal Colegiado de Circuito.")).toBe(true);
    expect(isLegalFilingRecommendation("Verificar el engrose y los puntos resolutivos.")).toBe(false);
  });

  it("recognizes the prospective acts that leaked into concluded ADR reports", () => {
    expect(isConcludedCaseProspectiveAction("Presentar solicitud de suspensión del acto reclamado ante el Juez de control")).toBe(true);
    expect(isConcludedCaseProspectiveAction("Ampliación de demanda para incluir pruebas adicionales")).toBe(true);
    expect(isConcludedCaseProspectiveAction("Petición de nulidad de la fracción IV")).toBe(true);
    expect(isConcludedCaseProspectiveAction("Interponer recurso de revisión ante el Tribunal de Alzada")).toBe(true);
    expect(isConcludedCaseProspectiveAction("Verificar el engrose y los puntos resolutivos")).toBe(false);
  });

  it("drops an unsupported filing recommendation", () => {
    const result = filterUnsupportedLegalFilingRecommendations([
      { title: "Presentar recurso de revisión", supportingFindingIds: [], supportingEvidence: [] },
      { title: "Verificar el engrose", supportingFindingIds: [], supportingEvidence: [] },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.removed).toHaveLength(1);
    expect(result.items[0].title).toBe("Verificar el engrose");
  });

  it("does not allow a finding id alone to authorize a filing", () => {
    expect(
      hasStructuredRecommendationSupport({
        title: "Interponer recurso de revisión",
        supportingFindingIds: [findingId],
        supportingEvidence: [],
      }),
    ).toBe(false);
  });

  it("does not allow a pinpoint quote alone to authorize a filing", () => {
    expect(
      hasStructuredRecommendationSupport({
        title: "Interponer recurso de revisión",
        supportingFindingIds: [],
        supportingEvidence: ["[DOC 1 p.4] La resolución fue notificada el..."],
      }),
    ).toBe(false);
  });

  it("keeps filing advice only when canonical finding and pinpoint evidence both support it", () => {
    expect(
      hasStructuredRecommendationSupport({
        title: "Interponer recurso de revisión",
        supportingFindingIds: [findingId],
        supportingEvidence: ["[DOC 1 p.4] La resolución deja a salvo el derecho de recurrir..."],
      }),
    ).toBe(true);
  });

  it("requires verified support plus an explicit post-judgment posture for a new act in a concluded case", () => {
    expect(hasConcludedPostureSupport({ supportingFindingIds: [findingId], supportingEvidence: [] })).toBe(false);
    expect(hasConcludedPostureSupport({ supportingFindingIds: [], supportingEvidence: ["[DOC 1 p.4] plazo abierto"] })).toBe(false);
    expect(
      hasConcludedPostureSupport({
        supportingFindingIds: [findingId],
        supportingEvidence: ["[DOC 1 p.4] la resolución deja a salvo el derecho de..."],
      }),
    ).toBe(false);
    expect(
      hasConcludedPostureSupport({
        title: "Interponer recurso contra la nueva resolución",
        procedural_posture: "Resolución posterior a la sentencia",
        supportingFindingIds: [findingId],
        supportingEvidence: ["[DOC 1 p.4] La resolución posterior deja a salvo el derecho de recurrir..."],
      }),
    ).toBe(true);
  });

  it("removes concluded-case suspension/nulidad actions lacking posture-linked findings", () => {
    const result = filterConcludedCaseProspectiveRecommendations([
      {
        title: "Presentar solicitud de suspensión del acto reclamado ante el Juez de control",
        supportingFindingIds: [],
        supportingEvidence: ["La SCJN declaró inconstitucional la norma."],
      },
      {
        title: "Petición de nulidad de la fracción IV",
        supportingFindingIds: [],
        supportingEvidence: ["[DOC 1 p.8] resulta inconstitucional la fracción IV"],
      },
      {
        title: "Verificar el engrose, resolutivos y alcance exacto",
        supportingFindingIds: [],
        supportingEvidence: [],
      },
    ]);
    expect(result.items.map((r) => r.title)).toEqual(["Verificar el engrose, resolutivos y alcance exacto"]);
    expect(result.removed).toHaveLength(2);
  });

  it("does not treat workflow dependencies as evidentiary support", () => {
    expect(hasStructuredRecommendationSupport({ title: "Interponer recurso de revisión", depends_on: ["revisar engrose"] })).toBe(false);
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
          { action: "Interponer recurso de revisión", why: "Para impugnar la resolución", depends_on: ["revisar engrose"] },
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

  it("drops the exact strict-mode ADR filing leak: pinpoint holding but no supporting finding id", () => {
    const result = filterUnsupportedLegalFilingRecommendations([
      {
        title: "Demanda de amparo directo",
        reason: "El amparo directo es procedente ante actos que violan derechos humanos reconocidos.",
        supportingFindingIds: [],
        supportingEvidence: ["[DOC 1 p.1] resulta inconstitucional la fracción IV del artículo 470"],
      },
    ]);
    expect(result.items).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
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

  it("scrubs prospective concluded-case sentences but preserves retrospective audit work", () => {
    const result = scrubConcludedCaseProspectiveSentences(
      "La SCJN resolvió el ADR. Presentar una solicitud de suspensión del acto reclamado mientras se resuelve el amparo. Verificar el engrose y los resolutivos.",
    );
    expect(result.text).toContain("La SCJN resolvió el ADR.");
    expect(result.text).not.toMatch(/suspensión del acto reclamado/i);
    expect(result.text).toContain("Verificar el engrose y los resolutivos.");
  });
});
