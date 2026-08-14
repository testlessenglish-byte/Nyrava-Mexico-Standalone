// Regression tests for the evidence-relationship taxonomy (Rule 6, report-
// quality audit, 2026-08-14, ADR-2239-2018-180906): "classify every finding
// as SOURCE_HOLDING / SOURCE_FACT / SOURCE_ARGUMENT / DERIVED_INFERENCE /
// UNPROVEN_ABSENCE / MISSING_EVIDENCE, and only the first two should ever be
// treated as a verified factual determination." Covers both the standalone
// classifier and its wiring into diagnoseEvidenceGate (the SOURCE_ARGUMENT
// downgrade — a party's own allegation, however verbatim and on-topic, must
// never be presented as DIRECT_EVIDENCE of the underlying proposition).
import { describe, it, expect } from "vitest";
import {
  classifyEvidenceRelationship,
  diagnoseEvidenceGate,
  type EvidenceItem,
} from "@/lib/intelligence/evidence-gate.server";
import { buildGroundingCorpus } from "@/lib/intelligence/grounding.server";

describe("classifyEvidenceRelationship", () => {
  it("classifies a dispositive/resolutive quote as SOURCE_HOLDING", () => {
    const r = classifyEvidenceRelationship({
      findingType: "DIRECT_EVIDENCE",
      notEstablishedTopic: false,
      text: "El tribunal resolvió el recurso de apelación.",
      verifiedQuotes: [
        "Por lo expuesto y fundado, se resuelve: PRIMERO. Se declara fundado el recurso de apelación.",
      ],
    });
    expect(r).toBe("SOURCE_HOLDING");
  });

  it("classifies a party's own allegation as SOURCE_ARGUMENT, not a fact or holding", () => {
    const r = classifyEvidenceRelationship({
      findingType: "DIRECT_EVIDENCE",
      notEstablishedTopic: false,
      text: "El quejoso alega una violación a su garantía de audiencia.",
      verifiedQuotes: ["El quejoso manifiesta que no fue notificado personalmente del acto reclamado."],
    });
    expect(r).toBe("SOURCE_ARGUMENT");
  });

  it("classifies a plain case-specific fact (no holding/argument markers) as SOURCE_FACT", () => {
    const r = classifyEvidenceRelationship({
      findingType: "DIRECT_EVIDENCE",
      notEstablishedTopic: false,
      text: "Fecha de presentación de la contestación.",
      verifiedQuotes: ["El demandado presentó su contestación el 15 de marzo de dos mil veinticuatro."],
    });
    expect(r).toBe("SOURCE_FACT");
  });

  it("classifies an EVIDENCE_BASED_INFERENCE finding as DERIVED_INFERENCE regardless of quote shape", () => {
    const r = classifyEvidenceRelationship({
      findingType: "EVIDENCE_BASED_INFERENCE",
      notEstablishedTopic: false,
      text: "Esto sugiere un posible incumplimiento del plazo.",
      verifiedQuotes: ["El expediente se recibió el 3 de enero."],
    });
    expect(r).toBe("DERIVED_INFERENCE");
  });

  it("classifies an AI_THEORY finding with no citation and no absence language as DERIVED_INFERENCE", () => {
    const r = classifyEvidenceRelationship({
      findingType: "AI_THEORY",
      notEstablishedTopic: false,
      text: "El quejoso podría tener razón en su planteamiento.",
      verifiedQuotes: [],
    });
    expect(r).toBe("DERIVED_INFERENCE");
  });

  it("classifies an uncited absence claim as UNPROVEN_ABSENCE", () => {
    const r = classifyEvidenceRelationship({
      findingType: "AI_THEORY",
      notEstablishedTopic: false,
      text: "No se identificó en el documento proporcionado una notificación formal al quejoso.",
      verifiedQuotes: [],
    });
    expect(r).toBe("UNPROVEN_ABSENCE");
  });

  it("classifies the procedural-defect-grounding bare-legal-rule downgrade as MISSING_EVIDENCE", () => {
    const r = classifyEvidenceRelationship({
      findingType: "AI_THEORY",
      notEstablishedTopic: true,
      text: "Notificación Defectuosa",
      verifiedQuotes: ["La notificación deberá hacerse personalmente al quejoso conforme al artículo 26."],
    });
    expect(r).toBe("MISSING_EVIDENCE");
  });
});

