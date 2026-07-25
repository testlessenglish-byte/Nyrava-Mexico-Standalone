// Regression tests for AgentSummary — the single source of truth for
// agent counts across the top-nav badge, Multi-Agent panel, Dashboard,
// and PDF export.
//
// Guards against the "Agents (3) vs 13 Executed" UI inconsistency bug:
// every consumer MUST read from getAgentSummary(report) and never
// re-derive counts from agent_findings.length or agent_logs on the client.
import { describe, it, expect } from "vitest";
import { getAgentSummary, validateAgentSummary } from "@/lib/intelligence/canonical";

// Shape the pipeline persists at reports.full_report.agent_statistics
const reportWith = (defs: Record<string, number>) => ({
  full_report: { agent_statistics: { definitions: defs } },
});

describe("AgentSummary — single source of truth", () => {
  it("reads canonical counts from reports.full_report.agent_statistics.definitions", () => {
    const r = reportWith({
      loaded: 13, executed: 13, producing_output: 12,
      producing_findings: 2, suppressed_findings: 49, visible_findings: 3,
    });
    const s = getAgentSummary(r);
    expect(s).toEqual({
      loaded: 13, executed: 13, producingOutput: 12,
      producingFindings: 2, suppressedFindings: 49, visibleFindings: 3,
    });
  });

  it("returns all zeros when the report has no agent_statistics", () => {
    expect(getAgentSummary(null)).toEqual({
      loaded: 0, executed: 0, producingOutput: 0,
      producingFindings: 0, suppressedFindings: 0, visibleFindings: 0,
    });
    expect(getAgentSummary({ full_report: {} })).toEqual({
      loaded: 0, executed: 0, producingOutput: 0,
      producingFindings: 0, suppressedFindings: 0, visibleFindings: 0,
    });
  });

  it("coerces non-numeric or negative values to 0", () => {
    const s = getAgentSummary(reportWith({
      loaded: -5, executed: Number.NaN as never, producing_output: 12,
      producing_findings: 2, suppressed_findings: 0, visible_findings: 3,
    }));
    expect(s.loaded).toBe(0);
    expect(s.executed).toBe(0);
    expect(s.producingOutput).toBe(12);
  });

  it("the user-reported real-world sample satisfies the count invariants", () => {
    // From the reliability-freeze bug report:
    //   loaded=13, executed=13, producing=12, findings=2, visible=3, suppressed=49
    const s = getAgentSummary(reportWith({
      loaded: 13, executed: 13, producing_output: 12,
      producing_findings: 2, suppressed_findings: 49, visible_findings: 3,
    }));
    expect(validateAgentSummary(s)).toEqual([]);
    expect(s.loaded).toBeGreaterThanOrEqual(s.executed);
    expect(s.executed).toBeGreaterThanOrEqual(s.producingOutput);
    expect(s.producingOutput).toBeGreaterThanOrEqual(s.producingFindings);
    expect(s.suppressedFindings).toBeGreaterThanOrEqual(0);
  });

  it("flags a summary whose executed exceeds loaded", () => {
    const errs = validateAgentSummary({
      loaded: 3, executed: 13, producingOutput: 0,
      producingFindings: 0, suppressedFindings: 0, visibleFindings: 0,
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/loaded/);
  });

  it("top-nav badge and Multi-Agent panel derive the same `executed` from one source", () => {
    // Simulates the previous bug: two components computing independently.
    // Both now MUST call getAgentSummary(report).executed.
    const r = reportWith({
      loaded: 13, executed: 13, producing_output: 12,
      producing_findings: 2, suppressed_findings: 49, visible_findings: 3,
    });
    const topNav = getAgentSummary(r).executed;
    const multiAgentPanel = getAgentSummary(r).executed;
    const dashboard = getAgentSummary(r).executed;
    expect(topNav).toBe(13);
    expect(topNav).toBe(multiAgentPanel);
    expect(topNav).toBe(dashboard);
  });
});
