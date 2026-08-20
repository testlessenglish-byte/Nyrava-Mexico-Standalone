import { describe, expect, it } from "vitest";

import { canonicalEvidenceIntegrityIssue, selectFindings } from "../finding-selection";
import { computeESS, detectDocTypeSignals } from "../sufficiency.server";

describe("post-169 report correctness", () => {
  it("treats a completed SCJN ADR judgment as substantive high-weight evidence", () => {
    const docs = [
      {
        filename: "ADR-5829-2025-SCJN.pdf",
        extracted_text:
          "AMPARO DIRECTO EN REVISIÓN 5829/2025. PRIMERA SALA. PUNTOS RESOLUTIVOS. Se revoca la sentencia recurrida.",
      },
    ];
    const signals = detectDocTypeSignals(docs);

    expect(signals.highWeightTypes).toContain("final_judgment");

    const ess = computeESS({
      documentCount: 1,
      pageCount: 20,
      extractedChars: 12_000,
      factCount: 4,
      contradictionCount: 0,
      corroboratedCount: 0,
      hasChargingDocument: signals.hasChargingDocument,
      highWeightDocTypeCount: signals.highWeightDocTypeCount,
      distinctDocTypeCount: signals.distinctDocTypeCount,
      locale: "es",
    });

    expect(ess.fullAnalysisOverride).toBe(true);
    expect(ess.bin).toBe("medium");
    expect(ess.insufficientEvidenceNotice).toBeNull();
  });

  it("collapses near-duplicate canonical findings before report/UI selection", () => {
    const selected = selectFindings([
      {
        id: "a",
        title: "Notificación defectuosa de la sentencia",
        description: "La notificación personal de la sentencia no consta debidamente.",
        category: "procedural",
        source_module: "engine:contradictions",
        finding_status: "verified",
        verification_status: "verified",
        severity: "high",
        supporting_engines: ["contradictions"],
        source_doc_ids: ["doc-1"],
        source_quote: "no consta la notificación personal",
      },
      {
        id: "b",
        title: "Falta de notificación personal de sentencia",
        description: "No consta debidamente la notificación personal de la sentencia.",
        category: "procedural",
        source_module: "agent:legal",
        finding_status: "verified",
        verification_status: "verified",
        severity: "high",
        supporting_engines: ["legal"],
        source_doc_ids: ["doc-1"],
        source_quote: "no consta la notificación personal",
      },
    ]);

    expect(selected).toHaveLength(1);
    const merged = selected[0] as Record<string, unknown>;
    expect(Array.isArray(merged.supporting_engines)).toBe(true);
  });

  it("rejects an adhesive-review holding attributed to the principal appellant", () => {
    expect(canonicalEvidenceIntegrityIssue({
      title: "Inoperancia de los agravios de la parte recurrente",
      description: "La parte recurrente no combatió la sentencia.",
      source_module: "agent:chain_of_custody",
      source_quote: "Resultan inoperantes los agravios esgrimidos por la adherente y se declara infundado el recurso de revisión adhesiva.",
    })).toBe("adhesive_party_misattributed_to_principal_appellant");
  });

  it("accepts the same holding when the adhesive party is preserved", () => {
    expect(canonicalEvidenceIntegrityIssue({
      title: "Inoperancia de los agravios de la recurrente adhesiva",
      description: "La recurrente adhesiva no combatió la sentencia.",
      source_module: "agent:chain_of_custody",
      source_quote: "Resultan inoperantes los agravios esgrimidos por la adherente y se declara infundado el recurso de revisión adhesiva.",
    })).toBeNull();
  });
});
