// =============================================================================
// ATTORNEY WORK PRODUCT LAYER (NYRAVA México) — pure, deterministic module.
//
// Turns the verified findings the pipeline already produced into case-
// preparation work product a Mexican attorney can act on:
//
//   · Importancia Estratégica        — why the finding matters (2–4 paragraphs)
//   · Síntesis Probatoria            — how multiple documents corroborate it
//   · Evidencia Pendiente            — what the record does not contain
//   · Próximas Acciones Recomendadas — 3–7 investigative / document steps
//   · Peso probatorio (★)            — Mexican evidentiary reliability tiers
//   · Agrupación por categoría de revisión y Snapshot del Expediente
//
// NO model calls, NO speculation, NO predictions. Every sentence is built
// from fields already verified upstream (title, description,
// legal_significance, potential_impact, severity, confidence, evidence
// refs) plus the document inventory actually present in the case. If an
// input is absent, the corresponding sentence is omitted — never invented.
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  buildDocumentGraph,
  synthesizeEvidence,
  type DocumentGraph,
  type EvidenceSynthesis,
} from "./evidence-synthesis";

export { buildDocumentGraph };
export type { DocumentGraph };

export type EvidenceWeight = {
  /** 1–5 — evidentiary reliability under Mexican practice, not AI confidence. */
  stars: number;
  /** Star glyphs, e.g. "★★★★☆". */
  glyphs: string;
  /** e.g. "Documento Público". */
  label: string;
};

export type FindingSourceDoc = {
  name: string;
  weight: EvidenceWeight;
  /** Verbatim excerpts cited from this document, used for fact comparison. */
  quotes: string[];
};

export type FindingWorkProduct = {
  /** Importancia Estratégica — 2–4 paragraphs. */
  importance: string[];
  /** Síntesis Probatoria — deterministic cross-document comparison. */
  synthesis:
    | { docs: FindingSourceDoc[]; narrative: string; lines: string[]; grounded: boolean }
    | null;
  /** Full structured synthesis (agreements / conflicts) for callers that need it. */
  synthesisDetail: EvidenceSynthesis | null;
  /** Evidencia Pendiente o No Localizada. */
  pending: string[];
  /** Próximas Acciones Recomendadas — 3–7 items. */
  actions: string[];
  /** Attorney-facing review group. */
  group: AttorneyGroupKey;
};

export type AttorneyGroupKey =
  | "criticas"
  | "procesales"
  | "favorable"
  | "contradictoria"
  | "vacios"
  | "revision";

export const ATTORNEY_GROUPS: Array<{ key: AttorneyGroupKey; label: string }> = [
  { key: "criticas", label: "Cuestiones Críticas" },
  { key: "procesales", label: "Riesgos Procesales" },
  { key: "contradictoria", label: "Evidencia Contradictoria" },
  { key: "vacios", label: "Vacíos Probatorios" },
  { key: "favorable", label: "Evidencia Favorable" },
  { key: "revision", label: "Aspectos que Requieren Revisión Profesional" },
];

export const METHODOLOGY_STATEMENT =
  "Todos los hallazgos de este reporte se derivan exclusivamente de los documentos cargados al expediente, " +
  "de la evidencia verificada dentro de ese corpus y del contexto jurídico mexicano aplicable. NYRAVA no inventa " +
  "hechos, no predice resultados judiciales, no sustituye el criterio del abogado ni proporciona asesoría legal. " +
  "Los hallazgos tienen por objeto asistir a profesionales del derecho organizando la evidencia e identificando " +
  "los puntos que requieren revisión adicional.";

// ---------------------------------------------------------------- utilities

