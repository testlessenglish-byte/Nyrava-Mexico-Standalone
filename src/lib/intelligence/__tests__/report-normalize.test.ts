import { describe, it, expect } from "vitest";
import {
  dedupeProseLines,
  dedupeItems,
  stripEmptySections,
  normalizeReport,
} from "../report-normalize";

describe("report-normalize", () => {
  it("dedupeProseLines removes repeated lines and collapses blank runs", () => {
    const input = [
      "Case involves breach of contract.",
      "Case involves breach of contract.",
      "",
      "",
      "Damages claimed exceed $500,000.",
      "damages claimed exceed $500,000.", // case-insensitive dup
    ].join("\n");
    const out = dedupeProseLines(input);
    expect(out.split("\n")).toEqual([
      "Case involves breach of contract.",
      "",
      "Damages claimed exceed $500,000.",
    ]);
  });

  it("dedupeItems drops blanks and duplicate titles", () => {
    const items = [
      { title: "Motion to Compel", body: "..." },
      { title: "" }, // blank
      { title: "   " }, // whitespace
      { title: "motion  to compel!", body: "different phrasing" }, // fuzzy dup
      { title: "Motion for Sanctions", body: "..." },
      { title: null }, // blank
      {}, // blank
    ] as Record<string, unknown>[];
    const out = dedupeItems(items);
    expect(out.map((o) => o.title)).toEqual([
      "Motion to Compel",
      "Motion for Sanctions",
    ]);
  });

  it("stripEmptySections nulls whitespace-only strings and clears empty arrays", () => {
    const r = {
      executive_summary: "   \n\n  ",
      full_report: "Alpha.\nAlpha.\nBeta.",
      motion_opportunities: [],
      strategy_recommendations: [{ title: "" }, { title: "Retain expert" }],
    };
    const out = stripEmptySections(r);
    expect(out.executive_summary).toBeNull();
    expect(out.full_report).toBe("Alpha.\nBeta.");
    expect(out.motion_opportunities).toEqual([]);
    expect((out.strategy_recommendations as unknown[]).length).toBe(1);
  });

  it("normalizeReport is idempotent", () => {
    const r = {
      executive_summary: "Point A.\nPoint A.\n\nPoint B.",
      motion_opportunities: [
        { title: "Suppress" },
        { title: "suppress" },
        { title: "" },
      ],
    };
    const once = normalizeReport(r);
    const twice = normalizeReport(once);
    expect(twice).toEqual(once);
    expect((once.motion_opportunities as unknown[]).length).toBe(1);
  });

  it("normalizeReport never invents fields", () => {
    const r = { case_strength_score: 42, motion_opportunities: [{ title: "X" }] };
    const out = normalizeReport(r);
    expect(Object.keys(out).sort()).toEqual(
      ["case_strength_score", "motion_opportunities"].sort(),
    );
    expect(out.case_strength_score).toBe(42);
  });
});
