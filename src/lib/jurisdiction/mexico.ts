// =============================================================================
// MEXICO JURISDICTION MODULE — the single source of truth for how a Mexican
// matter is routed through this platform.
//
// Everything about "what kind of matter is this, and what law governs it"
// lives here and nowhere else:
//
//   normalizeMexicanCaseType()  — canonicalize any incoming value (UI, DB,
//                                 AI classifier, seeded fixture) to a materia
//   requireMexicanCaseType()    — same, but throws instead of guessing
//   getPipelineProfile()        — execution profile for the materia
//   getCourtHierarchy()         — órgano jurisdiccional ladder + court level
//   getProceduralRules()        — código procesal, etapas, plazos base
//   getEvidenceRules()          — régimen probatorio de la materia
//   getReportTemplate()         — report template + section policy
//   buildMexicanExecutionContext() / assertMexicanExecutionContext()
//   agentJurisdictionBlock()    — the jurisdiction object handed to every agent
//
// There is no U.S. vocabulary here and no fallback that silently invents a
// materia: an unknown value is a configuration error, surfaced as
// PipelineConfigurationError, never as `civil`.
// =============================================================================

import {
  MX_CASE_TYPES,
  MX_CASE_TYPE_LABELS,
  isMexicanCaseType,
  type MexicanCaseType,
} from "./mexico-types";
import {
  MX_BLOCKED_TERMS,
  MX_ENGINES,
  MX_FINDING_MODULES,
  MX_FORBIDDEN_REPORT_FIELDS,
  MX_MOTION_TYPES,
  MX_SECTIONS,
  MX_TABS,
} from "./mexico-policy";

export { MX_CASE_TYPES, MX_CASE_TYPE_LABELS, isMexicanCaseType };
export type { MexicanCaseType };

/** Fixed jurisdiction of this platform. */
export const MX_JURISDICTION = "MX" as const;
/** Fixed legal tradition of this platform. */
export const MX_LEGAL_SYSTEM = "Civil Law" as const;

/**
 * Raised whenever execution cannot proceed deterministically — an unknown
 * materia, a missing procedural code, a case that is not a Mexican matter.
 * Callers must stop; they must never continue with a default.
 */
export class PipelineConfigurationError extends Error {
  readonly code = "PIPELINE_CONFIGURATION_ERROR";
  readonly detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "PipelineConfigurationError";
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Spanish spelling / synonym variants an attorney, a document, or the AI
 * classifier may produce for a materia. These are variants of the SAME
 * Mexican vocabulary (accents, plurals, the way a materia is named in a
 * pleading) — not a second jurisdiction's classification system.
 */
const MX_ALIASES: Record<string, MexicanCaseType> = {
  // penal
  "derecho penal": "penal",
  penales: "penal",
  "materia penal": "penal",
  "juicio penal": "penal",
  "proceso penal": "penal",
  "justicia penal": "penal",
  cnpp: "penal",
  // civil
  "derecho civil": "civil",
  "materia civil": "civil",
  "civil ordinario": "civil",
  "juicio ordinario civil": "civil",
  "responsabilidad civil": "civil",
  "dano moral": "civil",
  "daño moral": "civil",
  arrendamiento: "civil",
  // "inmobiliario" is now its own materia (transactional, notarial/registral —
  // not litigation). Removed from the civil alias table deliberately: leaving
  // it here would silently route every real-estate matter into civil, which
  // is exactly the bug this materia exists to fix. A real estate *dispute*
  // (title fraud, usucapión) is still civil — that's a different fact pattern,
  // not a naming variant, so it is not aliased here.
  // mercantil
  "derecho mercantil": "mercantil",
  "materia mercantil": "mercantil",
  comercial: "mercantil",
  "juicio ejecutivo mercantil": "mercantil",
  "juicio oral mercantil": "mercantil",
  societario: "mercantil",
  corporativo: "mercantil",
  "concurso mercantil": "mercantil",
  "propiedad intelectual": "mercantil",
  bancario: "mercantil",
  bursatil: "mercantil",
  bursátil: "mercantil",
  // familiar
  "derecho familiar": "familiar",
  "materia familiar": "familiar",
  familia: "familiar",
  divorcio: "familiar",
  sucesiones: "familiar",
  sucesorio: "familiar",
  "guarda y custodia": "familiar",
  // laboral
  "derecho laboral": "laboral",
  "materia laboral": "laboral",
  trabajo: "laboral",
  "derecho del trabajo": "laboral",
  lft: "laboral",
  // administrativo
  "derecho administrativo": "administrativo",
  "materia administrativa": "administrativo",
  administrativa: "administrativo",
  "juicio de nulidad": "administrativo",
  "contencioso administrativo": "administrativo",
  // fiscal
  "derecho fiscal": "fiscal",
  "materia fiscal": "fiscal",
  tributario: "fiscal",
  "derecho tributario": "fiscal",
  cff: "fiscal",
  // amparo
  "juicio de amparo": "amparo",
  "amparo indirecto": "amparo",
  "amparo directo": "amparo",
  "ley de amparo": "amparo",
  // electoral
  "derecho electoral": "electoral",
  "materia electoral": "electoral",
  "juicio de inconformidad": "electoral",
  jdc: "electoral",
  // agrario
  "derecho agrario": "agrario",
  "materia agraria": "agrario",
  agraria: "agrario",
  ejidal: "agrario",
  comunal: "agrario",
  // constitucional / derechos humanos
  "derecho constitucional": "constitucional",
  "materia constitucional": "constitucional",
  constitutional: "constitucional",
  "derechos humanos": "constitucional",
  "controversia constitucional": "constitucional",
  "accion de inconstitucionalidad": "constitucional",
  "acción de inconstitucionalidad": "constitucional",
};

/**
 * Canonicalize any incoming case-type value to a Mexican materia.
 * Returns `null` when the value carries no recognizable Mexican materia —
 * callers decide whether that means "ask the classifier" or "stop", but they
 * must never substitute a materia of their own.
 */
export function normalizeMexicanCaseType(value: unknown): MexicanCaseType | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (isMexicanCaseType(raw)) return raw;
  const collapsed = raw.replace(/[\s-]+/g, " ").replace(/_/g, " ");
  if (isMexicanCaseType(collapsed.replace(/ /g, "_"))) return collapsed.replace(/ /g, "_") as MexicanCaseType;
  return MX_ALIASES[collapsed] ?? null;
}

