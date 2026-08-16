// Real-user regression guard (2026-08-16): buildWorkProduct() and
// buildWitnessProfiles() (report-augment.server.ts) generate
// report.full_report.attorney_work_product deterministically (no LLM),
// but every string they produced was hardcoded around a penal
// prosecution-vs-defense adversarial-trial framing — "Ministerio Público",
// "in dubio pro reo... imputado" — with no materia check anywhere.
// Confirmed live on a real Amparo Directo en Revisión case (ADR-2239-2018,
// about the constitutionality of Ley de Amparo art. 75 — no Ministerio
// Público, no imputado, no trial of any kind): case_strategy read
// "...directly controverting the Ministerio Público's theory" and
// jury_themes read "...debe favorecer al imputado". Separately,
// PROPER_NAME_RE (any two-capitalized-word phrase) had no way to exclude
// institutional/citation phrases, so "Amparo Directo"/"Primera Sala"/
// "Semanario Judicial" got listed as cross-examination witnesses.
import { describe, it, expect } from "vitest";
import { buildWorkProduct, buildWitnessProfiles } from "@/lib/intelligence/report-augment.server";

function makeFakeDb(opts: {
  findings?: Array<Record<string, unknown>>;
  documents?: Array<Record<string, unknown>>;
  witnesses?: Array<Record<string, unknown>>;
}) {
  function chain(resolveValue: unknown) {
    const c: Record<string, unknown> = {
      eq: () => c,
      not: () => c,
      order: () => c,
      limit: () => c,
      select: () => c,
      then: (resolve: (v: unknown) => void) => resolve({ data: resolveValue, error: null }),
    };
    return c;
  }
  return {
    from(table: string) {
      return {
        select() {
          if (table === "case_findings") return chain(opts.findings ?? []);
          if (table === "documents") return chain(opts.documents ?? []);
          if (table === "case_witnesses") return chain(opts.witnesses ?? []);
          return chain([]);
        },
      };
    },
  };
}

describe("buildWorkProduct: materia-aware content", () => {
  it("does NOT leak penal vocabulary (Ministerio Público / imputado) for a non-penal materia", async () => {
    const db = makeFakeDb({
      findings: [
        {
          title: "Constitucionalidad del Artículo 75 de la Ley de Amparo",
          description: "",
          category: "Procedencia del Amparo",
          affected_party: "quejoso",
          severity: "medium",
          evidence_type: "exculpatory",
          source_document_id: "doc-1",
          source_page: 1,
        },
      ],
    });

    const result = await buildWorkProduct(db as never, "case-1", { caseType: "amparo" });
    const blob = JSON.stringify(result);

    expect(blob).not.toMatch(/Ministerio Público/);
    expect(blob).not.toMatch(/imputado/i);
    expect(blob).not.toMatch(/in dubio pro reo/i);
    expect(result.case_strategy).toContain("Constitucionalidad del Artículo 75");
  });

  it("still uses penal vocabulary for an actual penal case", async () => {
    const db = makeFakeDb({ findings: [] });
    const result = await buildWorkProduct(db as never, "case-1", { caseType: "penal" });
    expect(result.jury_themes.join(" ")).toMatch(/imputado/i);
  });

  it("falls back to a materia-neutral insufficiency message for non-penal cases with no findings", async () => {
    const db = makeFakeDb({ findings: [] });
    const result = await buildWorkProduct(db as never, "case-1", { caseType: "civil" });
    expect(result.jury_themes.join(" ")).not.toMatch(/imputado|Ministerio Público/i);
    expect(result.trial_themes.join(" ")).not.toMatch(/imputado|Ministerio Público/i);
  });
});

describe("buildWitnessProfiles: institutional phrases are not treated as witnesses", () => {
  it("does not list court/publication names as cross-examination witnesses", async () => {
    const text = Array(4)
      .fill(
        "El Amparo Directo fue resuelto por la Primera Sala conforme al Semanario Judicial de la Federación.",
      )
      .join(" ");
    const db = makeFakeDb({
      documents: [{ id: "doc-1", filename: "doc-1.txt", extracted_text: text, status: "extracted" }],
    });

    const profiles = await buildWitnessProfiles(db as never, "case-1");
    const names = profiles.map((p) => p.name);

    expect(names).not.toContain("Amparo Directo");
    expect(names).not.toContain("Primera Sala");
    expect(names).not.toContain("Semanario Judicial");
  });

  it("still detects a real repeated person name", async () => {
    const text = Array(4).fill("Juan Martinez declaró ante el tribunal sobre los hechos.").join(" ");
    const db = makeFakeDb({
      documents: [{ id: "doc-1", filename: "doc-1.txt", extracted_text: text, status: "extracted" }],
    });

    const profiles = await buildWitnessProfiles(db as never, "case-1");
    expect(profiles.map((p) => p.name)).toContain("Juan Martinez");
  });
});
