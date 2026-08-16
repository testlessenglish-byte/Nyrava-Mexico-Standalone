// Canonical Reconciliation Design (2026-08-16), P3 §10 F-7 — the domain-
// vocabulary gate and the claim-evidence-relevance gate (both inside
// addFindings, findings.server.ts) always computed a real rejection list and
// logged it via console.warn, but never counted it into
// findings_summary.suppression_reasons the way every other rejection reason
// already does — an attorney reading the report's "Findings Summary" had no
// way to see this content was ever suppressed. This exercises the REAL
// addFindings() end-to-end (not a unit-tested helper) against a fake db that
// supports the full resolveCaseIdentity() query shape (cases +
// case_classification_evidence, including `.in()`), since the domain-
// vocabulary gate only ever fires once addFindings resolves a real,
// non-penal materia.
import { describe, it, expect, beforeEach } from "vitest";
import { readFindingsAudit, resetFindingsAudit } from "@/lib/intelligence/findings.server";

const CASE_ID = "case-domain-vocab-1";

function makeFakeDb() {
  function chain(resolveValue: unknown) {
    const c: Record<string, unknown> = {
      eq: () => c,
      in: () => c,
      not: () => c,
      like: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: resolveValue, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: resolveValue, error: null }),
    };
    return c;
  }
  return {
    from(table: string) {
      return {
        select() {
          if (table === "cases")
            return chain({
              case_type: "civil",
              case_type_source: "declared",
              jurisdiction: null,
              analysis_mode: "exploratory",
            });
          // No CONFIRMED classification evidence — resolveCaseIdentity falls
          // through to the plain "declared" case_type above (status
          // "unverified", caseType still "civil" — checkFindingDomainVocabulary
          // only needs a real materia string, not full verification).
          if (table === "case_classification_evidence") return chain([]);
          if (table === "documents")
            return chain([
              {
                id: "doc-1",
                filename: "doc-1.txt",
                extracted_text:
                  "El demandado incumplió el contrato de compraventa celebrado el 5 de enero de 2025.",
                status: "extracted",
              },
            ]);
          if (table === "case_domain_activations") return chain([]);
          if (table === "case_findings") return chain([]);
          return chain([]);
        },
        insert(payload: unknown) {
          const rows = Array.isArray(payload) ? payload : [payload];
          return { select: () => ({ then: (r: (v: unknown) => void) => r({ data: rows, error: null }) }) };
        },
        update() {
          return { eq: () => Promise.resolve({ error: null }) };
        },
        delete: () => ({ eq: () => ({ like: () => Promise.resolve({ error: null }) }) }),
      };
    },
  };
}

describe("addFindings: domain-vocabulary and claim-evidence-relevance rejections are counted, not just logged", () => {
  beforeEach(() => {
    resetFindingsAudit(CASE_ID);
  });

  it("counts a domain-vocabulary-gate rejection into findings_summary.suppression_reasons.domain_vocabulary_violation", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const db = makeFakeDb();

    const rows = [
      {
        case_id: CASE_ID,
        user_id: "user-1",
        source_module: "agent:ways_out_analysis",
        category: "ways_out_analysis",
        // Real ADR 4640/2017 failure shape: a penal-only institution
        // asserted in a CIVIL case's own finding text.
        title: "Resolución del Tribunal de Enjuiciamiento",
        description:
          "La resolución del Tribunal de Enjuiciamiento desestimó un argumento novedoso planteado por el demandado en el contrato de compraventa.",
        severity: "medium" as const,
        confidence: 0.8,
        legal_significance: null,
        potential_impact: null,
        affected_party: null,
        evidence_refs: [],
        source_doc_ids: ["doc-1"],
        tags: [],
        metadata: {},
      },
    ];

    await addFindings(db as never, rows);

    const audit = readFindingsAudit(CASE_ID);
    expect(audit.suppression_reasons.domain_vocabulary_violation).toBeGreaterThan(0);
    expect(audit.suppressed).toBeGreaterThan(0);
  });
});