/**
 * Same as normalizeMexicanCaseType, but a non-Mexican / unknown value is a
 * hard configuration error. Use this everywhere routing happens.
 */
export function requireMexicanCaseType(value: unknown, where: string): MexicanCaseType {
  const t = normalizeMexicanCaseType(value);
  if (!t) {
    throw new PipelineConfigurationError(
      `Materia desconocida en ${where}: "${String(value ?? "")}". El expediente debe clasificarse en una materia mexicana antes de ejecutarse.`,
      { where, received: value ?? null, expected: MX_CASE_TYPES },
    );
  }
  return t;
}

// ---------------------------------------------------------------------------
// Procedural rules — código, órgano, etapas
// ---------------------------------------------------------------------------

/**
 * "notarial_registral" is not a court: it's the actual instancia for a
 * non-adversarial Mexican real-estate closing — Notario Público (fe pública)
 * plus inscription at the Registro Público de la Propiedad. Distinguished
 * from "federal"/"local"/"mixto" deliberately rather than forced into one of
 * them, and from `null`: assertMexicanExecutionContext() requires a real
 * court_level/court pair for every materia (see comment at PIPELINE
 * CONFIGURATION GATE below) — a transactional materia still needs a true
 * answer to "what body has authority over this," it's just not a tribunal.
 */
export type MxCourtLevel = "federal" | "local" | "mixto" | "notarial_registral";

export interface MxProceduralRules {
  /** Short code identifier handed to agents, e.g. "CNPP". */
  procedural_code: string;
  /** Full name of the governing procedural instrument. */
  procedural_code_name: string;
  /** Substantive instruments that govern the merits. */
  substantive_codes: string[];
  /** Canonical procedural stages of the materia, in order. */
  stages: string[];
  /** Whether the materia is litigated orally under an adversarial model. */
  oral: boolean;
}

