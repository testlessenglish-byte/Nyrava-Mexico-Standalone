// A DB error during identity resolution must never be swallowed into a
// guessed classification — status must come back "failed", caseType stays
// null, and downstream consumers must treat that exactly like "unverified"
// (skip/flag), never as license to fall back to "general_civil" or any other
// invented default. See resolveCaseIdentityUncached's catch block in
// case-classification.server.ts.
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveCaseIdentity,
  __clearCaseIdentityCacheForTests,
} from "@/lib/intelligence/case-classification.server";
import { isUsableForLegalReasoning } from "@/lib/intelligence/case-identity";
import { isStageRelevantForCaseType } from "@/lib/execution/mx-pipeline";
import { getAllowedFindingModules } from "@/lib/intelligence/practice-areas";

function makeThrowingFakeDb() {
  return {
    from(table: string) {
      if (table === "cases") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.reject(new Error("simulated connection reset")),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in fake db: ${table}`);
    },
  };
}

describe("case-identity-failure-path: a DB error resolves to failed, never a guess", () => {
  const db = makeThrowingFakeDb();

  beforeEach(() => {
    __clearCaseIdentityCacheForTests(db as never);
  });

  it("resolveCaseIdentity catches the error and returns status: failed with no caseType", async () => {
    const identity = await resolveCaseIdentity(db as never, "case-broken");

    expect(identity.status).toBe("failed");
    expect(identity.source).toBe("error");
    expect(identity.caseType).toBeNull();
    expect(identity.proceedingType).toBeNull();
    expect(identity.jurisdiction).toBeNull();
    expect(identity.evidence).toBeNull();
    expect(identity.conflict).toBeNull();
  });

  it("isUsableForLegalReasoning rejects a failed identity", async () => {
    const identity = await resolveCaseIdentity(db as never, "case-broken");
    expect(isUsableForLegalReasoning(identity)).toBe(false);
  });

  it("a failed identity degrades every downstream Tier 1 consumer to its safe default, never a guessed materia", async () => {
    const identity = await resolveCaseIdentity(db as never, "case-broken");
    const resolvedCaseType = isUsableForLegalReasoning(identity) ? identity.caseType : null;
    expect(resolvedCaseType).toBeNull();

    // Stage-selection's documented permissive default for "materia unknown"
    // is "exclude nothing" (exclusionsFor(null) === []) — every stage stays
    // eligible rather than the pipeline guessing a materia to filter by.
    expect(isStageRelevantForCaseType(resolvedCaseType, "constitutional")).toBe(true);
    expect(isStageRelevantForCaseType(resolvedCaseType, "witness")).toBe(true);

    // Finding-module policy's safe default for "materia unknown" is
    // universal-only — no materia-specific module (from any materia) is
    // ever let through just because identity resolution failed.
    const allowed = getAllowedFindingModules(resolvedCaseType ?? undefined);
    expect(allowed.has("conceptos_de_violacion")).toBe(false); // amparo-specific
    expect(allowed.has("competencia_de_la_autoridad")).toBe(false); // administrativo-specific
    expect(allowed.has("extraction")).toBe(true); // universal module still allowed
  });
});
