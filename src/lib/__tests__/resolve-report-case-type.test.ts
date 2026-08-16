// Canonical Reconciliation Design (2026-08-16), P2 — resolveReportCaseType
// regression tests. Real gap this closes: report generation used to call
// resolveCaseType (pipeline.server.ts), which returns an attorney-locked
// case_type with NO awareness of resolveCaseIdentity's "conflict" status —
// even when the lock actively disagrees with CONFIRMED classification
// evidence, a state every OTHER legal-reasoning consumer in the pipeline
// (analyzer stage, isFindingAllowed's policy gate) already refuses to trust.
// Mirrors the fake-db pattern from case-identity-attorney-lock.test.ts.
import { describe, it, expect } from "vitest";
import { resolveReportCaseType, resolveCaseType } from "@/lib/pipeline.server";

function makeFakeDb(opts: {
  declaredCaseType: string;
  caseTypeSource: string;
  confirmedEvidenceValue: string | null;
  name?: string;
  description?: string;
}) {
  return {
    from(table: string) {
      if (table === "cases") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    case_type: opts.declaredCaseType,
                    case_type_source: opts.caseTypeSource,
                    jurisdiction: null,
                    name: opts.name ?? "",
                    description: opts.description ?? "Juicio de amparo directo en revisión.",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "case_classification_evidence") {
        return {
          select: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: opts.confirmedEvidenceValue
                    ? [
                        {
                          field: "case_type",
                          status: "CONFIRMED",
                          value: opts.confirmedEvidenceValue,
                          confidence: 0.88,
                          source_document_id: "doc-1",
                          source_page: 2,
                          source_quote: "AMPARO DIRECTO EN REVISIÓN — quejoso promueve amparo.",
                        },
                      ]
                    : [],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { filename: "sentencia.pdf" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in fake db: ${table}`);
    },
  };
}

describe("resolveReportCaseType", () => {
  it("refuses the attorney-locked value when it actively conflicts with CONFIRMED evidence, falling back to detection instead", async () => {
    const db = makeFakeDb({
      declaredCaseType: "civil",
      caseTypeSource: "manual_override",
      confirmedEvidenceValue: "amparo",
      description: "Juicio de amparo directo en revisión ante el Tribunal Colegiado.",
    });
    const result = await resolveReportCaseType(db as never, "case-conflict");
    expect(result.identityConflict).toBe(true);
    // Never the conflicting locked value.
    expect(result.caseType).not.toBe("civil");
    // Falls back to real detection over the case description — not a
    // hardcoded default.
    expect(result.caseType).toBe("amparo");
  });

  it("uses the locked value normally (matches resolveCaseType) when it's attorney_locked with no conflict", async () => {
    const db = makeFakeDb({
      declaredCaseType: "civil",
      caseTypeSource: "manual_override",
      confirmedEvidenceValue: null,
    });
    const [reportResult, plain] = await Promise.all([
      resolveReportCaseType(db as never, "case-locked-clean"),
      resolveCaseType(db as never, "case-locked-clean"),
    ]);
    expect(reportResult.identityConflict).toBe(false);
    expect(reportResult.caseType).toBe("civil");
    expect(reportResult.caseType).toBe(plain);
  });

  it("uses the locked value normally when the lock happens to AGREE with CONFIRMED evidence", async () => {
    const db = makeFakeDb({
      declaredCaseType: "amparo",
      caseTypeSource: "manual_override",
      confirmedEvidenceValue: "amparo",
    });
    const result = await resolveReportCaseType(db as never, "case-locked-agrees");
    expect(result.identityConflict).toBe(false);
    expect(result.caseType).toBe("amparo");
  });

  it("uses the merely-declared (not yet evidence-confirmed) value unchanged — no regression for the common case", async () => {
    // status will be "unverified" (declared, no CONFIRMED evidence, no
    // manual lock source) — isUsableForLegalReasoning would say false here,
    // but resolveReportCaseType deliberately does NOT gate on that; it only
    // refuses a genuine "conflict".
    const db = makeFakeDb({
      declaredCaseType: "mercantil",
      caseTypeSource: "declared",
      confirmedEvidenceValue: null,
    });
    const result = await resolveReportCaseType(db as never, "case-declared-only");
    expect(result.identityConflict).toBe(false);
    expect(result.caseType).toBe("mercantil");
  });
});
