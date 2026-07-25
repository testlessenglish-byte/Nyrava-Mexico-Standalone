import { describe, it, expect } from "vitest";
import {
  getCanonicalScoringFindings,
  assertPipelineOrder,
  derivePipelineState,
  PipelineNotFinalizedError,
  CanonicalFindingsEmptyError,
  InvalidPipelineOrderError,
} from "../scoring-selection";

const finalized = {
  discovery_at: "2026-01-01T00:00:00Z",
  contradiction_at: "2026-01-01T00:01:00Z",
  evidence_intel_at: "2026-01-01T00:02:00Z",
  scored_at: "2026-01-01T00:03:00Z",
};

const mkF = (id: string, source_module: string, extra: Partial<{ metadata: Record<string, unknown> }> = {}) =>
  ({ id, source_module, ...extra }) as never;

describe("scoring-selection single source of truth", () => {
  it("derivePipelineState marks finalized only when all three timestamps present", () => {
    expect(derivePipelineState(finalized).finalized).toBe(true);
    expect(derivePipelineState({ ...finalized, discovery_at: null }).finalized).toBe(false);
  });

  it("throws PIPELINE_NOT_FINALIZED if any upstream timestamp missing", () => {
    expect(() =>
      getCanonicalScoringFindings({
        caseRow: { ...finalized, contradiction_at: null },
        findings: [mkF("a", "engine:contradictions")],
      }),
    ).toThrow(PipelineNotFinalizedError);
  });

  it("filters out analyzer:* and provisional findings, but keeps engine:* and agent:*", () => {
    const out = getCanonicalScoringFindings({
      caseRow: finalized,
      findings: [
        mkF("a", "engine:contradictions"),
        mkF("b", "analyzer:foo"),
        mkF("c", "engine:discovery", { metadata: { provisional: true } }),
        mkF("d", "engine:witness"),
        mkF("e", "agent:chain_of_custody"),
        mkF("f", "agent:constitutional_compliance"),
        mkF("g", "agent:procedural_violations", { metadata: { provisional: true } }),
      ],
    });
    // "a" and "d" are engine:* survivors; "e" and "f" are agent:* survivors.
    // "b" (analyzer:*), "c" (provisional engine:*), and "g" (provisional
    // agent:*) are all correctly excluded.
    expect(out.map((f) => f.id).sort()).toEqual(["a", "d", "e", "f"]);
  });

  it("throws CANONICAL_FINDINGS_EMPTY when no engine findings survive", () => {
    expect(() =>
      getCanonicalScoringFindings({
        caseRow: finalized,
        findings: [mkF("x", "analyzer:foo")],
      }),
    ).toThrow(CanonicalFindingsEmptyError);
  });

  it("assertPipelineOrder enforces scored_at >= preconditions in report mode", () => {
    expect(() => assertPipelineOrder(finalized, "report")).not.toThrow();
    expect(() => assertPipelineOrder({ ...finalized, scored_at: "2025-01-01T00:00:00Z" }, "report")).toThrow(
      InvalidPipelineOrderError,
    );
    expect(() => assertPipelineOrder({ ...finalized, scored_at: null }, "report")).toThrow(InvalidPipelineOrderError);
  });

  it("assertPipelineOrder in scoring mode requires only preconditions", () => {
    expect(() => assertPipelineOrder({ ...finalized, scored_at: null }, "scoring")).not.toThrow();
    expect(() => assertPipelineOrder({ ...finalized, discovery_at: null }, "scoring")).toThrow(
      PipelineNotFinalizedError,
    );
  });
});