const PROCEDURAL: Record<MexicanCaseType, MxProceduralRules> = {
  penal: {
    procedural_code: "CNPP",
    procedural_code_name: "Código Nacional de Procedimientos Penales",
    substantive_codes: ["CPEUM (Arts. 16, 19, 20, 21)", "Código Penal Federal / códigos penales estatales"],
    stages: ["investigación inicial", "investigación complementaria", "etapa intermedia", "juicio oral", "recursos"],
    oral: true,
  },
  civil: {
    procedural_code: "CNPCF",
    procedural_code_name: "Código Nacional de Procedimientos Civiles y Familiares / códigos de procedimientos civiles locales",
    substantive_codes: ["Código Civil Federal", "Códigos civiles de las entidades federativas"],
    stages: ["demanda", "contestación", "audiencia preliminar", "audiencia de pruebas", "alegatos", "sentencia", "apelación"],
    oral: true,
  },
  mercantil: {
    procedural_code: "CCom",
    procedural_code_name: "Código de Comercio (juicio ejecutivo y oral mercantil)",
    substantive_codes: ["Código de Comercio", "LGTOC", "LGSM", "Ley de Concursos Mercantiles"],
    stages: ["demanda", "auto de exequendo / admisión", "excepciones", "audiencia de pruebas", "sentencia", "apelación"],
    oral: true,
  },
  familiar: {
    procedural_code: "CNPCF",
    procedural_code_name: "Código Nacional de Procedimientos Civiles y Familiares / códigos familiares locales",
    substantive_codes: ["Códigos civiles/familiares estatales", "CPEUM Art. 4", "Convención sobre los Derechos del Niño"],
    stages: ["demanda", "contestación", "medidas provisionales", "audiencia", "sentencia", "apelación"],
    oral: true,
  },
  laboral: {
    procedural_code: "LFT",
    procedural_code_name: "Ley Federal del Trabajo (justicia laboral, reforma 2019)",
    substantive_codes: ["LFT", "CPEUM Art. 123"],
    stages: [
      "conciliación prejudicial (CFCRL / centros locales)",
      "demanda ante Tribunal Laboral",
      "audiencia preliminar",
      "audiencia de juicio",
      "sentencia",
      "amparo directo",
    ],
    oral: true,
  },
  administrativo: {
    procedural_code: "LFPCA",
    procedural_code_name: "Ley Federal de Procedimiento Contencioso Administrativo / leyes de justicia administrativa locales",
    substantive_codes: ["LFPA", "leyes administrativas sectoriales", "Ley General de Responsabilidades Administrativas"],
    stages: ["recurso administrativo (opcional)", "demanda de nulidad", "contestación de la autoridad", "pruebas", "alegatos", "sentencia", "revisión fiscal"],
    oral: false,
  },
  fiscal: {
    procedural_code: "CFF",
    procedural_code_name: "Código Fiscal de la Federación / LFPCA para el juicio contencioso",
    substantive_codes: ["CFF", "LISR", "LIVA", "leyes fiscales estatales"],
    stages: ["facultades de comprobación", "resolución determinante", "recurso de revocación", "juicio de nulidad ante el TFJA", "amparo directo"],
    oral: false,
  },
  amparo: {
    procedural_code: "Ley de Amparo",
    procedural_code_name: "Ley de Amparo, reglamentaria de los Arts. 103 y 107 CPEUM",
    substantive_codes: ["CPEUM", "tratados internacionales de derechos humanos"],
    stages: ["demanda de amparo", "admisión", "incidente de suspensión", "informe justificado", "audiencia constitucional", "sentencia", "revisión"],
    oral: false,
  },
  electoral: {
    procedural_code: "LGSMIME",
    procedural_code_name: "Ley General del Sistema de Medios de Impugnación en Materia Electoral",
    substantive_codes: ["CPEUM Arts. 41, 99", "LGIPE", "LGPP", "leyes electorales locales"],
    stages: ["medio de impugnación local", "juicio ante sala regional del TEPJF", "recurso de reconsideración"],
    oral: false,
  },
  agrario: {
    procedural_code: "Ley Agraria",
    procedural_code_name: "Ley Agraria (juicio agrario ante Tribunales Unitarios Agrarios)",
    substantive_codes: ["Ley Agraria", "CPEUM Art. 27", "Reglamento Interior del RAN"],
    stages: ["demanda agraria", "audiencia de ley", "pruebas", "sentencia", "revisión ante el Tribunal Superior Agrario"],
    oral: true,
  },
  constitucional: {
    procedural_code: "LR 105 CPEUM",
    procedural_code_name: "Ley Reglamentaria de las Fracciones I y II del Art. 105 CPEUM",
    substantive_codes: ["CPEUM", "tratados internacionales de derechos humanos", "jurisprudencia de la SCJN y la Corte IDH"],
    stages: ["demanda (controversia / acción)", "contestación", "instrucción", "sentencia del Pleno de la SCJN"],
    oral: false,
  },
  ambiental: {
    procedural_code: "LGEEPA",
    procedural_code_name: "Ley General del Equilibrio Ecológico y la Protección al Ambiente / LFPCA para el juicio contencioso",
    substantive_codes: [
      "LGEEPA",
      "Ley General de Vida Silvestre",
      "Ley General para la Prevención y Gestión Integral de los Residuos (LGPGIR)",
      "Ley de Aguas Nacionales",
      "Ley General de Cambio Climático",
      "NOM ambientales",
    ],
    stages: ["procedimiento de inspección y vigilancia (PROFEPA, CONAGUA, ASEA, CONANP o CONAFOR según la autoridad competente)", "medidas de seguridad / clausura", "recurso de revisión (LGEEPA)", "juicio de nulidad ante el TFJA", "amparo directo o indirecto"],
    oral: false,
  },
  inmobiliario: {
    // Transactional, not adversarial: there is no "litigation" here unless a
    // dispute arises, in which case the matter is civil, not inmobiliario
    // (see the alias-table comment above). `stages` doubles as the closing
    // milestone sequence surfaced in the Transaction Center.
    procedural_code: "Código Civil (federal o estatal según la ubicación del inmueble) + Ley del Notariado y Reglamento del RPP estatales",
    procedural_code_name:
      "Régimen de compraventa e inscripción inmobiliaria: Código Civil aplicable, Ley del Notariado local y Reglamento del Registro Público de la Propiedad de la entidad donde se ubica el inmueble — el instrumento exacto depende del estado y debe confirmarse caso por caso.",
    substantive_codes: [
      "Código Civil Federal / código civil estatal aplicable",
      "Ley del Notariado (estatal)",
      "Código Fiscal de la Federación / leyes fiscales locales (ISAI, ISR enajenación de inmuebles)",
      "Ley de Inversión Extranjera (Art. 27 CPEUM — fideicomiso en zona restringida para extranjeros)",
    ],
    stages: [
      "due diligence / verificación de título",
      "elaboración y firma de la escritura ante Notario Público",
      "pago de impuestos de traslado de dominio (ISAI/ISR)",
      "inscripción en el Registro Público de la Propiedad",
      "cierre (entrega y liberación de fondos)",
    ],
    oral: false,
  },
};

