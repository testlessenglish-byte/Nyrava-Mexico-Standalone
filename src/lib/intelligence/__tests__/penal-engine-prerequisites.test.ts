import { describe, expect, it } from "vitest";
import {
  classificationSupportsOpenProceeding,
  detectPenalEnginePrerequisites,
  penalEngineApplicability,
} from "../penal-engine-prerequisites";

describe("Penal engine prerequisites", () => {
  it("skips prospective engines for a concluded audit", () => {
    const prerequisites = detectPenalEnginePrerequisites(
      "La SCJN dictó sentencia definitiva en la causa penal.",
    );
    for (const engine of [
      "theories",
      "opportunities",
      "strategy",
      "litigation_strategy_center",
      "work_product",
      "appeal_opportunity_detection",
    ]) {
      expect(penalEngineApplicability(engine, "concluded_audit", prerequisites)).toMatchObject({
        run: false,
        status: "skipped_not_applicable",
      });
    }
  });

  it("allows prospective work only when a grounded subsequent proceeding is open", () => {
    const prerequisites = {
      ...detectPenalEnginePrerequisites("causa penal"),
      hasOpenSubsequentProceeding: true,
    };
    expect(penalEngineApplicability("strategy", "concluded_audit", prerequisites).run).toBe(true);
  });

  it("requires an identified witness and attributable statement", () => {
    const absent = detectPenalEnginePrerequisites("La sentencia menciona una víctima.");
    expect(penalEngineApplicability("witness_credibility", "ongoing", absent).run).toBe(false);

    const present = detectPenalEnginePrerequisites(
      "La testigo María declaró que observó la detención.",
    );
    expect(penalEngineApplicability("witness_credibility", "ongoing", present).run).toBe(true);
  });

  it("requires evidence and actual handling information for chain of custody", () => {
    const evidenceOnly = detectPenalEnginePrerequisites("Se localizó un teléfono.");
    expect(penalEngineApplicability("chain_of_custody", "ongoing", evidenceOnly).run).toBe(false);

    const complete = detectPenalEnginePrerequisites(
      "El teléfono fue asegurado, embalado y entregado con registro de cadena de custodia.",
    );
    expect(penalEngineApplicability("chain_of_custody", "ongoing", complete).run).toBe(true);
  });

  it("does not treat an ungrounded Ongoing label as an open subsequent proceeding", () => {
    expect(classificationSupportsOpenProceeding({ value: "Ongoing", source_quote: "" })).toBe(false);
    expect(
      classificationSupportsOpenProceeding({
        value: "Ongoing",
        source_quote: "Se admitió el recurso de apelación.",
      }),
    ).toBe(true);
  });
});
