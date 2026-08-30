// =============================================================================
// AUTHORITY-LAYER UNIVERSALITY — the authority / jurisdiction / time-validity
// layer must behave identically across every Mexican materia and must never
// alter, block or degrade the deterministic evidence-synthesis reasoning.
// =============================================================================
import { describe, expect, it } from "vitest";

import {
  FEDERAL_ONLY_MATERIAS,
  getAuthority,
  LEGAL_AUTHORITIES,
  MATERIA_AUTHORITY_IDS,
  UNIVERSAL_AUTHORITY_IDS,
} from "../legal/authority-registry";
import { resolveLegalContext } from "../legal/jurisdiction-resolver";
import { getApplicableAuthority, isAuthorityValid } from "../legal/legal-validity";
import { synthesizeEvidence } from "../reporting/evidence-synthesis";
import { CANONICAL_MATERIAS, SUPPORTED_MATERIAS } from "../reporting/legal-acts";

const weight = (stars: number, label: string) => ({
  stars,
  glyphs: "★".repeat(stars) + "☆".repeat(5 - stars),
  label,
});

/** One neutral corpus reused for every materia: reasoning must not vary. */
const DOCS = () => [
  {
    canonical_source_id: "source-1", name: "Documento A.pdf",
    weight: weight(5, "Documento público"),
    quotes: [
      "Se notificó personalmente el 03/04/2026 y se corrió traslado por la cantidad de $250,000.00 MXN.",
    ],
  },
  {
    canonical_source_id: "source-2", name: "Documento B.pdf",
    weight: weight(3, "Documento privado"),
    quotes: ["Se notificó el 03/04/2026 el requerimiento por $250,000.00 MXN."],
  },
];

const ALL_MATERIAS = [...new Set([...CANONICAL_MATERIAS, ...SUPPORTED_MATERIAS])];

describe("authority registry", () => {
  it("declares unique ids and well-formed dates", () => {
    const ids = LEGAL_AUTHORITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of LEGAL_AUTHORITIES) {
      expect(a.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.authority_weight).toBeGreaterThan(0);
    }
  });

  it("never duplicates state-level instruments per entidad federativa", () => {
    for (const a of LEGAL_AUTHORITIES) {
      if (a.jurisdiction === "state") expect(a.state).toBeUndefined();
    }
  });

  it("references only declared authority ids from the materia map", () => {
    for (const ids of Object.values(MATERIA_AUTHORITY_IDS)) {
      for (const id of ids) expect(getAuthority(id), id).toBeDefined();
    }
  });
});