export function getProceduralRules(caseType: unknown): MxProceduralRules {
  return PROCEDURAL[requireMexicanCaseType(caseType, "getProceduralRules")];
}

// ---------------------------------------------------------------------------
// Court hierarchy
// ---------------------------------------------------------------------------

export interface MxCourtHierarchy {
  court_level: MxCourtLevel;
  /** First-instance organ, e.g. "Juez de Control". */
  first_instance: string;
  /** Appellate / review ladder above first instance, in order. */
  ladder: string[];
}

const COURTS: Record<MexicanCaseType, MxCourtHierarchy> = {
  penal: {
    court_level: "mixto",
    first_instance: "Juez de Control / Tribunal de Enjuiciamiento",
    ladder: ["Tribunal de Alzada (apelación)", "Tribunal Colegiado de Circuito (amparo directo)", "SCJN"],
  },
  civil: {
    court_level: "local",
    first_instance: "Juez de lo Civil de primera instancia",
    ladder: ["Sala Civil del Tribunal Superior de Justicia", "Tribunal Colegiado de Circuito (amparo directo)"],
  },
  mercantil: {
    court_level: "mixto",
    first_instance: "Juez de lo Mercantil / Juez de Distrito (competencia concurrente)",
    ladder: ["Sala del Tribunal Superior de Justicia / Tribunal Unitario", "Tribunal Colegiado de Circuito"],
  },
  familiar: {
    court_level: "local",
    first_instance: "Juez de lo Familiar",
    ladder: ["Sala Familiar del Tribunal Superior de Justicia", "Tribunal Colegiado de Circuito"],
  },
  laboral: {
    court_level: "mixto",
    first_instance: "Tribunal Laboral (federal o local)",
    ladder: ["Tribunal Colegiado de Circuito (amparo directo)", "SCJN"],
  },
  administrativo: {
    court_level: "mixto",
    first_instance: "Sala Regional del TFJA / Tribunal de Justicia Administrativa local",
    ladder: ["Sala Superior del TFJA", "Tribunal Colegiado de Circuito"],
  },
  fiscal: {
    court_level: "federal",
    first_instance: "Sala Regional del Tribunal Federal de Justicia Administrativa",
    ladder: ["Sala Superior del TFJA", "Tribunal Colegiado de Circuito", "SCJN"],
  },
  amparo: {
    court_level: "federal",
    first_instance: "Juez de Distrito (indirecto) / Tribunal Colegiado de Circuito (directo)",
    ladder: ["Tribunal Colegiado de Circuito (revisión)", "SCJN"],
  },
  electoral: {
    court_level: "mixto",
    first_instance: "Tribunal Electoral local",
    ladder: ["Sala Regional del TEPJF", "Sala Superior del TEPJF"],
  },
  agrario: {
    court_level: "federal",
    first_instance: "Tribunal Unitario Agrario",
    ladder: ["Tribunal Superior Agrario", "Tribunal Colegiado de Circuito (amparo directo)"],
  },
  constitucional: {
    court_level: "federal",
    first_instance: "Suprema Corte de Justicia de la Nación",
    ladder: ["Pleno de la SCJN"],
  },
  ambiental: {
    court_level: "federal",
    first_instance: "Sala Regional del TFJA competente por territorio (la sala/ponencia específica depende de la autoridad emisora - PROFEPA, SEMARNAT, CONAGUA, ASEA, CONANP, CONAFOR - y debe confirmarse caso por caso; no se afirma la existencia de una sala especializada única en materia ambiental)",
    ladder: ["Sala Superior del TFJA", "Tribunal Colegiado de Circuito"],
  },
  inmobiliario: {
    court_level: "notarial_registral",
    first_instance: "Notario Público (fe pública) — formaliza la escritura de compraventa",
    ladder: [
      "Registro Público de la Propiedad de la entidad (inscripción y oponibilidad frente a terceros)",
      "Si surge controversia: Juez de lo Civil de primera instancia (el asunto deja de ser inmobiliario y se convierte en civil)",
    ],
  },
};

