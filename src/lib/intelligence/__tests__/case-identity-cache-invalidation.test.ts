// Regression test for the deeper root cause behind the ADR-4640-2017-180212
// investigation: resolveCaseIdentity() is memoized per (db instance, caseId)
// "for the lifetime of a single pipeline run" — but runCaseClassification()
// legitimately WRITES fresh case_type/case_classification_evidence data
// mid-run (called from autoDetectCaseContext, which runs at the very start
// of every pipeline tick). If ANY caller resolves and caches an identity
// BEFORE classification has written its evidence, every LATER caller
// sharing the same db instance within that same run kept reusing the stale
// cached "unknown" result — even after classification confirmed the real
// materia moments later. This is exactly how a case whose classifier
// correctly and confidently confirms "amparo" (verified independently — see
// case-classification.test.ts's AMPARO_TEXT fixture) could still end up
// with jurisdiction_intel/legal_qa falling back to "civil": they inherited
// a stale pre-classification cache entry, not a real classifier
// disagreement.
//
// Fixed by invalidateCaseIdentity(db, caseId), called unconditionally at
// the end of runCaseClassification() (case-classification.server.ts).
import { describe, it, expect } from "vitest";
import {
  resolveCaseIdentity,
  runCaseClassification,
  invalidateCaseIdentity,
  __clearCaseIdentityCacheForTests,
} from "@/lib/intelligence/case-classification.server";

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

function makeStatefulFakeDb() {
  const state = {
    caseRow: { case_type: null, case_type_source: null, jurisdiction: null } as Record<string, unknown>,
    evidenceRows: [] as Array<Record<string, unknown>>,
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
              // toCaseIdentityEvidence's follow-up filename lookup.
              maybeSingle: () => Promise.resolve({ data: { filename: "sentencia.pdf" }, error: null }),
            }),
          }),
        };
      }
      if (table === "case_classification_evidence") {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: state.evidenceRows, error: null }),
            }),
          }),
          delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: (rows: Array<Record<string, unknown>>) => {
            state.evidenceRows = rows;
            return Promise.resolve({ error: null });
          },
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
              Object.assign(state.caseRow, patch);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      // Generic handler for CASE_DERIVED_TABLES (Step 5's clearCaseDerivedData).
      return { delete: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    },
  };
  return { db, state };
}

describe("case-identity-cache-invalidation: a stale cached identity does not survive a later classification write", () => {
  it("reproduces the bug when invalidation is skipped, then proves invalidateCaseIdentity fixes it", async () => {
    const { db } = makeStatefulFakeDb();
    __clearCaseIdentityCacheForTests(db as never);

    // Step 1: something resolves identity BEFORE classification has run —
    // exactly what a practice-area gate could do at the very start of a
    // pipeline tick. Nothing is known yet, so this correctly (at the time)
    // resolves to unverified/null and gets CACHED for this db instance.
    const early = await resolveCaseIdentity(db as never, "case-adr-4640");
    expect(early.status).toBe("unverified");
    expect(early.caseType).toBeNull();

    // Step 2: classification now runs (as autoDetectCaseContext does, mid
    // pipeline) and confirms "amparo" with real evidence, writing both
    // case_classification_evidence and cases.case_type.
    const result = await runCaseClassification(db as never, "case-adr-4640", "user-1");
    const caseTypeField = result.fields.find((f) => f.field === "case_type")!;
    expect(caseTypeField.status).toBe("CONFIRMED");
    expect(caseTypeField.value).toBe("amparo");

    // Step 3: without the fix, this would return the STALE cached "early"
    // result (caseType: null) even though the DB now genuinely confirms
    // "amparo" — reproducing the exact symptom (jurisdiction_intel/legal_qa
    // falling back to "civil" despite a correctly-classified document).
    const after = await resolveCaseIdentity(db as never, "case-adr-4640");
    expect(after.status).toBe("verified");
    expect(after.caseType).toBe("amparo");
    expect(after.caseType).not.toBeNull();
  });

  it("invalidateCaseIdentity only clears the named case, not other cases cached on the same db instance", async () => {
    const { db, state } = makeStatefulFakeDb();
    __clearCaseIdentityCacheForTests(db as never);

    const other = await resolveCaseIdentity(db as never, "case-other");
    expect(other.status).toBe("unverified");

    state.caseRow.case_type = "amparo";
    invalidateCaseIdentity(db as never, "case-adr-4640"); // a different caseId

    // "case-other" was never invalidated, so it still returns its cached
    // (now stale, but that's expected/scoped) result rather than throwing
    // or being wiped as a side effect of invalidating an unrelated case.
    const otherAgain = await resolveCaseIdentity(db as never, "case-other");
    expect(otherAgain.caseType).toBeNull();
  });
});