describe("jurisdiction resolution across all canonical materias", () => {
  it("resolves an authority layer for every materia", () => {
    for (const m of ALL_MATERIAS) {
      const ctx = resolveLegalContext({ materia: m });
      expect(ctx.materia, m).toBe(m);
      expect(ctx.applicable_authorities.length, m).toBeGreaterThan(0);
      for (const id of UNIVERSAL_AUTHORITY_IDS) {
        expect(ctx.applicable_authorities, m).toContain(id);
      }
      expect(ctx.confidence).toBeGreaterThanOrEqual(0);
      expect(ctx.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("falls back to the universal authority frame when jurisdiction is unknown", () => {
    const ctx = resolveLegalContext({});
    expect(ctx.jurisdiction_level).toBe("federal");
    expect(ctx.applicable_authorities).toEqual([...UNIVERSAL_AUTHORITY_IDS]);
    expect(ctx.confidence).toBeLessThan(0.5);
  });

  it("keeps federal matters federal even when a state is present", () => {
    for (const m of FEDERAL_ONLY_MATERIAS) {
      const ctx = resolveLegalContext({
        materia: m,
        state: "Jalisco",
        court: "Tribunal Superior de Justicia del Estado",
      });
      expect(ctx.jurisdiction_level, m).toBe("federal");
    }
  });

  it("uses state law only when the matter admits local competence", () => {
    const local = resolveLegalContext({
      materia: "civil",
      state: "Nuevo León",
      court: "Juzgado de Primera Instancia",
    });
    expect(local.jurisdiction_level).toBe("state");
    expect(local.state).toBe("Nuevo León");

    const federal = resolveLegalContext({
      materia: "amparo",
      court: "Juzgado de Distrito",
      state: "Nuevo León",
    });
    const applied = getApplicableAuthority([], federal, "2026-04-03");
    expect(applied.authorities.every((a) => a.jurisdiction === "federal")).toBe(true);
  });

  it("is deterministic", () => {
    const a = resolveLegalContext({ materia: "penal", state: "Chiapas", court: "Juez de Control" });
    const b = resolveLegalContext({ materia: "penal", state: "Chiapas", court: "Juez de Control" });
    expect(a).toEqual(b);
  });

  it("never throws on malformed signals", () => {
    expect(() =>
      resolveLegalContext({
        materia: null,
        court: null,
        documentMetadata: { weird: { nested: true } } as never,
      }),
    ).not.toThrow();
  });
});

describe("temporal validity", () => {
  it("excludes expired authority", () => {
    expect(isAuthorityValid("ley_amparo_1936", "2026-01-01")).toBe(false);
    const res = getApplicableAuthority(["ley_amparo_1936"], resolveLegalContext({ materia: "amparo" }), "2026-01-01");
    expect(res.authorities.map((a) => a.id)).not.toContain("ley_amparo_1936");
    expect(res.excluded.some((e) => e.authority_id === "ley_amparo_1936" && e.reason === "expired")).toBe(true);
  });

  it("excludes authority not yet in force at the case date", () => {
    expect(isAuthorityValid("ley_amparo", "1990-01-01")).toBe(false);
    const res = getApplicableAuthority(["ley_amparo"], resolveLegalContext({ materia: "amparo" }), "1990-01-01");
    expect(res.excluded.some((e) => e.authority_id === "ley_amparo" && e.reason === "not_yet_in_force")).toBe(true);
  });

  it("applies historical authority to historical dates", () => {
    expect(isAuthorityValid("ley_amparo_1936", "2005-06-01")).toBe(true);
  });

  it("marks uncertainty instead of rejecting when metadata is missing", () => {
    const res = getApplicableAuthority(["autoridad_inexistente"], resolveLegalContext({ materia: "civil" }), null);
    expect(res.validity_checked).toBe(false);
    expect(res.uncertainty.length).toBeGreaterThan(0);
    expect(() => getApplicableAuthority(null, null, undefined)).not.toThrow();
  });
});

describe("evidence synthesis with the authority layer", () => {
  it("attaches legal_context for every materia without changing the reasoning", () => {
    const baseline = synthesizeEvidence(DOCS(), { caseType: "civil" });
    expect(baseline).toBeTruthy();

    for (const m of ALL_MATERIAS) {
      const s = synthesizeEvidence(DOCS(), {
        caseType: m,
        jurisdiction: { materia: m, state: "Jalisco" },
        referenceDate: "2026-04-03",
      });
      expect(s, m).toBeTruthy();
      expect(s!.legal_context, m).toBeTruthy();
      expect(s!.legal_context!.jurisdiction.materia, m).toBeTruthy();
      expect(s!.legal_context!.validity_checked, m).toBe(true);

      // Same evidence → same evidentiary reasoning in every materia.
      expect(s!.agreements.map((a) => a.display)).toEqual(baseline!.agreements.map((a) => a.display));
      expect(s!.conflicts.length, m).toBe(baseline!.conflicts.length);
      expect(s!.docs.map((d) => d.name)).toEqual(baseline!.docs.map((d) => d.name));
    }
  });

  it("produces deterministic output", () => {
    const opts = { caseType: "laboral", jurisdiction: { materia: "laboral" }, referenceDate: "2026-04-03" };
    expect(JSON.stringify(synthesizeEvidence(DOCS(), opts))).toBe(
      JSON.stringify(synthesizeEvidence(DOCS(), opts)),
    );
  });

  it("never fails when authority metadata is incomplete", () => {
    const s = synthesizeEvidence(DOCS(), { caseType: "materia_inexistente" });
    expect(s).toBeTruthy();
    expect(s!.legal_context!.jurisdiction.jurisdiction_level).toBe("federal");
    expect(s!.legal_context!.validity_checked).toBe(false);
    expect(s!.narrative.length).toBeGreaterThan(0);
    expect(s!.lines.length).toBeGreaterThan(0);
  });
});
