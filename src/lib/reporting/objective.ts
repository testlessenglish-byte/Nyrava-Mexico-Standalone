// =============================================================================
// Goal-first reporting layer.
//
// Every Nyrava report must open by answering the attorney's PRIMARY question
// for that materia — not by summarising the documents. This module is the
// deterministic registry + builder behind that behaviour.
//
// Hard rules:
//   - Pure, client-safe, no AI, no DB. Every sentence it emits is assembled
//     from signals the pipeline already verified.
//   - Never speculates. When the evidence is insufficient, it says so and
//     names what is missing instead of guessing an answer.
//   - It does NOT add a report section (the 17-section canonical contract is
//     frozen); it enriches ExecutiveSummary / Recommendations rendering.
// =============================================================================

import { MX_CASE_TYPE_LABELS, isMexicanCaseType, type MexicanCaseType } from "@/lib/jurisdiction/mexico-types";

export type ObjectiveLocale = "es" | "en";

export type Bilingual = { es: string; en: string };

export type MateriaObjective = {
  /** The single question the attorney opened this matter to answer. */
  question: Bilingual;
  /** How a positive / supported answer is phrased for this materia. */
  favorable: Bilingual;
  /** How an adverse / weak posture is phrased for this materia. */
  adverse: Bilingual;
  /** Mixed posture phrasing. */
  mixed: Bilingual;
  /** What the attorney is expected to DO next in this materia. */
  actionFrame: Bilingual;
};

const DEFAULT_OBJECTIVE: MateriaObjective = {
  question: {
    es: "¿Cuál es la posición jurídica del asunto y qué debe hacerse enseguida?",
    en: "What is the legal position of this matter and what should be done next?",
  },
  favorable: {
    es: "El expediente sostiene la posición del cliente en los puntos verificados.",
    en: "The file supports the client's position on the verified points.",
  },
  adverse: {
    es: "El expediente presenta riesgos verificados que debilitan la posición del cliente.",
    en: "The file shows verified risks that weaken the client's position.",
  },
  mixed: {
    es: "El expediente sostiene parcialmente la posición del cliente y deja frentes abiertos.",
    en: "The file partially supports the client's position and leaves open exposure.",
  },
  actionFrame: {
    es: "Siguiente actuación procesal",
    en: "Next procedural step",
  },
};

