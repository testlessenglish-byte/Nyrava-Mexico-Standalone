// Pipeline-wide sweep (2026-08-17): cross_examination.lines[].impeachment_with
// is a specific factual claim about the record ("declared X, contradicting
// their earlier statement"), backed by an optional citation — the same shape
// verifyAndLabel already quote-verifies for contradictions/motion_opportunities/
// constitutional_issues elsewhere in pipeline.server.ts. It was missed because
// verifyAndLabel's generic .citations[]/.evidence_refs[] sweep only reaches
// fields on the top-level item it's called with — cross_examination's citation
// lives two levels deeper (item.lines[].citation), never reached by that sweep.
import { describe, it, expect } from "vitest";
import { gateCrossExaminationImpeachment } from "@/lib/intelligence/cross-examination-grounding";
import { buildGroundingCorpus, verifyQuote } from "@/lib/intelligence/grounding.server";

const REAL_TEXT =
  "El testigo declaró ante el Ministerio Público que no se encontraba en el lugar de los hechos la noche del incidente.";

const corpus = buildGroundingCorpus([
  { id: "doc-1", filename: "declaracion.pdf", extracted_text: REAL_TEXT },
]);

describe("gateCrossExaminationImpeachment", () => {
  it("nulls impeachment_with and citation when the citation quote is fabricated — never appears in the real corpus", () => {
    const items = [
      {
        witness: "Juan Pérez",
        objective: "Impugnar credibilidad",
        lines: [
          {
            topic: "Ubicación la noche de los hechos",
            questions: ["¿Dónde se encontraba usted?"],
            impeachment_with: "Declaró previamente que sí estuvo presente, contradiciendo su testimonio actual.",
            citation: { doc_n: 1, page: 1, quote: "Esta frase no existe en ningún documento real del caso." },
          },
        ],
      },
    ];
    const { items: kept, droppedCount } = gateCrossExaminationImpeachment(items, verifyQuote, corpus);
    expect(droppedCount).toBe(1);
    expect(kept[0].lines?.[0].impeachment_with).toBeNull();
    expect(kept[0].lines?.[0].citation).toBeNull();
    // topic/questions survive — only the unverified claim is suppressed.
    expect(kept[0].lines?.[0].topic).toBe("Ubicación la noche de los hechos");
    expect(kept[0].lines?.[0].questions).toEqual(["¿Dónde se encontraba usted?"]);
  });

  it("keeps impeachment_with when its citation genuinely verifies against the real corpus", () => {
    const items = [
      {
        witness: "Juan Pérez",
        objective: "Impugnar credibilidad",
        lines: [
          {
            topic: "Ubicación la noche de los hechos",
            questions: ["¿Dónde se encontraba usted?"],
            impeachment_with: "Declaró que no se encontraba en el lugar de los hechos.",
            citation: { doc_n: 1, page: 1, quote: REAL_TEXT.slice(0, 50) },
          },
        ],
      },
    ];
    const { items: kept, droppedCount } = gateCrossExaminationImpeachment(items, verifyQuote, corpus);
    expect(droppedCount).toBe(0);
    expect(kept[0].lines?.[0].impeachment_with).toContain("no se encontraba");
  });

  it("leaves a line with no impeachment_with untouched — a plain question needs no citation", () => {
    const items = [
      {
        witness: "Juan Pérez",
        objective: "x",
        lines: [{ topic: "y", questions: ["z"], impeachment_with: null, citation: null }],
      },
    ];
    const { items: kept, droppedCount } = gateCrossExaminationImpeachment(items, verifyQuote, corpus);
    expect(droppedCount).toBe(0);
    expect(kept[0].lines?.[0]).toEqual(items[0].lines[0]);
  });

  it("nulls impeachment_with when it has no citation at all", () => {
    const items = [
      {
        witness: "x",
        objective: "y",
        lines: [{ topic: "z", questions: [], impeachment_with: "Una afirmación sin respaldo alguno.", citation: null }],
      },
    ];
    const { items: kept, droppedCount } = gateCrossExaminationImpeachment(items, verifyQuote, corpus);
    expect(droppedCount).toBe(1);
    expect(kept[0].lines?.[0].impeachment_with).toBeNull();
  });

  it("leaves an item with no lines array untouched", () => {
    const items = [{ witness: "x", objective: "y" }];
    const { items: kept, droppedCount } = gateCrossExaminationImpeachment(items, verifyQuote, corpus);
    expect(droppedCount).toBe(0);
    expect(kept).toEqual(items);
  });
});
