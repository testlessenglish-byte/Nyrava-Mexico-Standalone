import { describe, expect, it } from "vitest";
import {
  buildLegalIssueHierarchy,
  clusterBySameIssue,
} from "../finding-dedupe";

const finding = (overrides: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  category: "constitutional",
  title: "Issue",
  description: "Description",
  severity: "high",
  confidence: 0.9,
  evidence_refs: [{ quote: "La víctima tiene derecho a un recurso judicial efectivo." }],
  source_authority: "SCJN ADR",
  ...overrides,
});

describe("Penal semantic legal dedupe", () => {
  it("clusters victim-standing aliases when doctrine and authority match", () => {
    const rows = [
      finding({
        title: "Legitimación de la víctima",
        description: "La víctima cuenta con legitimación para acudir al juicio.",
        operative_effect: "standing_recognized",
      }),
      finding({
        title: "Acceso a la justicia para víctimas",
        description: "Se reconoce acceso judicial efectivo a la víctima.",
        operative_effect: "standing_recognized",
      }),
      finding({
        title: "Tutela judicial efectiva del ofendido",
        description: "El ofendido puede obtener revisión judicial.",
        operative_effect: "standing_recognized",
      }),
    ];

    const clusters = clusterBySameIssue(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it("does not over-dedupe similar wording with different operative effects", () => {
    const rows = [
      finding({
        title: "Acceso a la justicia de la víctima",
        operative_effect: "standing_recognized",
      }),
      finding({
        title: "Acceso a la justicia de la víctima",
        operative_effect: "standing_denied",
      }),
    ];

    expect(clusterBySameIssue(rows)).toHaveLength(2);
  });

  it("groups distinct consequences beneath a parent issue without deleting them", () => {
    const rows = [
      finding({
        title: "Presentación sin demora ante el Ministerio Público",
        normalized_legal_issue: "prompt_presentment_due_process",
        operative_effect: "constitutional_violation",
      }),
      finding({
        title: "Efecto de la demora sobre la confesión",
        normalized_legal_issue: "prompt_presentment_due_process",
        operative_effect: "confession_exclusion",
      }),
    ];

    const hierarchy = buildLegalIssueHierarchy(rows);
    expect(hierarchy).toHaveLength(1);
    expect(hierarchy[0].findings).toHaveLength(2);
  });

  it("keeps rejected and adopted holdings separate", () => {
    const rows = [
      finding({
        normalized_legal_issue: "victim_access_to_justice",
        adoption_status: "adopted",
        operative_effect: "standing_recognized",
      }),
      finding({
        normalized_legal_issue: "victim_access_to_justice",
        adoption_status: "rejected",
        operative_effect: "standing_recognized",
      }),
    ];

    expect(clusterBySameIssue(rows)).toHaveLength(2);
  });
});