export const MATERIA_OBJECTIVES: Record<MexicanCaseType, MateriaObjective> = {
  penal: {
    question: {
      es: "¿La carpeta de investigación sostiene la acusación y qué defensas están disponibles?",
      en: "Does the investigation file sustain the accusation, and which defenses are available?",
    },
    favorable: {
      es: "La carpeta presenta defectos verificados que pueden atacarse en audiencia.",
      en: "The investigation file shows verified defects that can be attacked at hearing.",
    },
    adverse: {
      es: "Los datos de prueba verificados sostienen la teoría del Ministerio Público en lo esencial.",
      en: "The verified evidence substantially sustains the prosecution's theory.",
    },
    mixed: {
      es: "Hay datos de prueba que sostienen la acusación y defectos aprovechables por la defensa.",
      en: "Some evidence sustains the accusation while exploitable defects remain for the defense.",
    },
    actionFrame: { es: "Actuación en la etapa procesal", en: "Action in the current stage" },
  },
  civil: {
    question: {
      es: "¿La acción está acreditada y qué prestaciones son exigibles?",
      en: "Is the claim proven and which remedies are enforceable?",
    },
    favorable: {
      es: "Los elementos de la acción están documentalmente soportados.",
      en: "The elements of the claim are supported by documentary evidence.",
    },
    adverse: {
      es: "Faltan elementos verificados para acreditar la acción tal como está planteada.",
      en: "Verified elements are missing to prove the claim as pleaded.",
    },
    mixed: {
      es: "Parte de la acción está acreditada; otras prestaciones carecen de soporte probatorio.",
      en: "Part of the claim is proven; other remedies lack evidentiary support.",
    },
    actionFrame: { es: "Actuación probatoria", en: "Evidentiary step" },
  },
  mercantil: {
    question: {
      es: "¿La obligación mercantil es exigible y por qué vía debe reclamarse?",
      en: "Is the commercial obligation enforceable and through which action?",
    },
    favorable: {
      es: "Los títulos y documentos base acreditan la exigibilidad de la obligación.",
      en: "The instruments and underlying documents establish enforceability.",
    },
    adverse: {
      es: "Los documentos base presentan defectos que comprometen la exigibilidad.",
      en: "The underlying instruments show defects that compromise enforceability.",
    },
    mixed: {
      es: "La obligación es parcialmente exigible; hay defectos documentales por subsanar.",
      en: "The obligation is partly enforceable; documentary defects remain.",
    },
    actionFrame: { es: "Actuación mercantil", en: "Commercial step" },
  },
  familiar: {
    question: {
      es: "¿Qué resolución protege mejor el interés superior de la niñez y los derechos alimentarios?",
      en: "Which outcome best protects the child's best interest and support rights?",
    },
    favorable: {
      es: "El expediente respalda la pretensión del cliente en términos del interés superior de la niñez.",
      en: "The file supports the client's position under the best-interest standard.",
    },
    adverse: {
      es: "El expediente contiene elementos verificados adversos al planteamiento del cliente.",
      en: "The file contains verified elements adverse to the client's position.",
    },
    mixed: {
      es: "El expediente sostiene parte de la pretensión y deja abiertos puntos de convivencia o alimentos.",
      en: "The file supports part of the claim and leaves custody or support issues open.",
    },
    actionFrame: { es: "Actuación familiar", en: "Family-law step" },
  },
  laboral: {
    question: {
      es: "¿El despido fue justificado y cuál es la exposición económica del patrón?",
      en: "Was the dismissal justified and what is the employer's financial exposure?",
    },
    favorable: {
      es: "La documentación laboral respalda la posición del cliente.",
      en: "The employment record supports the client's position.",
    },
    adverse: {
      es: "La carga probatoria patronal no está cubierta con la documentación verificada.",
      en: "The employer's burden of proof is not met on the verified record.",
    },
    mixed: {
      es: "La documentación cubre parte de la carga probatoria y deja rubros expuestos.",
      en: "The record covers part of the burden and leaves items exposed.",
    },
    actionFrame: { es: "Actuación ante el Tribunal Laboral", en: "Labor tribunal step" },
  },
  administrativo: {
    question: {
      es: "¿El acto administrativo es impugnable y por qué vía conviene combatirlo?",
      en: "Is the administrative act challengeable and through which channel?",
    },
    favorable: {
      es: "El acto presenta vicios de fundamentación o motivación verificados.",
      en: "The act shows verified defects in its legal basis or reasoning.",
    },
    adverse: {
      es: "El acto aparece fundado y motivado en los documentos verificados.",
      en: "The act appears properly grounded and reasoned on the verified record.",
    },
    mixed: {
      es: "Hay vicios parciales que permiten impugnación acotada.",
      en: "Partial defects allow a narrowed challenge.",
    },
    actionFrame: { es: "Vía de impugnación", en: "Challenge route" },
  },
  fiscal: {
    question: {
      es: "¿El crédito fiscal es legalmente exigible y qué medio de defensa procede?",
      en: "Is the tax assessment legally enforceable and which defense applies?",
    },
    favorable: {
      es: "La determinación presenta defectos verificados en su motivación o cálculo.",
      en: "The assessment shows verified defects in reasoning or computation.",
    },
    adverse: {
      es: "La determinación se sostiene con la documentación verificada.",
      en: "The assessment holds up on the verified record.",
    },
    mixed: {
      es: "Partes de la determinación son atacables; otras se sostienen.",
      en: "Parts of the assessment are challengeable; others hold.",
    },
    actionFrame: { es: "Medio de defensa fiscal", en: "Tax defense step" },
  },
  amparo: {
    question: {
      es: "¿Procede el amparo, contra qué acto y qué efectos suspensionales pueden obtenerse?",
      en: "Is amparo available, against which act, and what suspension effects are attainable?",
    },
    favorable: {
      es: "El acto reclamado y el interés jurídico están identificados en el expediente.",
      en: "The challenged act and legal standing are identified in the file.",
    },
    adverse: {
      es: "El expediente no acredita aún el acto reclamado o el interés requerido.",
      en: "The file does not yet establish the challenged act or the required standing.",
    },
    mixed: {
      es: "El acto reclamado está identificado, pero la acreditación es parcial.",
      en: "The challenged act is identified, but the record is only partly established.",
    },
    actionFrame: { es: "Actuación en el juicio de amparo", en: "Amparo step" },
  },
  electoral: {
    question: {
      es: "¿El acto electoral es impugnable dentro de plazo y con qué agravios?",
      en: "Is the electoral act challengeable in time, and on what grounds?",
    },
    favorable: {
      es: "Los agravios están documentados en las constancias verificadas.",
      en: "The grounds are documented in the verified record.",
    },
    adverse: {
      es: "Las constancias verificadas no sostienen los agravios planteados.",
      en: "The verified record does not sustain the grounds asserted.",
    },
    mixed: {
      es: "Algunos agravios están documentados y otros carecen de soporte.",
      en: "Some grounds are documented, others lack support.",
    },
    actionFrame: { es: "Medio de impugnación electoral", en: "Electoral challenge step" },
  },
  agrario: {
    question: {
      es: "¿Quién acredita el derecho sobre la tierra y ante qué instancia debe resolverse?",
      en: "Who holds the proven land right and before which forum must it be resolved?",
    },
    favorable: {
      es: "La documentación agraria respalda el derecho del cliente.",
      en: "The agrarian record supports the client's right.",
    },
    adverse: {
      es: "La documentación agraria no acredita aún el derecho reclamado.",
      en: "The agrarian record does not yet establish the claimed right.",
    },
    mixed: {
      es: "El derecho está parcialmente acreditado en el núcleo agrario.",
      en: "The right is partly established in the agrarian record.",
    },
    actionFrame: { es: "Actuación ante el Tribunal Agrario", en: "Agrarian tribunal step" },
  },
  constitucional: {
    question: {
      es: "¿Qué derecho humano fue vulnerado y qué reparación es exigible?",
      en: "Which human right was violated and what remedy is enforceable?",
    },
    favorable: {
      es: "El expediente documenta afectaciones a derechos reconocidos en la CPEUM y tratados.",
      en: "The file documents impairment of rights under the Constitution and treaties.",
    },
    adverse: {
      es: "El expediente aún no documenta la afectación al derecho invocado.",
      en: "The file does not yet document the asserted rights violation.",
    },
    mixed: {
      es: "Hay afectaciones documentadas parcialmente y otras sin soporte.",
      en: "Some impairments are documented; others lack support.",
    },
    actionFrame: { es: "Vía de reparación", en: "Remedy route" },
  },
  ambiental: {
    question: {
      es: "¿Existe daño ambiental acreditado y quién responde por su reparación?",
      en: "Is environmental damage established and who is liable for remediation?",
    },
    favorable: {
      es: "Los dictámenes e inspecciones verificadas documentan la afectación.",
      en: "Verified inspections and expert reports document the impact.",
    },
    adverse: {
      es: "No hay dictámenes verificados que acrediten la afectación reclamada.",
      en: "No verified expert record establishes the claimed impact.",
    },
    mixed: {
      es: "La afectación está parcialmente documentada.",
      en: "The impact is partly documented.",
    },
    actionFrame: { es: "Actuación ambiental", en: "Environmental step" },
  },
  inmobiliario: {
    question: {
      es: "¿Es seguro cerrar la operación y qué contingencias deben resolverse antes de la firma?",
      en: "Is it safe to close, and which contingencies must be cleared before signing?",
    },
    favorable: {
      es: "La debida diligencia verificada no detecta impedimentos para cerrar.",
      en: "Verified due diligence shows no impediment to closing.",
    },
    adverse: {
      es: "La debida diligencia detecta contingencias que impiden cerrar con seguridad.",
      en: "Due diligence surfaces contingencies that block a safe closing.",
    },
    mixed: {
      es: "La operación puede avanzar con condiciones: hay contingencias pendientes de subsanar.",
      en: "The transaction may proceed conditionally: contingencies remain open.",
    },
    actionFrame: { es: "Paso previo al cierre", en: "Pre-closing step" },
  },
};

