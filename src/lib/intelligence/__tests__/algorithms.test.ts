import { describe, it, expect } from "vitest";
import {
  scoreEvidence, scoreWitnessCredibility, buildTimeline,
  detectContradictions, discoveryCompleteness, auditChainOfCustody,
  evaluateBurden, assessRisk, detectMotions, detectAppealIssues,
  runAlgorithmBundle,
} from "@/lib/intelligence/algorithms";

describe("Layer 2 — deterministic legal algorithms", () => {
  it("scoreEvidence rewards corroboration and penalizes broken custody", () => {
    const r = scoreEvidence({ id: "e1", source_doc_ids: ["a", "b", "c"], physical: true, chain_of_custody: false });
    expect(r.score).toBeGreaterThan(40);
    expect(r.factors.some((f) => f.label.includes("chain of custody"))).toBe(true);
  });

  it("scoreWitnessCredibility produces deterministic 0-100 scores", () => {
    const r = scoreWitnessCredibility({ contradictions: 3, prior_inconsistent_statements: 2, internal_consistency: 0.9 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("buildTimeline flags large intervals and unparseable dates", () => {
    const r = buildTimeline([
      { date: "2024-01-01", event: "A" },
      { date: "bogus", event: "B" },
      { date: "2024-12-31", event: "C" },
    ], { gapDays: 30 });
    expect(r.ordered).toHaveLength(2);
    expect(r.undated).toHaveLength(1);
    expect(r.missing_intervals.length).toBeGreaterThan(0);
  });

  it("detectContradictions finds attribute disagreements on the same subject+event", () => {
    const r = detectContradictions([
      { id: "1", subject: "Officer Smith", event: "stop", attributes: { time: "10:00" } },
      { id: "2", subject: "officer smith", event: "Stop", attributes: { time: "11:30" } },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].field).toBe("time");
  });

  it("discoveryCompleteness computes percent + outstanding list", () => {
    const r = discoveryCompleteness([
      { id: "1", label: "bodycam", received: true },
      { id: "2", label: "CAD logs" },
    ]);
    expect(r.percent).toBe(50);
    expect(r.outstanding).toHaveLength(1);
  });

  it("auditChainOfCustody detects handoff breaks", () => {
    const r = auditChainOfCustody([
      { ts: "2024-01-01", from: "Officer A", to: "Evidence Room", itemId: "k1" },
      { ts: "2024-01-02", from: "Lab Tech",  to: "Court",         itemId: "k1" },
    ]);
    expect(r.items.k1.complete).toBe(false);
    expect(r.items.k1.breaks).toHaveLength(1);
  });

  it("evaluateBurden enforces standard thresholds", () => {
    const r = evaluateBurden("mas_alla_duda_razonable", [
      { element: "mens rea", evidence_score: 95 },
      { element: "actus reus", evidence_score: 60 },
    ]);
    expect(r.satisfied).toBe(false);
    expect(r.weakest?.element).toBe("actus reus");
  });

  it("assessRisk bands escalate with inputs", () => {
    const lo = assessRisk({ unresolved_contradictions: 0, missing_evidence: 0, constitutional_issues: 0, unfavorable_witnesses: 0, procedural_defects: 0 });
    const hi = assessRisk({ unresolved_contradictions: 5, missing_evidence: 5, constitutional_issues: 3, unfavorable_witnesses: 2, procedural_defects: 4 });
    expect(lo.band).toBe("low");
    expect(["high", "critical"]).toContain(hi.band);
  });

  it("detectMotions fires exclusión de prueba ilícita when signals exist", () => {
    const r = detectMotions([{ tag: "prueba_ilicita", severity: "high" }]);
    expect(r.find((m) => m.motion.includes("exclusión de prueba"))).toBeTruthy();
  });

  it("detectAppealIssues preserves the preservation flag", () => {
    const r = detectAppealIssues([{ kind: "motivacion_insuficiente_sentencia", preserved: true, severity: "high" }]);
    expect(r[0].preserved).toBe(true);
  });

  it("runAlgorithmBundle returns the full layer-2 envelope", () => {
    const r = runAlgorithmBundle({});
    expect(r.layer).toMatch(/deterministic_legal_intelligence/);
    expect(r.evidence).toEqual([]);
    expect(r.timeline.ordered).toEqual([]);
  });
});