function norm(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stars(n: number): string {
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

function weight(n: number, label: string): EvidenceWeight {
  return { stars: n, glyphs: stars(n), label };
}

/** Mexican evidentiary reliability tiers, matched against a document label. */
const WEIGHT_RULES: Array<{ re: RegExp; w: EvidenceWeight }> = [
  {
    re: /(sentencia|resolucion|laudo|auto de|acuerdo judicial|interlocutoria|ejecutoria)/,
    w: weight(5, "Resolución Judicial"),
  },
  {
    re: /(escritura publica|registro publico|acta constitutiva|documento publico|oficio|constancia oficial|acta de audiencia|acta circunstanciada|caratula|expediente administrativo)/,
    w: weight(5, "Documento Público"),
  },
  {
    re: /(copia certificada|certificad|notarial|fe publica|apostilla)/,
    w: weight(4, "Documento Certificado"),
  },
  { re: /(dictamen|pericial|peritaje|avaluo)/, w: weight(4, "Dictamen Pericial") },
  {
    re: /(cfdi|factura|estado de cuenta|contabilidad|nomina|recibo|poliza contable|balance|estados financieros)/,
    w: weight(3, "Registro Contable"),
  },
  {
    re: /(contrato|convenio|pagare|titulo de credito|adenda|clausulado)/,
    w: weight(3, "Documento Privado"),
  },
  {
    re: /(correo|email|e-mail|whatsapp|mensaje|chat|captura de pantalla|sms)/,
    w: weight(2, "Comunicación Electrónica"),
  },
  {
    re: /(testimonial|testimonio|declaracion|entrevista|manifestacion|comparecencia)/,
    w: weight(1, "Declaración No Corroborada"),
  },
];

export function classifyEvidenceWeight(label: string): EvidenceWeight {
  const n = norm(label);
  for (const rule of WEIGHT_RULES) if (rule.re.test(n)) return rule.w;
  return weight(2, "Documento Sin Clasificar");
}

const MATERIA_LABELS: Record<string, string> = {
  penal: "penal",
  penal_adolescentes: "penal para adolescentes",
  civil: "civil",
  general_civil: "civil",
  mercantil: "mercantil",
  mercantil_concursal: "concursal",
  mercantil_corporativo: "corporativa",
  laboral: "laboral",
  familiar: "familiar",
  familiar_sucesiones: "sucesoria",
  amparo: "de amparo",
  constitucional: "constitucional",
  fiscal: "fiscal",
  administrativo: "administrativa",
  agrario: "agraria",
  ambiental: "ambiental",
  migratorio: "migratoria",
  electoral: "electoral",
  consumidor: "de protección al consumidor",
  inmobiliario: "inmobiliaria",
  propiedad_intelectual: "de propiedad intelectual",
  maritimo: "marítima",
};

export function materiaLabel(caseType?: string | null): string {
  const k = norm(caseType ?? "").replace(/[^a-z_]/g, "");
  return MATERIA_LABELS[k] ?? "";
}

const SEVERITY_ES: Record<string, string> = {
  critical: "crítica",
  high: "alta",
  medium: "media",
  low: "baja",
  info: "informativa",
};

// ------------------------------------------------------------------ context

export type WorkProductContext = {
  /** Every document label in the case file (filenames / titles). */
  documentLabels: string[];
  /** Materia key, e.g. "laboral". */
  caseType?: string | null;
  /** Corpus-level missing documents already detected upstream. */
  missingDocuments?: string[];
  /** Cross-finding document index (buildDocumentGraph), for shared-source statements. */
  graph?: DocumentGraph;
};

type AnyFinding = Record<string, any>;

/** Cited documents with the verbatim quotes attributed to each one. */
function findingSourceDocs(f: AnyFinding): Array<{ name: string; quotes: string[] }> {
  const refs = Array.isArray(f.evidence_refs) ? f.evidence_refs : [];
  const byName = new Map<string, string[]>();
  for (const r of refs) {
    const label = String(r?.filename ?? r?.label ?? r?.document_title ?? "").trim();
    if (!label) continue;
    const quote = String(r?.quote ?? r?.excerpt ?? r?.snippet ?? r?.text ?? "").trim();
    const arr = byName.get(label) ?? [];
    if (quote && !arr.includes(quote)) arr.push(quote);
    byName.set(label, arr);
  }
  return [...byName.entries()].map(([name, quotes]) => ({ name, quotes }));
}

function findingText(f: AnyFinding): string {
  return norm(
    [f.title, f.description, f.legal_significance, f.potential_impact, f.category]
      .filter(Boolean)
      .join(" \n "),
  );
}

// --------------------------------------------------------------- grouping

const PROCEDURAL_RE =
  /(procesal|procedimiento|notificacion|emplazamiento|plazo|termino|caducidad|prescripcion|competencia|nulidad|formalidad|cumplimiento_procesal|requisito)/;
const CONTRADICTION_RE = /(contradiccion|contradictor|inconsistencia|discrepancia|divergencia)/;
const GAP_RE =
  /(vacio|faltante|missing|discovery_gap|no localizad|ausencia|omision|no se exhib|no consta)/;
const FAVORABLE_RE = /(corrobora|acredita|respalda|sustenta|favorable|exculpator)/;

export function groupForFinding(f: AnyFinding): AttorneyGroupKey {
  const cat = norm(f.category ?? "");
  const text = findingText(f);
  const sev = norm(f.severity ?? "");
  if (CONTRADICTION_RE.test(cat) || CONTRADICTION_RE.test(text)) return "contradictoria";
  if (GAP_RE.test(cat) || GAP_RE.test(text)) return "vacios";
  if (PROCEDURAL_RE.test(cat) || PROCEDURAL_RE.test(text)) return "procesales";
  if (sev === "critical" || sev === "high") return "criticas";
  const conf = Number(f.confidence ?? 0);
  if (FAVORABLE_RE.test(text) && conf >= 0.7) return "favorable";
  return "revision";
}

// ------------------------------------------------------- per-finding output

const PENDING_RULES: Array<{ mention: RegExp; corpus: RegExp; text: string }> = [
  {
    mention: /(contrato|convenio|clausul)/,
    corpus: /(contrato|convenio)/,
    text: "No se localizó en el expediente un contrato o convenio firmado que documente la relación referida.",
  },
  {
    mention: /(cfdi|factura|pago|nomina|honorario)/,
    corpus: /(cfdi|factura|nomina|recibo|estado de cuenta)/,
    text: "No se localizaron CFDI, recibos o registros contables que respalden los movimientos referidos.",
  },
  {
    mention: /(notificacion|emplazamiento|acuse)/,
    corpus: /(acuse|notificacion|emplazamiento|cedula)/,
    text: "No se localizó el acuse de notificación correspondiente.",
  },
  {
    mention: /(pericial|dictamen|peritaje)/,
    corpus: /(dictamen|pericial|peritaje)/,
    text: "No se localizó dictamen pericial relacionado con el punto analizado.",
  },
  {
    mention: /(avaluo|valor comercial|inmueble)/,
    corpus: /(avaluo)/,
    text: "No se localizó avalúo del bien referido.",
  },
  {
    mention: /(certificad|original|cotejo)/,
    corpus: /(copia certificada|certificad|notarial)/,
    text: "No se localizó copia certificada del documento referido; el corpus solo contiene versiones simples.",
  },
  {
    mention: /(autoridad|administrativ|sat|imss|infonavit|impi|inm|profeco|comar)/,
    corpus: /(expediente administrativo)/,
    text: "No consta el expediente administrativo completo remitido por la autoridad.",
  },
];

function buildPending(f: AnyFinding, ctx: WorkProductContext): string[] {
  const text = findingText(f);
  const corpus = norm(ctx.documentLabels.join(" | "));
  const out: string[] = [];
  for (const rule of PENDING_RULES) {
    if (rule.mention.test(text) && !rule.corpus.test(corpus)) out.push(rule.text);
  }
  for (const m of ctx.missingDocuments ?? []) {
    const key = norm(m)
      .split(/\s+/)
      .filter((w) => w.length > 5)[0];
    if (key && text.includes(key)) out.push(`No obra en el expediente: ${m}.`);
  }
  return Array.from(new Set(out)).slice(0, 5);
}

function buildActions(f: AnyFinding, docs: FindingSourceDoc[], pending: string[]): string[] {
  const text = findingText(f);
  const cat = norm(f.category ?? "");
  const top = docs[0];
  const actions: string[] = [];

  if (top) {
    actions.push(`Verificar en el expediente el documento fuente citado: ${top.name}.`);
    if (top.weight.stars < 4)
      actions.push(`Obtener copia certificada de ${top.name} para elevar su valor probatorio.`);
    if (top.weight.stars <= 2)
      actions.push(
        "Confirmar la autenticidad del soporte documental (ratificación, certificación notarial o cotejo con el original).",
      );
  } else {
    actions.push(
      "Identificar y adjuntar al expediente el documento fuente que sustenta este hallazgo.",
    );
  }
  if (CONTRADICTION_RE.test(cat) || CONTRADICTION_RE.test(text))
    actions.push(
      "Comparar de manera directa los documentos contradictorios y documentar cuál tiene mayor valor probatorio.",
    );
  if (/(cadena|custodia|traslado|resguardo)/.test(text))
    actions.push(
      "Revisar la cadena documental completa, desde el origen del documento hasta su incorporación al expediente.",
    );
  if (/(cfdi|factura|contabilidad|nomina|pago)/.test(text))
    actions.push(
      "Revisar los CFDI y registros contables relacionados con las cantidades referidas.",
    );
  if (/(notificacion|emplazamiento|acuse)/.test(text))
    actions.push("Confirmar los acuses de notificación y su constancia en autos.");
  if (/(plazo|termino|fecha|caducidad|prescripcion)/.test(text))
    actions.push(
      "Confirmar las fechas procesales aplicables contra las constancias del expediente.",
    );
  if (/(autoridad|administrativ|sat|imss|infonavit|impi|inm|profeco|comar)/.test(text))
    actions.push("Solicitar el expediente administrativo completo a la autoridad correspondiente.");
  if (pending.length)
    actions.push(
      "Solicitar o localizar la documentación pendiente identificada para este hallazgo.",
    );
  if (docs.length <= 1)
    actions.push(
      "Localizar evidencia adicional e independiente que corrobore el hallazgo dentro del expediente.",
    );

  const unique = Array.from(new Set(actions));
  if (unique.length < 3)
    unique.push(
      "Cotejar el hallazgo con el resto de las constancias del expediente antes de utilizarlo.",
    );
  if (unique.length < 3)
    unique.push("Someter el hallazgo a revisión del abogado responsable del asunto.");
  return unique.slice(0, 7);
}

function buildImportance(
  f: AnyFinding,
  docs: FindingSourceDoc[],
  ctx: WorkProductContext,
  detail: EvidenceSynthesis | null,
): string[] {
  const paras: string[] = [];
  const materia = materiaLabel(ctx.caseType);
  const sev = SEVERITY_ES[norm(f.severity ?? "")] ?? "media";
  const conf = Number(f.confidence ?? 0);
  const cat = String(f.category ?? "").replace(/_/g, " ");
  const text = findingText(f);

  const p1 =
    `El hallazgo se clasifica con gravedad ${sev}` +
    (cat ? ` dentro de la categoría de ${cat}` : "") +
    (materia ? ` en un asunto en materia ${materia}` : "") +
    ". " +
    (f.legal_significance
      ? String(f.legal_significance)
      : "Su relevancia deriva de que el punto descrito está sustentado en constancias que ya obran en el expediente.");
  paras.push(p1);

  const strongest = docs[0];
  const dir = norm(f.impact_direction ?? "");
  const effect =
    dir === "strengthens"
      ? "refuerza la posición probatoria de la parte a la que beneficia"
      : dir === "weakens"
        ? "debilita el sustento probatorio del punto controvertido"
        : "modifica el peso probatorio que puede atribuirse al punto controvertido";
  const p2 =
    docs.length > 0
      ? `Con base en las fuentes que lo sustentan (${docs.length} documento(s); el de mayor peso probatorio es ` +
        `${strongest.name} — ${strongest.weight.label} ${strongest.weight.glyphs}), el hallazgo ${effect}. ` +
        // Corroboration is asserted only when the extracted facts actually
        // agree across documents — never inferred from document count.
        (docs.length === 1
          ? "Al descansar en una sola fuente, su fuerza probatoria depende de que se localice corroboración independiente."
          : detail?.conflicts.length
            ? `Los documentos citados divergen en ${detail.conflicts.length} dato(s) concreto(s), por lo que la discrepancia debe resolverse antes de apoyarse en el hallazgo.`
            : detail?.agreements.some((a) => a.independent)
              ? "Los datos extraídos coinciden entre documentos de distinta naturaleza probatoria, lo que constituye corroboración independiente del punto."
              : detail?.agreements.length
                ? "Los datos extraídos coinciden entre documentos de la misma naturaleza probatoria, lo que constituye soporte acumulativo y no corroboración independiente."
                : "Los pasajes citados no contienen datos concretos comparables entre sí, por lo que no puede afirmarse que las fuentes se corroboren entre ellas.")
      : `El hallazgo ${effect}; sin embargo, no se identificó en el expediente una fuente documental citada de manera directa, ` +
        "por lo que su valor probatorio no puede considerarse acreditado en este estado del expediente.";
  paras.push(p2);

  if (PROCEDURAL_RE.test(text)) {
    paras.push(
      "El hallazgo plantea además una cuestión de orden procesal: incide en formalidades, plazos o constancias del " +
        "procedimiento cuya verificación en autos debe realizarse antes de cualquier actuación que dependa de ellas.",
    );
  } else if (f.potential_impact) {
    paras.push(String(f.potential_impact));
  }

  const needsReview =
    conf < 0.75 || docs.length <= 1 || String(f.verification_status ?? "") === "disputed";
  paras.push(
    needsReview
      ? "Se requiere revisión profesional antes de apoyarse en este hallazgo: el sustento documental es limitado o su " +
          "confiabilidad no alcanza el nivel más alto que el sistema puede confirmar contra el corpus."
      : "El hallazgo cuenta con sustento documental múltiple y confiabilidad alta dentro del corpus analizado; " +
          "corresponde al abogado confirmar su vigencia procesal antes de utilizarlo.",
  );

  return paras.slice(0, 4);
}

function buildSynthesis(
  f: AnyFinding,
  docs: FindingSourceDoc[],
  ctx: WorkProductContext,
): { synthesis: FindingWorkProduct["synthesis"]; detail: EvidenceSynthesis | null } {
  if (!docs.length) return { synthesis: null, detail: null };
  const detail = synthesizeEvidence(docs, {
    graph: ctx.graph,
    findingTitle: String(f.title ?? "").trim(),
  });
  if (!detail) return { synthesis: null, detail: null };
  return {
    synthesis: {
      docs,
      narrative: detail.narrative,
      lines: detail.lines,
      grounded: detail.grounded,
    },
    detail,
  };
}

export function buildFindingWorkProduct(
  f: AnyFinding,
  ctx: WorkProductContext,
): FindingWorkProduct {
  const docs: FindingSourceDoc[] = findingSourceDocs(f)
    .map((d) => ({ ...d, weight: classifyEvidenceWeight(d.name) }))
    .sort((a, b) => b.weight.stars - a.weight.stars);
  const pending = buildPending(f, ctx);
  const { synthesis, detail } = buildSynthesis(f, docs, ctx);
  return {
    importance: buildImportance(f, docs, ctx, detail),
    synthesis,
    synthesisDetail: detail,
    pending,
    actions: buildActions(f, docs, pending),
    group: groupForFinding(f),
  };
}

// --------------------------------------------------------- case snapshot

export type CaseSnapshot = {
  strengths: string[];
  weaknesses: string[];
  criticalEvidence: string[];
  missingEvidence: string[];
  proceduralConcerns: string[];
  priorityReview: string[];
};

function title(f: AnyFinding): string {
  return String(f.title ?? "").trim();
}

export function buildCaseSnapshot(findings: AnyFinding[], ctx: WorkProductContext): CaseSnapshot {
  const enriched = findings.map((f) => ({ f, wp: buildFindingWorkProduct(f, ctx) }));

  // Strength = facts that agree across documents of different evidentiary
  // families, not simply several documents attached to the finding.
  const strengths = enriched
    .filter(
      ({ wp }) =>
        !wp.synthesisDetail?.conflicts.length &&
        (wp.synthesisDetail?.agreements.some((a) => a.independent) ?? false),
    )
    .slice(0, 5)
    .map(({ f, wp }) => {
      const a = wp.synthesisDetail!.agreements.find((x) => x.independent)!;
      return `${title(f)} — «${a.display}» corroborado de forma independiente por ${a.docs.length} documentos (${wp.synthesis!.docs[0].weight.label}).`;
    });

  const weaknesses = enriched
    .filter(
      ({ f, wp }) =>
        (wp.synthesis?.docs.length ?? 0) <= 1 ||
        Number(f.confidence ?? 0) < 0.6 ||
        (wp.synthesisDetail?.conflicts.length ?? 0) > 0 ||
        !(wp.synthesisDetail?.agreements.length ?? 0),
    )
    .slice(0, 5)
    .map(({ f, wp }) => {
      const d = wp.synthesisDetail;
      if (d?.conflicts.length)
        return `${title(f)} — los documentos citados divergen en ${d.conflicts.length} dato(s) concreto(s).`;
      if (!wp.synthesis?.docs.length)
        return `${title(f)} — sin fuente documental citada de manera directa.`;
      if (wp.synthesis.docs.length === 1)
        return `${title(f)} — fuente documental única (${wp.synthesis.docs[0].weight.label}).`;
      return `${title(f)} — sin datos concretos coincidentes entre los pasajes citados.`;
    });

  const docWeights = ctx.documentLabels
    .map((name) => ({ name, w: classifyEvidenceWeight(name) }))
    .sort((a, b) => b.w.stars - a.w.stars);
  const criticalEvidence = docWeights
    .filter((d) => d.w.stars >= 4)
    .slice(0, 6)
    .map((d) => `${d.w.glyphs} ${d.w.label} — ${d.name}`);

  const missingEvidence = Array.from(
    new Set([...(ctx.missingDocuments ?? []), ...enriched.flatMap(({ wp }) => wp.pending)]),
  ).slice(0, 8);

  const proceduralConcerns = enriched
    .filter(({ wp }) => wp.group === "procesales")
    .slice(0, 5)
    .map(({ f }) => title(f));

  const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const priorityReview = [...enriched]
    .sort(
      (a, b) =>
        (sevOrder[norm(a.f.severity ?? "")] ?? 9) - (sevOrder[norm(b.f.severity ?? "")] ?? 9),
    )
    .slice(0, 5)
    .map(({ f }) => `${title(f)} (gravedad ${SEVERITY_ES[norm(f.severity ?? "")] ?? "media"}).`);

  return {
    strengths,
    weaknesses,
    criticalEvidence,
    missingEvidence,
    proceduralConcerns,
    priorityReview,
  };
}

export type SnapshotQuestion = { question: string; answer: string; bullets?: string[] };

/** The five questions the executive summary must answer within the first page. */
export function buildExecutiveQuestions(
  findings: AnyFinding[],
  ctx: WorkProductContext,
  snapshot: CaseSnapshot,
): SnapshotQuestion[] {
  const materia = materiaLabel(ctx.caseType);
  const docCount = ctx.documentLabels.length;
  const n = findings.length;
  const out: SnapshotQuestion[] = [
    {
      question: "¿De qué trata el asunto?",
      answer:
        `Expediente${materia ? ` en materia ${materia}` : ""} integrado por ${docCount} documento(s) analizados, ` +
        `de los cuales se derivaron ${n} hallazgo(s) verificado(s) contra el corpus.`,
    },
    {
      question: "¿Cuál es la evidencia más sólida?",
      answer: snapshot.criticalEvidence.length
        ? "Los documentos de mayor valor probatorio localizados en el expediente son:"
        : "No se localizaron documentos públicos, resoluciones judiciales, documentos certificados ni dictámenes periciales dentro del corpus.",
      bullets: snapshot.criticalEvidence,
    },
    {
      question: "¿Cuáles son las áreas más débiles?",
      answer: snapshot.weaknesses.length
        ? "Los siguientes hallazgos descansan en fuente única o en soporte documental de menor confiabilidad:"
        : "No se identificaron hallazgos sustentados en fuente única dentro del corpus analizado.",
      bullets: snapshot.weaknesses,
    },
    {
      question: "¿Qué evidencia relevante parece faltar?",
      answer: snapshot.missingEvidence.length
        ? "Con base en el inventario documental actual, no se localizó lo siguiente:"
        : "Con base en el inventario documental actual no se detectó documentación faltante relevante.",
      bullets: snapshot.missingEvidence,
    },
    {
      question: "¿Qué debe revisar primero el abogado?",
      answer: snapshot.priorityReview.length
        ? "Orden de revisión sugerido conforme a la gravedad de los hallazgos:"
        : "No hay hallazgos priorizados pendientes de revisión.",
      bullets: snapshot.priorityReview,
    },
  ];
  return out;
}
