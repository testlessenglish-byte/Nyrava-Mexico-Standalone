import { describe, expect, it } from "vitest";
import {
  __test__filterConcludedCaseRecommendations as filterConcludedCaseRecommendations,
  __test__reconcileFalseOrphans as reconcileFalseOrphans,
  __test__reconcileStrengthScoreText as reconcileStrengthScoreText,
  __test__sanitizePerspectiveActions as sanitizePerspectiveActions,
  __test__scrubQuarantinedActionSentence as scrubQuarantinedActionSentence,
  __test__scrubScorePlaceholderSentence as scrubScorePlaceholderSentence,
} from "../hallucination.server";

describe("post-report reconciliation", () => {
  it("removes an unsupported quarantined action from narrative prose", () => {
    const text =
      "La Corte declaró inoperante el agravio. Se recomienda presentar una nueva demanda de amparo que aborde los argumentos no considerados. La resolución debe revisarse con el expediente.";
    const result = scrubQuarantinedActionSentence(text, [
      "Presentar una nueva demanda de amparo que aborde los argumentos no considerados.",
    ]);
    expect(result).toContain("La Corte declaró inoperante el agravio.");
    expect(result).not.toContain("nueva demanda de amparo");
    expect(result).toContain("La resolución debe revisarse con el expediente.");
  });

  it("removes a close paraphrase of the same quarantined action", () => {
    const text =
      "Se sugiere que el quejoso considere presentar un nuevo amparo para abordar los argumentos no considerados.";
    const result = scrubQuarantinedActionSentence(text, [
      "Presentar una nueva demanda de amparo que aborde los argumentos no considerados.",
    ]);
    expect(result).toBe("");
  });

  it("does not remove unrelated attorney guidance", () => {
    const text = "Verificar el engrose y confirmar los puntos resolutivos antes de citar la sentencia.";
    const result = scrubQuarantinedActionSentence(text, [
      "Presentar una nueva demanda de amparo que aborde los argumentos no considerados.",
    ]);
    expect(result).toBe(text);
  });

  it("reconciles the score prose to the persisted deterministic score", () => {
    expect(
      reconcileStrengthScoreText(
        "La fortaleza del caso se califica en 64, lo que indica un nivel medio.",
        64,
        65,
      ),
    ).toBe("La fortaleza del caso se califica en 65, lo que indica un nivel medio.");
  });

  it("leaves score prose unchanged when raw and final scores agree", () => {
    const text = "La fortaleza del caso se califica en 65.";
    expect(reconcileStrengthScoreText(text, 65, 65)).toBe(text);
  });

  it("drops only the broken internal score-placeholder sentence", () => {
    const result = scrubScorePlaceholderSentence(
      "La puntuación general del caso es 67. La confianza general del análisis es del well-supported, lo que refleja certeza alta.",
    );
    expect(result.text).toBe("La puntuación general del caso es 67.");
    expect(result.removed).toBe(1);
  });

  it("removes an unsupported new-proceeding recommendation from a concluded audit", () => {
    const result = filterConcludedCaseRecommendations(
      [
        { title: "Demanda de amparo indirecto", supportingFindingIds: [], supportingEvidence: [] },
        { title: "Verificar el engrose y los puntos resolutivos", supportingFindingIds: [], supportingEvidence: [] },
      ],
      "concluded_audit",
    );
    expect(result.removed).toBe(1);
    expect(result.recommendations).toHaveLength(1);
  });

  it("keeps a new-proceeding recommendation when a concluded audit carries structured support", () => {
    const recommendations = [
      { title: "Interponer recurso de revisión", supportingFindingIds: ["finding-1"], supportingEvidence: [] },
    ];
    const result = filterConcludedCaseRecommendations(recommendations, "concluded_audit");
    expect(result.removed).toBe(0);
    expect(result.recommendations).toEqual(recommendations);
  });

  it("does not apply concluded-audit suppression to an ongoing matter", () => {
    const recommendations = [
      { title: "Demanda de amparo indirecto", supportingFindingIds: [], supportingEvidence: [] },
    ];
    const result = filterConcludedCaseRecommendations(recommendations, "ongoing");
    expect(result.removed).toBe(0);
    expect(result.recommendations).toEqual(recommendations);
  });

  it("removes penal-only recommended actions from an amparo perspective without rewriting them", () => {
    const full: Record<string, unknown> = {
      intelligence: {
        perspectives: [
          {
            recommended_actions: [
              { action: "Revisar la ejecutoria de la SCJN." },
              { action: "Solicitar actuación ante el Tribunal de Enjuiciamiento." },
            ],
          },
        ],
      },
    };
    expect(sanitizePerspectiveActions(full, "amparo")).toBe(1);
    const perspectives = (full.intelligence as any).perspectives;
    expect(perspectives[0].recommended_actions).toEqual([
      { action: "Revisar la ejecutoria de la SCJN." },
    ]);
  });

  it("does not remove penal vocabulary from an actual penal perspective", () => {
    const full: Record<string, unknown> = {
      intelligence: {
        perspectives: [
          { recommended_actions: [{ action: "Solicitar actuación ante el Tribunal de Enjuiciamiento." }] },
        ],
      },
    };
    expect(sanitizePerspectiveActions(full, "penal")).toBe(0);
    expect((full.intelligence as any).perspectives[0].recommended_actions).toHaveLength(1);
  });

  it("reconciles a synthetic page-count orphan when document metadata proves the cited page exists", () => {
    const full: Record<string, unknown> = {
      _citation_audit_prose: {
        orphaned: ["[DOC 1 p.7] — page 7 exceeds 4 pages"],
        orphan_count: 1,
      },
      validation: {
        quality_signals: { orphaned_citation_count: 1 },
        quality_gate: { critical_issues: ["1 orphaned citation(s) — verify docIndex"] },
      },
    };
    expect(reconcileFalseOrphans(full, [{ metadata: { pages: 7 } }])).toBe(1);
    expect((full._citation_audit_prose as any).orphan_count).toBe(0);
    expect((full.validation as any).quality_signals.orphaned_citation_count).toBe(0);
    expect((full.validation as any).quality_gate.critical_issues).toEqual([]);
  });

  it("keeps a real out-of-range citation orphan", () => {
    const full: Record<string, unknown> = {
      _citation_audit_prose: {
        orphaned: ["[DOC 1 p.9] — page 9 exceeds 4 pages"],
        orphan_count: 1,
      },
    };
    expect(reconcileFalseOrphans(full, [{ metadata: { pages: 7 } }])).toBe(0);
    expect((full._citation_audit_prose as any).orphan_count).toBe(1);
  });
});