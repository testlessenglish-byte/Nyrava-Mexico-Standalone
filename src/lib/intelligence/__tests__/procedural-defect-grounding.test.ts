// Regression tests for the "legal rule became a case finding" backstop.
// See procedural-defect-grounding.server.ts and the GROUNDING_CONTRACT in
// src/lib/mexico-lock.ts for the full writeup — this module is the
// deterministic second layer, not the primary defense (the prompt is).
//
// These mirror the adversarial scenarios from the architecture audit:
//   Test A: deadline doctrine discussed, no missed deadline in the corpus.
//   Test B: no notification record — must never become "defective notification".
//   Test C: suspension doctrine discussed, no suspension issue in the corpus.
//   Test D: an unpreserved argument must not read as failure to exhaust.
//   Test E: a general constitutional rule is legal authority, not a violation.
import { describe, it, expect } from "vitest";
import { assessProceduralDefectGrounding } from "@/lib/intelligence/procedural-defect-grounding.server";

describe("assessProceduralDefectGrounding", () => {
  it("Test A/B pattern — a notification-defect finding grounded ONLY in the statute text is flagged", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Notificación Defectuosa — la notificación de la sentencia se realizó por lista",
      quotes: [
        "La notificación deberá hacerse personalmente al quejoso conforme al artículo 26 de la Ley de Amparo.",
      ],
    });
    expect(result.isBareLegalRule).toBe(true);
  });

  it("a notification-defect finding grounded in a quote with a written-out Mexican-style date is NOT flagged", () => {
    // Mexican judicial resolutions write dates in words ("el veintinueve de
    // abril de dos mil veinticinco"), not digits — a digit-only date regex
    // would miss this entirely and misclassify every real dated fact as a
    // bare legal rule.
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Notificación Defectuosa",
      quotes: ["la notificación se realizó por lista de acuerdos el veintinueve de abril de dos mil veinticinco"],
    });
    expect(result.isBareLegalRule).toBe(false);
    expect(result.reason).toBe("case_specific_marker_present");
  });

  it("Test C pattern — a suspension finding grounded only in suspension doctrine text is flagged", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Defecto de suspensión / suspension violation",
      quotes: [
        "La suspensión a petición de parte procede cuando se acredite la apariencia del buen derecho y no se afecte el interés social.",
      ],
    });
    expect(result.isBareLegalRule).toBe(true);
  });

  it("Test E pattern — a general constitutional-violation label with only doctrinal quote is flagged", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Violación constitucional",
      quotes: ["El artículo 1 constitucional dispone que todas las autoridades deberán promover los derechos humanos."],
    });
    expect(result.isBareLegalRule).toBe(true);
  });

  it("is spared when a quote carries a concrete date marker alongside the topic", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Plazo incumplido / missed deadline",
      quotes: ["El recurso de revisión se interpuso el 22/08/2025, fuera del plazo de diez días."],
    });
    expect(result.isBareLegalRule).toBe(false);
    expect(result.reason).toBe("case_specific_marker_present");
  });

  it("is spared when a quote carries an expediente/folio reference", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Falta de jurisdicción",
      quotes: ["El expediente 692/2023 fue turnado al Décimo Tercer Tribunal Colegiado sin competencia territorial."],
    });
    expect(result.isBareLegalRule).toBe(false);
  });

  it("is spared when at least one of several quotes carries a case-specific marker (mixed grounding)", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Falta de definitividad",
      quotes: [
        "El principio de definitividad exige agotar los recursos ordinarios antes del amparo.",
        "El quejoso presentó su demanda el 15/03/2024 sin agotar el recurso de revocación.",
      ],
    });
    expect(result.isBareLegalRule).toBe(false);
    expect(result.reason).toBe("case_specific_marker_present");
  });

  it("never flags a finding whose topic is not a procedural-defect category, regardless of quote shape", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Exención de impuestos",
      quotes: ["El artículo 230 de la LISSSTE establece que los bienes del Instituto están exentos."],
    });
    expect(result.isBareLegalRule).toBe(false);
    expect(result.reason).toBe("not_a_procedural_defect_topic");
  });

  it("does not fire when there are no quotes to assess (the citation floor's job, not this module's)", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Notificación Defectuosa",
      quotes: [],
    });
    expect(result.isBareLegalRule).toBe(false);
    expect(result.reason).toBe("no_quotes_to_assess");
  });

  it("is conservative: an ambiguous quote (topic present, no statute opener, no normative phrasing, no date) is left alone", () => {
    const result = assessProceduralDefectGrounding({
      titleAndDescription: "Falta de competencia",
      quotes: ["La Subprocuraduría de Recursos Administrativos actuó fuera de su ámbito territorial reconocido."],
    });
    expect(result.isBareLegalRule).toBe(false);
    expect(result.reason).toBe("quote_shape_inconclusive");
  });
});
