import { describe, expect, it } from "vitest";
import {
  extractPenalDisposition,
  renderPenalDisposition,
} from "../penal-disposition.server";

describe("structured Penal disposition", () => {
  it("extracts operative orders only from the dispositive section", () => {
    const disposition = extractPenalDisposition({
      id: "doc-1",
      filename: "sentencia.pdf",
      extracted_text: [
        "SUPREMA CORTE DE JUSTICIA DE LA NACIÓN",
        "Ciudad de México, 14 de abril de 2018.",
        "En los antecedentes se citó otro asunto que se confirmó en 1956.",
        "PUNTOS RESOLUTIVOS",
        "PRIMERO. Se revoca la sentencia recurrida.",
        "SEGUNDO. Devuélvanse los autos al Tribunal Colegiado para que dicte nueva sentencia.",
      ].join("\n"),
    });

    expect(disposition).not.toBeNull();
    expect(disposition?.result).toContain("revoked");
    expect(disposition?.result).toContain("remanded");
    expect(disposition?.remand).toBe(true);
    expect(disposition?.operative_orders).toHaveLength(2);
    expect(disposition?.source_page).toBe(1);
    expect(renderPenalDisposition(disposition!)).toContain("RESULTADO DEL CASO");
  });

  it("does not treat a quoted precedent outcome in the merits as this case's disposition", () => {
    expect(
      extractPenalDisposition({
        id: "doc-2",
        extracted_text:
          "La tesis recuerda que en otro asunto PRIMERO. Se revocó la sentencia. Este párrafo sólo describe jurisprudencia histórica.",
      }),
    ).toBeNull();
  });

  it("detects an Amparo result and procedure reopening", () => {
    const disposition = extractPenalDisposition({
      id: "doc-3",
      extracted_text: [
        "TRIBUNAL COLEGIADO DEL PRIMER CIRCUITO",
        "RESUELVE:",
        "PRIMERO. La Justicia de la Unión concede el amparo solicitado.",
        "SEGUNDO. Se repone el procedimiento y deberá dictarse nueva sentencia.",
      ].join("\n"),
    });

    expect(disposition?.amparo_result).toBe("granted");
    expect(disposition?.procedure_reopened).toBe(true);
    expect(disposition?.sentence_status).toBe("new_sentence_ordered");
  });
});
