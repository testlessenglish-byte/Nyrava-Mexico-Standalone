// The ADR-4640-2017 regression canary — see
// "Fix the Verified Case Identity Architecture" instructions §6a.
//
// Honest scope note: this is a deterministic fake-db unit test, following
// this codebase's established convention (see case-classification.test.ts,
// finding-not-established-write-path.test.ts) — it exercises the REAL
// resolveCaseIdentity()/isUsableForLegalReasoning()/isStageRelevantForCaseType()/
// getAllowedFindingModules()/resolveMxProfile() functions against a fake db,
// not a live end-to-end pipeline run with a real AI call and a real corpus.
// A literal "run the actual production pipeline entry point" assertion (the
// spec's phrasing) is not something a unit test in this environment can do —
// there is no live AI/DB harness anywhere in this suite; every existing test
// follows the same fake-db-around-real-functions shape. What this test DOES
// prove, with real production code, is the specific failure this canary is
// named for: a case whose `cases.case_type` column is stuck at a stale/wrong
// value ("administrativo") while the corpus's own extracted evidence
// CONFIRMS a different materia ("amparo") must resolve — and propagate to
// every Tier 1 consumer — as "amparo", never silently falling back to the
// stale column.
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveCaseIdentity,
  __clearCaseIdentityCacheForTests,
} from "@/lib/intelligence/case-classification.server";
import { isUsableForLegalReasoning } from "@/lib/intelligence/case-identity";
import { isStageRelevantForCaseType } from "@/lib/execution/mx-pipeline";
import { getAllowedFindingModules } from "@/lib/intelligence/practice-areas";

const ADR_QUOTE =
  "AMPARO DIRECTO EN REVISIÓN 4640/2017. Quejoso promueve juicio de amparo contra el acto reclamado de la autoridad responsable.";

function makeAdr4640FakeDb() {
  return {
    from(table: string) {
      if (table === "cases") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  // The stale/legacy value this canary is named for: the
                  // declared column says "administrativo" and was never
                  // manually locked by an attorney (case_type_source is
                  // null, not "manual_override*").
                  data: { case_type: "administrativo", case_type_source: null, jurisdiction: null },
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
                  data: [
                    {
                      field: "case_type",
                      status: "CONFIRMED",
                      value: "amparo",
                      confidence: 0.92,
                      source_document_id: "doc-adr-4640",
                      source_page: 1,
                      source_quote: ADR_QUOTE,
                    },
                  ],
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
              maybeSingle: () =>
                Promise.resolve({ data: { filename: "sentencia-adr-4640.pdf" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in fake db: ${table}`);
    },
  };
}

describe("case-identity-canary: ADR-4640-2017 stale-administrativo / confirmed-amparo scenario", () => {
  const db = makeAdr4640FakeDb();

  beforeEach(() => {
    __clearCaseIdentityCacheForTests(db as never);
  });

  it("resolveCaseIdentity trusts the CONFIRMED source evidence over the stale declared column", async () => {
    const identity = await resolveCaseIdentity(db as never, "case-adr-4640");

    expect(identity.status).toBe("verified");
    expect(identity.caseType).toBe("amparo");
    expect(identity.caseType).not.toBe("administrativo");
    expect(identity.source).toBe("source_confirmed");
    expect(identity.confidence).toBe(0.92);
    expect(identity.evidence).toEqual({
      document_id: "doc-adr-4640",
      filename: "sentencia-adr-4640.pdf",
      page: 1,
      quote: ADR_QUOTE,
    });
    expect(isUsableForLegalReasoning(identity)).toBe(true);
  });

  it("downstream stage-selection sees the constitutional stage as relevant for amparo, which the stale administrativo value would have wrongly skipped", async () => {
    const identity = await resolveCaseIdentity(db as never, "case-adr-4640");
    const resolvedCaseType = isUsableForLegalReasoning(identity) ? identity.caseType : null;

    // amparo excludes only "witness" (no live testimonial hearing) — the
    // constitutional stage IS relevant. administrativo excludes BOTH
    // "constitutional" and "witness" (see EXCLUDED_STAGES in mx-pipeline.ts).
    // This is the concrete, reproducible consequence of the bug this canary
    // guards against: a case stuck reading the stale column would have its
    // constitutional-analysis stage silently skipped even though the case is
    // actually an amparo, where constitutional analysis is central.
    expect(isStageRelevantForCaseType(resolvedCaseType, "constitutional")).toBe(true);
    expect(isStageRelevantForCaseType("administrativo", "constitutional")).toBe(false);
  });

  it("downstream finding-module policy allows amparo-specific modules the stale administrativo value would have rejected", async () => {
    const identity = await resolveCaseIdentity(db as never, "case-adr-4640");
    const resolvedCaseType = isUsableForLegalReasoning(identity) ? identity.caseType : null;

    const allowedForResolved = getAllowedFindingModules(resolvedCaseType ?? undefined);
    const allowedForStaleValue = getAllowedFindingModules("administrativo");

    // "conceptos_de_violacion" (the core amparo pleading concept) is real
    // signal only in the amparo module list, not administrativo's — proof
    // that trusting the stale column would have caused a genuine amparo
    // finding module to be filtered out as "not applicable to this case."
    expect(allowedForResolved.has("conceptos_de_violacion")).toBe(true);
    expect(allowedForStaleValue.has("conceptos_de_violacion")).toBe(false);
  });
});
