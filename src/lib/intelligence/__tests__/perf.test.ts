// Performance probe — opt-in via PERF=1 (excluded from default vitest run).
// Measures pure-function pipeline read budgets, not LLM latency.
import { describe, it, expect } from "vitest";
import { getCanonicalCounts, paritySignature } from "@/lib/intelligence/canonical";

const RUN = process.env.PERF === "1";
const d = RUN ? describe : describe.skip;

function mkBigReport(pages: number) {
  const findings = Array.from({ length: pages }, (_, i) => ({
    id: `F-${i}`,
    text: `Finding ${i}`,
  }));
  const evidence = Array.from({ length: pages * 3 }, (_, i) => ({ id: `E-${i}` }));
  return {
    contradictions_struct: [],
    missing_evidence_struct: [],
    evidence_index: evidence,
    citations: evidence,
    motion_opportunities: [],
    full_report: {
      timeline: Array.from({ length: pages }, (_, i) => ({ id: `T-${i}` })),
      intelligence: { consolidated_findings: findings, witnesses: [], perspectives: [], opportunities: [], theories: [], strategy_rows: [] },
      disputed_issues: [],
      validation: { evidence_sufficiency: { level: "high" } },
    },
  };
}

d("canonical helpers stay fast under load", () => {
  for (const n of [10, 50, 100, 250, 500, 1000]) {
    it(`reads ${n}-page corpus in <50ms`, () => {
      const r = mkBigReport(n);
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        getCanonicalCounts(r);
        paritySignature(r);
      }
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(50 * 50); // 2500ms cumulative budget
    });
  }
});
