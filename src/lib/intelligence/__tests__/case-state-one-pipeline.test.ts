import { describe, expect, it } from "vitest";
import { engineAllowedInMode, type AnalysisMode, type EngineKey } from "../case-state.server";

const engines: EngineKey[] = [
  "extraction",
  "analyzers",
  "agents",
  "scoring",
  "contradictions",
  "discovery",
  "witness",
  "theory",
  "opportunity",
  "trial_prep",
  "work_product",
  "strategy",
  "perspectives",
  "evidence_intel",
  "litigation_strategy_center",
];

const legacyModes: AnalysisMode[] = ["strict", "balanced", "exploratory"];

describe("single verified pipeline compatibility", () => {
  for (const mode of legacyModes) {
    it(`${mode} legacy rows do not disable intelligence modules`, () => {
      for (const engine of engines) expect(engineAllowedInMode(engine, mode)).toBe(true);
    });
  }
});
