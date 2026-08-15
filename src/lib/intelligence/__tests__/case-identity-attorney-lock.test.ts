// The precedence bug fixed alongside resolveCaseIdentity (see its header
// comment in case-classification.server.ts): an attorney's manual lock must
// be checked BEFORE trusting CONFIRMED source evidence, so that an
// attorney's deliberate override is never silently overwritten by the
// classifier — but a genuine disagreement between the two must surface as an
// explicit conflict, never get silently resolved either way.
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveCaseIdentity,
  __clearCaseIdentityCacheForTests,
} from "@/lib/intelligence/case-classification.server";
import { isUsableForLegalReasoning } from "@/lib/intelligence/case-identity";

const CIVIL_LOCK_QUOTE = "Attorney manually classified this case as civil.";

function makeFakeDb(opts: {
  declaredCaseType: string;
  caseTypeSource: string;
  confirmedEvidenceValue: string | null;
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

describe("case-identity-attorney-lock: manual lock vs. disagreeing CONFIRMED evidence", () => {
  it("a lock that disagrees with CONFIRMED evidence resolves to conflict, caseType null, both values recorded, unusable for legal reasoning", async () => {
    const db = makeFakeDb({
      declaredCaseType: "civil",
      caseTypeSource: "manual_override",
      confirmedEvidenceValue: "amparo",
    });
    __clearCaseIdentityCacheForTests(db as never);

    const identity = await resolveCaseIdentity(db as never, "case-locked-conflict");

    expect(identity.status).toBe("conflict");
    expect(identity.caseType).toBeNull();
    expect(identity.source).toBe("attorney");
    expect(identity.conflict).toEqual({
      attorneyValue: "civil",
      sourceValue: "amparo",
      sourceEvidence: {
        document_id: "doc-1",
        filename: "sentencia.pdf",
        page: 2,
        quote: "AMPARO DIRECTO EN REVISIÓN — quejoso promueve amparo.",
      },
    });
    expect(isUsableForLegalReasoning(identity)).toBe(false);
  });

  it("a lock with no disagreeing CONFIRMED evidence resolves to attorney_locked and IS usable — the attorney's choice is authoritative", async () => {
    const db = makeFakeDb({
      declaredCaseType: "civil",
      caseTypeSource: "manual_override",
      confirmedEvidenceValue: null,
    });
    __clearCaseIdentityCacheForTests(db as never);

    const identity = await resolveCaseIdentity(db as never, "case-locked-clean");

    expect(identity.status).toBe("attorney_locked");
    expect(identity.caseType).toBe("civil");
    expect(identity.source).toBe("attorney");
    expect(identity.conflict).toBeNull();
    expect(isUsableForLegalReasoning(identity)).toBe(true);
  });

  it("a lock that happens to AGREE with CONFIRMED evidence is attorney_locked, not conflict — agreement is never mistaken for disagreement", async () => {
    const db = makeFakeDb({
      declaredCaseType: "amparo",
      caseTypeSource: "manual_override",
      confirmedEvidenceValue: "amparo",
    });
    __clearCaseIdentityCacheForTests(db as never);

    const identity = await resolveCaseIdentity(db as never, "case-locked-agrees");

    expect(identity.status).toBe("attorney_locked");
    expect(identity.caseType).toBe("amparo");
    expect(identity.conflict).toBeNull();
    expect(isUsableForLegalReasoning(identity)).toBe(true);
  });
});
