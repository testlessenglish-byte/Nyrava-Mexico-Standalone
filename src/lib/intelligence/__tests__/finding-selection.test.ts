// Phase 1 safety-layer tests: the unified selector must reproduce the
// pre-refactor counting rules EXACTLY. Any divergence here is a behavior
// change and fails the phase.

import { describe, expect, it } from "vitest";
import {
  classifyFindingSource,
  getFindingConsensus,
  getFindingMetrics,
  isCanonicalFinding,
  selectFindings,
} from "@/lib/intelligence/finding-selection";
import { getCanonicalScoringFindings } from "@/lib/intelligence/scoring-selection";

const CASE_ROW = {
  discovery_at: "2026-01-01T00:00:00Z",
  contradiction_at: "2026-01-01T00:01:00Z",
  evidence_intel_at: "2026-01-01T00:02:00Z",
  scored_at: "2026-01-01T00:03:00Z",
};

const FIXTURE = [
  { source_module: "engine:contradictions", severity: "critical", metadata: {} },
  { source_module: "engine:evidence_intelligence", severity: "high", metadata: {} },
  { source_module: "engine:timeline", severity: "medium", metadata: { provisional: true } },
  { source_module: "agent:witness_credibility", severity: "high", metadata: {} },
  { source_module: "agent:chain_of_custody", severity: "critical", metadata: {} },
  { source_module: "analyzer:facts", severity: "critical", metadata: {} },
  { source_module: "analyzer:entities", severity: "low", metadata: { provisional: true } },
  { source_module: "legacy_import", severity: "high", metadata: {} },
];

describe("classifyFindingSource", () => {
  it("maps each source_module prefix to its class", () => {
    expect(classifyFindingSource({ source_module: "engine:x" })).toBe("engine");
    expect(classifyFindingSource({ source_module: "agent:x" })).toBe("agent");
    expect(classifyFindingSource({ source_module: "analyzer:x" })).toBe("analyzer");
    expect(classifyFindingSource({ source_module: "projection:case_witnesses" })).toBe("projection");
    expect(classifyFindingSource({ source_module: "whatever" })).toBe("other");
    expect(classifyFindingSource({})).toBe("other");
  });

  it("does not treat a prefix appearing mid-string as a class", () => {
    expect(classifyFindingSource({ source_module: "x:engine:y" })).toBe("other");
  });
});

describe("isCanonicalFinding", () => {
  it("accepts engine and agent, rejects analyzer, other, provisional, quarantined, and suppressed", () => {
    expect(isCanonicalFinding({ source_module: "engine:a" })).toBe(true);
    expect(isCanonicalFinding({ source_module: "agent:a" })).toBe(true);
    expect(isCanonicalFinding({ source_module: "analyzer:a" })).toBe(false);
    expect(isCanonicalFinding({ source_module: "legacy" })).toBe(false);
    expect(isCanonicalFinding({ source_module: "engine:a", metadata: { provisional: true } })).toBe(false);
    expect(isCanonicalFinding({ source_module: "engine:a", verification_status: "no_citation" })).toBe(false);
    expect(isCanonicalFinding({ source_module: "engine:a", verification_status: "unverified" })).toBe(false);
    expect(isCanonicalFinding({ source_module: "engine:a", finding_status: "suppressed" })).toBe(false);
  });
});

