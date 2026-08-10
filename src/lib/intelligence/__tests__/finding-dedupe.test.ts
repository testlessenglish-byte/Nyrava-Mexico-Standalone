import { describe, it, expect } from "vitest";
import { consolidateFindings, jaccard, normalizeText } from "../finding-dedupe";

const f = (o: Record<string, unknown>) => ({ severity: "medium", confidence: 0.5, ...o });

describe("finding dedupe — duplicate consolidation", () => {
  it("collapses near-duplicate findings describing the same legal issue", () => {
    const rows = [
      f({
        id: "a",
        category: "cadena_de_custodia",
        title: "Ruptura de la cadena de custodia del arma",
        description: "No hay registro de traslado del arma entre la escena y el almacén.",
        severity: "high",
        citations: ["CNPP art. 227"],
        evidence_refs: ["doc-1"],
      }),
      f({
        id: "b",
        category: "cadena_de_custodia",
        title: "Cadena de custodia del arma interrumpida",
        description: "El registro de traslado del arma está ausente en el expediente.",
        severity: "critical",
        citations: ["CNPP art. 228"],
        evidence_refs: ["doc-2"],
      }),
      f({
        id: "c",
        category: "cadena_de_custodia",
        title: "Interrupción en la cadena de custodia del arma",
        description: "Falta el registro de traslado del arma.",
        citations: ["CNPP art. 227"],
        evidence_refs: ["doc-3"],
      }),
    ];
    const out = consolidateFindings(rows);
    expect(out).toHaveLength(1);
    // strongest (critical) survives
    expect(out[0].id).toBe("b");
    // every citation and evidence ref survives
    expect(out[0].citations).toEqual(expect.arrayContaining(["CNPP art. 227", "CNPP art. 228"]));
    expect(out[0].evidence_refs).toEqual(expect.arrayContaining(["doc-1", "doc-2", "doc-3"]));
    expect(out[0]._merged_count).toBe(2);
    // no analysis lost
    const merged = out[0]._merged ?? [];
    expect(merged.map((m) => m.description).join(" ")).toContain("escena");
  });

  it("never merges unrelated findings", () => {
    const rows = [
      f({ id: "a", category: "procesal", title: "Notificación fuera de plazo" }),
      f({ id: "b", category: "procesal", title: "Falta de firma del perito" }),
      f({ id: "c", category: "evidencia", title: "Notificación fuera de plazo" }),
    ];
    const out = consolidateFindings(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("works across practice areas, not just criminal", () => {
    const laboral = consolidateFindings([
      f({
        id: "l1",
        category: "laboral",
        title: "Omisión del pago de aguinaldo proporcional",
        severity: "high",
      }),
      f({
        id: "l2",
        category: "laboral",
        title: "Falta de pago del aguinaldo proporcional",
        severity: "medium",
      }),
    ]);
    expect(laboral).toHaveLength(1);
    expect(laboral[0].id).toBe("l1");

    const amparo = consolidateFindings([
      f({
        id: "m1",
        category: "amparo",
        title: "Violación al derecho de audiencia previa",
        severity: "critical",
      }),
      f({
        id: "m2",
        category: "amparo",
        title: "Vulneración del derecho de audiencia previa",
        severity: "high",
      }),
      f({ id: "m3", category: "amparo", title: "Falta de fundamentación del acto reclamado" }),
    ]);
    expect(amparo).toHaveLength(2);
    expect(amparo.map((r) => r.id)).toEqual(["m1", "m3"]);
  });

  it("loses no evidence, citations, source docs or supporting engines", () => {
    const out = consolidateFindings([
      f({
        id: "a",
        category: "civil",
        title: "Incumplimiento contractual del arrendatario",
        source_doc_ids: ["d1"],
        supporting_engines: ["engine:contradictions"],
        tags: ["contrato"],
        citations: ["CCF art. 2398"],
      }),
      f({
        id: "b",
        category: "civil",
        title: "Incumplimiento del contrato por el arrendatario",
        source_doc_ids: ["d2"],
        supporting_engines: ["agent:procedural_violations"],
        tags: ["arrendamiento"],
        citations: ["CCF art. 2400"],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source_doc_ids).toEqual(["d1", "d2"]);
    expect(out[0].supporting_engines).toEqual([
      "engine:contradictions",
      "agent:procedural_violations",
    ]);
    expect(out[0].tags).toEqual(["contrato", "arrendamiento"]);
    expect(out[0].citations).toEqual(["CCF art. 2398", "CCF art. 2400"]);
  });

  it("preserves input order and does not mutate inputs", () => {
    const rows = [
      f({ id: "a", category: "penal", title: "Detención sin orden judicial" }),
      f({ id: "b", category: "penal", title: "Cateo ilegal del domicilio" }),
      f({ id: "c", category: "penal", title: "Detención efectuada sin orden judicial" }),
    ];
    const snapshot = JSON.stringify(rows);
    const out = consolidateFindings(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("passes single findings through untouched", () => {
    const row = f({
      id: "solo",
      category: "fiscal",
      title: "Determinación presuntiva improcedente",
    });
    const out = consolidateFindings([row]);
    expect(out).toHaveLength(1);
    expect(out[0]._alias_ids).toBeUndefined();
    expect(out[0]._merged_count).toBeUndefined();
  });

  it("handles empty input", () => {
    expect(consolidateFindings([])).toEqual([]);
  });

  it("normalizes accents and computes jaccard", () => {
    expect(normalizeText("Violación Áérea")).toBe("violacion aerea");
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});

describe("finding dedupe — cross-engine (cross-category) duplication", () => {
  it("merges the same canonical issue emitted by two engines under different categories", () => {
    const out = consolidateFindings([
      f({
        id: "e1",
        category: "custody_best_interest_analysis",
        title: "Deterioro cognitivo del testador",
        description:
          "La valoración neuropsicológica documenta deterioro cognitivo moderado a severo.",
        severity: "high",
        evidence_refs: ["doc-neuropsicologia"],
        citations: ["CCF art. 1306"],
      }),
      f({
        id: "e2",
        category: "domestic_violence_assessment",
        title: "Deterioro cognitivo del testador",
        description:
          "El dictamen psiquiátrico confirma deterioro cognitivo moderado a severo del testador.",
        severity: "critical",
        evidence_refs: ["doc-psiquiatria"],
        citations: ["CCF art. 1313"],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("e2"); // strongest survives
    expect(out[0]._alias_categories).toEqual(["custody_best_interest_analysis"]);
    expect(out[0].evidence_refs).toEqual(
      expect.arrayContaining(["doc-neuropsicologia", "doc-psiquiatria"]),
    );
    expect(out[0].citations).toEqual(expect.arrayContaining(["CCF art. 1306", "CCF art. 1313"]));
    const meta = out[0].metadata as Record<string, unknown>;
    expect(meta.merged_categories).toEqual(
      expect.arrayContaining(["domestic_violence_assessment", "custody_best_interest_analysis"]),
    );
  });

  it("merges across categories when evidence is shared even if wording differs slightly", () => {
    const out = consolidateFindings([
      f({
        id: "a",
        category: "capacidad_testamentaria",
        title: "Deterioro cognitivo moderado a severo del testador",
        evidence_refs: ["doc-7"],
      }),
      f({
        id: "b",
        category: "influencia_indebida",
        title: "Deterioro cognitivo severo a moderado del testador",
        evidence_refs: ["doc-7"],
      }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("still refuses to merge across categories without corroboration", () => {
    const out = consolidateFindings([
      f({ id: "a", category: "procesal", title: "Notificación fuera de plazo" }),
      f({ id: "b", category: "evidencia", title: "Notificación fuera de plazo" }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not merge different issues that merely share one evidence document", () => {
    const out = consolidateFindings([
      f({
        id: "a",
        category: "capacidad_testamentaria",
        title: "Deterioro cognitivo del testador",
        evidence_refs: ["doc-1"],
      }),
      f({
        id: "b",
        category: "formalidades",
        title: "Ausencia de firma de dos testigos instrumentales",
        evidence_refs: ["doc-1"],
      }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  // Regression: a real completed-case export produced two same-category
  // findings — "Competencia del Juzgado" and "Competencia de la autoridad"
  // — that cite the literal identical quoted sentence from the sentencia,
  // yet the title wording is different enough (Jaccard ~0.33) to miss both
  // the title-similarity threshold (0.55) AND the title-fallback threshold
  // (0.4) that gates the description check. Before this fix, the
  // same-category branch of isSameIssue never looked at evidence at all, so
  // this pair never merged. A verbatim shared quote must be enough on its
  // own regardless of title wording.
  it("merges same-category findings that cite the identical quoted evidence even when titles differ", () => {
    const QUOTE =
      "El Juzgado Segundo de Distrito en Materia Penal resulta competente para conocer del presente asunto conforme al artículo 37 de la Ley de Amparo.";
    const out = consolidateFindings([
      f({
        id: "a",
        category: "Amparo",
        title: "Competencia del Juzgado",
        description: "Se analiza la competencia territorial del órgano jurisdiccional.",
        evidence_refs: [{ label: "Fragmento de la sentencia", quote: QUOTE, doc_id: "doc-1" }],
      }),
      f({
        id: "b",
        category: "Amparo",
        title: "Competencia de la autoridad",
        description:
          "Se revisa si la autoridad responsable tenía competencia para el acto reclamado.",
        evidence_refs: [{ label: "Cita textual de la resolución", quote: QUOTE, doc_id: "doc-1" }],
      }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("still keeps same-category findings separate when their quotes merely share a short common phrase", () => {
    const out = consolidateFindings([
      f({
        id: "a",
        category: "Amparo",
        title: "Competencia del Juzgado",
        evidence_refs: [{ quote: "el juez ordeno", doc_id: "doc-1" }],
      }),
      f({
        id: "b",
        category: "Amparo",
        title: "Notificación fuera de plazo procesal",
        evidence_refs: [{ quote: "el juez ordeno", doc_id: "doc-2" }],
      }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  // Regression: cross-category sharesEvidence() used to sign evidence_refs
  // entries by JSON.stringify-ing the WHOLE {label,quote,doc_id} object, so
  // two engines citing the identical quote under differently worded labels
  // never registered as shared evidence, even with matching titles.
  it("recognizes cross-category shared evidence even when the label wording differs", () => {
    const QUOTE =
      "El quejoso compareció ante la autoridad responsable y ofreció el testimonio correspondiente.";
    const out = consolidateFindings([
      f({
        id: "a",
        category: "Testimonio de Testigo",
        title: "Existencia del Acto Reclamado",
        evidence_refs: [{ label: "Declaración testimonial", quote: QUOTE, doc_id: "doc-1" }],
      }),
      f({
        id: "b",
        category: "Conventionality Pro Persona",
        title: "Existencia del Acto Reclamado",
        evidence_refs: [
          { label: "Acta de audiencia constitucional", quote: QUOTE, doc_id: "doc-1" },
        ],
      }),
    ]);
    expect(out).toHaveLength(1);
  });
});
