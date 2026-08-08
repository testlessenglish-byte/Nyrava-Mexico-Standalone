// Regression test for the over-suppression bug: the procedural-defect-
// grounding backstop (see procedural-defect-grounding.server.ts) downgrades
// a finding to AI_THEORY, and the PRE-EXISTING strict/balanced mode policy
// silently DROPS every AI_THEORY finding — turning a useful "this topic is
// raised but not established" signal into nothing at all, in the two most
// commonly used analysis modes. This exercises diagnoseEvidenceGate()
// directly to prove the fix: a bare-legal-rule finding survives in every
// mode, explicitly labeled "NO ESTABLECIDO", while genuinely unsupported
// findings (no citation, or real inference language in strict mode) are
// still correctly dropped exactly as before.
import { describe, it, expect } from "vitest";
import { diagnoseEvidenceGate, type EvidenceItem } from "@/lib/intelligence/evidence-gate.server";
import { buildGroundingCorpus } from "@/lib/intelligence/grounding.server";

const RULE_QUOTE = "La notificación deberá hacerse personalmente al quejoso conforme al artículo 26 de la Ley de Amparo.";
const FACT_QUOTE = "El demandante presentó su contestación el 15 de marzo de dos mil veinticuatro.";

function corpusWith(...texts: string[]) {
  return buildGroundingCorpus(texts.map((t, i) => ({ id: `doc-${i + 1}`, filename: `doc-${i + 1}.txt`, extracted_text: t })));
}

describe("diagnoseEvidenceGate: procedural-defect-grounding survives mode policy", () => {
  it("a bare-legal-rule notification finding is ACCEPTED (not dropped) in strict mode, labeled NO ESTABLECIDO", () => {
    const items: EvidenceItem[] = [
      {
        title: "Notificación Defectuosa",
        description: "La notificación de la sentencia se realizó por lista.",
        confidence: 0.95,
        evidence_refs: [{ doc_n: 1, quote: RULE_QUOTE }],
      },
    ];
    const { accepted, audit } = diagnoseEvidenceGate(items, {
      mode: "strict",
      corpus: corpusWith(RULE_QUOTE),
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].gated.finding_type).toBe("AI_THEORY");
    expect(accepted[0].gated.title).toMatch(/^NO ESTABLECIDO/);
    expect(audit.downgraded_bare_legal_rule).toBe(1);
    expect(audit.rejected_unsupported_claim).toBe(0);
  });

  it("same finding is ACCEPTED in balanced mode too", () => {
    const items: EvidenceItem[] = [
      {
        title: "Defecto de suspensión",
        description: "Se alega un problema con la suspensión.",
        confidence: 0.9,
        evidence_refs: [
          { doc_n: 1, quote: "La suspensión a petición de parte procede cuando se acredite la apariencia del buen derecho." },
        ],
      },
    ];
    const { accepted } = diagnoseEvidenceGate(items, {
      mode: "balanced",
      corpus: corpusWith("La suspensión a petición de parte procede cuando se acredite la apariencia del buen derecho."),
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].gated.finding_type).toBe("AI_THEORY");
    expect(accepted[0].gated.title).toMatch(/^NO ESTABLECIDO/);
  });

  it("regression guard: a genuinely unsupported finding (no citation at all) is still dropped in strict mode", () => {
    const items: EvidenceItem[] = [
      { title: "Alegación sin respaldo", description: "El quejoso podría tener razón.", confidence: 0.6 },
    ];
    const { accepted, audit } = diagnoseEvidenceGate(items, {
      mode: "strict",
      corpus: corpusWith(FACT_QUOTE),
    });
    expect(accepted).toHaveLength(0);
    expect(audit.rejected_no_citation).toBe(1);
  });

  it("regression guard: real inference language with a real citation is still dropped in strict mode (unaffected by the exemption)", () => {
    const items: EvidenceItem[] = [
      {
        title: "Posible incumplimiento",
        description: "This suggests the deadline may have been missed.",
        confidence: 0.8,
        evidence_refs: [{ doc_n: 1, quote: FACT_QUOTE }],
      },
    ];
    const { accepted, audit } = diagnoseEvidenceGate(items, {
      mode: "strict",
      corpus: corpusWith(FACT_QUOTE),
    });
    expect(accepted).toHaveLength(0);
    expect(audit.rejected_unsupported_claim).toBe(1);
  });

  it("a finding grounded in a real case-specific fact (not a bare rule) is accepted normally, untouched by the backstop", () => {
    const items: EvidenceItem[] = [
      {
        title: "Contestación presentada",
        description: "El demandado contestó la demanda dentro del plazo legal.",
        confidence: 0.9,
        evidence_refs: [{ doc_n: 1, quote: FACT_QUOTE }],
      },
    ];
    const { accepted, audit } = diagnoseEvidenceGate(items, {
      mode: "strict",
      corpus: corpusWith(FACT_QUOTE),
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].gated.finding_type).toBe("DIRECT_EVIDENCE");
    expect(accepted[0].gated.title).toBe("Contestación presentada");
    expect(audit.downgraded_bare_legal_rule).toBe(0);
  });
});