describe("selectFindings parity with getCanonicalScoringFindings", () => {
  it("returns the identical set the scoring selector returns", () => {
    const viaScoring = getCanonicalScoringFindings({ caseRow: CASE_ROW, findings: FIXTURE as never });
    const viaSelector = selectFindings(FIXTURE);
    expect(viaSelector.length).toBe(viaScoring.length);
    expect(viaSelector.map((f) => f.source_module)).toEqual(
      (viaScoring as unknown as typeof FIXTURE).map((f) => f.source_module),
    );
  });

  it("keeps the canonical set at 4 for the fixture (2 engine + 2 agent)", () => {
    expect(selectFindings(FIXTURE).map((f) => f.source_module)).toEqual([
      "engine:contradictions",
      "engine:evidence_intelligence",
      "agent:witness_credibility",
      "agent:chain_of_custody",
    ]);
  });

  it("reproduces the dashboard high-priority badge rule exactly", () => {
    const legacy = FIXTURE.filter((f) => f.severity === "critical" || f.severity === "high");
    const viaSelector = selectFindings(FIXTURE, {
      include: ["engine", "agent", "analyzer", "other"],
      includeProvisional: true,
      severities: ["critical", "high"],
    });
    expect(viaSelector).toEqual(legacy);
    expect(viaSelector.length).toBe(6);
  });

  it("filters by finding_status when asked and keeps non-suppressed legacy rows by default", () => {
    const rows = [
      { source_module: "engine:a", finding_status: "promoted" },
      { source_module: "engine:b", finding_status: "verified" },
      { source_module: "engine:c" },
    ];
    expect(selectFindings(rows).length).toBe(3);
    expect(selectFindings(rows, { statuses: ["promoted"] }).length).toBe(1);
    expect(selectFindings(rows, { statuses: ["candidate"] }).map((r) => r.source_module)).toEqual(["engine:c"]);
  });

  it("never lets a suppressed finding re-enter canonical report/scoring surfaces unless explicitly requested", () => {
    const rows = [
      { source_module: "engine:good", finding_status: "verified", severity: "high" },
      { source_module: "engine:rejected", finding_status: "suppressed", severity: "critical" },
    ];
    expect(selectFindings(rows).map((r) => r.source_module)).toEqual(["engine:good"]);
    expect(getCanonicalScoringFindings({ caseRow: CASE_ROW, findings: rows as never }).map((r) => r.source_module)).toEqual([
      "engine:good",
    ]);
    expect(selectFindings(rows, { includeSuppressed: true }).map((r) => r.source_module)).toEqual([
      "engine:good",
      "engine:rejected",
    ]);
  });
});

describe("getFindingMetrics", () => {
  it("tallies source, severity, status, and high priority consistently", () => {
    const m = getFindingMetrics(FIXTURE);
    expect(m.total).toBe(8);
    expect(m.canonical).toBe(4);
    expect(m.provisional).toBe(2);
    expect(m.highPriority).toBe(4);
    expect(m.bySource).toEqual({ engine: 3, agent: 2, analyzer: 2, projection: 0, other: 1 });
    expect(m.bySeverity.critical).toBe(3);
    expect(m.byStatus.candidate).toBe(8);
    expect(m.byStatus.promoted).toBe(0);
  });

  it("is total-preserving across source classes", () => {
    const m = getFindingMetrics(FIXTURE);
    const summed = Object.values(m.bySource).reduce((a, b) => a + b, 0);
    expect(summed).toBe(m.total);
  });

  it("handles an empty set without throwing", () => {
    const m = getFindingMetrics([]);
    expect(m.total).toBe(0);
    expect(m.canonical).toBe(0);
    expect(m.byStatus.verified).toBe(0);
  });
});

describe("getFindingConsensus", () => {
  it("reports zero agreement for pre-migration rows", () => {
    expect(getFindingConsensus({ source_module: "engine:a" }).agreementCount).toBe(0);
  });

  it("dedupes and sorts supporting engines", () => {
    const c = getFindingConsensus({
      source_module: "engine:a",
      supporting_engines: ["procedural_compliance", "engine:a", "procedural_compliance"],
    });
    expect(c.engines).toEqual(["engine:a", "procedural_compliance"]);
    expect(c.agreementCount).toBe(2);
  });

  it("never claims independent verification", () => {
    const c = getFindingConsensus({ source_module: "engine:a", supporting_engines: ["a", "b"] });
    expect(c.label("es")).toBe("identificado por 2 etapas del pipeline");
    expect(c.label("en")).toBe("identified by 2 pipeline stages");
    expect(c.label("en")).not.toMatch(/independent/i);
    expect(c.label("es")).not.toMatch(/independiente/i);
  });
});
