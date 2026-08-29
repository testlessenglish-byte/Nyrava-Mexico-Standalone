// Real-user regression guard (2026-08-18): buildLegalIssues()/
// buildLegalIssuesWithCaseLaw() (report-augment.server.ts) scan the corpus
// against ISSUE_RULES — a table that is exhaustively CNPP/penal-specific
// (Cateo y Detención, Omisión en el Deber de Aportación Probatoria, etc.,
// each cited to Art. 16/20/21 CPEUM or the CNPP) — with NO materia gate at
// all. Confirmed live, verbatim, on TWO separate non-penal (amparo fiscal,
// ADR-5829/2025) reports: "Omisión en el Deber de Aportación Probatoria"
// rendered a Ministerio Público/Juez de Control/carpeta de investigación
// block in the "Cuestiones Jurídicas y Jurisprudencia" section of a tax
// exemption case whose corpus merely discussed missing documentation in
// ordinary (non-penal) terms.
import { describe, it, expect } from "vitest";
import { buildLegalIssues } from "@/lib/intelligence/report-augment.server";

// The real trigger text from the live report: a tax case discussing
// missing documentation using the phrase "omisión probatoria" — plausible
// in ANY materia, but ISSUE_RULES' indicator regex doesn't distinguish.
const CORPUS_TEXT =
  "El ISSSTE no acompañó la documentación que acredite la clasificación de sus bienes, lo que " +
  "constituye una omisión probatoria relevante para resolver sobre la exención fiscal solicitada.";

function makeFakeDb(opts: { caseType: string | null; documentText: string }) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(table: string): any {
      if (table === "cases") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { case_type: opts.caseType }, error: null }),
            }),
          }),
        };
      }
      if (table === "documents") {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ id: "d1", filename: "test.pdf", extracted_text: opts.documentText, status: "extracted" }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("buildLegalIssues — materia gate", () => {
  it("the real reported bug: does NOT fire ISSUE_RULES on a non-penal (amparo fiscal) case", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = makeFakeDb({ caseType: "amparo", documentText: CORPUS_TEXT }) as any;
    const issues = await buildLegalIssues(db, "case-1");
    expect(issues).toEqual([]);
  });

  it("does NOT fire for civil, fiscal, administrativo, or any other non-penal materia", async () => {
    for (const caseType of ["civil", "fiscal", "administrativo", "laboral", "mercantil", "constitucional"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = makeFakeDb({ caseType, documentText: CORPUS_TEXT }) as any;
      const issues = await buildLegalIssues(db, "case-1");
      expect(issues).toEqual([]);
    }
  });

  it("still fires for an actual penal case with matching indicator text", async () => {
    const penalText = "El Ministerio Público incurrió en ocultamiento de evidencia relevante durante la etapa de investigación.";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = makeFakeDb({ caseType: "penal", documentText: penalText }) as any;
    const issues = await buildLegalIssues(db, "case-1");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.issue === "Omisión en el Deber de Aportación Probatoria")).toBe(true);
  });

  it("never throws when case_type is unset — degrades to empty, not an exception", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = makeFakeDb({ caseType: null, documentText: CORPUS_TEXT }) as any;
    await expect(buildLegalIssues(db, "case-1")).resolves.toEqual([]);
  });
});
