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

const mkF = (id: string, source_module: string, extra: Record<string, unknown> = {}) =>
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
        mkF("a", "engine:contradictions", { title: "Issue A", category: "A" }),
        mkF("b", "analyzer:foo", { title: "Issue B", category: "B" }),
        mkF("c", "engine:discovery", { title: "Issue C", category: "C", metadata: { provisional: true } }),
        mkF("d", "engine:witness", { title: "Issue D", category: "D" }),
        mkF("e", "agent:chain_of_custody", { title: "Issue E", category: "E" }),
        mkF("f", "agent:constitutional_compliance", { title: "Issue F", category: "F" }),
        mkF("g", "agent:procedural_violations", {
          title: "Issue G",
          category: "G",
          metadata: { provisional: true },
        }),
      ],
    });
    expect(out.map((f) => f.id).sort()).toEqual(["a", "d", "e", "f"]);
  });

  it("collapses duplicate finalized rows before scoring and keeps the verified court holding", () => {
    const quote = "la exención prevista en el artículo 230 de la LISSSTE únicamente resulta aplicable respecto de contribuciones de carácter federal";
    const out = getCanonicalScoringFindings({
      caseRow: finalized,
      findings: [
        mkF("stale-risk-child", "agent:constitutional_rights_mapping", {
          title: "Posible exención de impuestos",
          category: "Hallazgo General",
          description: "Posible alcance de la exención de impuestos del ISSSTE.",
          severity: "high",
          confidence: 0.95,
          audit_classification: "POTENTIAL_ISSUE",
          evidence_refs: [{ doc_n: 1, quote }],
          impact_direction: "negative",
        }),
        mkF("verified-holding", "agent:chain_of_custody", {
          title: "Exención de impuestos",
          category: "Hallazgo General",
          description: "Determinación judicial sobre el alcance de la exención de impuestos del ISSSTE.",
          severity: "high",
          confidence: 0.9,
          audit_classification: "VERIFIED_COURT_HOLDING",
          proposition_type: "holding",
          adoption_status: "adopted",
          evidence_refs: [{ doc_n: 1, quote }],
          impact_direction: "neutral",
        }),
      ],
    });

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("verified-holding");
    expect(out[0].audit_classification).toBe("VERIFIED_COURT_HOLDING");
    expect(out[0].impact_direction).toBe("neutral");
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