export function getCourtHierarchy(caseType: unknown): MxCourtHierarchy {
  return COURTS[requireMexicanCaseType(caseType, "getCourtHierarchy")];
}

// ---------------------------------------------------------------------------
// Evidence rules
// ---------------------------------------------------------------------------

export interface MxEvidenceRules {
  /** Standard of proof / valuation regime applied by the organ. */
  valoracion: string;
  /** Evidentiary instruments typical of the materia. */
  medios: string[];
  /** Party bearing the burden by default. */
  carga_probatoria: string;
}

const EVIDENCE: Record<MexicanCaseType, MxEvidenceRules> = {
  penal: {
    valoracion: "Libre valoración con reglas de la lógica y la sana crítica (Art. 359 CNPP); solo lo desahogado ante el Tribunal de Enjuiciamiento es prueba.",
    medios: ["dato de prueba", "medio de prueba", "prueba testimonial", "pericial", "documental", "cadena de custodia (Arts. 227-230 CNPP)"],
    carga_probatoria: "Ministerio Público — presunción de inocencia (Art. 20-B-I CPEUM).",
  },
  civil: {
    valoracion: "Valoración conforme a las reglas de la prueba tasada y la sana crítica según el código aplicable.",
    medios: ["confesional", "documental pública y privada", "pericial", "testimonial", "inspección judicial", "presuncional"],
    carga_probatoria: "Quien afirma está obligado a probar (actor respecto de su acción, demandado respecto de sus excepciones).",
  },
  mercantil: {
    valoracion: "Prueba preconstituida del título de crédito; valoración tasada con presunción de literalidad y autonomía.",
    medios: ["título de crédito", "estado de cuenta certificado", "documentoscopia", "contabilidad", "pericial contable"],
    carga_probatoria: "El demandado debe acreditar sus excepciones frente al título ejecutivo.",
  },
  familiar: {
    valoracion: "Valoración flexible orientada por el interés superior de la niñez; suplencia de la queja en favor de menores.",
    medios: ["estudio psicológico", "estudio socioeconómico", "informe de trabajo social", "testimonial", "documental"],
    carga_probatoria: "Distribución dinámica; el juzgador puede recabar pruebas de oficio.",
  },
  laboral: {
    valoracion: "Valoración en conciencia (Art. 841 LFT), a verdad sabida y buena fe guardada.",
    medios: ["testimonial", "documental (nómina, controles de asistencia)", "inspección", "pericial", "confesional"],
    carga_probatoria: "El patrón soporta la carga sobre antigüedad, salario, jornada y causa del despido (Art. 784 LFT).",
  },
  administrativo: {
    valoracion: "Presunción de legalidad del acto administrativo (Art. 68 CFF / Art. 42 LFPCA), desvirtuable por el particular.",
    medios: ["expediente administrativo", "documental pública", "pericial", "informes de autoridad"],
    carga_probatoria: "El particular debe desvirtuar la presunción de legalidad, salvo negativa lisa y llana.",
  },
  fiscal: {
    valoracion: "Presunción de legalidad de la resolución determinante; valoración tasada de documentación fiscal y CFDI.",
    medios: ["papeles de trabajo", "CFDI", "contabilidad electrónica", "pericial contable", "dictamen fiscal"],
    carga_probatoria: "El contribuyente debe acreditar la materialidad y deducibilidad de sus operaciones.",
  },
  amparo: {
    valoracion: "Se resuelve sobre el acto reclamado y las constancias; en amparo directo no se admite prueba nueva.",
    medios: ["informe justificado", "copias certificadas del expediente de origen", "documental pública"],
    carga_probatoria: "El quejoso acredita el acto reclamado y el interés; la autoridad rinde informe justificado.",
  },
  electoral: {
    valoracion: "Valoración conforme al Art. 16 LGSMIME; las pruebas técnicas solo tienen valor indiciario.",
    medios: ["actas de escrutinio", "documental pública electoral", "pruebas técnicas", "presuncional"],
    carga_probatoria: "El actor acredita la irregularidad y su carácter determinante.",
  },
  agrario: {
    valoracion: "Valoración conforme a la Ley Agraria con suplencia de la deficiencia de la queja en favor del núcleo ejidal.",
    medios: ["carpeta básica agraria", "certificados parcelarios del RAN", "pericial topográfica", "testimonial"],
    carga_probatoria: "Distribución flexible; el tribunal suple la deficiencia de la queja del sujeto agrario.",
  },
  constitucional: {
    valoracion: "Control de constitucionalidad y convencionalidad sobre normas y actos; parámetro de regularidad constitucional.",
    medios: ["norma impugnada", "proceso legislativo", "informes de autoridad", "jurisprudencia SCJN y Corte IDH"],
    carga_probatoria: "El promovente expone conceptos de invalidez; la SCJN suple la deficiencia de la queja.",
  },
  ambiental: {
    valoracion: "Presunción de legalidad del acta de inspección y de la resolución de la autoridad ambiental competente (PROFEPA, CONAGUA, ASEA, CONANP o CONAFOR según el caso) conforme a la LFPA (aplicable supletoriamente), desvirtuable por el particular; valoración técnica reforzada por dictamen pericial ambiental. La cita del artículo específico debe confirmarse con el abogado responsable.",
    medios: [
      "acta de inspección (PROFEPA/CONAGUA/ASEA/CONANP/CONAFOR según la autoridad)",
      "manifestación de impacto ambiental",
      "dictamen pericial ambiental",
      "estudio de riesgo",
      "informes de monitoreo de emisiones",
      "bitácoras de manejo de residuos",
      "muestreo ambiental (agua, suelo, aire)",
      "reportes de laboratorio acreditado",
      "cartografía y sistemas de información geográfica (SIG)",
      "imágenes satelitales",
      "fotografía y video con drones",
      "informes de ingeniería ambiental",
      "estudios hidrológicos",
    ],
    carga_probatoria: "El particular debe desvirtuar la presunción de legalidad del acta/resolución de la autoridad ambiental; en daño ambiental la Ley Federal de Responsabilidad Ambiental (LFRA) establece un régimen de responsabilidad objetiva en supuestos calificados por la propia ley (materiales o residuos peligrosos, entre otros).",
  },
  inmobiliario: {
    // Not a "standard of proof" in the litigation sense — this is the
    // verification standard a closing must meet before a notario will
    // formalize the escritura, which is the functional analogue here.
    valoracion:
      "Verificación documental previa a la firma: el Notario Público debe cerciorarse de la propiedad, libertad de gravámenes y regularidad fiscal del inmueble (Ley del Notariado local) antes de autorizar la escritura; no hay valoración judicial salvo que surja controversia.",
    medios: [
      "escritura pública / título de propiedad",
      "certificado de libertad de gravamen (RPP)",
      "constancia de no adeudo predial",
      "boleta/constancia catastral",
      "constancia de no adeudo de agua",
      "recibo CFE",
      "levantamiento topográfico / plano de medidas y colindancias",
      "carta de no adeudo de la administración del condominio (HOA)",
      "identificación oficial y, en su caso, poder notarial",
    ],
    carga_probatoria: "No aplica carga procesal — el comprador y su abogado asumen el riesgo de una verificación insuficiente; de ahí el rol del Verification Center.",
  },
};

