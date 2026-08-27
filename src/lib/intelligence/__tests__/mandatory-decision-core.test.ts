import { describe, expect, it } from "vitest";
import { emptyReconstruction, sourced } from "../decision-reconstruction";
import {
  buildMandatoryDecisionCore,
  mandatoryDecisionCoreToFindings,
  validateMandatoryDecisionCore,
} from "../mandatory-decision-core";

function fixture() {
  const reconstruction = emptyReconstruction("case-244289", "2026-08-27T12:00:00Z");
  reconstruction.issues_presented = [
    sourced(
      "Si el artículo 8, fracción III, segundo párrafo satisface el principio de taxatividad.",
      [
        {
          document_id: "doc-1",
          quote: "determinar si la norma impugnada satisface el principio de taxatividad",
        },
      ],
    ),
  ];
  reconstruction.court_holding = [
    sourced(
      {
        text: "El artículo 8, fracción III, segundo párrafo viola el principio de taxatividad.",
        speaker_role: "scjn",
        proposition_type: "court_holding",
        adoption_status: "adopted",
      },
      [{ document_id: "doc-1", quote: "la norma impugnada viola el principio de taxatividad" }],
    ),
    sourced(
      {
        text: "La norma impide garantizar a las víctimas una reparación integral.",
        speaker_role: "scjn",
        proposition_type: "court_holding",
        adoption_status: "adopted",
      },
      [{ document_id: "doc-1", quote: "impide garantizar a las víctimas una reparación integral" }],
    ),
    sourced(
      {
        text: "Se rechaza el criterio previo que negó legitimación a la víctima.",
        speaker_role: "tribunal_colegiado",
        proposition_type: "rejected_holding",
        adoption_status: "rejected",
      },
      [{ document_id: "doc-1", quote: "se rechaza el criterio que negó legitimación" }],
    ),
  ];
  reconstruction.disposition_remedy = sourced(
    "Se revoca la sentencia recurrida y se devuelven los autos para dictar una nueva decisión sin aplicar la norma inconstitucional.",
    [{ document_id: "doc-1", quote: "se revoca la sentencia recurrida. Devuélvanse los autos" }],
  );
  return reconstruction;
}

describe("mandatory decision core", () => {
  it("treats a legacy failed-attempt marker as unavailable instead of throwing", () => {
    expect(buildMandatoryDecisionCore({})).toEqual([]);
  });

  it("extracts verified holdings, rejected holdings, disposition, remedy, and controlling issues", () => {
    const core = buildMandatoryDecisionCore(fixture());
    expect(core.map((item) => item.kind)).toEqual([
      "CONTROLLING_ISSUE",
      "COURT_HOLDING",
      "COURT_HOLDING",
      "REJECTED_HOLDING",
      "DISPOSITION",
      "REMEDY",
    ]);
    expect(core.every((item) => item.source_refs.length > 0)).toBe(true);
  });

  it("reproduces the 2-244289 failure: secondary standing prose cannot cover omitted holdings or disposition", () => {
    const core = buildMandatoryDecisionCore(fixture());
    const validation = validateMandatoryDecisionCore(core, {
      executiveSummary:
        "La víctima tiene legitimación para cuestionar la individualización de la pena mediante amparo directo.",
      findings: [
        {
          title: "Legitimación de la víctima",
          description: "Se reconoció acceso a la justicia para impugnar la pena.",
        },
      ],
    });
    expect(validation.ok).toBe(false);
    expect(validation.missing.some((item) => item.kind === "COURT_HOLDING")).toBe(true);
    expect(validation.missing.some((item) => item.kind === "DISPOSITION")).toBe(true);
  });

  it("passes only when every mandatory proposition is represented", () => {
    const core = buildMandatoryDecisionCore(fixture());
    const findings = mandatoryDecisionCoreToFindings({
      core,
      caseId: "case-244289",
      userId: "user-1",
    });
    const validation = validateMandatoryDecisionCore(core, {
      executiveSummary: findings.map((finding) => finding.description).join("\n"),
      findings,
    });
    expect(validation).toMatchObject({ required: 6, represented: 6, ok: true, missing: [] });
  });

  it("promotes neutral reportable holdings without making them score-moving", () => {
    const findings = mandatoryDecisionCoreToFindings({
      core: buildMandatoryDecisionCore(fixture()),
      caseId: "case-244289",
      userId: "user-1",
    });
    const holding = findings.find(
      (finding) => finding.audit_classification === "VERIFIED_COURT_HOLDING",
    );
    expect(holding).toMatchObject({
      source_module: "decision_core",
      audit_classification: "VERIFIED_COURT_HOLDING",
      impact_direction: "neutral",
      score_dimension: null,
    });
    expect(holding?.metadata).toMatchObject({ reportable: true, score_moving: false });
    expect(holding?.source_doc_ids).toEqual(["doc-1"]);
  });
});

