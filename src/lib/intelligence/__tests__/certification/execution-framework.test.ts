// Final Execution Framework Certification
// ----------------------------------------
// This suite is the freeze-the-framework gate. It exercises the five
// validation scenarios laid out in the FINAL EXECUTION FRAMEWORK
// CERTIFICATION REQUIREMENT memo against the pure modules that already
// own the behavior (no DB, no LLM). When this file is green, the
// execution architecture is considered certified and frozen — future
// work targets legal intelligence and new domains only.
//
//   1. Base case validation              (per-area allow/deny purity)
//   2. Cross-domain activation           (positive + negative)
//   3. Evidence-threshold gating         (no empty/placeholder sections)
//   4. Deterministic certification       (5x identical runs)
//   5. Framework certification           (release gate PASS for all)

import { describe, it, expect } from "vitest";
import {
  buildCaseTypeManifest,
  getAllowedAnalyzers,
  getApplicableSections,
  isAnalyzerAllowed,
  isFindingAllowed,
  isMotionAllowed,
  PRACTICE_AREA_LABELS,
  type PracticeArea,
} from "@/lib/intelligence/practice-areas";
import { deriveActivations } from "@/lib/intelligence/cross-domain.server";
import { reconcileManifest } from "@/lib/intelligence/release-gate";
import { computeESS } from "@/lib/intelligence/sufficiency.server";

const AREAS: PracticeArea[] = [
  "general_civil",
  "personal_injury",
  "medical_malpractice",
  "employment",
  "family",
  "criminal",
  "civil_rights",
  "appellate",
  "tax_law",
  "corporate",
  "commercial",
  "ip",
  "real_estate",
  "estate",
  "securities",
  "banking",
  "fintech",
];

// Engines that must never appear in a base manifest for the listed area.
const PROHIBITED: Record<PracticeArea, string[]> = {
  general_civil: ["constitutional_compliance"],
  personal_injury: ["constitutional_compliance", "cross_examination"],
  medical_malpractice: ["constitutional_compliance", "cross_examination"],
  employment: ["constitutional_compliance", "cross_examination"],
  family: ["constitutional_compliance", "cross_examination", "trial_prep"],
  appellate: ["constitutional_compliance", "cross_examination", "trial_prep"],
  criminal: [],
  civil_rights: [],
  tax_law: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  corporate: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  commercial: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  ip: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  real_estate: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  estate: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  securities: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  banking: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
  fintech: ["constitutional_compliance", "chain_of_custody", "procedural_violations"],
};

// Sample foreign finding-module markers per area (must be denied at the gate).
const FOREIGN_FINDINGS: Record<PracticeArea, string[]> = {
  criminal: ["engine:custody:primary", "engine:title_vii:claim"],
  civil_rights: ["engine:child_support:calc", "engine:standard_of_care:breach"],
  general_civil: ["engine:miranda:violation", "engine:custody:primary"],
  personal_injury: ["engine:miranda:violation", "engine:title_vii:claim"],
  medical_malpractice: ["engine:miranda:violation", "engine:custody:primary"],
  employment: ["engine:miranda:violation", "engine:custody:primary"],
  family: ["engine:miranda:violation", "engine:title_vii:claim"],
  appellate: ["engine:custody:primary"],
  tax_law: ["engine:miranda:violation", "engine:custody:primary"],
  corporate: ["engine:miranda:violation", "engine:custody:primary", "engine:standard_of_care:breach"],
  commercial: ["engine:miranda:violation", "engine:custody:primary", "engine:standard_of_care:breach"],
  ip: ["engine:miranda:violation", "engine:custody:primary"],
  real_estate: ["engine:miranda:violation", "engine:custody:primary"],
  estate: ["engine:miranda:violation", "engine:title_vii:claim"],
  securities: ["engine:miranda:violation", "engine:custody:primary"],
  banking: ["engine:miranda:violation", "engine:custody:primary"],
  fintech: ["engine:miranda:violation", "engine:custody:primary"],
};

