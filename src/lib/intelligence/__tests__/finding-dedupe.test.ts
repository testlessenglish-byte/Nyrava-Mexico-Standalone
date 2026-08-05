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
      f({ id: "l1", category: "laboral", title: "Omisión del pago de aguinaldo proporcional", severity: "high" }),
      f({ id: "l2", category: "laboral", title: "Falta de pago del aguinaldo proporcional", severity: "medium" }),
    ]);
    expect(laboral).toHaveLength(1);
    expect(laboral[0].id).toBe("l1");

    const amparo = consolidateFindings([
      f({ id: "m1", category: "amparo", title: "Violación al derecho de audiencia previa", severity: "critical" }),
      f({ id: "m2", category: "amparo", title: "Vulneración del derecho de audiencia previa", severity: "high" }),
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
    expect(out[0].supporting_engines).toEqual(["engine:contradictions", "agent:procedural_violations"]);
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
    const row = f({ id: "solo", category: "fiscal", title: "Determinación presuntiva improcedente" });
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
