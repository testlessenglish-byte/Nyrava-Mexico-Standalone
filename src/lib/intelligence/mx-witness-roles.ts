// =============================================================================
// ROLE-AWARE WITNESS INTELLIGENCE — pure module.
//
// A witness in a Mexican matter is not a generic "witness": the procedural
// role determines what the declarant can lawfully contribute, how their
// credibility is weighed, and what structural bias the court will assume.
// A perito is judged on método y fundamentación; a policía primer respondiente
// on cadena de custodia and puesta a disposición; a víctima on consistencia
// and the amplified evidentiary value the CNPP gives their declaración; an
// autoridad responsable on the informe justificado's presumption of veracity.
//
// This module classifies the free-text role emitted by the witness engine
// into a canonical Mexican procedural role, and supplies (a) the credibility
// weighting profile used for that role, (b) the structural-bias note, and
// (c) the statutory authority the analysis rests on.
//
// Deterministic — no model calls, so the role mapping can never hallucinate
// an article number.
// =============================================================================

export type MxWitnessRole =
  | "victima"
  | "testigo"
  | "policia"
  | "perito"
  | "autoridad_responsable"
  | "servidor_publico"
  | "autoridad_fiscal"
  | "quejoso"
  | "tercero_interesado"
  | "juez"
  | "ministerio_publico"
  | "imputado"
  | "actor"
  | "demandado"
  | "trabajador"
  | "patron"
  | "desconocido";

export type WitnessRoleWeights = {
  reliability: number;
  bias: number;
  consistency: number;
  corroboration: number;
  observationOpportunity: number;
};

export type MxWitnessRoleProfile = {
  role: MxWitnessRole;
  label_es: string;
  label_en: string;
  /** Statutory hook that governs how this declaration is valued. */
  authority: string;
  /** Structural bias the court presumes for this role (Spanish). */
  bias_note_es: string;
  bias_note_en: string;
  /** What the credibility analysis must focus on for this role (Spanish). */
  scrutiny_es: string;
  scrutiny_en: string;
  /** Credibility-risk weights; always sum to 1. */
  weights: WitnessRoleWeights;
  /** Baseline structural bias floor (0–100) applied to the bias dimension. */
  bias_floor: number;
};

const W = (
  reliability: number,
  bias: number,
  consistency: number,
  corroboration: number,
  observationOpportunity: number,
): WitnessRoleWeights => ({ reliability, bias, consistency, corroboration, observationOpportunity });

