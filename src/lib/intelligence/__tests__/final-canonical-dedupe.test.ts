import { describe, it, expect } from "vitest";
import { dedupeReportableFindingsByCanonicalId } from "../finding-dedupe";

describe("Final Reportable Finding Deduplication by canonical_finding_id", () => {
  it("Test 1: collapses multiple findings sharing the same canonical_finding_id into exactly 1 surviving finding", () => {
    const rawFindings = [
      {
        id: "f-001",
        canonical_finding_id: "AM_NOTIF_DEF_01",
        title: "Defecto en la notificación personal",
        category: "procedural_integrity",
        severity: "high",
        confidence: 0.8,
        source_module: "engine:procedural_compliance",
        source_quote: "No se realizó la notificación en términos del artículo 27 de la Ley de Amparo.",
        evidence_refs: [
          { doc_id: "doc-1", page: 4, quote: "No se realizó la notificación en términos del artículo 27 de la Ley de Amparo." },
        ],
        source_doc_ids: ["doc-1"],
      },
      {
        id: "f-002",
        canonical_finding_id: "AM_NOTIF_DEF_01",
        title: "Falta de notificación al quejoso",
        category: "constitutional_issue",
        severity: "critical",
        confidence: 0.9,
        source_module: "report_writer:constitutional_issue",
        evidence_refs: [
          { doc_id: "doc-2", page: 12, quote: "Se omitió correr traslado con copia de la demanda." },
        ],
        source_doc_ids: ["doc-2"],
      },
    ];

    const result = dedupeReportableFindingsByCanonicalId(rawFindings);

    expect(result.deduped.length).toBe(1);
    expect(result.duplicatesFound).toBe(1);
    expect(result.final_reportable_canonical_ids_unique).toBe(true);

    const survivor = result.deduped[0];
    expect(survivor.canonical_finding_id).toBe("AM_NOTIF_DEF_01");
    // Unions evidence refs from both
    expect((survivor.evidence_refs as unknown[]).length).toBe(2);
    // Unions source doc ids from both
    expect((survivor.source_doc_ids as string[])).toContain("doc-1");
    expect((survivor.source_doc_ids as string[])).toContain("doc-2");
    // Contains aliases
    expect(survivor._alias_ids).toContain("f-002");
    expect(survivor._alias_titles).toContain("Falta de notificación al quejoso");
  });

  it("Test 2: judicial holding candidate wins over speculative candidate regardless of numerical severity", () => {
    const rawFindings = [
      {
        id: "f-speculative",
        canonical_finding_id: "PEN_INCONST_ART470",
        title: "Posible inconstitucionalidad del artículo 470",
        category: "constitutional_issue",
        severity: "critical",
        confidence: 0.95,
        audit_classification: "POTENTIAL_ISSUE",
        proposition_type: "argument",
        source_module: "analyzer:constitutional",
      },
      {
        id: "f-holding",
        canonical_finding_id: "PEN_INCONST_ART470",
        title: "Inconstitucionalidad del artículo 470 del Código Nacional",
        category: "constitutional_issue",
        severity: "medium",
        confidence: 0.85,
        audit_classification: "VERIFIED_COURT_HOLDING",
        proposition_type: "holding",
        source_module: "engine:decision_core",
        source_quote: "Esta Primera Sala declara la inconstitucionalidad del precepto impugnado.",
        evidence_refs: [
          { doc_id: "sentencia-scjn", page: 45, quote: "Esta Primera Sala declara la inconstitucionalidad del precepto impugnado." },
        ],
      },
    ];

    const result = dedupeReportableFindingsByCanonicalId(rawFindings);

    expect(result.deduped.length).toBe(1);
    const survivor = result.deduped[0];
    // The verified judicial holding must win
    expect(survivor.id).toBe("f-holding");
    expect(survivor.title).toBe("Inconstitucionalidad del artículo 470 del Código Nacional");
    expect(survivor.audit_classification).toBe("VERIFIED_COURT_HOLDING");
  });

  it("Test 3: distinct canonical IDs are never merged", () => {
    const rawFindings = [
      {
        id: "f-1",
        canonical_finding_id: "CANONICAL_AAA",
        title: "Violación a la cadena de custodia",
        source_module: "engine:chain_of_custody",
      },
      {
        id: "f-2",
        canonical_finding_id: "CANONICAL_BBB",
        title: "Violación al principio de inmediación",
        source_module: "engine:procedural_compliance",
      },
    ];

    const result = dedupeReportableFindingsByCanonicalId(rawFindings);

    expect(result.deduped.length).toBe(2);
    expect(result.duplicatesFound).toBe(0);
    expect(result.final_reportable_canonical_ids_unique).toBe(true);
  });

  it("Test 4: generates complete duplicate audit logging provenance", () => {
    const rawFindings = [
      {
        id: "f-alpha",
        canonical_finding_id: "NOTIF_01",
        title: "Defecto de Notificación",
        category: "procedural",
        source_module: "engine:analyzers",
        evidence_refs: [{ citation_id: "cit-1", doc_id: "d1" }],
      },
      {
        id: "f-beta",
        canonical_finding_id: "NOTIF_01",
        title: "Omisión de Notificación",
        category: "constitutional",
        source_module: "report_writer",
        evidence_refs: [{ citation_id: "cit-2", doc_id: "d2" }],
      },
      {
        id: "f-gamma",
        canonical_finding_id: "NOTIF_01",
        title: "Nulidad de Notificación",
        category: "litigation",
        source_module: "engine:litigation",
        evidence_refs: [{ citation_id: "cit-3", doc_id: "d3" }],
      },
    ];

    const result = dedupeReportableFindingsByCanonicalId(rawFindings);

    expect(result.deduped.length).toBe(1);
    expect(result.duplicatesFound).toBe(2);
    expect(result.duplicateAudit.length).toBe(1);

    const audit = result.duplicateAudit[0];
    expect(audit.canonical_id).toBe("NOTIF_01");
    expect(audit.duplicate_finding_ids).toEqual(["f-alpha", "f-beta", "f-gamma"]);
    expect(audit.originating_agents).toContain("engine:analyzers");
    expect(audit.originating_agents).toContain("report_writer");
    expect(audit.originating_agents).toContain("engine:litigation");
    expect(audit.citation_ids).toContain("cit-1");
    expect(audit.citation_ids).toContain("cit-2");
    expect(audit.citation_ids).toContain("cit-3");
  });
});
