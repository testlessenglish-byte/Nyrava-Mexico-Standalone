// Regression test for the "13 executed mid-run → 4 executed once the report
// finishes" bug: the 13-agent orchestrator writes agent_logs under TWO
// different run_ids per case — a preliminary pass covering all 13 agents
// (deferRelease:true), then runFinalReleaseReview() as the pipeline's LAST
// step, which re-runs only 4 gate agents (report/qa/judge/hallucination)
// under a BRAND NEW run_id. getAgentLogs (multi-agent.functions.ts) used to
// resolve "no runId requested" to "rows from the single most recently
// created run_id" — since the final-review run always happens last, this
// permanently narrowed the live Multi-Agent panel to 4/13 agents after
// every completed pipeline run. latestRowPerAgentKey is the fix: take the
// newest row PER agent_key across every run_id, mirroring the aggregation
// buildAgentStatistics() (statistics.server.ts) already uses server-side.
import { describe, it, expect } from "vitest";
import { latestRowPerAgentKey } from "@/lib/agents/multi-agent.functions";

type Row = { agent_key: string; agent_index: number; run_id: string; created_at: string; status: string };

const PRELIMINARY_RUN = "11111111-1111-1111-1111-111111111111";
const FINAL_REVIEW_RUN = "22222222-2222-2222-2222-222222222222";

function row(agent_key: string, agent_index: number, run_id: string, created_at: string): Row {
  return { agent_key, agent_index, run_id, created_at, status: "success" };
}

describe("latestRowPerAgentKey", () => {
  it("the real reported bug: a narrower final-review run must not hide the preliminary pass's other agents", () => {
    // Preliminary pass: all 13 agents, written first (older created_at).
    const preliminary = [
      row("intake", 1, PRELIMINARY_RUN, "2026-08-14T13:00:00Z"),
      row("ocr", 2, PRELIMINARY_RUN, "2026-08-14T13:00:01Z"),
      row("entities", 3, PRELIMINARY_RUN, "2026-08-14T13:00:02Z"),
      row("timeline", 4, PRELIMINARY_RUN, "2026-08-14T13:00:03Z"),
      row("evidence", 5, PRELIMINARY_RUN, "2026-08-14T13:00:04Z"),
      row("contradictions", 6, PRELIMINARY_RUN, "2026-08-14T13:00:05Z"),
      row("legal", 7, PRELIMINARY_RUN, "2026-08-14T13:00:06Z"),
      row("risk", 8, PRELIMINARY_RUN, "2026-08-14T13:00:07Z"),
      row("report", 9, PRELIMINARY_RUN, "2026-08-14T13:00:08Z"),
      row("qa", 10, PRELIMINARY_RUN, "2026-08-14T13:00:09Z"),
      row("judge", 11, PRELIMINARY_RUN, "2026-08-14T13:00:10Z"),
      row("hallucination", 12, PRELIMINARY_RUN, "2026-08-14T13:00:11Z"),
      row("orchestrator", 13, PRELIMINARY_RUN, "2026-08-14T13:00:12Z"),
    ];
    // Final release review: only the 4 gate agents, written LAST (newer
    // created_at) under a different run_id — this is what made "latest
    // run_id" resolve to a 4-row view.
    const finalReview = [
      row("report", 9, FINAL_REVIEW_RUN, "2026-08-14T13:11:00Z"),
      row("qa", 10, FINAL_REVIEW_RUN, "2026-08-14T13:11:01Z"),
      row("judge", 11, FINAL_REVIEW_RUN, "2026-08-14T13:11:02Z"),
      row("hallucination", 12, FINAL_REVIEW_RUN, "2026-08-14T13:11:03Z"),
    ];
    // Caller passes rows newest-first (matches the real query's `.order("created_at", { ascending: false })`).
    const rows = [...finalReview].reverse().concat([...preliminary].reverse());
    const result = latestRowPerAgentKey(rows);

    expect(result).toHaveLength(13);
    expect(result.map((r) => r.agent_key)).toEqual([
      "intake", "ocr", "entities", "timeline", "evidence", "contradictions",
      "legal", "risk", "report", "qa", "judge", "hallucination", "orchestrator",
    ]);
  });

  it("the 4 gate agents resolve to their NEWER final-review row, not the stale preliminary one", () => {
    const rows = [
      row("report", 9, FINAL_REVIEW_RUN, "2026-08-14T13:11:00Z"),
      row("report", 9, PRELIMINARY_RUN, "2026-08-14T13:00:08Z"),
    ];
    const result = latestRowPerAgentKey(rows);
    expect(result).toHaveLength(1);
    expect(result[0].run_id).toBe(FINAL_REVIEW_RUN);
  });

  it("is stable-sorted by agent_index regardless of input order", () => {
    const rows = [
      row("hallucination", 12, PRELIMINARY_RUN, "t3"),
      row("intake", 1, PRELIMINARY_RUN, "t1"),
      row("legal", 7, PRELIMINARY_RUN, "t2"),
    ];
    const result = latestRowPerAgentKey(rows);
    expect(result.map((r) => r.agent_index)).toEqual([1, 7, 12]);
  });

  it("handles an empty input without throwing", () => {
    expect(latestRowPerAgentKey([])).toEqual([]);
  });

  it("skips rows with no agent_key rather than crashing on a malformed row", () => {
    const rows = [
      { agent_key: "", agent_index: 0, run_id: "x", created_at: "t" },
      row("intake", 1, PRELIMINARY_RUN, "t1"),
    ];
    const result = latestRowPerAgentKey(rows);
    expect(result).toHaveLength(1);
    expect(result[0].agent_key).toBe("intake");
  });
});