export const MX_WITNESS_ROLES: Record<MxWitnessRole, MxWitnessRoleProfile> = {
  victima: {
    role: "victima",
    label_es: "Víctima u ofendido",
    label_en: "Victim / aggrieved party",
    authority: "CNPP Arts. 109 y 360; Ley General de Víctimas Art. 7",
    bias_note_es:
      "Interés directo en el resultado del proceso; la ley reconoce su calidad de parte, lo que no demerita su dicho pero sí exige corroboración.",
    bias_note_en:
      "Direct interest in the outcome; the law recognizes party status, which does not diminish the declaration but does require corroboration.",
    scrutiny_es:
      "Consistencia entre la denuncia, la entrevista ministerial y la ampliación de declaración; ausencia de contradicciones sobre modo, tiempo y lugar.",
    scrutiny_en:
      "Consistency across the complaint, the ministerial interview and any expanded declaration; no contradictions as to manner, time and place.",
    weights: W(0.25, 0.15, 0.3, 0.2, 0.1),
    bias_floor: 35,
  },
  testigo: {
    role: "testigo",
    label_es: "Testigo",
    label_en: "Witness",
    authority: "CNPP Arts. 360-372; CNPCF (prueba testimonial)",
    bias_note_es: "Sin interés procesal acreditado; la parcialidad debe demostrarse con datos concretos.",
    bias_note_en: "No established procedural interest; partiality must be shown with concrete data.",
    scrutiny_es:
      "Oportunidad real de percepción, razón del dicho y ausencia de vínculo con las partes.",
    scrutiny_en: "Genuine opportunity to perceive, stated basis of knowledge, and absence of ties to the parties.",
    weights: W(0.3, 0.25, 0.2, 0.15, 0.1),
    bias_floor: 0,
  },
  policia: {
    role: "policia",
    label_es: "Policía / primer respondiente",
    label_en: "Police officer / first responder",
    authority: "CNPP Arts. 132, 227-233 (cadena de custodia) y 434",
    bias_note_es:
      "Actúa bajo mando del Ministerio Público; su dicho se valora frente al informe policial homologado y la cadena de custodia.",
    bias_note_en:
      "Acts under the Ministerio Público; the declaration is weighed against the standardized police report and chain of custody.",
    scrutiny_es:
      "Registro puntual de la detención, puesta a disposición sin demora y trazabilidad de los indicios embalados.",
    scrutiny_en:
      "Precise record of the arrest, prompt presentation before the authority, and traceability of packaged evidence.",
    weights: W(0.3, 0.3, 0.15, 0.15, 0.1),
    bias_floor: 30,
  },
  perito: {
    role: "perito",
    label_es: "Perito",
    label_en: "Expert witness",
    authority: "CNPP Arts. 368-370; CNPCF (prueba pericial)",
    bias_note_es:
      "El perito de parte responde a quien lo ofrece; el perito oficial se presume imparcial salvo prueba en contrario.",
    bias_note_en:
      "A party-appointed expert answers to the offering party; an official expert is presumed impartial absent contrary proof.",
    scrutiny_es:
      "Acreditación técnica, método empleado, fundamentación del dictamen y reproducibilidad de las conclusiones.",
    scrutiny_en: "Technical credentials, method used, reasoning of the opinion, and reproducibility of conclusions.",
    weights: W(0.4, 0.2, 0.15, 0.15, 0.1),
    bias_floor: 15,
  },
  autoridad_responsable: {
    role: "autoridad_responsable",
    label_es: "Autoridad responsable",
    label_en: "Responsible authority",
    authority: "Ley de Amparo Arts. 117 y 119 (informe justificado)",
    bias_note_es:
      "Defiende la constitucionalidad de su propio acto; el informe justificado se presume cierto sólo en cuanto no sea desvirtuado.",
    bias_note_en:
      "Defends the constitutionality of its own act; the informe justificado is presumed accurate only insofar as it is not rebutted.",
    scrutiny_es:
      "Congruencia entre el informe justificado y las constancias remitidas; existencia o inexistencia del acto reclamado.",
    scrutiny_en:
      "Consistency between the informe justificado and the certified record; existence or non-existence of the challenged act.",
    weights: W(0.25, 0.35, 0.2, 0.15, 0.05),
    bias_floor: 45,
  },
  servidor_publico: {
    role: "servidor_publico",
    label_es: "Servidor público",
    label_en: "Public servant",
    authority: "Ley General de Responsabilidades Administrativas Arts. 7 y 49",
    bias_note_es: "Deber de veracidad reforzado, con interés institucional en sostener la actuación de su dependencia.",
    bias_note_en:
      "Heightened duty of truthfulness, coupled with an institutional interest in defending the agency's conduct.",
    scrutiny_es: "Competencia para emitir el acto, documentación de respaldo y apego al procedimiento administrativo.",
    scrutiny_en: "Authority to issue the act, supporting documentation, and compliance with the administrative procedure.",
    weights: W(0.3, 0.3, 0.2, 0.15, 0.05),
    bias_floor: 30,
  },
  autoridad_fiscal: {
    role: "autoridad_fiscal",
    label_es: "Autoridad fiscal (SAT)",
    label_en: "Tax authority (SAT)",
    authority: "CFF Arts. 42, 46 y 68 (presunción de legalidad)",
    bias_note_es:
      "Sus actos gozan de presunción de legalidad; la carga de desvirtuarlos recae en el contribuyente, lo que exige revisar motivación y competencia.",
    bias_note_en:
      "Its acts enjoy a presumption of legality; the burden to rebut falls on the taxpayer, requiring review of reasoning and competence.",
    scrutiny_es: "Fundamentación y motivación del acto, competencia del emisor y respeto a los plazos de la visita o revisión.",
    scrutiny_en: "Legal basis and reasoning of the act, issuer competence, and compliance with audit deadlines.",
    weights: W(0.3, 0.3, 0.2, 0.15, 0.05),
    bias_floor: 35,
  },
  quejoso: {
    role: "quejoso",
    label_es: "Quejoso",
    label_en: "Amparo claimant",
    authority: "Ley de Amparo Arts. 5 fracción I y 108",
    bias_note_es: "Parte que promueve el amparo; su dicho requiere respaldo documental del acto reclamado y del interés jurídico.",
    bias_note_en:
      "Party seeking amparo; the declaration requires documentary support of the challenged act and of legal standing.",
    scrutiny_es: "Acreditación del interés jurídico o legítimo y de la existencia del acto reclamado.",
    scrutiny_en: "Proof of legal or legitimate interest and of the existence of the challenged act.",
    weights: W(0.25, 0.2, 0.25, 0.2, 0.1),
    bias_floor: 35,
  },
  tercero_interesado: {
    role: "tercero_interesado",
    label_es: "Tercero interesado",
    label_en: "Interested third party",
    authority: "Ley de Amparo Art. 5 fracción III",
    bias_note_es: "Interés contrapuesto al del quejoso; su declaración se contrasta con las constancias del juicio de origen.",
    bias_note_en:
      "Interest opposed to the claimant's; the declaration is contrasted with the record of the underlying proceeding.",
    scrutiny_es: "Coincidencia con el expediente de origen y ausencia de afirmaciones ajenas a ese expediente.",
    scrutiny_en: "Agreement with the underlying record and absence of assertions foreign to it.",
    weights: W(0.25, 0.3, 0.2, 0.2, 0.05),
    bias_floor: 40,
  },
  juez: {
    role: "juez",
    label_es: "Órgano jurisdiccional",
    label_en: "Judicial officer",
    authority: "CPEUM Art. 17; Ley Orgánica del Poder Judicial de la Federación",
    bias_note_es: "Se presume imparcial; su actuación se examina por legalidad, no por credibilidad testimonial.",
    bias_note_en: "Presumed impartial; conduct is examined for legality, not testimonial credibility.",
    scrutiny_es: "Fundamentación y motivación de sus resoluciones y respeto al debido proceso.",
    scrutiny_en: "Reasoning of its rulings and respect for due process.",
    weights: W(0.4, 0.1, 0.25, 0.2, 0.05),
    bias_floor: 0,
  },
  ministerio_publico: {
    role: "ministerio_publico",
    label_es: "Ministerio Público",
    label_en: "Ministerio Público",
    authority: "CPEUM Art. 21; CNPP Arts. 127-131",
    bias_note_es:
      "Titular de la acción penal con deber de objetividad y de lealtad procesal; su interés acusatorio debe contrastarse con esa obligación.",
    bias_note_en:
      "Holder of the criminal action with a duty of objectivity and procedural loyalty; the prosecutorial interest is weighed against that duty.",
    scrutiny_es:
      "Integración completa de la carpeta de investigación y descubrimiento oportuno de los datos de prueba favorables a la defensa.",
    scrutiny_en:
      "Complete assembly of the investigation file and timely disclosure of evidence favorable to the defense.",
    weights: W(0.3, 0.3, 0.2, 0.15, 0.05),
    bias_floor: 30,
  },
  imputado: {
    role: "imputado",
    label_es: "Imputado",
    label_en: "Accused",
    authority: "CPEUM Art. 20 apartado B; CNPP Arts. 113 y 309",
    bias_note_es:
      "Declara sin obligación de decir verdad y bajo presunción de inocencia; su silencio no puede usarse en su contra.",
    bias_note_en:
      "Declares without an obligation to tell the truth and under the presumption of innocence; silence cannot be used against them.",
    scrutiny_es: "Voluntariedad de la declaración, asistencia de defensa técnica y correspondencia con los datos de prueba.",
    scrutiny_en: "Voluntariness of the declaration, assistance of counsel, and correspondence with the evidence.",
    weights: W(0.25, 0.2, 0.25, 0.2, 0.1),
    bias_floor: 35,
  },
  actor: {
    role: "actor",
    label_es: "Actor",
    label_en: "Claimant",
    authority: "CNPCF (carga de la prueba); Código de Comercio Art. 1194",
    bias_note_es: "Parte actora con la carga de probar los hechos constitutivos de su acción.",
    bias_note_en: "Claimant bearing the burden of proving the facts constituting the claim.",
    scrutiny_es: "Soporte documental de la acción y congruencia con las prestaciones reclamadas.",
    scrutiny_en: "Documentary support for the claim and consistency with the relief sought.",
    weights: W(0.25, 0.25, 0.2, 0.2, 0.1),
    bias_floor: 35,
  },
  demandado: {
    role: "demandado",
    label_es: "Demandado",
    label_en: "Respondent",
    authority: "CNPCF (excepciones y defensas); Código de Comercio Art. 1194",
    bias_note_es: "Parte demandada con la carga de probar sus excepciones y defensas.",
    bias_note_en: "Respondent bearing the burden of proving its defenses.",
    scrutiny_es: "Oportunidad de la contestación y soporte de las excepciones opuestas.",
    scrutiny_en: "Timeliness of the answer and support for the defenses raised.",
    weights: W(0.25, 0.25, 0.2, 0.2, 0.1),
    bias_floor: 35,
  },
  trabajador: {
    role: "trabajador",
    label_es: "Trabajador",
    label_en: "Employee",
    authority: "LFT Arts. 784 y 804 (reversión de la carga probatoria)",
    bias_note_es:
      "Parte con interés directo, pero la ley revierte la carga de la prueba al patrón sobre condiciones de trabajo.",
    bias_note_en:
      "Directly interested party, though the law shifts the burden of proof on employment conditions to the employer.",
    scrutiny_es: "Consistencia sobre antigüedad, salario y circunstancias del despido.",
    scrutiny_en: "Consistency as to seniority, wage, and the circumstances of the dismissal.",
    weights: W(0.25, 0.15, 0.3, 0.2, 0.1),
    bias_floor: 30,
  },
  patron: {
    role: "patron",
    label_es: "Patrón",
    label_en: "Employer",
    authority: "LFT Arts. 784, 804 y 805",
    bias_note_es:
      "Soporta la carga de la prueba documental; la falta de los documentos exigidos presume ciertos los hechos del trabajador.",
    bias_note_en:
      "Bears the documentary burden of proof; failure to produce required records presumes the employee's facts true.",
    scrutiny_es: "Existencia y exhibición de contratos, recibos de nómina, controles de asistencia y aviso de rescisión.",
    scrutiny_en: "Existence and production of contracts, payroll receipts, attendance records, and the dismissal notice.",
    weights: W(0.3, 0.3, 0.2, 0.15, 0.05),
    bias_floor: 40,
  },
  desconocido: {
    role: "desconocido",
    label_es: "Rol procesal no determinado",
    label_en: "Undetermined procedural role",
    authority: "Valoración libre y lógica (CNPP Art. 265; CNPCF)",
    bias_note_es: "No fue posible determinar el rol procesal a partir del expediente; se aplica la valoración general.",
    bias_note_en: "The procedural role could not be determined from the record; general valuation applies.",
    scrutiny_es: "Debe precisarse el carácter con el que comparece antes de asignarle valor probatorio.",
    scrutiny_en: "The capacity in which the person appears must be established before assigning evidentiary weight.",
    weights: W(0.3, 0.25, 0.2, 0.15, 0.1),
    bias_floor: 0,
  },
};