export function objectiveFor(caseType: string | null | undefined): MateriaObjective {
  return isMexicanCaseType(caseType) ? MATERIA_OBJECTIVES[caseType] : DEFAULT_OBJECTIVE;
}

export function materiaLabel(caseType: string | null | undefined, locale: ObjectiveLocale): string | null {
  return isMexicanCaseType(caseType) ? MX_CASE_TYPE_LABELS[caseType][locale] : null;
}

// ---------------------------------------------------------------------------
// Decision support
// ---------------------------------------------------------------------------

export type DecisionPoint = {
  id: string;
  issue: string;
  /** Why this matters, in one line. */
  why: string;
  /** What it impacts (posture, exposure, admissibility, closing…). */
  impact: string;
  /** The next logical action the attorney should take. */
  next_action: string;
  severity: string;
};

export type ObjectiveBlock = {
  materia: string | null;
  materia_label: string | null;
  locale: ObjectiveLocale;
  /** The attorney's primary question for this materia. */
  question: string;
  /** Conclusion-first answer, assembled only from verified signals. */
  answer: string;
  /** alta | media | baja (es) — high | medium | low (en). */
  confidence: string;
  /** Whether the record is too thin to answer. */
  insufficient: boolean;
  /** Titles of the verified findings the answer rests on. */
  basis: string[];
  /** Verified gaps that limit the answer. */
  blockers: string[];
  decision_points: DecisionPoint[];
};

