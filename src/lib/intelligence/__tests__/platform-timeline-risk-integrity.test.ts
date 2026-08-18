import { describe, expect, it } from "vitest";
import { extractCorpusTimelineEvents, normalizeTimelineDate } from "../canonical-timeline.server";
import { getScores, getTimeline } from "../canonical";

describe("platform timeline and risk integrity", () => {
  it("parses Mexican procedural dates written in words", () => {
    expect(normalizeTimelineDate("veintidós de agosto de dos mil veinticinco")).toBe("2025-08-22");
    expect(normalizeTimelineDate("7 de noviembre de 2024")).toBe("2024-11-07");
  });

  it("recovers a procedural chronology from Mexican judgment text when analyzer output is empty", () => {
    const text = [
      "El veintidós de agosto de dos mil veinticinco el ISSSTE interpuso recurso de revisión.",
      "El 5 de septiembre de 2025 se admitió el recurso.",
      "El 12 de diciembre de 2025 la Suprema Corte dictó sentencia y revocó la resolución recurrida.",
    ].join("\n");
    const events = extractCorpusTimelineEvents(text);
    expect(events.map((e) => e.date)).toEqual(["2025-08-22", "2025-09-05", "2025-12-12"]);
    expect(events.every((e) => e.event.length > 0)).toBe(true);
  });

  it("does not promote a bare statutory/publication date into the case chronology", () => {
    const text = "Artículo reformado mediante decreto publicado el 23 de diciembre de 1999 en el Diario Oficial de la Federación.";
    expect(extractCorpusTimelineEvents(text)).toEqual([]);
  });

  it("uses deterministic litigation risk instead of leaking analysis confidence into risk", () => {
    const report = {
      scores_suppressed: false,
      case_strength_score: 51,
      risk_score: 87,
      full_report: {
        deterministic_algorithms: { risk: { score: 8, band: "low" } },
        deterministic_scorecard: { overall_confidence: 87 },
      },
    };
    expect(getScores(report)).toEqual({ strength: 51, risk: 8 });
  });

  it("falls back to legacy risk only when no deterministic risk exists", () => {
    const report = { scores_suppressed: false, case_strength_score: 51, risk_score: 42, full_report: {} };
    expect(getScores(report)).toEqual({ strength: 51, risk: 42 });
  });

  it("makes the canonical timeline authoritative across UI, PDF, DOCX and Talk to Case consumers", () => {
    const report = {
      full_report: {
        canonical_timeline: {
          events: [{ date: "2025-08-22", event: "Se interpuso el recurso de revisión" }],
        },
        timeline: [],
      },
    };
    expect(getTimeline(report)).toHaveLength(1);
    expect(getTimeline(report)[0].date).toBe("2025-08-22");
  });
});
