// Case-Type Execution Framework — policy regression suite.
// Locks the rules that determine which analyzers, finding modules, motions,
// and report sections execute / render for each practice area, and that
// cross-domain activation only widens the policy through audited paths.
import { describe, it, expect } from "vitest";
import {
  isAnalyzerAllowed,
  isFindingAllowed,
  isMotionAllowed,
  isSectionApplicable,
  isTabApplicable,
  getAllowedAnalyzers,
  getAllowedFindingModules,
  getBlockedTerms,
  findBlockedTermsIn,
  normalizePracticeArea,
  scrubReportForPracticeArea,
  SKIP_REASON_NOT_APPLICABLE,
  type PracticeArea,
} from "@/lib/intelligence/practice-areas";
import { deriveActivations } from "@/lib/intelligence/cross-domain.server";

const AREAS: PracticeArea[] = [
  "criminal", "civil_rights", "general_civil", "personal_injury",
  "medical_malpractice", "employment", "family", "appellate",
];

describe("practice-area normalization", () => {
  it("falls back to general_civil for unknown inputs", () => {
    expect(normalizePracticeArea(null)).toBe("general_civil");
    expect(normalizePracticeArea("nonsense")).toBe("general_civil");
  });
  it("preserves all eight registered areas", () => {
    for (const a of AREAS) expect(normalizePracticeArea(a)).toBe(a);
  });
});

describe("analyzer gating (rule sets from the directive)", () => {
  it("universal infrastructure engines run for every area", () => {
    for (const a of AREAS) {
      for (const e of ["extraction", "contradictions", "timeline", "scoring", "report_generator"]) {
        expect(isAnalyzerAllowed(a, e)).toBe(true);
      }
    }
  });

  it("constitutional_compliance is criminal/civil_rights only", () => {
    expect(isAnalyzerAllowed("criminal", "constitutional_compliance")).toBe(true);
    expect(isAnalyzerAllowed("civil_rights", "constitutional_compliance")).toBe(true);
    expect(isAnalyzerAllowed("family", "constitutional_compliance")).toBe(false);
    expect(isAnalyzerAllowed("employment", "constitutional_compliance")).toBe(false);
    expect(isAnalyzerAllowed("personal_injury", "constitutional_compliance")).toBe(false);
  });

  it("trial_prep / cross_examination never run in family or appellate", () => {
    for (const e of ["trial_prep", "cross_examination"]) {
      expect(isAnalyzerAllowed("family", e)).toBe(false);
      expect(isAnalyzerAllowed("appellate", e)).toBe(false);
    }
  });
});

describe("finding-module gating", () => {
  // MX-aligned: the criminal (penal acusatorio) profile allows CNPP/CPEUM
  // modules — never US common-law ones like Miranda or Brady.
  it("criminal allows CNPP modules; civil does not", () => {
    expect(isFindingAllowed("criminal", "engine:cadena_de_custodia:ruptura")).toBe(true);
    expect(isFindingAllowed("criminal", "engine:vinculacion_a_proceso:plazo")).toBe(true);
    expect(isFindingAllowed("criminal", "engine:medidas_cautelares:impugnacion")).toBe(true);
    expect(isFindingAllowed("general_civil", "engine:cadena_de_custodia:ruptura")).toBe(false);
    expect(isFindingAllowed("general_civil", "engine:prision_preventiva_oficiosa:catalogo")).toBe(false);
  });

  it("family allows custody/support; rejects criminal terminology", () => {
    expect(isFindingAllowed("family", "engine:custody:primary")).toBe(true);
    expect(isFindingAllowed("family", "engine:child_support:guideline")).toBe(true);
    expect(isFindingAllowed("family", "engine:vinculacion_a_proceso:plazo")).toBe(false);
    expect(isFindingAllowed("family", "engine:wrongful_termination:claim")).toBe(false);
  });

  it("employment allows discrimination/eeoc; rejects custody/criminal", () => {
    expect(isFindingAllowed("employment", "engine:discrimination:title_vii")).toBe(true);
    expect(isFindingAllowed("employment", "engine:eeoc:charge")).toBe(true);
    expect(isFindingAllowed("employment", "engine:custody:dispute")).toBe(false);
    expect(isFindingAllowed("employment", "engine:cadena_de_custodia:ruptura")).toBe(false);
  });
});

describe("motion gating", () => {
  it("family forbids penal filings; criminal allows them", () => {
    expect(isMotionAllowed("criminal", "solicitud_de_no_vinculacion")).toBe(true);
    expect(isMotionAllowed("criminal", "impugnacion_medidas_cautelares")).toBe(true);
    expect(isMotionAllowed("family", "solicitud_de_no_vinculacion")).toBe(false);
    expect(isMotionAllowed("family", "motion_to_suppress")).toBe(false);
  });
  it("family allows custody_modification; civil does not", () => {
    expect(isMotionAllowed("family", "custody_modification")).toBe(true);
    expect(isMotionAllowed("general_civil", "custody_modification")).toBe(false);
  });
});

