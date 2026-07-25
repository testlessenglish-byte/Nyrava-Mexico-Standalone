// Final Release Validation — regression suite.
//
// Locks the case-type execution framework's guarantees:
//   1. Manifest is deterministic per case type.
//   2. Practice-area purity: no foreign engines in a base manifest.
//   3. Cross-domain activation requires audit metadata.
//   4. reconcileManifest catches drift between intent and outcome.
//   5. Work-product state is binary (Generated | Skipped+reason).
import { describe, it, expect } from "vitest";
import {
  buildCaseTypeManifest,
  getAllowedAnalyzers,
  getApplicableSections,
  PRACTICE_AREA_LABELS,
  type PracticeArea,
} from "@/lib/intelligence/practice-areas";
import { deriveActivations } from "@/lib/intelligence/cross-domain.server";
import { reconcileManifest } from "@/lib/intelligence/release-gate";

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

// Forbidden-engine cross-checks. If any of these analyzers appears in a base
// manifest's enabled list, the practice-area gate is broken.
const FORBIDDEN_BY_AREA: Record<PracticeArea, string[]> = {
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


describe("Manifest determinism & purity", () => {
  for (const area of AREAS) {
    it(`${PRACTICE_AREA_LABELS[area]} — manifest is deterministic`, () => {
      const a = buildCaseTypeManifest(area);
      const b = buildCaseTypeManifest(area);
      // generated_at is the only field allowed to differ.
      const stripTs = (m: ReturnType<typeof buildCaseTypeManifest>) => ({ ...m, generated_at: "" });
      expect(stripTs(a)).toEqual(stripTs(b));
    });

    it(`${PRACTICE_AREA_LABELS[area]} — no forbidden engines in enabled list`, () => {
      const m = buildCaseTypeManifest(area);
      for (const f of FORBIDDEN_BY_AREA[area]) {
        expect(m.enabled_engines).not.toContain(f);
        expect(m.skipped_engines).toContain(f);
      }
    });

    it(`${PRACTICE_AREA_LABELS[area]} — enabled = universal + practice (no cross-domain)`, () => {
      const m = buildCaseTypeManifest(area);
      const allowed = getAllowedAnalyzers(area);
      for (const e of m.enabled_engines) expect(allowed.has(e)).toBe(true);
      expect(m.cross_domain_engines).toEqual([]);
      expect(m.active_domains).toEqual([]);
    });

    it(`${PRACTICE_AREA_LABELS[area]} — sections list is a subset of applicable sections`, () => {
      const m = buildCaseTypeManifest(area);
      const apply = getApplicableSections(area);
      for (const s of m.enabled_sections) expect(apply.has(s)).toBe(true);
    });
  }
});

describe("Cross-domain activation is audited", () => {
  it("user opt-in records source=user, reason, no evidence required", () => {
    const acts = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal",
      additionalDomains: ["civil_rights"],
      findings: [],
    });
    expect(acts).toHaveLength(1);
    expect(acts[0].source).toBe("user");
    expect(acts[0].domain).toBe("civil_rights");
    expect(acts[0].reason).toBeTruthy();
  });

  it("hybrid case type expands to both domains", () => {
    const acts = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal_civil_rights",
      additionalDomains: [],
      findings: [],
    });
    expect(acts.map((a) => a.domain).sort()).toEqual(["civil_rights"]);
    expect(acts[0].source).toBe("hybrid");
  });

  it("evidence trigger fires only when threshold met", () => {
    const below = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal",
      additionalDomains: [],
      findings: [{ id: "f1", source_module: "engine:section_1983:violation" }],
    });
    expect(below).toHaveLength(0);
    const meets = deriveActivations({
      baseArea: "criminal",
      caseType: "criminal",
      additionalDomains: [],
      findings: [
        { id: "f1", source_module: "engine:section_1983:violation" },
        { id: "f2", source_module: "engine:monell:policy" },
      ],
    });
    expect(meets).toHaveLength(1);
    expect(meets[0].source).toBe("evidence");
    expect(meets[0].evidence_finding_ids).toEqual(["f1", "f2"]);
    expect(meets[0].reason).toBeTruthy();
  });

  it("manifest with active domain lists cross-domain engines separately", () => {
    const m = buildCaseTypeManifest("general_civil", new Set(["criminal"]));
    expect(m.active_domains).toEqual(["criminal"]);
    expect(m.cross_domain_engines).toContain("constitutional_compliance");
    expect(m.enabled_engines).not.toContain("constitutional_compliance");
  });
});

describe("reconcileManifest — drift detection", () => {
  const manifest = buildCaseTypeManifest("general_civil");

  function row(engine: string, status: string, reason: string | null = null) {
    return { engine, status, skipped_reason: reason };
  }

  it("clean run: every enabled engine completed, every skipped engine has reason", () => {
    const r = reconcileManifest({
      manifest,
      runs: [
        ...manifest.enabled_engines.map((e) => row(e, "completed")),
        ...manifest.skipped_engines.map((e) => row(e, "skipped", "not_applicable_to_case_type")),
      ],
      activations: [],
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.stats.executed).toBe(manifest.enabled_engines.length);
  });

  it("flags pending engines after pipeline completion", () => {
    const r = reconcileManifest({
      manifest,
      runs: [row("scoring", "running"), row("contradictions", "queued")],
      activations: [],
    });
    expect(r.ok).toBe(false);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("pending_after_run");
  });

  it("flags silent activation when a gated engine completed without being unlocked", () => {
    const r = reconcileManifest({
      manifest,
      runs: [row("constitutional_compliance", "completed")],
      activations: [],
    });
    expect(r.issues.some((i) => i.code === "silent_activation" && i.engine === "constitutional_compliance")).toBe(true);
  });

  it("flags activations missing reason or evidence", () => {
    const m = buildCaseTypeManifest("general_civil", new Set(["criminal"]));
    const r = reconcileManifest({
      manifest: m,
      runs: [],
      activations: [{ domain: "criminal", source: "evidence", reason: null, evidence_finding_ids: [] }],
    });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("activation_missing_reason");
    expect(codes).toContain("activation_missing_evidence");
  });

  it("flags cross-domain engines listed but no activation audit row exists", () => {
    const m = buildCaseTypeManifest("general_civil", new Set(["criminal"]));
    const r = reconcileManifest({ manifest: m, runs: [], activations: [] });
    expect(r.issues.some((i) => i.code === "cross_domain_no_audit")).toBe(true);
  });

  it("flags empty work-product templates; Generated/Skipped+reason both pass", () => {
    const r = reconcileManifest({
      manifest,
      runs: manifest.enabled_engines.map((e) => row(e, "completed")),
      activations: [],
      workProducts: [
        { title: "Generated brief", body_markdown: "x".repeat(80) },
        { title: "Skipped brief", body_markdown: "", skipped_reason: "insufficient evidence" },
        { title: "Empty template", body_markdown: "", skipped_reason: null, error_message: null },
      ],
    });
    expect(r.stats.work_generated).toBe(1);
    expect(r.stats.work_skipped).toBe(1);
    expect(r.issues.some((i) => i.code === "work_product_empty")).toBe(true);
  });
});