// Sample foreign motion families per area.
const FOREIGN_MOTIONS: Record<PracticeArea, string[]> = {
  criminal: ["custody_modification", "summary_judgment_employment"],
  civil_rights: ["custody_modification"],
  general_civil: ["motion_to_suppress", "custody_modification"],
  personal_injury: ["motion_to_suppress", "custody_modification"],
  medical_malpractice: ["motion_to_suppress", "custody_modification"],
  employment: ["motion_to_suppress", "custody_modification"],
  family: ["motion_to_suppress", "summary_judgment"],
  appellate: ["motion_to_suppress", "custody_modification"],
  tax_law: ["motion_to_suppress", "custody_modification"],
  corporate: ["motion_to_suppress", "custody_modification"],
  commercial: ["motion_to_suppress", "custody_modification"],
  ip: ["motion_to_suppress", "custody_modification"],
  real_estate: ["motion_to_suppress", "custody_modification"],
  estate: ["motion_to_suppress", "custody_modification"],
  securities: ["motion_to_suppress", "custody_modification"],
  banking: ["motion_to_suppress", "custody_modification"],
  fintech: ["motion_to_suppress", "custody_modification"],
};


// -- Helpers --------------------------------------------------------------

function stripVolatile<T extends { generated_at?: string }>(m: T) {
  return { ...m, generated_at: "" };
}

function fakeRunsForManifest(m: ReturnType<typeof buildCaseTypeManifest>) {
  return [
    ...m.enabled_engines.map((e) => ({ engine: e, status: "completed" as const })),
    ...m.skipped_engines.map((e) => ({
      engine: e,
      status: "skipped" as const,
      skipped_reason: "not_applicable_to_case_type",
    })),
  ];
}

// =========================================================================
// 1. Base Case Validation
// =========================================================================
describe("Certification §1 — Base Case Validation", () => {
  for (const area of AREAS) {
    it(`${PRACTICE_AREA_LABELS[area]} — only permitted analyzers run; prohibited never run`, () => {
      const m = buildCaseTypeManifest(area);
      const allowed = getAllowedAnalyzers(area);
      for (const e of m.enabled_engines) expect(allowed.has(e)).toBe(true);
      for (const f of PROHIBITED[area]) {
        expect(m.enabled_engines).not.toContain(f);
        expect(m.skipped_engines).toContain(f);
        expect(isAnalyzerAllowed(area, f)).toBe(false);
      }
    });

    it(`${PRACTICE_AREA_LABELS[area]} — no unrelated finding modules survive the gate`, () => {
      for (const sourceModule of FOREIGN_FINDINGS[area]) {
        expect(isFindingAllowed(area, sourceModule)).toBe(false);
      }
    });

    it(`${PRACTICE_AREA_LABELS[area]} — no unrelated motion families pass the gate`, () => {
      for (const motion of FOREIGN_MOTIONS[area]) {
        expect(isMotionAllowed(area, motion)).toBe(false);
      }
    });

    it(`${PRACTICE_AREA_LABELS[area]} — sections in manifest ⊆ applicable sections (UI/PDF/JSON sync)`, () => {
      const m = buildCaseTypeManifest(area);
      const apply = getApplicableSections(area);
      for (const s of m.enabled_sections) expect(apply.has(s)).toBe(true);
    });

    it(`${PRACTICE_AREA_LABELS[area]} — release gate returns PASS on a clean run`, () => {
      const m = buildCaseTypeManifest(area);
      const r = reconcileManifest({ manifest: m, runs: fakeRunsForManifest(m), activations: [] });
      expect(r.ok).toBe(true);
      expect(r.issues).toEqual([]);
    });
  }
});

