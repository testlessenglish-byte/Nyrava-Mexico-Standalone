// Performance Certification — pure-helper hot paths must stay within
// generous budgets. These ceilings are intentionally loose; a regression
// here means somebody introduced O(n^2) or accidental I/O into a helper
// that runs on every dashboard tick.
import { describe, it, expect } from "vitest";
import { computeESS } from "@/lib/intelligence/sufficiency.server";
import { classifyClaim } from "@/lib/intelligence/claim-class";
import {
  latestRowsByEngine,
  pipelineProgressPercent,
  PIPELINE_ENGINE_ORDER,
  type ExecutionRow,
} from "@/lib/execution-state";

function bench(name: string, iterations: number, fn: () => void, budgetMs: number) {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const dur = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`PERF ${name}: ${iterations} iters in ${dur.toFixed(1)}ms (budget ${budgetMs}ms)`);
  expect(dur).toBeLessThan(budgetMs);
}

describe("Performance budgets (pure helpers)", () => {
  it("computeESS — 5,000 iterations under 200ms", () => {
    bench("computeESS", 5_000, () => {
      computeESS({
        documentCount: 12, pageCount: 200, extractedChars: 80_000,
        factCount: 30, contradictionCount: 4, corroboratedCount: 8,
      });
    }, 200);
  });

  it("classifyClaim — 10,000 iterations under 300ms", () => {
    const sample = "The witness statement appears to indicate a discrepancy based on the record.";
    bench("classifyClaim", 10_000, () => { classifyClaim(sample); }, 300);
  });

  it("execution-state derivation — 1,000 iterations under 150ms", () => {
    const rows: ExecutionRow[] = PIPELINE_ENGINE_ORDER.flatMap((engine, i) => [
      { id: `${engine}-a`, engine, status: "running",   started_at: `2026-06-25T10:0${i % 10}:00Z`, ended_at: null, created_at: `2026-06-25T10:0${i % 10}:00Z` },
      { id: `${engine}-b`, engine, status: "completed", started_at: `2026-06-25T10:1${i % 10}:00Z`, ended_at: `2026-06-25T10:1${i % 10}:30Z`, created_at: `2026-06-25T10:1${i % 10}:30Z` },
    ]);
    bench("derive-progress", 1_000, () => {
      latestRowsByEngine(rows);
      pipelineProgressPercent(rows);
    }, 150);
  });
});
