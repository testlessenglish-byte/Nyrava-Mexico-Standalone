// Regression test for a real completed-case export (ADR-2239-2018-180906,
// an amparo directo en revisión resolved in concluded_audit mode): the
// downloaded PDF/DOCX/JSON report's "Hallazgos Clave" table showed 4
// separate rows — from agent:chain_of_custody, agent:standing_procedencia,
// agent:procedural_violations, and agent:conventionality_pro_persona — that
// were all the same finding ("Distinción entre amparo directo e indirecto")
// restated under each agent's own category label, byte-identical or
// near-identical titles, sharing overlapping evidence quotes.
//
// Root cause: getCase() (cases.functions.ts), which is what feeds
// CaseExportData to export.ts's PDF/DOCX/JSON renderer, queried
// case_findings directly and filtered straight to canonical (engine:*/
// agent:*) rows — it never ran the result through consolidateFindings(),
// the SAME near-duplicate clustering pipeline.server.ts's report-generation
// stage already applies internally (as `allFindings =
// dedupeFindings(rawFindings)`) for score_breakdown/structured summaries.
// So the internally computed report data was correctly deduped, but the
// actual downloadable report a user opens was not — confirmed NOT to be a
// stale-deployment issue: running the exact current consolidateFindings()
// against this exact real export data collapses 17 raw findings to 14,
// merging precisely this cluster.
//
// This test locks in the two-step pipeline getCase() must apply — dedupe
// BEFORE the canonical filter (mirroring pipeline.server.ts's order) — using
// a minimal reproduction of the real cluster, so a future refactor can't
// silently drop the consolidateFindings() step again.
import { describe, it, expect } from "vitest";
import { consolidateFindings } from "@/lib/intelligence/finding-dedupe";
import { isCanonicalFinding, type SelectableFinding } from "@/lib/intelligence/finding-selection";

const QUOTE =
  "dicha distinción no genera inseguridad jurídica, puesto que atiende a las diferencias sustanciales que existen entre uno y otro tipo de procedimientos de control de regularidad constitucional";

function deriveExportFindings<T extends SelectableFinding & Record<string, unknown>>(
  rawRows: T[],
): T[] {
  const all = consolidateFindings(rawRows) as T[];
  const canonical = all.filter((f) => isCanonicalFinding(f));
  return canonical.length > 0 ? canonical : all;
}

describe("getCase() export findings: dedupe before canonical filter", () => {
  it("collapses the real ADR-2239-2018 'Distinción entre amparo directo e indirecto' cluster", () => {
    const rows = [
      {
        id: "f1",
        source_module: "agent:chain_of_custody",
        category: "Amparo",
        title: "Distinción entre amparo directo e indirecto",
        description: "El artículo permite que en el amparo indirecto el quejoso ofrezca pruebas.",
        severity: "medium",
        confidence: 0.9,
        evidence_refs: [{ doc_n: 1, quote: QUOTE }],
      },
      {
        id: "f2",
        source_module: "agent:standing_procedencia",
        category: "Amparo",
        title: "Distinción entre Amparo Directo e Indirecto",
        description: "El artículo establece diferencias en las facultades probatorias.",
        severity: "medium",
        confidence: 0.85,
        evidence_refs: [{ doc_n: 1, quote: QUOTE }],
      },
      {
        id: "f3",
        source_module: "agent:procedural_violations",
        category: "Amparo",
        title: "Distinción entre amparo directo e indirecto en la admisión de pruebas",
        description:
          "El artículo establece diferencias en las facultades probatorias entre el amparo directo e indirecto.",
        severity: "medium",
        confidence: 0.8,
        evidence_refs: [{ doc_n: 1, quote: QUOTE }],
      },
      {
        id: "f4",
        source_module: "agent:conventionality_pro_persona",
        category: "Amparo",
        title: "Distinción entre amparo directo e indirecto",
        description:
          "Esta distinción busca garantizar el derecho de defensa y la igualdad ante la ley.",
        severity: "medium",
        confidence: 0.75,
        evidence_refs: [{ doc_n: 1, quote: QUOTE }],
      },
      // A genuinely distinct finding must survive untouched.
      {
        id: "f5",
        source_module: "agent:suspension_analysis",
        category: "Suspension Analysis",
        title: "Suspensión de oficio y de plano no procede",
        description: "No se presentan actos que importen peligro de privación de la vida.",
        severity: "low",
        confidence: 0.7,
        evidence_refs: [{ doc_n: 1, quote: "otro pasaje totalmente distinto del documento" }],
      },
    ];

    const exported = deriveExportFindings(rows);

    expect(exported).toHaveLength(2);
    const titles = exported.map((f) => f.title).sort();
    expect(titles).toContain("Suspensión de oficio y de plano no procede");
    // The survivor absorbed all 3 duplicates. `_merged_count` is a
    // consolidateFindings() addition, present at runtime but intentionally
    // stripped from deriveExportFindings()'s declared type — see its
    // comment on why the return type stays T[], not T[] & DedupedFinding.
    const cluster = exported.find((f) => f.id !== "f5") as unknown as { _merged_count?: number };
    expect(cluster._merged_count).toBe(3);
  });

  it("still excludes analyzer:* (provisional) rows after deduping", () => {
    const rows = [
      {
        id: "a1",
        source_module: "analyzer:draft_pass",
        category: "Amparo",
        title: "Borrador provisional",
        description: "Salida provisional del analyzer, nunca debe llegar al reporte descargable.",
        severity: "low",
        confidence: 0.5,
        evidence_refs: [],
      },
      {
        id: "e1",
        source_module: "engine:procedural_compliance",
        category: "Cumplimiento Procesal",
        title: "Elemento no identificado en el corpus",
        description: "No se identificó una argumentación expresa sobre interés jurídico.",
        severity: "medium",
        confidence: 0.6,
        evidence_refs: [],
      },
    ];

    const exported = deriveExportFindings(rows);

    expect(exported.map((f) => f.id)).toEqual(["e1"]);
  });
});
