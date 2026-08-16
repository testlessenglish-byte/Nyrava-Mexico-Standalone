// Real-user regression guard (2026-08-16): reports.tsx's engine-status chip
// row renders report.full_report.engines_summary directly (reports.tsx:78,
// `report?.engines_summary`) — a snapshot frozen at write time, not a live
// query. pipeline.server.ts deliberately never flips the REAL
// pipeline_engine_runs report_generator row to "completed" until after
// reports.upsert is confirmed (a real crash-safety property, untouched by
// this fix). But that meant EVERY successfully completed report embedded a
// snapshot showing "report_generator: running" forever — reported live: an
// attorney saw a finished report with working PDF/DOCX downloads sitting
// next to a status chip claiming the report itself never finished
// generating. finalizeEnginesSummaryForEmbed patches only the embedded
// display copy.
import { describe, it, expect } from "vitest";
import { finalizeEnginesSummaryForEmbed } from "@/lib/intelligence/engine-audit.server";

describe("finalizeEnginesSummaryForEmbed", () => {
  it("marks the embedded report_generator entry completed even though it was still 'running' when queried", () => {
    const summary = {
      extraction: { status: "completed", runtime_ms: 2200 },
      report_generator: { status: "running", started_at: "2026-08-16T22:07:00.000Z", ended_at: null },
    };

    const out = finalizeEnginesSummaryForEmbed(summary);

    expect(out.report_generator).toMatchObject({
      status: "completed",
      started_at: "2026-08-16T22:07:00.000Z",
    });
    expect((out.report_generator as { ended_at: string }).ended_at).toBeTruthy();
    // Every other engine's row is untouched.
    expect(out.extraction).toEqual(summary.extraction);
  });

  it("is a no-op when report_generator has no row yet (e.g. very first run)", () => {
    const summary = { extraction: { status: "completed" } };
    const out = finalizeEnginesSummaryForEmbed(summary);
    expect(out).toEqual(summary);
  });

  it("does not mutate the input object", () => {
    const summary = { report_generator: { status: "running" } };
    const out = finalizeEnginesSummaryForEmbed(summary);
    expect(summary.report_generator.status).toBe("running");
    expect(out).not.toBe(summary);
  });
});