describe("section and tab gating", () => {
  it("constitutional section is criminal/civil_rights only", () => {
    expect(isSectionApplicable("criminal", "constitutional")).toBe(true);
    expect(isSectionApplicable("civil_rights", "constitutional")).toBe(true);
    expect(isSectionApplicable("family", "constitutional")).toBe(false);
    expect(isSectionApplicable("personal_injury", "constitutional")).toBe(false);
  });
  it("universal sections render for every area", () => {
    for (const a of AREAS) {
      expect(isSectionApplicable(a, "timeline")).toBe(true);
      expect(isSectionApplicable(a, "findings")).toBe(true);
      expect(isSectionApplicable(a, "witnesses")).toBe(true);
    }
  });
  it("trial tab hidden for family + appellate", () => {
    expect(isTabApplicable("family", "trial")).toBe(false);
    expect(isTabApplicable("appellate", "trial")).toBe(false);
    expect(isTabApplicable("criminal", "trial")).toBe(true);
  });
});

describe("terminology blocklist", () => {
  it("flags Miranda in a family-law prose snippet", () => {
    const hits = findBlockedTermsIn(
      "The petitioner's Miranda warning is irrelevant to custody.",
      "family",
    );
    expect(hits.length).toBeGreaterThan(0);
  });
  it("does not flag custody language in a family case", () => {
    expect(findBlockedTermsIn("Joint custody is in the child's best interests.", "family")).toEqual([]);
  });
  it("criminal blocklist keeps US common-law terms blocked and allows CNPP terms", () => {
    const terms = getBlockedTerms("criminal");
    // MX penal profile blocks US terminology outright.
    expect(terms.some((t) => /miranda|grand jury|plea bargain|felony/i.test(t))).toBe(true);
    // ...and never blocks its own Mexican modules.
    expect(terms.some((t) => /cadena de custodia|vinculaci/i.test(t))).toBe(false);
  });
});

describe("cross-domain activation — only via audited paths", () => {
  it("user opt-in activates a domain with source=user", () => {
    const acts = deriveActivations({
      baseArea: "criminal", caseType: "criminal",
      additionalDomains: ["civil_rights"], findings: [],
    });
    expect(acts).toHaveLength(1);
    expect(acts[0].source).toBe("user");
    expect(acts[0].domain).toBe("civil_rights");
  });

  it("hybrid case type auto-unlocks the bundled domains", () => {
    const acts = deriveActivations({
      baseArea: "criminal", caseType: "criminal_civil_rights",
      additionalDomains: [], findings: [],
    });
    expect(acts.some((a) => a.domain === "civil_rights" && a.source === "hybrid")).toBe(true);
  });

  it("evidence trigger requires the declared minimum (no isolated keyword)", () => {
    // One related finding is below threshold — must NOT activate.
    const tooFew = deriveActivations({
      baseArea: "criminal", caseType: "criminal", additionalDomains: [],
      findings: [{ id: "a", source_module: "engine:section_1983:claim" }],
    });
    expect(tooFew).toHaveLength(0);

    // Two related findings → activation with source=evidence and reason+ids.
    const enough = deriveActivations({
      baseArea: "criminal", caseType: "criminal", additionalDomains: [],
      findings: [
        { id: "a", source_module: "engine:section_1983:claim" },
        { id: "b", source_module: "engine:qualified_immunity:rebuttal" },
      ],
    });
    expect(enough).toHaveLength(1);
    expect(enough[0].source).toBe("evidence");
    expect(enough[0].domain).toBe("civil_rights");
    expect(enough[0].reason.length).toBeGreaterThan(0);
    expect(enough[0].evidence_finding_ids.length).toBeGreaterThanOrEqual(2);
  });

  it("activations widen — never narrow — the base policy", () => {
    expect(isFindingAllowed("criminal", "engine:custody:dispute")).toBe(false);
    // Family activated → custody now permitted.
    expect(isFindingAllowed("criminal", "engine:custody:dispute", ["family"])).toBe(true);
    // Criminal base modules still permitted.
    expect(isFindingAllowed("criminal", "engine:cadena_de_custodia:ruptura", ["family"])).toBe(true);
  });
});

describe("scrub helpers (belt-and-braces)", () => {
  it("family report has constitutional_issues wiped", () => {
    const r = { constitutional_issues: "Fourth Amendment analysis…", findings: [{ id: 1 }] };
    scrubReportForPracticeArea(r as Record<string, unknown>, "family");
    expect(r.constitutional_issues).toBe("");
    expect(r.findings).toEqual([{ id: 1 }]);
  });
});

describe("canonical skip reason", () => {
  it("is a stable string", () => {
    expect(SKIP_REASON_NOT_APPLICABLE).toBe("not_applicable_to_case_type");
  });
});

describe("allow-list completeness — every area has at least one practice-specific module", () => {
  for (const a of AREAS) {
    it(`${a} declares at least one analyzer + finding module`, () => {
      // Universal analyzers always present; practice analyzers may be empty
      // (family / appellate), but every area must declare ≥1 finding module.
      expect(getAllowedFindingModules(a).size).toBeGreaterThan(10);
      // Universal engines are always >= 15.
      expect(getAllowedAnalyzers(a).size).toBeGreaterThan(15);
    });
  }
});
