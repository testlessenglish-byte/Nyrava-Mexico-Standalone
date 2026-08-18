import { describe, expect, it } from "vitest";
import {
  filterConcludedCaseProspectiveRecommendations,
  hasConcludedPostureSupport,
} from "../recommendation-grounding";

const supportedHistoricRecord = {
  supportingFindingIds: ["cf_49f2473e590a98e0"],
  supportingEvidence: [{ doc_n: 1, page: 10, quote: "La sentencia fue notificada por lista." }],
};

describe("concluded-case remedy grounding", () => {
  it("does not treat citations to the historic proceeding as proof that a new filing is still available", () => {
    const rec = {
      ...supportedHistoricRecord,
      title: "Incidente de nulidad de notificaciones",
      action: "Promover incidente de nulidad de notificaciones.",
      reason: "La sentencia histórica contiene una discusión sobre notificación.",
    };

    expect(hasConcludedPostureSupport(rec)).toBe(false);
    const out = filterConcludedCaseProspectiveRecommendations([rec]);
    expect(out.items).toHaveLength(0);
    expect(out.removed).toHaveLength(1);
  });

  it("removes advice to file the ADR that the concluded record already contains", () => {
    const rec = {
      ...supportedHistoricRecord,
      title: "Recurso de revisión",
      action: "Interponer recurso de revisión ante la SCJN.",
    };
    expect(filterConcludedCaseProspectiveRecommendations([rec]).items).toHaveLength(0);
  });

  it("allows a genuinely supported post-judgment remedy tied to a subsequent event", () => {
    const rec = {
      supportingFindingIds: ["cf_post_judgment_001"],
      supportingEvidence: [
        {
          doc_n: 2,
          page: 3,
          quote: "Posteriormente a la sentencia se emitió una nueva resolución de cumplimiento.",
        },
      ],
      title: "Impugnación de nueva resolución",
      action: "Interponer recurso contra la nueva resolución posterior a la sentencia.",
      procedural_posture: "Resolución posterior dictada en cumplimiento de sentencia.",
    };

    expect(hasConcludedPostureSupport(rec)).toBe(true);
    expect(filterConcludedCaseProspectiveRecommendations([rec]).items).toHaveLength(1);
  });
});
