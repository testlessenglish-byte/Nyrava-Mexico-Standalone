// Regression test for the completed-case-audit's gating contract: it must
// be a true no-op — no DB reads beyond the case_analysis_mode check, no LLM
// call — for every case NOT under a completed-case analysis mode. This is
// what makes it safe to call unconditionally from the pipeline's
// finalization step (see pipeline.server.ts, right after
// runFinalReleaseReview) without risking any effect on an ongoing case.
import { describe, it, expect } from "vitest";

function makeFakeDb(calls: string[]) {
  function chain(resolveValue: unknown) {
    const c: Record<string, unknown> = {
      eq: () => c,
      not: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: resolveValue, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: resolveValue, error: null }),
    };
    return c;
  }
  return {
    from(table: string) {
      calls.push(table);
      if (table === "cases") return { select: () => chain({ case_analysis_mode: "ongoing" }) };
      // Any other table being touched at all, for an "ongoing" case, is the
      // bug this test guards against.
      throw new Error(`unexpected table access for an ongoing-mode case: ${table}`);
    },
  };
}

describe("runCompletedCaseAudit: gating", () => {
  it("is a true no-op for a case under the default 'ongoing' analysis mode", async () => {
    const { runCompletedCaseAudit } =
      await import("@/lib/intelligence/completed-case-audit.server");
    const calls: string[] = [];
    const db = makeFakeDb(calls);

    const result = await runCompletedCaseAudit(db as never, "case-1", "user-1");

    expect(result).toBeNull();
    expect(calls).toEqual(["cases"]);
  });
});
