import { describe, expect, it } from "vitest";
import {
  classifyCaseFromDocuments,
  normalizeProceduralVehicle,
  type DocInput,
} from "../case-classification.server";

const doc = (text: string): DocInput => ({
  id: "doc-1",
  filename: "sentencia.pdf",
  extracted_text: text,
});

describe("Penal procedural identity", () => {
  it("keeps an Amparo/ADR vehicle separate from the underlying Penal materia", () => {
    const result = classifyCaseFromDocuments([
      doc(
        "AMPARO DIRECTO EN REVISIÓN 3684/2012. La sentencia deriva del proceso penal seguido por el Ministerio Público contra la persona sentenciada.",
      ),
    ]);
    const fields = Object.fromEntries(result.fields.map((field) => [field.field, field]));

    expect(fields.procedural_vehicle.status).toBe("CONFIRMED");
    expect(fields.procedural_vehicle.value).toBe("amparo_directo_revision");
    expect(fields.underlying_materia.status).toBe("CONFIRMED");
    expect(fields.underlying_materia.value).toBe("penal");
  });

  it("does not invent an underlying Penal materia from an Amparo caption alone", () => {
    const result = classifyCaseFromDocuments([
      doc("AMPARO DIRECTO EN REVISIÓN 120/2024. Controversia sobre un contrato mercantil."),
    ]);
    const underlying = result.fields.find((field) => field.field === "underlying_materia");

    expect(underlying?.status).toBe("INSUFFICIENT_DATA");
    expect(underlying?.value).toBeNull();
  });

  it("normalizes procedural vehicles without case-specific identifiers", () => {
    expect(normalizeProceduralVehicle("AMPARO DIRECTO EN REVISIÓN")).toBe(
      "amparo_directo_revision",
    );
    expect(normalizeProceduralVehicle("RECURSO DE APELACIÓN")).toBe("apelacion");
  });
});