const ROLE_PATTERNS: readonly { role: MxWitnessRole; re: RegExp }[] = [
  { role: "autoridad_responsable", re: /autoridad\s+responsable|responsible\s+authority/ },
  { role: "autoridad_fiscal", re: /\bsat\b|autoridad\s+fiscal|administracion\s+desconcentrada|tax\s+authority|hacienda/ },
  { role: "ministerio_publico", re: /ministerio\s+publico|fiscal(?:ia)?\b|agente\s+del\s+mp|\bmp\b|prosecutor/ },
  { role: "perito", re: /perit[oa]|dictamen|expert\s+witness|forense|criminalist/ },
  { role: "policia", re: /polic[ií]|primer\s+respondiente|agente\s+de\s+investigacion|guardia\s+nacional|police|officer/ },
  { role: "juez", re: /juez|jueza|magistrad|tribunal|judge|justice/ },
  { role: "victima", re: /victima|ofendid|victim|denunciante|querellante/ },
  { role: "imputado", re: /imputad|acusad|procesad|sentenciad|defendant\s+in\s+criminal|accused/ },
  { role: "quejoso", re: /quejos|agraviad|claimant\s+in\s+amparo/ },
  { role: "tercero_interesado", re: /tercero\s+interesad|third\s+party/ },
  { role: "trabajador", re: /trabajador|emplead|obrer|employee|worker/ },
  { role: "patron", re: /patron|empleador|employer|representante\s+legal\s+de\s+la\s+empresa/ },
  { role: "servidor_publico", re: /servidor\s+public|funcionari|public\s+servant|notari/ },
  { role: "actor", re: /\bactor\b|actora|demandante|promovente|plaintiff/ },
  { role: "demandado", re: /demandad|defendant|reo\b/ },
  { role: "testigo", re: /testig|witness|declarante/ },
];

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Classify the engine's free-text role string into a Mexican procedural role. */
export function classifyWitnessRole(rawRole: string | null | undefined, name?: string | null): MxWitnessRoleProfile {
  const hay = normalize(`${rawRole ?? ""} ${name ?? ""}`);
  if (hay.trim()) {
    for (const { role, re } of ROLE_PATTERNS) {
      if (re.test(hay)) return MX_WITNESS_ROLES[role];
    }
  }
  return MX_WITNESS_ROLES.desconocido;
}

