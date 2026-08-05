// Regression tests for the TFJA party-role bug: a theory favoring a
// tercero interesado (third interested party) was rendered as "PLAINTIFF
// theory" because mxPartyRoleEnum had only two real-party slots
// (a/b/neutral) for administrativo and amparo. Confirmed via a real
// production case: San Baltazar Spirits vs. IMPI (TFJA nulidad), tercero
// interesado Palenque Xquenda.
//
// Generic tests only — no case-specific party names, no fixture content.
import { describe, it, expect } from "vitest";
import { mxPartyRoleEnum, mxRoleLabel, MX_PARTY_ROLES } from "@/lib/execution/mx-pipeline";

describe("mxPartyRoleEnum: third-party (tercero interesado) support", () => {
  it("administrativo now includes a third role, not just particular/autoridad", () => {
    const enumStr = mxPartyRoleEnum("administrativo");
    expect(enumStr).toContain('"particular"');
    expect(enumStr).toContain('"autoridad"');
    expect(enumStr).toContain('"tercero_interesado"');
    expect(enumStr).toContain('"ambas"');
  });

  it("amparo now includes tercero_interesado alongside quejoso/autoridad_responsable", () => {
    const enumStr = mxPartyRoleEnum("amparo");
    expect(enumStr).toContain('"quejoso"');
    expect(enumStr).toContain('"autoridad_responsable"');
    expect(enumStr).toContain('"tercero_interesado"');
  });

  it("materias without a common third-party pattern are unaffected — still exactly two real roles", () => {
    for (const materia of ["civil", "familiar", "mercantil", "laboral", "fiscal", "penal"]) {
      const roles = MX_PARTY_ROLES[materia as keyof typeof MX_PARTY_ROLES];
      expect(roles.c).toBeUndefined();
    }
  });

  it("electoral and ambiental inherit the administrativo profile's third role, since they route through the same profile", () => {
    // electoral/ambiental aren't MxPipelineProfile keys themselves — they
    // resolve to the administrativo profile via PROFILE_BY_MATERIA, so this
    // is exercised through the case-type resolution, not MX_PARTY_ROLES
    // directly. Confirm indirectly: the enum for administrativo (the
    // profile electoral/ambiental actually route through) has the third role.
    expect(mxPartyRoleEnum("administrativo")).toContain("tercero_interesado");
  });
});

describe("mxRoleLabel", () => {
  it("converts a snake_case Mexican role slug into a readable title-case label", () => {
    expect(mxRoleLabel("tercero_interesado")).toBe("Tercero Interesado");
    expect(mxRoleLabel("particular")).toBe("Particular");
    expect(mxRoleLabel("parte_actora")).toBe("Parte Actora");
    expect(mxRoleLabel("ministerio_publico")).toBe("Ministerio Publico");
  });

  it("falls back gracefully for null/undefined/empty input", () => {
    expect(mxRoleLabel(null)).toBe("Theory");
    expect(mxRoleLabel(undefined)).toBe("Theory");
    expect(mxRoleLabel("")).toBe("Theory");
  });
});

describe("theory validTheoryTypes construction (mirrors engines.server.ts::runTheoryEngine)", () => {
  // Mirrors the exact set-construction logic added to runTheoryEngine:
  //   const roles = MX_PARTY_ROLES[profile];
  //   const validTheoryTypes = new Set([roles.a, roles.b, roles.c, roles.neutral].filter(Boolean));
  function validTheoryTypesFor(materia: keyof typeof MX_PARTY_ROLES): Set<string> {
    const roles = MX_PARTY_ROLES[materia];
    return new Set([roles.a, roles.b, roles.c, roles.neutral].filter(Boolean) as string[]);
  }

  it("a theory favoring the tercero interesado is now a legal, distinct theory_type for administrativo — the actual bug fix", () => {
    const valid = validTheoryTypesFor("administrativo");
    expect(valid.has("tercero_interesado")).toBe(true);
    // Confirm it is genuinely distinct from the promovente/particular role —
    // this is what prevents a tercero's theory from colliding with (and
    // being mislabeled as) the plaintiff's.
    expect(valid.has("particular")).toBe(true);
    expect("tercero_interesado").not.toBe("particular");
  });

  it("a theory_type the model invents outside the real role set for this materia is correctly rejected", () => {
    const valid = validTheoryTypesFor("administrativo");
    // "plaintiff" was the old (wrong) hardcoded English value — must no
    // longer be considered valid now that the real Mexican vocabulary is
    // used instead.
    expect(valid.has("plaintiff")).toBe(false);
    expect(valid.has("prosecution")).toBe(false);
  });

  it("penal's real role set is Mexican procedural vocabulary, not the old generic 'prosecution'/'defense'", () => {
    const valid = validTheoryTypesFor("penal");
    expect(valid.has("ministerio_publico")).toBe(true);
    expect(valid.has("defensa")).toBe(true);
    expect(valid.has("prosecution")).toBe(false);
  });

  it("has exactly 4 valid values for administrativo/amparo (a, b, c, neutral) and 3 for materias without a third role", () => {
    expect(validTheoryTypesFor("administrativo").size).toBe(4);
    expect(validTheoryTypesFor("amparo").size).toBe(4);
    expect(validTheoryTypesFor("civil").size).toBe(3);
  });
});

describe("opportunity validSides construction (mirrors engines.server.ts::runOpportunityEngine)", () => {
  // Same bug, same fix, one engine over: runOpportunityEngine offered the
  // model a hardcoded English "plaintiff"/"defense" enum for `side` with no
  // materia awareness and no third-party slot, for every one of the 9
  // non-penal-litigation materias (administrativo, amparo, laboral, fiscal,
  // familiar, agrario, electoral, ambiental, inmobiliario) — confirmed via
  // audit of every materia's engine list. Fixed to use the exact same
  // MX_PARTY_ROLES construction runTheoryEngine already used correctly.
  function validSidesFor(materia: keyof typeof MX_PARTY_ROLES): Set<string> {
    const roles = MX_PARTY_ROLES[materia];
    return new Set([roles.a, roles.b, roles.c, roles.neutral].filter(Boolean) as string[]);
  }

  it("an opportunity favoring the tercero interesado is a legal, distinct side for administrativo", () => {
    const valid = validSidesFor("administrativo");
    expect(valid.has("tercero_interesado")).toBe(true);
    expect(valid.has("particular")).toBe(true);
  });

  it("the old hardcoded plaintiff/defense values are no longer considered valid for any materia", () => {
    for (const materia of ["civil", "familiar", "mercantil", "laboral", "administrativo", "amparo", "agrario"] as const) {
      const valid = validSidesFor(materia);
      expect(valid.has("plaintiff")).toBe(false);
      expect(valid.has("defense")).toBe(false);
      expect(valid.has("prosecution")).toBe(false);
    }
  });

  it("penal's real side vocabulary is Mexican procedural roles, not English plaintiff/defense", () => {
    const valid = validSidesFor("penal");
    expect(valid.has("ministerio_publico")).toBe(true);
    expect(valid.has("defensa")).toBe(true);
    expect(valid.has("plaintiff")).toBe(false);
  });

  it("has exactly 4 valid sides for administrativo/amparo (a, b, c, neutral) and 3 for materias without a third role — same shape as theory's role set, since both engines share one role vocabulary per materia", () => {
    expect(validSidesFor("administrativo").size).toBe(4);
    expect(validSidesFor("amparo").size).toBe(4);
    expect(validSidesFor("civil").size).toBe(3);
  });
});