function corpusWith(...texts: string[]) {
  return buildGroundingCorpus(
    texts.map((t, i) => ({ id: `doc-${i + 1}`, filename: `doc-${i + 1}.txt`, extracted_text: t })),
  );
}

describe("diagnoseEvidenceGate: SOURCE_ARGUMENT can never back a DIRECT_EVIDENCE finding", () => {
  it("downgrades a finding whose only verified quote is a party's own allegation to EVIDENCE_BASED_INFERENCE", () => {
    const quote = "El quejoso manifiesta que no fue notificado personalmente del acto reclamado.";
    const items: EvidenceItem[] = [
      {
        title: "Vulneración a la garantía de audiencia",
        description: "El quejoso alega no haber sido notificado.",
        confidence: 0.9,
        evidence_refs: [{ doc_n: 1, quote }],
      },
    ];
    const { accepted, audit } = diagnoseEvidenceGate(items, { mode: "balanced", corpus: corpusWith(quote) });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].gated.finding_type).toBe("EVIDENCE_BASED_INFERENCE");
    expect(accepted[0].gated.evidence_relationship).toBe("SOURCE_ARGUMENT");
    expect(audit.downgraded_inference).toBe(1);
  });

  it("a finding grounded in a real dispositive holding keeps DIRECT_EVIDENCE and is tagged SOURCE_HOLDING", () => {
    const quote = "Por lo expuesto y fundado, se resuelve: PRIMERO. Se declara fundado el recurso de apelación.";
    const items: EvidenceItem[] = [
      {
        title: "Recurso de apelación declarado fundado",
        description: "El tribunal resolvió el recurso.",
        confidence: 0.9,
        evidence_refs: [{ doc_n: 1, quote }],
      },
    ];
    const { accepted } = diagnoseEvidenceGate(items, { mode: "strict", corpus: corpusWith(quote) });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].gated.finding_type).toBe("DIRECT_EVIDENCE");
    expect(accepted[0].gated.evidence_relationship).toBe("SOURCE_HOLDING");
  });

  it("a finding grounded in a plain case-specific fact keeps DIRECT_EVIDENCE and is tagged SOURCE_FACT", () => {
    const quote = "El demandado presentó su contestación el 15 de marzo de dos mil veinticuatro.";
    const items: EvidenceItem[] = [
      {
        title: "Contestación presentada",
        description: "El demandado contestó la demanda dentro del plazo legal.",
        confidence: 0.9,
        evidence_refs: [{ doc_n: 1, quote }],
      },
    ];
    const { accepted } = diagnoseEvidenceGate(items, { mode: "strict", corpus: corpusWith(quote) });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].gated.finding_type).toBe("DIRECT_EVIDENCE");
    expect(accepted[0].gated.evidence_relationship).toBe("SOURCE_FACT");
  });

  it("in strict mode, an argument-only finding is dropped after the downgrade (strict never keeps EVIDENCE_BASED_INFERENCE)", () => {
    const quote = "El quejoso manifiesta que no fue notificado personalmente del acto reclamado.";
    const items: EvidenceItem[] = [
      {
        title: "Vulneración a la garantía de audiencia",
        description: "El quejoso alega no haber sido notificado.",
        confidence: 0.9,
        evidence_refs: [{ doc_n: 1, quote }],
      },
    ];
    const { accepted, audit } = diagnoseEvidenceGate(items, { mode: "strict", corpus: corpusWith(quote) });
    expect(accepted).toHaveLength(0);
    expect(audit.rejected_unsupported_claim).toBe(1);
  });
});