/**
 * Role-aware credibility composite. Each role weights the five dimensions
 * differently (a perito lives or dies on reliability/method; an autoridad
 * responsable on structural bias) and carries a bias floor reflecting the
 * interest the law itself presumes.
 */
export function computeRoleAwareCredibility(input: {
  role?: string | null;
  name?: string | null;
  reliability?: number | null;
  bias?: number | null;
  consistency?: number | null;
  corroboration?: number | null;
  observation_opportunity?: number | null;
  locale?: "es" | "en";
}): {
  risk: number;
  profile: MxWitnessRoleProfile;
  breakdown: string;
  bias_applied: number;
} {
  const profile = classifyWitnessRole(input.role, input.name);
  const locale = input.locale ?? "es";
  const clamp = (n: number | null | undefined) =>
    typeof n !== "number" || Number.isNaN(n) ? 50 : Math.max(0, Math.min(100, n));

  const reliability = clamp(input.reliability);
  const consistency = clamp(input.consistency);
  const corroboration = clamp(input.corroboration);
  const observation = clamp(input.observation_opportunity);
  const bias = Math.max(clamp(input.bias), profile.bias_floor);

  const w = profile.weights;
  const contributions: Record<string, number> = {
    reliability: (100 - reliability) * w.reliability,
    bias: bias * w.bias,
    consistency: (100 - consistency) * w.consistency,
    corroboration: (100 - corroboration) * w.corroboration,
    observationOpportunity: (100 - observation) * w.observationOpportunity,
  };
  const risk = Math.max(
    0,
    Math.min(100, Math.round(Object.values(contributions).reduce((a, b) => a + b, 0))),
  );

  const LABELS_ES: Record<string, string> = {
    reliability: "confiabilidad",
    bias: "parcialidad",
    consistency: "consistencia",
    corroboration: "corroboración",
    observationOpportunity: "oportunidad de percepción",
  };
  const LABELS_EN: Record<string, string> = {
    reliability: "reliability",
    bias: "bias",
    consistency: "consistency",
    corroboration: "corroboration",
    observationOpportunity: "opportunity to observe",
  };
  const labels = locale === "es" ? LABELS_ES : LABELS_EN;
  const drivers = Object.entries(contributions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .filter(([, v]) => v > 5)
    .map(([k]) => labels[k])
    .join(locale === "es" ? " y " : " and ");

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const weightList =
    `${labels.reliability} ${pct(w.reliability)}, ${labels.bias} ${pct(w.bias)}, ` +
    `${labels.consistency} ${pct(w.consistency)}, ${labels.corroboration} ${pct(w.corroboration)}, ` +
    `${labels.observationOpportunity} ${pct(w.observationOpportunity)}`;

  const breakdown =
    locale === "es"
      ? `Valorado como ${profile.label_es} (${profile.authority}). ${profile.bias_note_es} ` +
        `Escrutinio aplicable: ${profile.scrutiny_es} ` +
        `Cálculo: confiabilidad=${reliability}, parcialidad=${bias}, consistencia=${consistency}, ` +
        `corroboración=${corroboration}, oportunidad de percepción=${observation} (ponderación por rol: ${weightList}).` +
        (drivers ? ` Factor determinante: ${drivers}.` : " Ninguna dimensión domina el resultado.")
      : `Valued as ${profile.label_en} (${profile.authority}). ${profile.bias_note_en} ` +
        `Applicable scrutiny: ${profile.scrutiny_en} ` +
        `Computed from reliability=${reliability}, bias=${bias}, consistency=${consistency}, ` +
        `corroboration=${corroboration}, opportunity to observe=${observation} (role weights: ${weightList}).` +
        (drivers ? ` Largest driver(s): ${drivers}.` : " No single dimension dominates.");

  return { risk, profile, breakdown, bias_applied: bias };
}
