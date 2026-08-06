// =============================================================================
// UNIVERSALITY REGRESSION — the deterministic evidence-synthesis engine must
// behave identically across every Mexican materia. No case-specific tuning,
// no report-specific wording, no document-name logic.
// =============================================================================
import { describe, expect, it } from "vitest";

import { extractFacts } from "../reporting/evidence-facts";
import { synthesizeEvidence } from "../reporting/evidence-synthesis";
import {
  ALL_ACT_LABELS,
  CANONICAL_MATERIAS,
  resolveActLexicon,
  SUPPORTED_MATERIAS,
  UNIVERSAL_LEXICON,
} from "../reporting/legal-acts";

const weight = (stars: number, label: string) => ({
  stars,
  glyphs: "★".repeat(stars) + "☆".repeat(5 - stars),
  label,
});

/** Matter-typical corpora — used only as INPUT, never referenced by the engine. */
const CORPORA: Record<string, { a: string[]; b: string[] }> = {
  civil: {
    a: ["Las partes celebran el presente contrato el 03/04/2026 y el deudor se obliga a pagar $250,000.00 MXN."],
    b: ["Se notificó el requerimiento de pago el 3 de abril de 2026 por $250,000.00 MXN; existe saldo insoluto."],
  },
  familiar: {
    a: ["En el convenio de divorcio se fija pensión alimenticia por $12,000.00 MXN a partir del 01/02/2026."],
    b: ["Se resuelve la guarda y custodia y el régimen de convivencia; obra estudio psicosocial del menor de 01/02/2026."],
  },
  penal: {
    a: ["Se realizó el aseguramiento de los objetos y se llenó el registro de cadena de custodia el 10/01/2026."],
    b: ["Detención en flagrancia el 10/01/2026; se le hizo saber sus derechos y se formula imputación."],
  },
  mercantil: {
    a: ["El pagaré suscrito el 05/05/2026 ampara $80,000.00 MXN con aval de la sociedad."],
    b: ["Se levantó protesto por falta de pago del título el 05/05/2026 por $80,000.00 MXN."],
  },
  laboral: {
    a: ["Contrato individual de trabajo con fecha de ingreso 01/03/2024 y salario diario integrado de $850.00 MXN."],
    b: ["Aviso de rescisión de 15/06/2026; no obra pago de aguinaldo ni prima vacacional. Recibo de nómina por $850.00 MXN."],
  },
  administrativo: {
    a: ["Acta circunstanciada de la visita de verificación de 08/08/2026 dentro del expediente administrativo 44/2026."],
    b: ["Resolución administrativa que impone multa por $60,000.00 MXN; se notificó el 08/08/2026."],
  },
  fiscal: {
    a: ["Orden de visita domiciliaria de 02/02/2026 en ejercicio de facultades de comprobación al RFC ABC010203AB1."],
    b: ["Resolución determinante de crédito fiscal por $1,250,000.00 MXN; CFDI con UUID fiscal relacionado."],
  },
  agrario: {
    a: ["Acta de asamblea general de ejidatarios de 12/12/2025 con quórum de la asamblea acreditado."],
    b: ["Certificado parcelario inscrito ante el Registro Agrario Nacional el 12/12/2025; posesión de la parcela reconocida."],
  },
  amparo: {
    a: ["Demanda de amparo indirecto contra el acto reclamado; se concede la suspensión provisional el 07/07/2026."],
    b: ["Informe justificado de la autoridad responsable rendido el 07/07/2026; audiencia constitucional señalada."],
  },
  inmobiliario: {
    a: ["Escritura pública de compraventa número 3417 de 09/09/2025 por $4,300,000.00 MXN."],
    b: ["Certificado de libertad de gravámenes del folio real 88213 expedido el 09/09/2025."],
  },
  familiar_sucesiones: {
    a: ["Acta de defunción del autor de la sucesión de 04/04/2025 y testamento público abierto."],
    b: ["Declaración de herederos de 04/04/2025; el albacea acepta el cargo."],
  },
  ambiental: {
    a: ["Acta de inspección de PROFEPA de 06/06/2026 por descarga de aguas residuales."],
    b: ["Se ordenan medidas correctivas el 06/06/2026; obra análisis de laboratorio acreditado."],
  },
  electoral: {
    a: ["Acta de escrutinio de la casilla básica de 02/06/2026 con cómputo distrital."],
    b: ["Juicio de inconformidad promovido el 02/06/2026 contra el cómputo distrital."],
  },
  mercantil_corporativo: {
    a: ["Acta de asamblea general extraordinaria de 11/11/2025 que aprueba aumento de capital."],
    b: ["Escritura inscrita en el registro público de comercio el 11/11/2025 respecto del aumento de capital."],
  },
  consumidor: {
    a: ["Contrato de adhesión y ticket de compra de 20/10/2025 por $9,500.00 MXN."],
    b: ["Queja del consumidor ante PROFECO de 20/10/2025 por negativa de garantía."],
  },
  propiedad_intelectual: {
    a: ["Registro de marca ante el IMPI con expediente 2231456 de 15/03/2024."],
    b: ["Uso no autorizado del signo confundible detectado el 15/03/2024."],
  },
};