export function getEvidenceRules(caseType: unknown): MxEvidenceRules {
  return EVIDENCE[requireMexicanCaseType(caseType, "getEvidenceRules")];
}

// ---------------------------------------------------------------------------
// Report template
// ---------------------------------------------------------------------------

export interface MxReportTemplate {
  template_id: string;
  /** Report sections that render for this materia (universal + materia). */
  sections: readonly string[];
  /** Party role labels used throughout the report. */
  party_roles: { a: string; b: string; neutral: string };
  /** Report fields that must be scrubbed for this materia. */
  forbidden_fields: readonly string[];
}

const PARTY_ROLES: Record<MexicanCaseType, { a: string; b: string; neutral: string }> = {
  penal: { a: "ministerio_publico", b: "defensa", neutral: "ambas" },
  civil: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  mercantil: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  familiar: { a: "parte_actora", b: "parte_demandada", neutral: "ambas" },
  laboral: { a: "trabajador", b: "patron", neutral: "ambas" },
  administrativo: { a: "particular", b: "autoridad", neutral: "ambas" },
  fiscal: { a: "contribuyente", b: "autoridad_fiscal", neutral: "ambas" },
  amparo: { a: "quejoso", b: "autoridad_responsable", neutral: "ambas" },
  electoral: { a: "actor", b: "autoridad_responsable", neutral: "ambas" },
  agrario: { a: "nucleo_ejidal", b: "parte_demandada", neutral: "ambas" },
  constitucional: { a: "promovente", b: "autoridad_responsable", neutral: "ambas" },
  ambiental: { a: "particular", b: "autoridad_ambiental", neutral: "ambas" },
  inmobiliario: { a: "comprador", b: "vendedor", neutral: "ambas" },
};

