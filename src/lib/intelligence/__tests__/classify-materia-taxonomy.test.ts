// Regression test for a real bug found on a completed-case audit (ADR
// 4640/2017, Fabiola Romo Hernández, materia "amparo"): MATERIA_CATEGORY_RULES
// had an empty "amparo" registry slot, so every amparo finding — debido
// proceso, seguridad jurídica, procedencia, doble instancia — fell through
// UNIVERSAL_CATEGORY_RULES (criminal-evidence vocabulary) to
// LEGACY_CATEGORY_ALIAS, which mislabeled the finding using the PRODUCING
// AGENT's own hardcoded default category (e.g. witness_credibility agent →
// category:"witness" → displayed as "Testimonio de Testigo") regardless of
// what the finding actually said. A due-process holding about an amparo
// petitioner's argument being inoperante was shown to the attorney as
// "Testimonio de Testigo" / "Cadena de Custodia".
//
// Two independent fixes, both covered here:
//   1. MATERIA_CATEGORY_RULES.amparo now carries real amparo vocabulary, so
//      genuine amparo content is classified BEFORE ever reaching the
//      criminal-evidence universal layer or the alias fallback.
//   2. The alias fallback no longer overwrites the human-facing `category`
//      label with the producing agent's raw default bucket name — only
//      `category_key` (a machine token existing consumers already filter
//      on) still resolves through it. Unmatched content now shows the
//      honest "Hallazgo General" label instead of a specific, wrong one.
import { describe, it, expect } from "vitest";
import {
  rankAndClassify,
  classifyCategory,
  classifyCategoryKey,
  classifyFinding,
} from "../classify.server";

describe("materia-aware category taxonomy: amparo", () => {
  it("classifies real amparo/constitutional content into amparo-specific categories, not criminal-evidence ones", () => {
    const cases: Array<{ title: string; description: string; expectedKey: string }> = [
      {
        title: "Argumento sobre debido proceso inoperante",
        description:
          "El argumento de la recurrente sobre la violación de su derecho al debido proceso fue considerado inoperante por no haber sido planteado en la demanda de amparo.",
        expectedKey: "debido_proceso",
      },
      {
        title: "Elemento no identificado en el corpus: Acto reclamado precisado",
        description:
          'No se identificó una argumentación expresa y desarrollada sobre "Acto reclamado precisado" en los documentos proporcionados.',
        expectedKey: "procedencia_amparo",
      },
      {
        title: "Inconstitucionalidad del Artículo 83 del Código de Procedimientos Civiles",
        description:
          "La resolución analiza la constitucionalidad del artículo 83 en relación con la seguridad jurídica y la debida fundamentación y motivación de las sentencias de apelación.",
        expectedKey: "seguridad_juridica",
      },
      {
        title: "Derecho a la doble instancia",
        description:
          "Se plantea si el recurso disponible garantiza el acceso a la justicia y un recurso efectivo.",
        expectedKey: "doble_instancia_acceso_justicia",
      },
    ];
    for (const c of cases) {
      expect(classifyCategoryKey(c, "amparo")).toBe(c.expectedKey);
    }
  });

  it("does NOT fall back to criminal-evidence categories for amparo materia content that used to hit the universal layer", () => {
    const f = {
      title: "Inoperancia de Agravios Nuevos",
      description:
        "Se determina que los agravios relacionados con el debido proceso son inoperantes por no haber sido planteados en la demanda de amparo.",
    };
    const label = classifyCategory(f, "es", "amparo");
    expect(label).not.toBe("Testimonio de Testigo");
    expect(label).not.toBe("Cadena de Custodia");
    expect(label).toBe("Debido Proceso");
  });
});

describe("rankAndClassify: agent default category no longer overwrites the display label on a content mismatch", () => {
  it("a witness_credibility-agent finding about due process gets an honest generic label, not 'Testimonio de Testigo'", () => {
    const rows = [
      {
        title: "Argumento sobre debido proceso inoperante",
        description:
          "El argumento de la recurrente sobre la violación de su derecho al debido proceso fue considerado inoperante.",
        // The agent's own hardcoded default bucket (AGENTS array,
        // pipeline.server.ts) — NOT a content-derived category.
        category: "witness",
        severity: "medium" as const,
      },
    ];
    const [out] = rankAndClassify(rows, "es", "amparo");
    expect(out.category).toBe("Debido Proceso");
    expect(out.category).not.toBe("Testimonio de Testigo");
  });

  it("content that matches nothing at all still resolves category_key through the legacy alias (existing machine consumers unaffected), while the display label stays generic and honest", () => {
    const rows = [
      {
        title: "Punto sin vocabulario reconocido",
        description: "Texto genérico que no contiene ningún término de la taxonomía.",
        category: "witness",
        severity: "low" as const,
      },
    ];
    const [out] = rankAndClassify(rows, "es", "amparo");
    expect(out.category).toBe("Hallazgo General");
    expect(out.category_key).toBe("witness");
  });

  it("real amparo content still gets classified correctly regardless of which agent's default category label arrives in the raw field", () => {
    const rows = [
      {
        title: "Transcripción de agravios no es requisito formal",
        description:
          "La resolución establece que la certeza de que la autoridad judicial analiza los argumentos no depende de la transcripción de los agravios.",
        category: "chain_of_custody",
        severity: "medium" as const,
      },
    ];
    const [out] = rankAndClassify(rows, "es", "amparo");
    expect(out.category).not.toBe("Cadena de Custodia");
  });
});

describe("classifyFinding: affected_party is not stamped 'prosecution'/'defense' outside penal matters", () => {
  // Regression test for a real bug found on the ADR 4640/2017 rerun: a
  // CIVIL apelación finding about "debido proceso" was rendered in the PDF
  // as "PARTE: Ministerio Público" — a party that does not exist in a civil
  // amparo case. Root cause: classify.server.ts's RULES table matches on
  // vocabulary that appears in every materia (e.g. "debido proceso" is not
  // penal-exclusive) but unconditionally assigned affected_party:
  // "prosecution"/"defense", a purely criminal-adversarial framing that
  // report-i18n.ts's glossary then rendered as the Spanish criminal-law
  // term. classifyFinding() now only applies that framing for materia
  // "penal" — everywhere else it returns "neutral", so rankAndClassify
  // falls back to the engine's own value (or omits the party line
  // entirely) instead of fabricating a criminal-only role.
  const dueProcessFinding = {
    title: "Argumento sobre debido proceso inoperante",
    description:
      "El argumento de la recurrente sobre la violación de su derecho al debido proceso fue considerado inoperante.",
    category: "witness",
  };

  it("does not assign 'prosecution' for a civil/amparo materia", () => {
    expect(classifyFinding(dueProcessFinding, "amparo").affected_party).toBe("neutral");
    expect(classifyFinding(dueProcessFinding, "civil").affected_party).toBe("neutral");
    expect(classifyFinding(dueProcessFinding, "laboral").affected_party).toBe("neutral");
  });

  it("still assigns 'prosecution' for a genuine penal matter", () => {
    expect(classifyFinding(dueProcessFinding, "penal").affected_party).toBe("prosecution");
  });

  it("rankAndClassify never surfaces a fabricated 'Ministerio Público' party on a civil amparo finding", () => {
    const [out] = rankAndClassify(
      [{ ...dueProcessFinding, severity: "medium" as const }],
      "es",
      "amparo",
    );
    expect(out.affected_party).not.toBe("prosecution");
  });
});