export type ObjectiveInput = {
  caseType: string | null | undefined;
  locale: ObjectiveLocale;
  findings: Array<{
    id?: string | null;
    title?: string | null;
    severity?: string | null;
    category?: string | null;
    legal_significance?: string | null;
    potential_impact?: string | null;
    affected_party?: string | null;
  }>;
  contradictions?: number;
  missingEvidence?: Array<{ topic?: string | null; what_is_missing?: string | null; label?: string | null }>;
  scores?: { strength?: number | null; risk?: number | null; suppressed?: boolean };
  documentsTotal?: number;
};

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

const T = {
  insufficient: {
    es: "El expediente aún no contiene evidencia verificada suficiente para responder esta pregunta. No se emite conclusión.",
    en: "The file does not yet contain enough verified evidence to answer this question. No conclusion is issued.",
  },
  noDocs: {
    es: "No hay documentos extraídos en el expediente.",
    en: "No extracted documents in the file.",
  },
  basisLead: { es: "Sustento verificado", en: "Verified basis" },
  blockersLead: { es: "Pendiente de acreditar", en: "Still unproven" },
  contradictions: {
    es: (n: number) => `Se detectaron ${n} contradicción(es) verificada(s) en el expediente.`,
    en: (n: number) => `${n} verified contradiction(s) were detected in the file.`,
  },
  conf: { high: { es: "alta", en: "high" }, med: { es: "media", en: "medium" }, low: { es: "baja", en: "low" } },
  why: {
    es: "Incide directamente en la pregunta principal del asunto.",
    en: "It bears directly on the matter's primary question.",
  },
  impact: {
    critical: { es: "Impacto determinante en la posición del asunto.", en: "Determinative impact on the matter." },
    high: { es: "Impacto alto en la estrategia y la exposición.", en: "High impact on strategy and exposure." },
    medium: { es: "Impacto moderado; condiciona actuaciones posteriores.", en: "Moderate impact; conditions later steps." },
    low: { es: "Impacto acotado; se documenta para control.", en: "Limited impact; recorded for control." },
  },
  action: {
    es: "Verificar el soporte documental y decidir la actuación correspondiente.",
    en: "Verify the documentary support and decide the corresponding step.",
  },
  gapAction: {
    es: (topic: string) => `Recabar u ofrecer prueba sobre: ${topic}.`,
    en: (topic: string) => `Obtain or offer evidence on: ${topic}.`,
  },
  gapWhy: {
    es: "Sin este elemento, la conclusión no puede sostenerse.",
    en: "Without this element, the conclusion cannot be sustained.",
  },
  gapImpact: {
    es: "Limita el alcance de la respuesta a la pregunta principal.",
    en: "Limits how far the primary question can be answered.",
  },
};