export function getPartyRoles(caseType: unknown) {
  return PARTY_ROLES[requireMexicanCaseType(caseType, "getPartyRoles")];
}

/** JSON-schema-ready enum, e.g. `"parte_actora"|"parte_demandada"|"ambas"`. */
export function partyRoleEnum(caseType: unknown): string {
  const r = getPartyRoles(caseType);
  return `"${r.a}"|"${r.b}"|"${r.neutral}"`;
}

export function getReportTemplate(caseType: unknown): MxReportTemplate {
  const t = requireMexicanCaseType(caseType, "getReportTemplate");
  return {
    template_id: `mx_${t}`,
    sections: MX_SECTIONS[t],
    party_roles: PARTY_ROLES[t],
    forbidden_fields: MX_FORBIDDEN_REPORT_FIELDS[t],
  };
}

// ---------------------------------------------------------------------------
// Policy accessors (engines / findings / motions / sections / tabs / terms)
// ---------------------------------------------------------------------------

export const materiaSections = (t: MexicanCaseType) => MX_SECTIONS[t];
export const materiaTabs = (t: MexicanCaseType) => MX_TABS[t];
export const materiaEngines = (t: MexicanCaseType) => MX_ENGINES[t];
export const materiaFindingModules = (t: MexicanCaseType) => MX_FINDING_MODULES[t];
export const materiaMotionTypes = (t: MexicanCaseType) => MX_MOTION_TYPES[t];
export const materiaBlockedTerms = (t: MexicanCaseType) => MX_BLOCKED_TERMS[t];
export const materiaForbiddenReportFields = (t: MexicanCaseType) => MX_FORBIDDEN_REPORT_FIELDS[t];

// ---------------------------------------------------------------------------
// Pipeline profile + execution context
// ---------------------------------------------------------------------------

export interface MxPipelineProfileInfo {
  materia: MexicanCaseType;
  label: { es: string; en: string };
  jurisdiction: typeof MX_JURISDICTION;
  legal_system: typeof MX_LEGAL_SYSTEM;
  procedural_code: string;
  procedural_code_name: string;
  court_level: MxCourtLevel;
  court: MxCourtHierarchy;
  oral: boolean;
  party_roles: { a: string; b: string; neutral: string };
}

