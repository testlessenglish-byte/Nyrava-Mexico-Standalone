// Regression for production case ca103271-a5fa-405e-abfb-c1786e5ea8b1:
// 13 agents loaded, valid VERIFIED_COURT_HOLDING output existed, but the
// outer case_type=amparo was treated as non-Penal and the finding was dropped
// before case_findings/canonical/report selection. This test follows the same
// legal record through the deterministic promotion and release boundaries.
import { describe, expect, it } from "vitest";
import { checkFindingDomainVocabulary } from "../domain-vocabulary-gate";
import { normalizePenalFinding } from "../penal-legal-normalization";
import { getCanonicalReportFindings } from "../scoring-selection";
import { findingScoringDirection } from "../scoring.server";
import { selectFindings } from "../finding-selection";
import { buildPenalQaStatuses } from "../penal-qa-status";
import { validateRenderedReport } from "../../canonical/prerender-validate.server";
import { applyEvidenceGate } from "../evidence-gate.server";
import { buildGroundingCorpus } from "../grounding.server";
import type { Finding, NewFinding } from "../types";

const base = {
  case_id: "ca103271-a5fa-405e-abfb-c1786e5ea8b1",
  user_id: "user-1",
  source_module: "agent:constitutional_rights_mapping",
  category: "constitutional_rights_mapping",
  title: "Derecho a la reparación del daño",
  description:
    "La SCJN sostuvo que el Ministerio Público debe proteger a la víctima y que el sentenciado conserva las garantías del Juicio Oral.",
  severity: "medium",
  confidence: 0.94,
  affected_party: "neutral",
  evidence_refs: [
    {
      doc_id: "doc-1",
      doc_n: 1,
      page: 14,
      quote:
        "El Ministerio Público deberá velar por la protección de la víctima y los derechos del sentenciado.",
    },
  ],
  speaker_role: "scjn",
  proposition_type: "holding",
  adoption_status: "adopted",
  audit_classification: "VERIFIED_COURT_HOLDING",
  impact_direction: null,
  metadata: {},
} as unknown as NewFinding;

function persisted(overrides: Record<string, unknown> = {}): Finding {
  const normalized = normalizePenalFinding(base, {
    matter: "amparo",
    underlyingMatter: "penal",
  });
  return {
    ...normalized,
    id: "finding-1",
    created_at: "2026-08-26T18:00:00.000Z",
    updated_at: "2026-08-26T18:00:00.000Z",
    finding_status: "verified",
    verification_status: "verified",
    source_document_id: "doc-1",
    source_quote: normalized.evidence_refs?.[0]?.quote ?? null,
    ...overrides,
  } as unknown as Finding;
}

const finalized = {
  discovery_at: "2026-08-26T18:01:00.000Z",
  contradiction_at: "2026-08-26T18:02:00.000Z",
  evidence_intel_at: "2026-08-26T18:03:00.000Z",
};

describe("Penal-origin Amparo finding promotion", () => {
  it("reproduces the exported SCJN holding at the real strict evidence-promotion gate", () => {
    const quote =
      "la víctima u ofendido del delito tiene el carácter de parte procesal en el procedimiento penal";
    const corpus = buildGroundingCorpus([
      { id: "doc-1", filename: "2_244289_4834_firmado.pdf", extracted_text: quote },
    ]);
    const valid = {
      title: "Legitimación de la víctima para promover juicio de amparo directo",
      description:
        "La víctima u ofendido tiene legitimación para impugnar la individualización de la pena en un juicio de amparo directo.",
      confidence: 0.9,
      evidence_refs: [{ doc_n: 1, quote }],
      audit_classification: "VERIFIED_COURT_HOLDING",
      proposition_type: "holding",
      speaker_role: "scjn",
      adoption_status: "adopted",
    };
    const result = applyEvidenceGate([valid], { mode: "strict", corpus });
    expect(result.audit.accepted).toBe(1);
    expect(result.items[0]).toMatchObject({
      finding_type: "DIRECT_EVIDENCE",
      source_document_id: "doc-1",
      source_quote: quote,
    });

    const unsupported = applyEvidenceGate(
      [{ ...valid, evidence_refs: [{ doc_n: 1, quote: "texto inventado que no obra en el corpus" }] }],
      { mode: "strict", corpus },
    );
    expect(unsupported.items).toEqual([]);
    expect(unsupported.audit.rejected_quote_unverified).toBe(1);
  });

  it("promotes the real verified neutral SCJN holding into canonical, visible and report input without moving score", () => {
    const normalized = normalizePenalFinding(base, {
      matter: "amparo",
      underlyingMatter: "penal",
    });
    expect(checkFindingDomainVocabulary(normalized, "amparo", "penal").clean).toBe(true);
    expect(normalized.proposition_type).toBe("court_holding");
    expect(normalized.impact_direction).toBe("neutral");

    const finding = persisted();
    const canonical = getCanonicalReportFindings({ caseRow: finalized, findings: [finding] });
    const visible = selectFindings([finding]);
    expect(canonical.map((row) => row.id)).toEqual(["finding-1"]);
    expect(visible.map((row) => row.id)).toEqual(["finding-1"]);
    expect(findingScoringDirection(canonical[0])).toBe("neutral");

    const reportIssues = validateRenderedReport(
      { key_findings: canonical.map((row) => `${row.title}: ${row.description}`) },
      "amparo",
      "penal",
    );
    expect(reportIssues.some((issue) => issue.code === "SPANISH_CASE_TYPE_LEAK")).toBe(false);
    expect(
      buildPenalQaStatuses({
        applicable: true,
        citationQuarantined: 0,
        hallucinationEngineStatus: "completed",
        classificationConflicts: 0,
        proceduralSemanticIssues: 0,
        renderedCriticalIssues: 0,
        releaseGateIssues: 0,
        qualityBlocked: false,
      }).every((layer) => layer.reason !== "not_a_penal_matter"),
    ).toBe(true);
  });

  it("keeps invalid, unsupported or stale rows suppressed", () => {
    const invalid = persisted({
      id: "invalid",
      verification_status: "unverified",
      source_quote: null,
    });
    const suppressed = persisted({ id: "suppressed", finding_status: "suppressed" });
    expect(selectFindings([invalid, suppressed])).toEqual([]);
    expect(() =>
      getCanonicalReportFindings({ caseRow: finalized, findings: [invalid, suppressed] }),
    ).toThrowError("CANONICAL_FINDINGS_EMPTY");
  });

  it.each([
    ["penal", null, true],
    ["amparo", "penal", true],
    ["amparo", "civil", false],
    ["amparo", null, false],
    ["civil", null, false],
    ["familiar", null, false],
    ["mercantil", null, false],
    ["laboral", null, false],
    ["administrativo", null, false],
    ["fiscal", null, false],
  ] as const)(
    "X10BREAKIT vocabulary routing: case_type=%s underlying=%s Penal-context=%s",
    (caseType, underlying, expectedClean) => {
      expect(
        checkFindingDomainVocabulary(base, caseType, underlying).clean,
      ).toBe(expectedClean);
    },
  );

  it("deduplicates rerun aliases while keeping the verified survivor", () => {
    const first = persisted({ id: "old", confidence: 0.88 });
    const rerun = persisted({ id: "fresh", confidence: 0.96 });
    const canonical = getCanonicalReportFindings({
      caseRow: finalized,
      findings: [first, rerun],
    });
    expect(canonical).toHaveLength(1);
    expect(canonical[0].audit_classification).toBe("VERIFIED_COURT_HOLDING");
  });
});
