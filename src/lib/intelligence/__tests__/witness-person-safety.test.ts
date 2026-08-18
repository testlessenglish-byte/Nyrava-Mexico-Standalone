import { describe, expect, it } from "vitest";
import { isLikelyWitnessPersonName } from "../report-augment.server";

describe("witness person safety", () => {
  it("rejects institutional/legal phrases that appeared as fake witnesses", () => {
    expect(isLikelyWitnessPersonName("Procedimientos Penales", "declaración testimonial")).toBe(false);
    expect(isLikelyWitnessPersonName("Estados Unidos", "declaración testimonial")).toBe(false);
    expect(isLikelyWitnessPersonName("Suprema Corte", "declaración testimonial")).toBe(false);
    expect(isLikelyWitnessPersonName("Amparo Directo", "declaración testimonial")).toBe(false);
    expect(isLikelyWitnessPersonName("Código Nacional", "declaración testimonial")).toBe(false);
  });

  it("does not treat a repeated capitalized name as a witness without testimonial context", () => {
    expect(isLikelyWitnessPersonName("Carlos Espindola", "quejoso en el amparo directo en revisión")).toBe(false);
  });

  it("allows a plausible person name when the local context is actually testimonial", () => {
    expect(isLikelyWitnessPersonName("Carlos Espindola", "el testigo Carlos Espindola declaró que observó los hechos")).toBe(true);
  });
});