/** The execution profile for a materia. Throws on an unknown materia. */
export function getPipelineProfile(caseType: unknown): MxPipelineProfileInfo {
  const materia = requireMexicanCaseType(caseType, "getPipelineProfile");
  const proc = PROCEDURAL[materia];
  const court = COURTS[materia];
  return {
    materia,
    label: MX_CASE_TYPE_LABELS[materia],
    jurisdiction: MX_JURISDICTION,
    legal_system: MX_LEGAL_SYSTEM,
    procedural_code: proc.procedural_code,
    procedural_code_name: proc.procedural_code_name,
    court_level: court.court_level,
    court,
    oral: proc.oral,
    party_roles: PARTY_ROLES[materia],
  };
}

/**
 * The object every pipeline stage, agent and report renderer receives.
 * `entity` is the federal entity (or "federal") the matter is litigated in;
 * `jurisdiction` is always "MX" — this platform has one jurisdiction.
 */
export interface MexicanExecutionContext {
  jurisdiction: typeof MX_JURISDICTION;
  legal_system: typeof MX_LEGAL_SYSTEM;
  normalized_case_type: MexicanCaseType;
  materia_label: string;
  procedural_code: string;
  procedural_code_name: string;
  court_level: MxCourtLevel;
  court: string;
  entity: string | null;
  party_roles: { a: string; b: string; neutral: string };
  procedural_stages: string[];
  evidence: MxEvidenceRules;
  report_template: string;
}

export function buildMexicanExecutionContext(args: {
  caseType: unknown;
  entity?: string | null;
  where?: string;
}): MexicanExecutionContext {
  const materia = requireMexicanCaseType(args.caseType, args.where ?? "buildMexicanExecutionContext");
  const profile = getPipelineProfile(materia);
  const proc = PROCEDURAL[materia];
  return {
    jurisdiction: MX_JURISDICTION,
    legal_system: MX_LEGAL_SYSTEM,
    normalized_case_type: materia,
    materia_label: profile.label.es,
    procedural_code: proc.procedural_code,
    procedural_code_name: proc.procedural_code_name,
    court_level: profile.court_level,
    court: profile.court.first_instance,
    entity: args.entity ? String(args.entity) : null,
    party_roles: profile.party_roles,
    procedural_stages: proc.stages,
    evidence: EVIDENCE[materia],
    report_template: `mx_${materia}`,
  };
}

/**
 * Runtime gate executed before any stage runs. Every assertion is explicit;
 * a failure stops the run with a descriptive error instead of continuing on
 * a default.
 */
export function assertMexicanExecutionContext(ctx: unknown): asserts ctx is MexicanExecutionContext {
  const c = (ctx ?? {}) as Partial<MexicanExecutionContext>;
  const fail = (msg: string, detail: Record<string, unknown> = {}) => {
    throw new PipelineConfigurationError(msg, detail);
  };
  if (c.jurisdiction !== MX_JURISDICTION)
    fail(`La jurisdicción del expediente debe ser "MX" (recibido: "${String(c.jurisdiction ?? "")}").`, { ctx: c });
  if (c.legal_system !== MX_LEGAL_SYSTEM) fail(`El sistema jurídico debe ser "Civil Law".`, { ctx: c });
  if (!c.normalized_case_type || !isMexicanCaseType(c.normalized_case_type))
    fail(`El expediente no tiene una materia mexicana normalizada.`, { ctx: c });
  if (!c.procedural_code) fail(`No se resolvió el código procesal aplicable a la materia.`, { ctx: c });
  if (!c.court_level || !c.court) fail(`No se resolvió el órgano jurisdiccional competente.`, { ctx: c });
  if (!c.party_roles?.a || !c.party_roles?.b) fail(`No se resolvieron los roles procesales de las partes.`, { ctx: c });
}

/** Compact jurisdiction block handed to every AI agent. Agents never infer. */
export function agentJurisdictionBlock(ctx: MexicanExecutionContext): string {
  return JSON.stringify({
    jurisdiction: ctx.jurisdiction,
    legal_system: ctx.legal_system,
    procedural_code: ctx.procedural_code,
    normalized_case_type: ctx.normalized_case_type,
    court_level: ctx.court_level,
    court: ctx.court,
    entity: ctx.entity,
    party_roles: ctx.party_roles,
  });
}