describe("legal-act registry universality", () => {
  it("declares a lexicon layer for every canonical materia", () => {
    for (const m of CANONICAL_MATERIAS) {
      expect(SUPPORTED_MATERIAS, `missing lexicon for ${m}`).toContain(m);
    }
  });

  it("every materia inherits the universal procedural acts", () => {
    for (const m of SUPPORTED_MATERIAS) {
      const keys = new Set(resolveActLexicon(m).acts.map((a) => a.act));
      for (const u of UNIVERSAL_LEXICON.acts) {
        expect(keys, `${m} lost universal act ${u.act}`).toContain(u.act);
      }
    }
  });

  it("every act, sequence and gap references declared acts and has a Spanish label", () => {
    for (const m of [...SUPPORTED_MATERIAS, "unknown_materia", ""]) {
      const lex = resolveActLexicon(m);
      const keys = new Set(lex.acts.map((a) => a.act));
      for (const a of lex.acts) {
        expect(ALL_ACT_LABELS[a.act]).toBeTruthy();
        expect(a.label.length).toBeGreaterThan(3);
      }
      for (const s of lex.sequences) {
        expect(keys).toContain(s.from);
        expect(keys).toContain(s.to);
      }
      for (const g of lex.gaps) {
        expect(keys).toContain(g.act);
        for (const n of g.needs) expect(keys).toContain(n);
      }
    }
  });

  it("unknown materia degrades to the universal lexicon, never to nothing", () => {
    const lex = resolveActLexicon("materia_inexistente");
    expect(lex.acts.length).toBe(UNIVERSAL_LEXICON.acts.length);
  });
});

describe("synthesis behaves consistently across every matter type", () => {
  for (const [materia, corpus] of Object.entries(CORPORA)) {
    it(`${materia}: produces grounded, matter-adapted synthesis`, () => {
      const s = synthesizeEvidence(
        [
          { name: "Documento A.pdf", weight: weight(5, "Documento Público"), quotes: corpus.a },
          { name: "Documento B.pdf", weight: weight(3, "Documento Privado"), quotes: corpus.b },
        ],
        { caseType: materia },
      );
      expect(s).not.toBeNull();
      // Same analytical shape for every materia.
      expect(s!.docs).toHaveLength(2);
      expect(s!.narrative.length).toBeGreaterThan(40);
      expect(s!.grounded).toBe(true);
      // At least one legal fact of the matter's own vocabulary was detected.
      const acts = s!.docs.flatMap((d) => d.facts.filter((f) => f.kind === "act"));
      expect(acts.length, `${materia} detected no legal acts`).toBeGreaterThan(0);
      // No engine output may name a document-specific or sample-specific rule.
      expect(JSON.stringify(s!.lines)).not.toMatch(/demo|sample|ejemplo de prueba/i);
    });
  }

  it("matter vocabulary changes with materia while methodology stays constant", () => {
    const quotes = CORPORA.penal.a;
    const penal = extractFacts(quotes, "penal").filter((f) => f.kind === "act").map((f) => f.act);
    const civil = extractFacts(quotes, "civil").filter((f) => f.kind === "act").map((f) => f.act);
    expect(penal).toContain("cadena_custodia");
    expect(civil).not.toContain("cadena_custodia");
    // Non-act fact kinds are identical regardless of materia.
    const kinds = (m: string) =>
      extractFacts(quotes, m).filter((f) => f.kind !== "act").map((f) => `${f.kind}|${f.key}`);
    expect(kinds("penal")).toEqual(kinds("civil"));
  });

  it("is deterministic: identical input yields byte-identical output", () => {
    const docs = [
      { name: "A.pdf", weight: weight(4, "Documento Público"), quotes: CORPORA.fiscal.a },
      { name: "B.pdf", weight: weight(2, "Documento Privado"), quotes: CORPORA.fiscal.b },
    ];
    expect(JSON.stringify(synthesizeEvidence(docs, { caseType: "fiscal" }))).toBe(
      JSON.stringify(synthesizeEvidence(docs, { caseType: "fiscal" })),
    );
  });

  it("detects conflicts, weight hierarchy and duplicates identically in any materia", () => {
    for (const materia of ["civil", "laboral", "agrario", "amparo"]) {
      const s = synthesizeEvidence(
        [
          {
            name: "Escritura pública.pdf",
            weight: weight(5, "Documento Público"),
            quotes: ["El importe pactado asciende a $100,000.00 MXN el 01/01/2026."],
          },
          {
            name: "Recibo privado.pdf",
            weight: weight(2, "Documento Privado"),
            quotes: ["El importe pactado asciende a $90,000.00 MXN el 01/01/2026."],
          },
          {
            name: "Escritura pública (copia certificada).pdf",
            weight: weight(5, "Documento Público"),
            quotes: ["El importe pactado asciende a $100,000.00 MXN el 01/01/2026."],
          },
        ],
        { caseType: materia },
      );
      const text = s!.lines.join(" ");
      expect(text, materia).toMatch(/Discrepancia de cantidad/);
      expect(text, materia).toMatch(/mayor valor probatorio/);
      expect(text, materia).toMatch(/Evidencia duplicada/);
    }
  });
});
