import { describe, expect, it } from "vitest";
import { extractFacts } from "../reporting/evidence-facts";
import { buildDocumentGraph, synthesizeEvidence } from "../reporting/evidence-synthesis";
import { buildFindingWorkProduct } from "../reporting/attorney-workproduct";

const w = (stars: number, label: string) => ({
  stars,
  glyphs: "★".repeat(stars) + "☆".repeat(5 - stars),
  label,
});

describe("extractFacts", () => {
  it("extracts dates, amounts, identifiers, parties and legal acts", () => {
    const facts = extractFacts([
      "El C. Juan Pérez López se obliga a pagar la cantidad de $350,000.00 MXN el 3 de marzo de 2026, según CFDI No. A-1456.",
    ]);
    const kinds = facts.map((f) => f.kind);
    expect(kinds).toContain("date");
    expect(kinds).toContain("amount");
    expect(kinds).toContain("identifier");
    expect(kinds).toContain("party");
    expect(facts.find((f) => f.kind === "amount")?.numeric).toBe(350000);
    expect(facts.find((f) => f.kind === "date")?.key).toBe("2026-03-03");
    expect(facts.find((f) => f.act === "obligacion_creada")).toBeTruthy();
  });

  it("reads Mexican date order as day-first", () => {
    expect(extractFacts(["03/04/2026"]).find((f) => f.kind === "date")?.key).toBe("2026-04-03");
  });
});

describe("synthesizeEvidence", () => {
  it("reports independent corroboration when different document families agree", () => {
    const s = synthesizeEvidence([
      { name: "Contrato de compraventa.pdf", weight: w(3, "Documento Privado"), quotes: ["se obliga a pagar $350,000.00 MXN"] },
      { name: "CFDI A-1456.xml", weight: w(3, "Registro Contable"), quotes: ["importe total $350,000.00 MXN pago recibido"] },
    ])!;
    const agreed = s.agreements.find((a) => a.kind === "amount");
    expect(agreed?.display).toContain("350,000");
    expect(agreed?.independent).toBe(true);
    expect(s.lines.join(" ")).toContain("Corroboración independiente");
  });

  it("detects a monetary discrepancy and names the prevailing source by weight", () => {
    const s = synthesizeEvidence([
      { name: "Estado de cuenta.pdf", weight: w(3, "Registro Contable"), quotes: ["pago por $350,000.00 MXN"] },
      { name: "Resolución administrativa.pdf", weight: w(5, "Documento Público"), quotes: ["saldo insoluto de $120,000.00 MXN"] },
    ])!;
    expect(s.conflicts).toHaveLength(1);
    const line = s.lines[0];
    expect(line).toContain("Discrepancia de cantidad");
    expect(line).toContain("diferencia de $230,000");
    expect(line).toContain("Resolución administrativa.pdf");
    expect(line).toContain("mayor valor probatorio");
  });

  it("says a same-tier conflict cannot be resolved by hierarchy", () => {
    const s = synthesizeEvidence([
      { name: "Contrato A.pdf", weight: w(3, "Documento Privado"), quotes: ["la cantidad de $100,000 MXN"] },
      { name: "Contrato B.pdf", weight: w(3, "Documento Privado"), quotes: ["la cantidad de $80,000 MXN"] },
    ])!;
    expect(s.conflicts[0].tie).toBe(true);
    expect(s.lines[0]).toContain("no se resuelve por jerarquía documental");
  });

  it("treats copies of the same source as duplicates, not corroboration", () => {
    const s = synthesizeEvidence([
      { name: "Contrato arrendamiento.pdf", weight: w(3, "Documento Privado"), quotes: ["$50,000 MXN"] },
      { name: "Contrato arrendamiento (copia).pdf", weight: w(3, "Documento Privado"), quotes: ["$50,000 MXN"] },
    ])!;
    expect(s.docs.some((d) => d.duplicateOf)).toBe(true);
    expect(s.agreements[0].independent).toBe(false);
    expect(s.lines.join(" ")).toContain("no incrementan la fuerza probatoria");
  });

  it("describes complementary legal acts across documents", () => {
    const s = synthesizeEvidence([
      { name: "Contrato.pdf", weight: w(3, "Documento Privado"), quotes: ["se obliga a pagar la renta mensual"] },
      { name: "Recibo de pago.pdf", weight: w(3, "Registro Contable"), quotes: ["comprobante de pago recibido de conformidad"] },
    ])!;
    expect(s.lines.join(" ")).toContain("Documentos complementarios");
  });

  it("flags an obligation with no evidence of fulfilment", () => {
    const s = synthesizeEvidence([
      { name: "Convenio.pdf", weight: w(3, "Documento Privado"), quotes: ["el deudor se obliga a pagar $10,000 MXN"] },
      { name: "Demanda.pdf", weight: w(2, "Documento Sin Clasificar"), quotes: ["el deudor se obliga a pagar $10,000 MXN"] },
    ])!;
    expect(s.lines.join(" ")).toContain("no acredita el cumplimiento");
  });

  it("never claims corroboration when the quotes yield no comparable facts", () => {
    const s = synthesizeEvidence([
      { name: "Nota A.pdf", weight: w(2, "Documento Sin Clasificar"), quotes: ["texto sin datos"] },
      { name: "Nota B.pdf", weight: w(2, "Documento Sin Clasificar"), quotes: ["otro texto distinto"] },
    ])!;
    expect(s.grounded).toBe(false);
    expect(s.narrative).toContain("no puede afirmarse");
  });

  it("is reproducible across runs", () => {
    const docs = [
      { name: "Escritura pública.pdf", weight: w(5, "Documento Público"), quotes: ["inscrito bajo folio real 12345 el 10/01/2026"] },
      { name: "Avalúo.pdf", weight: w(4, "Dictamen Pericial"), quotes: ["valor de $2,500,000 MXN al 10/01/2026"] },
    ];
    expect(JSON.stringify(synthesizeEvidence(docs)!.lines)).toBe(
      JSON.stringify(synthesizeEvidence(docs)!.lines),
    );
  });
});

describe("document graph", () => {
  it("states when another finding depends on the same document", () => {
    const findings = [
      {
        title: "Pago acreditado",
        evidence_refs: [{ filename: "Contrato.pdf", quote: "se obliga a pagar $1,000 MXN" }],
      },
      {
        title: "Cláusula penal aplicable",
        evidence_refs: [{ filename: "Contrato.pdf", quote: "pena convencional del 10%" }],
      },
    ];
    const graph = buildDocumentGraph(findings);
    const wp = buildFindingWorkProduct(findings[0], { documentLabels: ["Contrato.pdf"], graph });
    expect(wp.synthesis?.lines.join(" ")).toContain("Cláusula penal aplicable");
  });
});
