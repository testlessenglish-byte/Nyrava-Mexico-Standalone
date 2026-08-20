import { describe, expect, it } from "vitest";
import { isCanonicalFinding, selectFindings } from "../finding-selection";

describe("citation quarantine finding selection", () => {
  const verified = {
    source_module: "agent:constitutional_rights_mapping",
    verification_status: "verified",
    finding_status: "candidate",
  };
  const noCitation = {
    source_module: "agent:ways_out_analysis",
    verification_status: "no_citation",
    finding_status: "candidate",
  };
  const unverified = {
    source_module: "engine:procedural_compliance",
    verification_status: "unverified",
    finding_status: "candidate",
  };

  it("keeps verified engine/agent findings canonical", () => {
    expect(isCanonicalFinding(verified)).toBe(true);
  });

  it("keeps no-citation and unverified rows out of canonical report surfaces", () => {
    expect(isCanonicalFinding(noCitation)).toBe(false);
    expect(isCanonicalFinding(unverified)).toBe(false);
    expect(selectFindings([verified, noCitation, unverified])).toEqual([verified]);
  });

  it("allows audit tooling to request quarantined rows explicitly", () => {
    expect(
      selectFindings([verified, noCitation], { includeQuarantined: true }),
    ).toHaveLength(2);
  });

  it("preserves pre-verification behavior while a run is still in progress", () => {
    expect(
      isCanonicalFinding({
        source_module: "agent:procedural_violations",
        verification_status: null,
      }),
    ).toBe(true);
  });
});


describe("ADR semantic evidence integrity", () => {
  const base = {
    source_module: "agent:constitutional_rights_mapping",
    verification_status: "verified",
    finding_status: "candidate",
    audit_classification: "VERIFIED_COURT_HOLDING",
    evidence_refs: [] as Array<{ quote: string }>,
  };

  it("rejects SCJN non-exemption claims not entailed by an overturned-lower-court quote", () => {
    const finding = {
      ...base,
      title: "Aplicabilidad de la exención fiscal",
      description: "La SCJN determinó que el ISSSTE no está exento del pago de impuestos locales.",
      source_quote: "El Pleno de la SCJN determina que fue incorrecto tanto el fallo del Tribunal Colegiado, como de la autoridad responsable, en relación con el impuesto predial.",
      evidence_refs: [{ quote: "El Pleno de la SCJN determina que fue incorrecto tanto el fallo del Tribunal Colegiado, como de la autoridad responsable, en relación con el impuesto predial." }],
    };
    expect(isCanonicalFinding(finding)).toBe(false);
    expect(selectFindings([finding])).toEqual([]);
  });

  it("rejects procedencia conclusions supported only by a competence quote", () => {
    const finding = {
      ...base,
      title: "Procedencia del recurso de revisión",
      description: "El recurso fue procedente debido a cuestiones constitucionales no atendidas.",
      source_quote: "El Pleno de esta SCJN es competente para conocer del presente asunto.",
      evidence_refs: [{ quote: "El Pleno de esta SCJN es competente para conocer del presente asunto." }],
    };
    expect(isCanonicalFinding(finding)).toBe(false);
  });

  it("rejects an unclassified generated theory with zero evidence references", () => {
    const finding = {
      source_module: "engine:theory:tercero_interesado",
      verification_status: "verified",
      finding_status: "candidate",
      audit_classification: null,
      source_quote: "Loose quote not bound as evidence.",
      evidence_refs: [],
    };
    expect(isCanonicalFinding(finding)).toBe(false);
  });
});

describe("ADR semantic evidence provenance isolation", () => {
  it("does not let an unrelated secondary quote cure an inverted primary holding", () => {
    const finding = {
      source_module: "agent:constitutional_rights_mapping",
      verification_status: "verified",
      finding_status: "candidate",
      audit_classification: "VERIFIED_COURT_HOLDING",
      title: "Aplicabilidad de la exención fiscal",
      description: "La SCJN determinó que el ISSSTE no está exento del pago de impuestos locales.",
      source_quote:
        "El Pleno determinó que fue incorrecto el fallo del Tribunal Colegiado respecto del impuesto predial.",
      evidence_refs: [
        {
          document_id: "unrelated-document",
          quote: "Una parte alegó que el organismo no está exento de contribuciones locales.",
        },
      ],
    };

    expect(isCanonicalFinding(finding)).toBe(false);
    expect(selectFindings([finding])).toEqual([]);
  });

  it("does not let a procedencia quote cure a competence-only primary quote", () => {
    const finding = {
      source_module: "agent:constitutional_rights_mapping",
      verification_status: "verified",
      finding_status: "candidate",
      audit_classification: "VERIFIED_COURT_HOLDING",
      title: "Procedencia del recurso de revisión",
      description: "El recurso fue procedente debido a cuestiones constitucionales no atendidas.",
      source_quote: "El Pleno de esta SCJN es competente para conocer del presente asunto.",
      evidence_refs: [
        {
          document_id: "different-resolution",
          quote: "En otro expediente se declaró procedente un recurso diverso.",
        },
      ],
    };

    expect(isCanonicalFinding(finding)).toBe(false);
  });
});