// =========================================================================
// 2. Cross-Domain Validation (positive + negative)
// =========================================================================
describe("Certification §2 — Cross-Domain Validation", () => {
  // -- Positive scenarios: activation must fire under the documented rule --

  it("Employment + Civil Rights — user opt-in records source/reason and appears in the manifest", () => {
    const acts = deriveActivations({
      baseArea: "employment",
      caseType: "employment",
      additionalDomains: ["civil_rights"],
      findings: [],
    });
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ domain: "civil_rights", source: "user" });
    expect(acts[0].reason).toBeTruthy();
    const manifest = buildCaseTypeManifest("employment", new Set(["civil_rights"]));
    expect(manifest.active_domains).toEqual(["civil_rights"]);
    expect(manifest.cross_domain_engines).toContain("constitutional_compliance");
  });

  it("Criminal hybrid (criminal + civil rights) — hybrid trigger fires with no extra inputs", () => {
    const acts = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal_civil_rights",
      additionalDomains: [],
      findings: [],
    });
    expect(acts.map((a) => a.domain)).toEqual(["civil_rights"]);
    expect(acts[0].source).toBe("hybrid");
  });

  it("Evidence trigger — § 1983 in a criminal case unlocks civil rights with citation ids", () => {
    const acts = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal",
      additionalDomains: [],
      findings: [
        { id: "f1", source_module: "engine:section_1983:violation" },
        { id: "f2", source_module: "engine:monell:policy" },
      ],
    });
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ domain: "civil_rights", source: "evidence" });
    expect(acts[0].evidence_finding_ids).toEqual(["f1", "f2"]);
    expect(acts[0].reason).toBeTruthy();
  });

  // -- Negative scenarios: rule NOT satisfied → no cross-domain activity --

  it("Negative — single matching finding falls below threshold; no activation, no foreign engines", () => {
    const acts = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal",
      additionalDomains: [],
      findings: [{ id: "f1", source_module: "engine:section_1983:violation" }],
    });
    expect(acts).toEqual([]);
    const m = buildCaseTypeManifest("criminal");
    expect(m.active_domains).toEqual([]);
    expect(m.cross_domain_engines).toEqual([]);
  });

  it("Negative — general_civil with no additional domain and no triggering findings stays pure", () => {
    const acts = deriveActivations({
      baseArea: "general_civil",
      caseType: "general_civil",
      additionalDomains: [],
      findings: [
        { id: "f1", source_module: "engine:contract:breach" },
        { id: "f2", source_module: "engine:damages:calc" },
      ],
    });
    expect(acts).toEqual([]);
    const m = buildCaseTypeManifest("general_civil");
    expect(m.cross_domain_engines).toEqual([]);
    expect(m.enabled_engines).not.toContain("constitutional_compliance");
  });

  it("Cross-domain activation is recorded in the audit (release gate flags missing reason/evidence)", () => {
    const m = buildCaseTypeManifest("general_civil", new Set(["criminal"]));
    const bad = reconcileManifest({
      manifest: m,
      runs: [],
      activations: [{ domain: "criminal", source: "evidence", reason: null, evidence_finding_ids: [] }],
    });
    const codes = bad.issues.map((i) => i.code);
    expect(codes).toContain("activation_missing_reason");
    expect(codes).toContain("activation_missing_evidence");
  });
});

// =========================================================================
// 3. Evidence Threshold Validation
// =========================================================================
describe("Certification §3 — Evidence Threshold Validation", () => {
  it("Minimal corpus → scores and motions are blocked; insufficient-evidence notice is set", () => {
    const ess = computeESS({
      documentCount: 1,
      pageCount: 1,
      extractedChars: 200,
      factCount: 0,
      contradictionCount: 0,
      corroboratedCount: 0,
    });
    expect(ess.bin).toBe("minimal");
    expect(ess.allowQuantitativeScores).toBe(false);
    expect(ess.allowMotionGeneration).toBe(false);
    expect(ess.insufficientEvidenceNotice).toBeTruthy();
  });

  it("Robust corpus → scores and motions are allowed; no suppression notice", () => {
    const ess = computeESS({
      documentCount: 25,
      pageCount: 600,
      extractedChars: 750_000,
      factCount: 180,
      contradictionCount: 14,
      corroboratedCount: 120,
    });
    expect(ess.allowQuantitativeScores).toBe(true);
    expect(ess.allowMotionGeneration).toBe(true);
    expect(ess.insufficientEvidenceNotice).toBeFalsy();
  });

  it("Empty work-product templates are rejected by the release gate (no placeholders rendered)", () => {
    const m = buildCaseTypeManifest("general_civil");
    const r = reconcileManifest({
      manifest: m,
      runs: fakeRunsForManifest(m),
      activations: [],
      workProducts: [
        { title: "Real brief", body_markdown: "x".repeat(120) },
        { title: "Skipped brief", body_markdown: "", skipped_reason: "insufficient evidence" },
        { title: "Empty template", body_markdown: "", skipped_reason: null, error_message: null },
      ],
    });
    expect(r.stats.work_generated).toBe(1);
    expect(r.stats.work_skipped).toBe(1);
    expect(r.issues.some((i) => i.code === "work_product_empty")).toBe(true);
  });
});

