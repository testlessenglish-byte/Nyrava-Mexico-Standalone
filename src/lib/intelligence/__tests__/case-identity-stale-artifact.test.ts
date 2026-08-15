// Fix instructions Step 5: when an automatic re-classification run actually
// CHANGES cases.case_type (not merely re-confirms the same value), every
// derived artifact generated under the old, wrong materia (findings,
// reports, scores, agent output, ...) must be invalidated — otherwise a
// case that was first analyzed as "administrativo" and later corrected to
// "amparo" keeps serving stale administrativo-era findings/report forever.
// Exercises the REAL runCaseClassification() (which internally calls the
// REAL clearCaseDerivedData()/CASE_RESET_FIELDS from pipeline-reset.ts) with
// a fake db, following this codebase's established mocking convention.
import { describe, it, expect } from "vitest";
import { runCaseClassification } from "@/lib/intelligence/case-classification.server";
import { CASE_DERIVED_TABLES, CASE_RESET_FIELDS } from "@/lib/pipeline-reset";

const AMPARO_TEXT = `
  AMPARO DIRECTO EN REVISIÓN 4640/2017
  Expediente número 4640/2017.
  TRIBUNAL COLEGIADO EN MATERIA ADMINISTRATIVA DEL PRIMER CIRCUITO
  QUEJOSO: Juan Pérez López
  Juicio de amparo indirecto. Quejoso promueve contra acto reclamado de
  autoridad responsable. Suspensión definitiva concedida. Se invocan
  derechos humanos y control de convencionalidad como fundamento del
  concepto de violación. Ley de amparo aplicable. Amparo indirecto.
  El presente asunto ha causado ejecutoria.
`.repeat(2);

function makeFakeDb(initialCaseRow: {
  case_type: string | null;
  jurisdiction: string | null;
  case_type_source: string | null;
}) {
  const state = {
    caseRow: { ...initialCaseRow } as Record<string, unknown>,
    updatePatches: [] as Record<string, unknown>[],
    deletedTables: [] as string[],
  };
  const db = {
    from(table: string) {
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [{ id: "doc-adr-4640", filename: "sentencia.pdf", extracted_text: AMPARO_TEXT }],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "case_classification_evidence") {
        return {
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: () => Promise.resolve({ error: null }),
        };
      }
      if (table === "cases") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { ...state.caseRow }, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => {
              state.updatePatches.push(patch);
              Object.assign(state.caseRow, patch);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      // Generic handler for every CASE_DERIVED_TABLES entry clearCaseDerivedData
      // loops over — matches the real shape (delete().eq('case_id', ...)).
      return {
        delete: () => ({
          eq: () => {
            state.deletedTables.push(table);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
  return { db, state };
}

describe("case-identity-stale-artifact: correcting case_type invalidates prior derived data", () => {
  it("a run that CHANGES case_type (administrativo -> amparo) clears every derived table and resets progress fields", async () => {
    const { db, state } = makeFakeDb({
      case_type: "administrativo",
      jurisdiction: null,
      case_type_source: null,
    });

    await runCaseClassification(db as never, "case-adr-4640", "user-1");

    expect(state.caseRow.case_type).toBe("amparo");

    // Every table clearCaseDerivedData knows about was actually cleared for
    // this case — not a partial/best-effort subset.
    for (const table of CASE_DERIVED_TABLES) {
      expect(state.deletedTables).toContain(table);
    }

    // The reset-fields patch (progress/status/timestamps back to their
    // fresh-run defaults) was applied, not just the case_type write.
    const resetPatch = state.updatePatches.find(
      (p) => p.progress === CASE_RESET_FIELDS.progress && p.status_message === CASE_RESET_FIELDS.status_message,
    );
    expect(resetPatch).toBeTruthy();
    expect(resetPatch).toMatchObject(CASE_RESET_FIELDS);
  });

  it("a re-run that only RE-CONFIRMS the same case_type does not re-invalidate derived data", async () => {
    const { db, state } = makeFakeDb({
      case_type: "amparo",
      jurisdiction: null,
      case_type_source: "source_confirmed",
    });

    await runCaseClassification(db as never, "case-adr-4640", "user-1");

    expect(state.caseRow.case_type).toBe("amparo");
    expect(state.deletedTables).toHaveLength(0);
    const resetPatch = state.updatePatches.find((p) => p.progress === CASE_RESET_FIELDS.progress);
    expect(resetPatch).toBeUndefined();
  });

  it("a manually locked case_type is never overwritten and never triggers invalidation, even when source evidence disagrees", async () => {
    const { db, state } = makeFakeDb({
      case_type: "civil",
      jurisdiction: null,
      case_type_source: "manual_override_conflicting",
    });

    await runCaseClassification(db as never, "case-adr-4640", "user-1");

    expect(state.caseRow.case_type).toBe("civil");
    expect(state.deletedTables).toHaveLength(0);
  });
});
