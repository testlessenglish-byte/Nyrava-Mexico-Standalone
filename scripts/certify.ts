// Production Certification Runner.
// Executes the certification vitest suite, captures the JSON reporter
// output, and emits docs/CERTIFICATION_REPORT.md with a signed verdict.
//
// Usage:
//   bunx tsx scripts/certify.ts
//
// Exit code is non-zero if any certification test fails OR a required
// section reports zero tests (suite missing).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { BENCHMARK_VERSION, BENCHMARKS } from "../src/lib/certification/benchmarks";

type VitestAssertion = { fullName: string; status: "passed" | "failed" | "skipped"; failureMessages?: string[] };
type VitestFile = { name: string; status: string; assertionResults: VitestAssertion[] };
type VitestJson = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: VitestFile[];
  startTime: number;
};

const OUT_JSON = resolve("/tmp/nyrava-cert.json");
const OUT_REPORT = resolve("docs/CERTIFICATION_REPORT.md");

function run(): VitestJson {
  const res = spawnSync(
    "bunx",
    [
      "vitest", "run",
      "src/lib/intelligence/__tests__/certification",
      "src/lib/intelligence/__tests__/acceptance.test.ts",
      "src/lib/intelligence/__tests__/hallucination.test.ts",
      "--reporter=json",
      `--outputFile=${OUT_JSON}`,
    ],
    { stdio: "inherit", encoding: "utf8" },
  );
  // Vitest exits non-zero on failures; we still parse the JSON to report.
  try {
    return JSON.parse(readFileSync(OUT_JSON, "utf8")) as VitestJson;
  } catch {
    throw new Error(`Certification run produced no JSON (exit=${res.status}).`);
  }
}

const SECTIONS: Array<{ key: string; match: RegExp; label: string }> = [
  { key: "benchmarks",   match: /certification\/benchmarks\.test/,            label: "1. Real-Workload Certification" },
  { key: "determinism",  match: /certification\/provider-determinism\.test/,  label: "2. Provider Determinism" },
  { key: "governance",   match: /certification\/governance\.test/,            label: "4. Evidence Governance" },
  { key: "redteam",      match: /certification\/redteam\.test/,               label: "5. Hallucination Red-Team" },
  { key: "performance",  match: /certification\/performance\.test/,           label: "6. Performance" },
  { key: "concurrency",  match: /certification\/concurrency\.test/,           label: "7. Concurrency" },
  { key: "recovery",     match: /certification\/recovery\.test/,              label: "8. Recovery" },
  { key: "security",     match: /certification\/security\.test/,              label: "9. Security & Privacy" },
  { key: "acceptance",   match: /acceptance\.test/,                            label: "10a. Pre-flight Gate Acceptance" },
  { key: "hallucination",match: /hallucination\.test/,                         label: "10b. Classifier Hallucination Defense" },
];

function summarize(j: VitestJson) {
  return SECTIONS.map((s) => {
    const files = j.testResults.filter((f) => s.match.test(f.name));
    const tests = files.flatMap((f) => f.assertionResults);
    const passed = tests.filter((t) => t.status === "passed").length;
    const failed = tests.filter((t) => t.status === "failed").length;
    const failures = tests.filter((t) => t.status === "failed").map((t) => `${t.fullName}: ${(t.failureMessages?.[0] ?? "").split("\n")[0]}`);
    return { ...s, total: tests.length, passed, failed, failures };
  });
}

function render(j: VitestJson) {
  const sections = summarize(j);
  const totalFailed = sections.reduce((a, s) => a + s.failed, 0);
  const totalRequiredMissing = sections.filter((s) => s.total === 0).length;
  const verdict = totalFailed === 0 && totalRequiredMissing === 0 ? "Approved for Production" : "Not Yet Approved";

  const sig = createHash("sha256")
    .update(JSON.stringify({ sections, total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests }))
    .digest("hex").slice(0, 16);

  const ts = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# NYRAVA Production Certification Report");
  lines.push("");
  lines.push(`- Generated: \`${ts}\``);
  lines.push(`- Benchmark suite: \`${BENCHMARK_VERSION}\` (${BENCHMARKS.length} fixtures)`);
  lines.push(`- Total tests: ${j.numTotalTests} (passed ${j.numPassedTests}, failed ${j.numFailedTests}, pending ${j.numPendingTests})`);
  lines.push(`- Verdict: **${verdict}**`);
  lines.push(`- Signature: \`sha256:${sig}\``);
  lines.push("");
  lines.push("## Section Results");
  lines.push("");
  lines.push("| # | Section | Tests | Passed | Failed | Status |");
  lines.push("|---|---------|-------|--------|--------|--------|");
  for (const s of sections) {
    const status = s.total === 0 ? "MISSING" : s.failed === 0 ? "PASS" : "FAIL";
    lines.push(`| ${s.key} | ${s.label} | ${s.total} | ${s.passed} | ${s.failed} | ${status} |`);
  }
  lines.push("");
  if (totalFailed > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const s of sections.filter((x) => x.failed > 0)) {
      lines.push(`### ${s.label}`);
      for (const f of s.failures) lines.push(`- ${f}`);
      lines.push("");
    }
  }

  lines.push("## Benchmark Fixtures");
  lines.push("");
  lines.push("| ID | Type | Docs | Pages | Chars | Facts | Expected Bin |");
  lines.push("|----|------|------|-------|-------|-------|--------------|");
  for (const b of BENCHMARKS) {
    lines.push(`| ${b.id} | ${b.case_type} | ${b.documentCount} | ${b.pageCount} | ${b.extractedChars.toLocaleString()} | ${b.factCount} | ${b.expectedBin} |`);
  }
  lines.push("");

  lines.push("## Items Requiring Live Workload Evidence");
  lines.push("");
  lines.push("These sections cannot be fully certified by automated tests alone and");
  lines.push("require live captures from a staging tenant to graduate to VERIFIED:");
  lines.push("");
  lines.push("- 3. AI Cost Certification — needs `ai_usage` rollup across a full benchmark run.");
  lines.push("- 6. Performance — wall-clock budgets per pipeline stage need live capture (pure-helper budgets are locked here).");
  lines.push("- 7. Concurrency — needs N=10 simultaneous case analyses recorded in `pipeline_engine_runs`.");
  lines.push("");
  lines.push("---");
  lines.push(`Signed: certification-runner ${sig} @ ${ts}`);
  return lines.join("\n") + "\n";
}

function main() {
  mkdirSync(resolve("docs"), { recursive: true });
  const json = run();
  const report = render(json);
  writeFileSync(OUT_REPORT, report);
  const sections = summarize(json);
  const totalFailed = sections.reduce((a, s) => a + s.failed, 0);
  const missing = sections.filter((s) => s.total === 0);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OUT_REPORT}`);
  if (totalFailed > 0 || missing.length > 0) process.exit(1);
}

main();
