import { describe, expect, it } from "vitest";
import { buildCaseLawSearchQuery } from "../case-law.server";

describe("legal knowledge query coverage", () => {
  it("does not silently drop an Amparo issue absent from the curated map", () => {
    expect(buildCaseLawSearchQuery("Interés legítimo del quejoso", "amparo")).toBe(
      "Interés legítimo del quejoso amparo",
    );
  });

  it("does not silently drop non-penal materias", () => {
    expect(buildCaseLawSearchQuery("Guarda y custodia", "familiar")).toContain("Guarda y custodia");
    expect(buildCaseLawSearchQuery("Despido injustificado", "laboral")).toContain("laboral");
    expect(buildCaseLawSearchQuery("Crédito fiscal", "fiscal")).toContain("fiscal");
  });

  it("uses curated Mexican Amparo vocabulary when available", () => {
    const q = buildCaseLawSearchQuery("Procedencia del recurso de revisión", "amparo");
    expect(q).toContain("amparo directo revisión");
    expect(q).toContain("cuestión constitucional");
  });
});
