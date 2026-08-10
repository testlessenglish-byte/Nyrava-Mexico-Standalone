// Regression test for a real completed-case audit (Amparo Directo Penal
// 1/2026, single-document corpus): case.procedural_compliance.summary
// flatly asserted "Faltan 3 requisitos procesales obligatorios en materia
// amparo: Interés jurídico o legítimo acreditado (...); Informe justificado
// de la autoridad (...); Principio de definitividad satisfecho (...)." —
// while the FINDING this same module generates for the identical corpus gap
// (procedural-compliance.server.ts's "Elemento no identificado en el
// corpus") correctly hedges: "Esto refleja lo que consta en el corpus
// analizado, no necesariamente una omisión... verifique contra el
// expediente oficial antes de asumir un defecto procesal." Same underlying
// fact, same module, two different confidence levels — a pattern-search
// miss against a single-document corpus was being presented as a confirmed
// procedural defect at the aggregate-summary level even though the
// findings layer already knew better.
//
// NOTE: this does not touch which checklist items apply to which
// proceeding type (e.g. whether informe_justificado/suspensión genuinely
// apply to a given amparo directo) — that's a Mexican procedural-law
// question left for legal review, not something a keyword-match miss
// should ever resolve on its own.
import { describe, it, expect } from "vitest";
import { evaluateProceduralCompliance } from "../procedural-compliance";

describe("evaluateProceduralCompliance — hedged summary and status naming", () => {
  it("never asserts a confirmed procedural defect from a corpus pattern-search miss", () => {
    const report = evaluateProceduralCompliance(
      "amparo",
      "Texto del expediente sin referencia a los elementos del checklist procesal.",
    );
    expect(report.missing_required).toBeGreaterThan(0);
    // The old assertive phrasing must be gone.
    expect(report.summary).not.toMatch(/^Faltan \d+ requisito/);
    // The hedge from the findings layer must be present here too.
    expect(report.summary).toContain("no demuestra por sí mismo");
    expect(report.summary).toContain("expediente oficial");
  });

  it("renames the unmatched status away from 'faltante' so the value itself can't read as an assertion", () => {
    const report = evaluateProceduralCompliance("amparo", "Nada relevante aquí.");
    const unmatched = report.items.filter((i) => i.evidence === null);
    expect(unmatched.length).toBeGreaterThan(0);
    for (const item of unmatched) {
      expect(item.status).toBe("no_identificado_en_corpus");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((item as any).status).not.toBe("faltante");
    }
  });

  it("still marks a genuinely matched pattern as cumplido — a real positive detection stays a strong claim", () => {
    const report = evaluateProceduralCompliance(
      "amparo",
      "El acto reclamado consiste en la sentencia de segunda instancia impugnada.",
    );
    const found = report.items.find((i) => i.id === "acto_reclamado");
    expect(found?.status).toBe("cumplido");
  });
});
