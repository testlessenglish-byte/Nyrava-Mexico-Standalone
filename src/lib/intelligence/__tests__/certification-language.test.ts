// Regression test for the certification-language fix: the PDF/DOCX cover
// used to print "Evidence-grounded. Citation-audited..." unconditionally,
// regardless of whether QA/Judge/Hallucination actually passed. Confirmed
// via production evidence: a report with zero findings, a failed inner
// release gate, and QA passing but Judge and Hallucination both failing
// still printed the full certification claim.
//
// deriveCertificationState() derives the claim from data.agent_logs (the
// real 13-agent audit rows, same source as the multi_agent release gate
// fixed in an earlier PR) rather than from report_mode alone — per the
// explicit requirement that FULL/LIMITED mode is not sufficient on its own
// (a report can be nominally FULL while its verification gate still
// failed).
//
// Generic synthetic agent_logs rows only — no case-specific content.
import { describe, it, expect } from "vitest";
import { deriveCertificationState } from "@/lib/export";
import type { CaseExportData } from "@/lib/export";

function makeExportData(agentLogs: Array<Record<string, unknown>>): CaseExportData {
  return {
    case: { id: "case-1", name: "Generic Case" },
    documents: [],
    analysis: null,
    agents: [],
    score: null,
    report: { report_mode: "FULL" },
    agent_logs: agentLogs,
  };
}

describe("deriveCertificationState", () => {
  it("returns 'verified' only when qa, judge, and hallucination all succeeded", () => {
    const data = makeExportData([
      { agent_key: "qa", status: "success", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "judge", status: "success", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "hallucination", status: "success", started_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(deriveCertificationState(data)).toBe("verified");
  });

  it("returns 'unverified' when judge failed even though qa and hallucination succeeded (the confirmed production scenario)", () => {
    const data = makeExportData([
      { agent_key: "qa", status: "success", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "judge", status: "failed", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "hallucination", status: "success", started_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(deriveCertificationState(data)).toBe("unverified");
  });

  it("returns 'unverified' when hallucination failed", () => {
    const data = makeExportData([
      { agent_key: "qa", status: "success", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "judge", status: "success", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "hallucination", status: "failed", started_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(deriveCertificationState(data)).toBe("unverified");
  });

  it("fails closed: no agent_logs at all means unverified, not verified", () => {
    const data = makeExportData([]);
    expect(deriveCertificationState(data)).toBe("unverified");
  });

  it("fails closed: agent_logs present but missing one of the three required gates means unverified", () => {
    const data = makeExportData([
      { agent_key: "qa", status: "success", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "judge", status: "success", started_at: "2026-01-01T00:00:00Z" },
      // hallucination row entirely absent
    ]);
    expect(deriveCertificationState(data)).toBe("unverified");
  });

  it("uses the LATEST row per agent when multiple runs exist (e.g. after a resume/retry)", () => {
    const data = makeExportData([
      { agent_key: "qa", status: "success", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "judge", status: "failed", started_at: "2026-01-01T00:00:00Z" },
      { agent_key: "hallucination", status: "success", started_at: "2026-01-01T00:00:00Z" },
      // A later, successful judge retry — this is the one that should count.
      { agent_key: "judge", status: "success", started_at: "2026-01-01T01:00:00Z" },
    ]);
    expect(deriveCertificationState(data)).toBe("verified");
  });
});