// =========================================================================
// 4. Deterministic Certification — 5× identical runs
// =========================================================================
describe("Certification §4 — 5-run Determinism", () => {
  const RUNS = 5;

  for (const area of AREAS) {
    it(`${PRACTICE_AREA_LABELS[area]} — manifest + release gate verdict identical across ${RUNS} runs`, () => {
      const baseline = stripVolatile(buildCaseTypeManifest(area));
      const gateBaseline = reconcileManifest({
        manifest: buildCaseTypeManifest(area),
        runs: fakeRunsForManifest(buildCaseTypeManifest(area)),
        activations: [],
      });
      for (let i = 0; i < RUNS; i += 1) {
        const m = buildCaseTypeManifest(area);
        expect(stripVolatile(m)).toEqual(baseline);
        const g = reconcileManifest({ manifest: m, runs: fakeRunsForManifest(m), activations: [] });
        expect(g).toEqual(gateBaseline);
      }
    });
  }

  it("Cross-domain activations are deterministic across 5 runs (same findings → same audit rows)", () => {
    const findings = [
      { id: "f1", source_module: "engine:section_1983:violation" },
      { id: "f2", source_module: "engine:monell:policy" },
      { id: "f3", source_module: "engine:qualified_immunity:claim" },
    ];
    const baseline = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal",
      additionalDomains: [],
      findings,
    });
    for (let i = 0; i < 5; i += 1) {
      const next = deriveActivations({
        baseArea: "criminal",
        caseType: "criminal",
        additionalDomains: [],
        findings,
      });
      expect(next).toEqual(baseline);
    }
  });
});

// =========================================================================
// 5. Framework Certification — composite PASS for every benchmark area
// =========================================================================
describe("Certification §5 — Framework Certification (composite)", () => {
  it("Every supported area produces a manifest that the release gate clears", () => {
    const failures: string[] = [];
    for (const area of AREAS) {
      const m = buildCaseTypeManifest(area);
      const r = reconcileManifest({ manifest: m, runs: fakeRunsForManifest(m), activations: [] });
      if (!r.ok) failures.push(`${area}: ${r.issues.map((i) => i.code).join(",")}`);
    }
    expect(failures).toEqual([]);
  });

  it("Every cross-domain hybrid produces a clean release gate when activations are properly audited", () => {
    const scenarios: Array<{ base: PracticeArea; add: PracticeArea }> = [
      { base: "employment", add: "civil_rights" },
      { base: "family", add: "criminal" },
      { base: "general_civil", add: "personal_injury" },
      { base: "criminal", add: "civil_rights" },
    ];
    for (const s of scenarios) {
      const m = buildCaseTypeManifest(s.base, new Set([s.add]));
      const r = reconcileManifest({
        manifest: m,
        runs: fakeRunsForManifest(m),
        activations: [
          {
            domain: s.add,
            source: "user",
            trigger_id: null,
            reason: `Operator activated ${s.add} on a ${s.base} matter.`,
            evidence_finding_ids: [],
          },
        ],
      });
      expect(r.ok, `${s.base}+${s.add}: ${JSON.stringify(r.issues)}`).toBe(true);
    }
  });
});
