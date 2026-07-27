// Functional smoke test — exercises the REAL functions the pipeline calls
// for report generation, not just the type checker. Run with:
//   npx vite-node scripts/smoke-test-ambiental.ts

import {
  isAnalyzerAllowed,
  isFindingAllowed,
  isMotionAllowed,
  isSectionApplicable,
  isTabApplicable,
  getAllowedAnalyzers,
  getAllowedFindingModules,
  getBlockedTerms,
  getApplicableSections,
  getApplicableTabs,
  buildCaseTypeManifest,
  normalizePracticeArea,
  scrubReportForPracticeArea,
} from "../src/lib/intelligence/practice-areas";
import { buildCaseTypeStandardsBlock } from "../src/lib/intelligence/case-type-standards";
import {
  getProceduralRules,
  getCourtHierarchy,
  getEvidenceRules,
  getPartyRoles,
} from "../src/lib/jurisdiction/mexico";
import { buildCoverageMatrix } from "../src/lib/intelligence/mx-coverage";
import { MX_CASE_TYPES } from "../src/lib/jurisdiction/mexico-types";

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`OK   ${label}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${label}`);
    console.log(`     ${(e as Error).message}`);
  }
}

console.log("=== AMBIENTAL: full pipeline surface ===\n");

check("normalizePracticeArea('ambiental')", () => {
  const r = normalizePracticeArea("ambiental");
  if (r !== "ambiental") throw new Error(`got ${r}`);
});

check("report_generator is allowed (universal engine)", () => {
  if (!isAnalyzerAllowed("ambiental", "report_generator")) throw new Error("report_generator NOT allowed");
});

check("constitutional_compliance is allowed (Art. 4 CPEUM / amparo)", () => {
  if (!isAnalyzerAllowed("ambiental", "constitutional_compliance")) throw new Error("constitutional_compliance NOT allowed");
});

check("getAllowedAnalyzers('ambiental') returns non-empty set", () => {
  const s = getAllowedAnalyzers("ambiental");
  if (s.size === 0) throw new Error("empty");
  console.log(`     -> ${[...s].sort().join(", ")}`);
});

check("getAllowedFindingModules('ambiental') returns domain-specific modules", () => {
  const s = getAllowedFindingModules("ambiental");
  if (!s.has("responsabilidad_ambiental_objetiva")) throw new Error("missing expected module");
  console.log(`     -> ${s.size} modules`);
});

check("isMotionAllowed('ambiental', 'recurso_de_revision')", () => {
  if (!isMotionAllowed("ambiental", "recurso_de_revision")) throw new Error("not allowed");
});

check("isMotionAllowed('ambiental', 'amparo_indirecto_ambiental')", () => {
  if (!isMotionAllowed("ambiental", "amparo_indirecto_ambiental")) throw new Error("not allowed");
});

check("getBlockedTerms('ambiental') blocks foreign common-law terms", () => {
  const terms = getBlockedTerms("ambiental");
  if (!terms.includes("miranda")) throw new Error("blocklist missing expected term");
});

check("getApplicableSections('ambiental') non-empty", () => {
  const s = getApplicableSections("ambiental");
  if (s.size === 0) throw new Error("empty");
});

check("isSectionApplicable('ambiental', 'scorecard')", () => {
  if (!isSectionApplicable("ambiental", "scorecard")) throw new Error("not applicable");
});

check("getApplicableTabs('ambiental') non-empty", () => {
  const s = getApplicableTabs("ambiental");
  if (s.size === 0) throw new Error("empty");
});

check("isTabApplicable('ambiental', 'strategy')", () => {
  if (!isTabApplicable("ambiental", "strategy")) throw new Error("not applicable");
});

check("buildCaseTypeManifest('ambiental') runs end-to-end", () => {
  const m = buildCaseTypeManifest("ambiental");
  if (m.case_type !== "ambiental") throw new Error("wrong case_type");
  if (!m.enabled_engines.includes("report_generator")) throw new Error("report_generator not in manifest");
  console.log(`     -> enabled_engines: ${m.enabled_engines.join(", ")}`);
  console.log(`     -> enabled_sections: ${m.enabled_sections.length}, enabled_tabs: ${m.enabled_tabs.length}`);
  console.log(`     -> allowed_motion_types: ${m.allowed_motion_types.length}`);
});

check("buildCaseTypeStandardsBlock('ambiental') produces prompt text", () => {
  const block = buildCaseTypeStandardsBlock("ambiental");
  if (!block.includes("LGEEPA")) throw new Error("missing expected content");
  if (block.length < 200) throw new Error("suspiciously short");
  console.log(`     -> ${block.length} chars`);
});

check("getProceduralRules('ambiental') runs", () => {
  const r = getProceduralRules("ambiental");
  if (!r.procedural_code) throw new Error("missing procedural_code");
});

check("getCourtHierarchy('ambiental') runs", () => {
  const r = getCourtHierarchy("ambiental");
  if (!r.first_instance) throw new Error("missing first_instance");
});

check("getEvidenceRules('ambiental') runs", () => {
  const r = getEvidenceRules("ambiental");
  if (r.medios.length < 5) throw new Error("evidence list too short");
  console.log(`     -> ${r.medios.length} evidence types`);
});

check("getPartyRoles('ambiental') runs", () => {
  const r = getPartyRoles("ambiental");
  if (!r.a || !r.b) throw new Error("missing party roles");
});

check("scrubReportForPracticeArea('ambiental', ...) does not throw", () => {
  scrubReportForPracticeArea("ambiental", { constitutional_issues: "test", some_field: "keep" });
});

check("buildCoverageMatrix() includes ambiental as base_area-backed", () => {
  const matrix = buildCoverageMatrix();
  const row = matrix.find((r) => r.spec.code === "ambiental");
  if (!row) throw new Error("ambiental missing from coverage matrix");
  if (row.cells.report_template.status === "missing") throw new Error("report_template still reports missing");
  console.log(`     -> report_template status: ${row.cells.report_template.status}, score: ${row.score}`);
});

console.log("\n=== REGRESSION: all 12 case types still resolve cleanly ===\n");

for (const ct of MX_CASE_TYPES) {
  check(`buildCaseTypeManifest('${ct}') runs without throwing`, () => {
    const m = buildCaseTypeManifest(ct);
    if (!m.enabled_engines.includes("report_generator")) throw new Error("report_generator missing");
  });
}

for (const ct of MX_CASE_TYPES) {
  check(`buildCaseTypeStandardsBlock('${ct}') runs without throwing`, () => {
    buildCaseTypeStandardsBlock(ct);
  });
}

for (const ct of MX_CASE_TYPES) {
  check(`getProceduralRules/getCourtHierarchy/getEvidenceRules/getPartyRoles('${ct}') all run`, () => {
    getProceduralRules(ct);
    getCourtHierarchy(ct);
    getEvidenceRules(ct);
    getPartyRoles(ct);
  });
}

console.log(`\n=== RESULT: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
