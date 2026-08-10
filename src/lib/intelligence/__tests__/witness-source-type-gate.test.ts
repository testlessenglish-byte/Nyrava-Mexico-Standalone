// Regression test for the source-type gate on witness_credibility findings.
//
// witness_credibility runs unconditionally on every case
// (UNIVERSAL_FINDING_MODULES, practice-areas.ts) with a source-type-blind
// prompt: it grounds a "credibility" finding in any verbatim corpus quote,
// with no check on WHAT KIND of document that quote came from. On a real
// case with no actual witness testimony in the corpus — Amparo Directo en
// Revisión 2239/2018, an SCJN judicial-review record — it quoted the
// COURT'S OWN resolution language and analyzed it as if it were a witness's
// statement, producing a "Testimonio de Testigo" finding out of a judgment.
//
// dropJudicialTextFindings (grounding.server.ts) is the deterministic
// backstop: any finding whose evidence_refs quotes are ALL judicial-decision
// or statutory/constitutional text is dropped before it can reach
// case_findings, regardless of what the agent's prompt says.
import { describe, it, expect } from "vitest";
import {
  isJudicialOrStatutoryText,
  dropJudicialTextFindings,
} from "@/lib/intelligence/grounding.server";

describe("isJudicialOrStatutoryText", () => {
  it("recognizes SCJN resolution language as judicial-decision text", () => {
    expect(
      isJudicialOrStatutoryText(
        "Esta Primera Sala resuelve que el recurso de revisión es infundado por unanimidad de votos.",
      ),
    ).toBe(true);
    expect(
      isJudicialOrStatutoryText(
        "CONSIDERANDO: Que la Suprema Corte de Justicia de la Nación es competente para conocer del presente amparo directo en revisión.",
      ),
    ).toBe(true);
    expect(isJudicialOrStatutoryText("SEGUNDO. Se sobresee en el juicio de amparo.")).toBe(true);
  });

  it("recognizes a bare legal-authority citation (existing isLegalAuthorityCitation behavior)", () => {
    expect(
      isJudicialOrStatutoryText(
        "Artículo 16 de la Constitución Política de los Estados Unidos Mexicanos",
      ),
    ).toBe(true);
  });

  it("does NOT flag a genuine first-person witness/party statement", () => {
    expect(
      isJudicialOrStatutoryText(
        "El testigo declaró que vio al acusado salir del domicilio aproximadamente a las diez de la noche.",
      ),
    ).toBe(false);
    expect(
      isJudicialOrStatutoryText(
        "Bajo protesta de decir verdad, manifiesto que no estuve presente en el lugar de los hechos.",
      ),
    ).toBe(false);
  });

  it("is defensive against null/empty input", () => {
    expect(isJudicialOrStatutoryText(null)).toBe(false);
    expect(isJudicialOrStatutoryText("")).toBe(false);
    expect(isJudicialOrStatutoryText(undefined)).toBe(false);
  });
});

describe("dropJudicialTextFindings", () => {
  it("drops a witness_credibility finding grounded entirely in judicial-decision text — the real reported bug", () => {
    const findings = [
      {
        title: "Testimonio de Testigo",
        evidence_refs: [
          {
            doc_n: 1,
            quote:
              "Esta Primera Sala resuelve por unanimidad de votos conceder el amparo directo en revisión.",
          },
        ],
      },
    ];
    const result = dropJudicialTextFindings(findings);
    expect(result.items).toHaveLength(0);
    expect(result.dropped).toBe(1);
  });

  it("keeps a finding grounded in genuine witness testimony", () => {
    const findings = [
      {
        title: "Inconsistencia en el testimonio",
        evidence_refs: [
          {
            doc_n: 2,
            quote: "El testigo manifestó que no recordaba la hora exacta de los hechos.",
          },
        ],
      },
    ];
    const result = dropJudicialTextFindings(findings);
    expect(result.items).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it("keeps a finding with at least one non-judicial quote among several evidence_refs", () => {
    const findings = [
      {
        title: "Contradicción parcial",
        evidence_refs: [
          { doc_n: 1, quote: "Artículo 16 CPEUM." },
          {
            doc_n: 2,
            quote: "El testigo afirmó haber visto el vehículo estacionado toda la noche.",
          },
        ],
      },
    ];
    const result = dropJudicialTextFindings(findings);
    expect(result.items).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it("leaves an item with no evidence_refs to the existing grounding gate rather than dropping it itself", () => {
    const findings = [{ title: "Sin evidencia", evidence_refs: [] }];
    const result = dropJudicialTextFindings(findings);
    expect(result.items).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });
});