function clean(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

export function buildObjectiveBlock(input: ObjectiveInput): ObjectiveBlock {
  const L = input.locale === "en" ? "en" : "es";
  const obj = objectiveFor(input.caseType);
  const findings = (input.findings ?? []).filter((f) => clean(f.title));
  const gaps = (input.missingEvidence ?? [])
    .map((m) => clean(m.topic) || clean(m.what_is_missing) || clean(m.label))
    .filter(Boolean)
    .slice(0, 5);
  const docs = input.documentsTotal ?? 0;
  const contradictions = input.contradictions ?? 0;

  const ranked = [...findings].sort(
    (a, b) => (SEV_RANK[clean(b.severity).toLowerCase()] ?? 0) - (SEV_RANK[clean(a.severity).toLowerCase()] ?? 0),
  );
  const serious = ranked.filter((f) => (SEV_RANK[clean(f.severity).toLowerCase()] ?? 0) >= 3);

  const insufficient = findings.length === 0 || docs === 0;

  let answer: string;
  let confidence: string;
  if (insufficient) {
    answer = docs === 0 ? `${T.noDocs[L]} ${T.insufficient[L]}` : T.insufficient[L];
    confidence = T.conf.low[L];
  } else if (serious.length >= 3) {
    answer = obj.favorable[L];
    confidence = T.conf.high[L];
  } else if (serious.length >= 1) {
    answer = obj.mixed[L];
    confidence = T.conf.med[L];
  } else {
    answer = obj.adverse[L];
    confidence = gaps.length ? T.conf.low[L] : T.conf.med[L];
  }

  if (!insufficient && contradictions > 0) {
    answer = `${answer} ${T.contradictions[L](contradictions)}`;
  }

  const decision_points: DecisionPoint[] = ranked.slice(0, 5).map((f, i) => {
    const sev = clean(f.severity).toLowerCase() || "medium";
    const impactKey = (sev === "critical" ? "critical" : sev === "high" ? "high" : sev === "low" ? "low" : "medium") as
      | "critical"
      | "high"
      | "medium"
      | "low";
    return {
      id: clean(f.id) || `dp-${i + 1}`,
      issue: clean(f.title),
      why: clean(f.legal_significance) || T.why[L],
      impact: clean(f.potential_impact) || T.impact[impactKey][L],
      next_action: `${obj.actionFrame[L]}: ${T.action[L]}`,
      severity: sev,
    };
  });

  for (const [i, gap] of gaps.slice(0, 3).entries()) {
    decision_points.push({
      id: `gap-${i + 1}`,
      issue: gap,
      why: T.gapWhy[L],
      impact: T.gapImpact[L],
      next_action: T.gapAction[L](gap),
      severity: "medium",
    });
  }

  return {
    materia: isMexicanCaseType(input.caseType) ? input.caseType : null,
    materia_label: materiaLabel(input.caseType, L),
    locale: L,
    question: obj.question[L],
    answer,
    confidence,
    insufficient,
    basis: ranked.slice(0, 5).map((f) => clean(f.title)),
    blockers: gaps,
    decision_points,
  };
}
