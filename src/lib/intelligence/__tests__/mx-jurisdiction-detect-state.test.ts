// Regression test for detectState() (mx-jurisdiction.ts) — audit P0-1.
//
// Bug: state *codes* (3-letter abbreviations) were matched case-insensitively
// against free-flowing prose, and several codes are also ordinary Spanish
// words: SIN ("without"), SON ("[they] are"), VER ("to see"), QUE
// ("that"/"what"). Any document containing one of these common words was
// misdetected as the corresponding state. Fix: codes now match only their
// official uppercase form; state names and city aliases remain
// case-insensitive since they are not also common words.
import { describe, it, expect } from "vitest";
import { detectState } from "@/lib/intelligence/mx-jurisdiction";

describe("detectState — code/word collision false positives (audit P0-1)", () => {
  it("does not misdetect Sinaloa from the word 'sin'", () => {
    expect(detectState("El documento no tiene relación sin mayor detalle.")).toBeNull();
  });

  it("does not misdetect Sonora from the word 'son'", () => {
    expect(detectState("Son las diez de la mañana y el caso continúa.")).toBeNull();
  });

  it("does not misdetect Veracruz from the word 'ver'", () => {
    expect(detectState("El juez debe ver el expediente completo.")).toBeNull();
  });

  it("does not misdetect Querétaro from the word 'que'", () => {
    expect(detectState("El actor manifiesta que el demandado incumplió.")).toBeNull();
  });

  it("still detects a state from its full name", () => {
    expect(detectState("El caso se tramita en el estado de Sinaloa.")).toEqual({
      code: "SIN",
      name: "Sinaloa",
    });
  });

  it("still detects a state from a city alias", () => {
    expect(detectState("El caso se tramita en Culiacán.")).toEqual({
      code: "SIN",
      name: "Sinaloa",
    });
  });

  it("still detects a state from its uppercase official code", () => {
    expect(detectState("Domicilio: Edo. SIN, México.")).toEqual({
      code: "SIN",
      name: "Sinaloa",
    });
  });

  it("does not misdetect a state code embedded in a longer word (pre-existing guard)", () => {
    expect(detectState("El juicio se lleva en Guadalajara, Jalisco.")).toEqual({
      code: "JAL",
      name: "Jalisco",
    });
  });
});
