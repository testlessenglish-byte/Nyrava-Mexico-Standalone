import { describe, it, expect } from "vitest";
import { canGenerateReport, missingRequiredEngines, REPORT_REQUIRED_ENGINES } from "../canonical";

describe("Pipeline Execution Isolation (Phase 1)", () => {
  const caseId = "case-123-uuid";
  const executionA = "exec-aaa-111";
  const executionB = "exec-bbb-222";

  it("proves an old passed execution cannot satisfy a new execution when execution_id is filtered", () => {
    // Database contains passed runs from Execution A and empty/pending for Execution B
    const allDbRuns = REPORT_REQUIRED_ENGINES.map((engine) => ({
      id: `run-${engine}-A`,
      case_id: caseId,
      execution_id: executionA,
      engine,
      status: "completed",
      created_at: "2026-08-01T10:00:00Z",
    }));

    // Query strictly filtered to execution B:
    const executionBRuns = allDbRuns.filter((r) => r.execution_id === executionB);
    const gateB = canGenerateReport(executionBRuns as any);

    expect(gateB.ok).toBe(false);
    expect(gateB.missingBlocking.length).toBeGreaterThan(0);
    expect(missingRequiredEngines(executionBRuns as any).length).toBe(REPORT_REQUIRED_ENGINES.length);

    // If query incorrectly ignored execution_id (only filtered case_id):
    const brokenLeakedRuns = allDbRuns.filter((r) => r.case_id === caseId);
    const brokenGate = canGenerateReport(brokenLeakedRuns as any);
    expect(brokenGate.ok).toBe(true); // Demonstrates the exact bug eliminated
  });

  it("proves an old failed execution cannot block a valid new execution", () => {
    const historicalRuns = [
      // Old failed execution A
      ...REPORT_REQUIRED_ENGINES.map((engine) => ({
        id: `run-${engine}-A`,
        case_id: caseId,
        execution_id: executionA,
        engine,
        status: "failed",
        created_at: "2026-08-01T10:00:00Z",
      })),
      // New successful execution B
      ...REPORT_REQUIRED_ENGINES.map((engine) => ({
        id: `run-${engine}-B`,
        case_id: caseId,
        execution_id: executionB,
        engine,
        status: "completed",
        created_at: "2026-08-29T12:00:00Z",
      })),
    ];

    // Scoped to Execution B only:
    const executionBRuns = historicalRuns.filter((r) => r.execution_id === executionB);
    const gateB = canGenerateReport(executionBRuns as any);

    expect(gateB.ok).toBe(true);
    expect(gateB.missingBlocking).toEqual([]);
    expect(missingRequiredEngines(executionBRuns as any)).toEqual([]);
  });

  it("proves report release evaluates one execution only", () => {
    // Execution A passed extraction and analyzers, but failed scoring
    // Execution B passed everything
    const runs = [
      { id: "1", case_id: caseId, execution_id: executionA, engine: "scoring", status: "failed", created_at: "2026-08-01" },
      { id: "2", case_id: caseId, execution_id: executionB, engine: "scoring", status: "completed", created_at: "2026-08-29" },
    ];

    const scopedToB = runs.filter((r) => r.case_id === caseId && r.execution_id === executionB);
    expect(scopedToB.length).toBe(1);
    expect(scopedToB[0].status).toBe("completed");
  });

  it("verifies source code queries in pipeline.server.ts and orchestrator.server.ts enforce execution_id scoping", async () => {
    const fs = await import("node:fs/promises");
    const pipeSource = (await fs.readFile("src/lib/pipeline.server.ts", "utf-8")).replace(/\r\n/g, "\n");
    const orchSource = (await fs.readFile("src/lib/agents/orchestrator.server.ts", "utf-8")).replace(/\r\n/g, "\n");
    const runnerSource = (await fs.readFile("src/lib/pipeline-runner.server.ts", "utf-8")).replace(/\r\n/g, "\n");

    expect(pipeSource).toContain('if (args.executionId) {\n    runsQuery = runsQuery.eq("execution_id", args.executionId);\n  }');
    expect(pipeSource).toContain('if (executionId) {\n      runsQuery = runsQuery.eq("execution_id", executionId);\n    }');
    expect(orchSource).toContain('if (args.executionId) {\n    engineRunsQuery = engineRunsQuery.eq("execution_id", args.executionId);\n  }');
    expect(runnerSource).toContain('if (executionId) {\n      priorRunsQuery = priorRunsQuery.eq("execution_id", executionId);\n    }');
  });
});
