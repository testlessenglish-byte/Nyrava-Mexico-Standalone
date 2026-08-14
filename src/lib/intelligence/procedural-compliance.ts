// =============================================================================
// PROCEDURAL COMPLIANCE ANALYSIS — pure module.
//
// Per-materia checklist of the procedural acts, plazos and formalities a
// Mexican matter must satisfy. Each item is evaluated against the extracted
// document corpus via keyword-pattern matching: if a pattern is found, the
// item is "cumplido" (confirmed present). If no pattern is found, the item is
// "no_identificado_en_corpus" — NOT "missing" or "faltante". A text-search
// miss against a partial corpus (frequently a single document, not the full
// expediente) proves nothing about the official record; it only proves the
// search didn't find it in what was supplied. This module must never convert
// "keyword absent" into "requirement missing" — that conflation was traced to
// a real completed-case audit where the aggregate summary flatly asserted
// "Faltan 3 requisitos procesales obligatorios" for a single-document
// amparo directo corpus, while the findings this same module generates for
// the identical gap (see procedural-compliance.server.ts) correctly hedge
// with "no necesariamente una omisión... verifique contra el expediente
// oficial". Same underlying fact, same module, two different confidence
// levels — score/summary must match the findings layer's discipline, not
// contradict it.
//
// `score` is a corpus pattern-detection coverage ratio (patterns matched /
// patterns checked), NOT a legal-compliance or procedural-failure score —
// see its own doc comment below before wiring it into anything an attorney
// reads as a verdict.
//
// Consumed by the `procedural_compliance` pipeline stage ("Análisis de
// Cumplimiento Procesal"). Deterministic — no model calls, so it can never
// hallucinate an article number.
// =============================================================================

import type { MxPipelineProfile } from "../execution/mx-pipeline";

export type ComplianceRequirement = "required" | "recommended";

export type ComplianceItem = {
  id: string;
  /** Spanish label — the platform's primary language. */
  label_es: string;
  label_en: string;
  /** Statutory hook, e.g. "CNPP Art. 141". */
  authority: string;
  requirement: ComplianceRequirement;
  /** Evidence patterns searched in the corpus (accent/case-insensitive). */
  patterns: readonly string[];
};

export type ComplianceItemResult = ComplianceItem & {
  // "no_identificado_en_corpus" (not "faltante"/"missing"): the pattern
  // search found nothing in the SUPPLIED corpus. That is a statement about
  // this run's document set, never a finding about the official expediente
  // — see the module header. Renamed from "faltante" specifically so the
  // value itself can't be read as an assertion the requirement wasn't met.
  status: "cumplido" | "no_identificado_en_corpus" | "no_documentado";
  /** Short excerpt of the matching corpus text, when found. */
  evidence: string | null;
};

export type ComplianceReport = {
  materia: MxPipelineProfile;
  evaluated: number;
  satisfied: number;
  missing_required: number;
  /**
   * 0–100 corpus pattern-detection coverage: the share of checklist items
   * whose keyword pattern(s) were found somewhere in the supplied corpus.
   * This is NOT a legal-compliance score and NOT a procedural-failure
   * score — a low number means "few of these patterns showed up in the
   * document(s) we were given," not "few of these requirements were
   * actually met by the parties/court." Never render this as "Cumplimiento
   * Procesal: N/100" or similar phrasing that implies a compliance verdict;
   * pair it with `summary` (already hedged) or an equivalent disclosure of
   * what the number measures.
   */
  score: number;
  items: ComplianceItemResult[];
  /** Spanish one-line summary. */
  summary: string;
};

const CHECKLISTS: Record<MxPipelineProfile, readonly ComplianceItem[]> = {
  penal: [
    {
      id: "carpeta_investigacion",
      label_es: "Carpeta de investigación integrada",
      label_en: "Investigation file (carpeta de investigación) on record",
      authority: "CNPP Art. 213–221",
      requirement: "required",
      patterns: ["carpeta de investigacion", "numero unico de caso", "nuc "],
    },
    {
      id: "iph",
      label_es: "Informe Policial Homologado (IPH)",
      label_en: "Standardized police report (IPH)",
      authority: "CNPP Art. 132",
      requirement: "required",
      patterns: ["informe policial homologado", "iph"],
    },
    {
      id: "cadena_custodia",
      label_es: "Cadena de custodia documentada",
      label_en: "Documented chain of custody",
      authority: "CNPP Art. 227–228",
      requirement: "required",
      patterns: ["cadena de custodia", "registro de cadena"],
    },
    {
      id: "lectura_derechos",
      label_es: "Lectura de derechos al imputado",
      label_en: "Reading of the accused's rights",
      authority: "CNPP Art. 152; CPEUM Art. 20 B",
      requirement: "required",
      patterns: ["lectura de derechos", "derechos del imputado", "se le hicieron saber sus derechos"],
    },
    {
      id: "control_detencion",
      label_es: "Audiencia de control de la detención",
      label_en: "Detention review hearing",
      authority: "CNPP Art. 307",
      requirement: "required",
      patterns: ["control de la detencion", "calificacion de la detencion"],
    },
    {
      id: "vinculacion",
      label_es: "Auto de vinculación a proceso",
      label_en: "Order binding the accused to trial",
      authority: "CNPP Art. 313–316",
      requirement: "required",
      patterns: ["vinculacion a proceso", "auto de vinculacion"],
    },
    {
      id: "plazo_constitucional",
      label_es: "Respeto del plazo constitucional (72/144 horas)",
      label_en: "Constitutional 72/144-hour term respected",
      authority: "CPEUM Art. 19",
      requirement: "required",
      patterns: ["plazo constitucional", "72 horas", "144 horas"],
    },
    {
      id: "medidas_cautelares",
      label_es: "Resolución de medidas cautelares",
      label_en: "Ruling on precautionary measures",
      authority: "CNPP Art. 153–158",
      requirement: "recommended",
      patterns: ["medidas cautelares", "prision preventiva", "garantia economica"],
    },
    {
      id: "descubrimiento",
      label_es: "Descubrimiento probatorio a la defensa",
      label_en: "Evidence disclosure to the defense",
      authority: "CNPP Art. 337",
      requirement: "required",
      patterns: ["descubrimiento probatorio", "acceso a la carpeta"],
    },
    {
      id: "asesor_victima",
      label_es: "Asesor jurídico de la víctima designado",
      label_en: "Victim's legal advisor appointed",
      authority: "Ley General de Víctimas Art. 12",
      requirement: "recommended",
      patterns: ["asesor juridico", "asesor de la victima"],
    },
  ],
  amparo: [
    {
      id: "acto_reclamado",
      label_es: "Acto reclamado precisado",
      label_en: "Challenged act clearly identified",
      authority: "Ley de Amparo Art. 108 fr. IV",
      requirement: "required",
      patterns: ["acto reclamado"],
    },
    {
      id: "autoridad_responsable",
      label_es: "Autoridad responsable señalada",
      label_en: "Responsible authority identified",
      authority: "Ley de Amparo Art. 108 fr. III",
      requirement: "required",
      patterns: ["autoridad responsable"],
    },
    {
      id: "interes_juridico",
      label_es: "Interés jurídico o legítimo acreditado",
      label_en: "Legal or legitimate interest established",
      authority: "Ley de Amparo Art. 5 fr. I",
      requirement: "required",
      // Mexican amparo pleadings argue standing in many equivalent ways —
      // matching only "interés jurídico"/"interés legítimo" produced false
      // "faltante" flags on demands that plainly argue standing.
      patterns: [
        "interes juridico",
        "interes legitimo",
        "afectacion a su esfera juridica",
        "afectacion en su esfera juridica",
        "esfera juridica del quejoso",
        "agravio personal y directo",
        "agravio directo y personal",
        "perjuicio personal y directo",
        "titular de un derecho subjetivo",
        "derecho subjetivo publico",
        "situacion juridica identificable",
        "legitimacion activa",
        "legitimacion en la causa",
        "calidad de quejoso",
        "acredita su interes",
        "acreditar el interes",
      ],
    },
    {
      id: "plazo_15_dias",
      label_es: "Presentación dentro del plazo (15 días, salvo excepciones)",
      label_en: "Filed within the 15-day term (with statutory exceptions)",
      authority: "Ley de Amparo Art. 17",
      requirement: "required",
      patterns: [
        "quince dias",
        "15 dias",
        "plazo para promover",
        "plazo para la presentacion de la demanda",
        "oportunidad de la demanda",
        "presentada en tiempo",
        "en tiempo y forma",
        "articulo 17 de la ley de amparo",
        "actos de imposible reparacion",
        "no esta sujeta a plazo",
      ],
    },
    {
      id: "conceptos_violacion",
      label_es: "Conceptos de violación expresados",
      label_en: "Grounds of constitutional violation stated",
      authority: "Ley de Amparo Art. 108 fr. VIII",
      requirement: "required",
      patterns: [
        "conceptos de violacion",
        "concepto de violacion",
        "agravios",
        "violacion a los articulos",
        "violaciones constitucionales",
        "derechos humanos violados",
      ],
    },
    {
      id: "suspension",
      label_es: "Solicitud y resolución de suspensión",
      label_en: "Stay (suspensión) requested and resolved",
      authority: "Ley de Amparo Art. 125–129",
      requirement: "recommended",
      patterns: [
        "suspension del acto",
        "suspension provisional",
        "suspension definitiva",
        "suspension de plano",
        "se concede la suspension",
        "incidente de suspension",
        "apariencia del buen derecho",
      ],
    },
    {
      id: "informe_justificado",
      label_es: "Informe justificado de la autoridad",
      label_en: "Authority's justifying report",
      authority: "Ley de Amparo Art. 117",
      requirement: "required",
      patterns: ["informe justificado", "informe previo", "rinde informe", "rindio su informe"],
    },
    {
      id: "principio_definitividad",
      label_es: "Principio de definitividad satisfecho",
      label_en: "Principle of definitiveness satisfied",
      authority: "Ley de Amparo Art. 61 fr. XVIII",
      requirement: "required",
      patterns: [
        "definitividad",
        "recurso ordinario agotado",
        "agoto el recurso",
        "no existe recurso ordinario",
        "excepcion al principio de definitividad",
        "recurso ordinario procedente",
      ],
    },

  ],
  derechos_humanos: [
    {
      id: "queja",
      label_es: "Queja presentada ante la comisión competente",
      label_en: "Complaint filed with the competent human-rights commission",
      authority: "Ley de la CNDH Art. 25–27",
      requirement: "required",
      patterns: ["queja ante la comision", "cndh", "comision estatal de derechos humanos"],
    },
    {
      id: "victima_registro",
      label_es: "Inscripción en el Registro Nacional de Víctimas",
      label_en: "Entry in the National Victims Registry",
      authority: "Ley General de Víctimas Art. 96",
      requirement: "recommended",
      patterns: ["registro nacional de victimas", "renavi"],
    },
    {
      id: "control_convencionalidad",
      label_es: "Control de convencionalidad planteado",
      label_en: "Conventionality control raised",
      authority: "CPEUM Art. 1º; CADH",
      requirement: "required",
      patterns: ["control de convencionalidad", "convencion americana", "corte interamericana"],
    },
    {
      id: "reparacion",
      label_es: "Medidas de reparación integral solicitadas",
      label_en: "Integral reparation measures requested",
      authority: "Ley General de Víctimas Art. 26–27",
      requirement: "required",
      patterns: ["reparacion integral", "medidas de reparacion"],
    },
  ],
  // FIX (2239/2018): controversia constitucional / acción de
  // inconstitucionalidad / amparo directo o indirecto en revisión — SCJN
  // judicial review of a norm, act, or amparo ruling. Previously evaluated
  // against "derechos_humanos"'s checklist above, which asserted a CNDH
  // administrative complaint (queja, Ley de la CNDH) as a REQUIRED element
  // of a judicial proceeding that can never file one — a real case (Amparo
  // Directo en Revisión 2239/2018) got exactly that false, scored-negative
  // finding. This checklist reflects what these judicial proceedings
  // actually require instead.
  constitucional: [
    {
      id: "norma_o_acto_impugnado",
      label_es: "Norma general o acto impugnado identificado",
      label_en: "Challenged general norm or act identified",
      authority:
        "Ley Reglamentaria del Art. 105 CPEUM Arts. 22 fr. III y 61 fr. III; Ley de Amparo Art. 88",
      requirement: "required",
      patterns: [
        "norma impugnada",
        "acto impugnado",
        "norma general impugnada",
        "ley impugnada",
        "decreto impugnado",
      ],
    },
    {
      id: "legitimacion_constitucional",
      label_es: "Legitimación del promovente acreditada",
      label_en: "Promovente's standing established",
      authority: "CPEUM Art. 105 fr. I–II; Ley de Amparo Art. 81 fr. II",
      requirement: "required",
      patterns: [
        "legitimacion activa",
        "legitimacion procesal",
        "organo legitimado",
        "actor legitimado",
        "recurrente legitimado",
        "acredita su legitimacion",
      ],
    },
    {
      id: "plazo_impugnacion_constitucional",
      label_es: "Promovido dentro del plazo legal aplicable",
      label_en: "Filed within the applicable statutory term",
      authority: "Ley Reglamentaria del Art. 105 CPEUM Arts. 21 y 60; Ley de Amparo Art. 86",
      requirement: "required",
      patterns: [
        "dentro del plazo",
        "treinta dias",
        "diez dias",
        "plazo para la interposicion",
        "oportunidad del recurso",
        "presentado en tiempo",
        "presentada en tiempo",
      ],
    },
    {
      id: "concepto_invalidez_o_agravios",
      label_es: "Conceptos de invalidez o agravios expresados",
      label_en: "Concepts of invalidity or grievances stated",
      authority:
        "Ley Reglamentaria del Art. 105 CPEUM Arts. 22 fr. VII y 61 fr. V; Ley de Amparo Art. 88",
      requirement: "required",
      patterns: [
        "conceptos de invalidez",
        "concepto de invalidez",
        "agravios",
        "conceptos de violacion",
      ],
    },
    {
      id: "cuestion_constitucionalidad",
      label_es: "Cuestión propiamente constitucional identificada (importancia y trascendencia)",
      label_en: "Genuine constitutional question identified (importancia y trascendencia)",
      authority: "Ley de Amparo Art. 81 fr. II; Acuerdo General 9/2015 SCJN",
      // Recommended, not required: this element is specific to the recurso
      // de revisión vehicle, not to controversia constitucional/acción de
      // inconstitucionalidad — marking it required would produce a false
      // "faltante" on those two proceedings, the same class of error this
      // whole profile exists to stop.
      requirement: "recommended",
      patterns: [
        "importancia y trascendencia",
        "cuestion de constitucionalidad",
        "interpretacion directa de la constitucion",
        "planteamiento de constitucionalidad",
      ],
    },
    {
      id: "suspension_constitucional",
      label_es: "Suspensión solicitada y resuelta, cuando proceda",
      label_en: "Stay requested and resolved, where applicable",
      authority: "Ley Reglamentaria del Art. 105 CPEUM Arts. 14–18",
      requirement: "recommended",
      patterns: ["suspension", "medida cautelar"],
    },
  ],
  laboral: [
    {
      id: "conciliacion_prejudicial",
      label_es: "Conciliación prejudicial agotada (constancia)",
      label_en: "Mandatory pre-trial conciliation exhausted",
      authority: "LFT Art. 684-A a 684-E",
      requirement: "required",
      patterns: ["constancia de no conciliacion", "centro de conciliacion", "conciliacion prejudicial"],
    },
    {
      id: "demanda_prestaciones",
      label_es: "Demanda con prestaciones y hechos precisados",
      label_en: "Claim states benefits sought and facts",
      authority: "LFT Art. 872",
      requirement: "required",
      patterns: ["prestaciones reclamadas", "capitulo de hechos", "demanda laboral"],
    },
    {
      id: "relacion_laboral",
      label_es: "Acreditación de la relación de trabajo",
      label_en: "Employment relationship evidenced",
      authority: "LFT Art. 20–21",
      requirement: "required",
      patterns: ["relacion laboral", "contrato individual de trabajo", "recibos de nomina"],
    },
    {
      id: "salario_integrado",
      label_es: "Salario diario integrado determinado",
      label_en: "Integrated daily wage determined",
      authority: "LFT Art. 84 y 89",
      requirement: "required",
      patterns: ["salario diario integrado", "salario integrado", "sdi"],
    },
    {
      id: "prescripcion",
      label_es: "Acción presentada dentro del plazo de prescripción",
      label_en: "Action filed within the limitation period",
      authority: "LFT Art. 516 y 518",
      requirement: "required",
      patterns: ["prescripcion", "dos meses", "un año"],
    },
    {
      id: "aviso_rescision",
      label_es: "Aviso de rescisión al trabajador",
      label_en: "Notice of termination served on the worker",
      authority: "LFT Art. 47",
      requirement: "recommended",
      patterns: ["aviso de rescision", "aviso de despido"],
    },
  ],
  civil: [
    {
      id: "demanda_requisitos",
      label_es: "Demanda con requisitos de forma",
      label_en: "Complaint meets formal requirements",
      authority: "CNPCyF Art. 267 (o código local)",
      requirement: "required",
      patterns: ["escrito de demanda", "prestaciones", "capitulo de hechos"],
    },
    {
      id: "documentos_base",
      label_es: "Documentos base de la acción exhibidos",
      label_en: "Documents founding the action attached",
      authority: "CNPCyF Art. 270",
      requirement: "required",
      patterns: ["documento base de la accion", "anexos", "contrato"],
    },
    {
      id: "emplazamiento",
      label_es: "Emplazamiento legalmente practicado",
      label_en: "Service of process properly effected",
      authority: "CNPCyF Art. 128–137",
      requirement: "required",
      patterns: ["emplazamiento", "cedula de notificacion", "razon actuarial"],
    },
    {
      id: "contestacion",
      label_es: "Contestación de demanda y excepciones",
      label_en: "Answer and defenses filed",
      authority: "CNPCyF Art. 279",
      requirement: "required",
      patterns: ["contestacion de demanda", "excepciones y defensas"],
    },
    {
      id: "ofrecimiento_pruebas",
      label_es: "Ofrecimiento y admisión de pruebas",
      label_en: "Evidence offered and admitted",
      authority: "CNPCyF Art. 293–300",
      requirement: "required",
      patterns: ["ofrecimiento de pruebas", "admision de pruebas", "auto admisorio"],
    },
    {
      id: "prescripcion_civil",
      label_es: "Acción dentro del plazo de prescripción",
      label_en: "Action within the limitation period",
      authority: "Código Civil aplicable",
      requirement: "recommended",
      patterns: ["prescripcion", "caducidad"],
    },
  ],
  familiar: [
    {
      id: "demanda_familiar",
      label_es: "Demanda familiar con prestaciones",
      label_en: "Family claim stating relief sought",
      authority: "CNPCyF Art. 618",
      requirement: "required",
      patterns: ["demanda de divorcio", "demanda familiar", "prestaciones"],
    },
    {
      id: "interes_superior_menor",
      label_es: "Interés superior del menor invocado y motivado",
      label_en: "Best interest of the child invoked and reasoned",
      authority: "CPEUM Art. 4º; LGDNNA Art. 2",
      requirement: "required",
      patterns: ["interes superior del menor", "interes superior de la niñez"],
    },
    {
      id: "medidas_provisionales",
      label_es: "Medidas provisionales (alimentos, guarda y custodia)",
      label_en: "Provisional measures (support, custody)",
      authority: "CNPCyF Art. 626",
      requirement: "required",
      patterns: ["medidas provisionales", "guarda y custodia", "pension alimenticia"],
    },
    {
      id: "estudios_psicosociales",
      label_es: "Estudios psicológicos / socioeconómicos",
      label_en: "Psychological / socioeconomic assessments",
      authority: "CNPCyF Art. 638",
      requirement: "recommended",
      patterns: ["estudio psicologico", "estudio socioeconomico", "dictamen psicologico"],
    },
    {
      id: "convenio",
      label_es: "Propuesta de convenio regulador",
      label_en: "Proposed settlement agreement",
      authority: "CNPCyF Art. 620",
      requirement: "recommended",
      patterns: ["convenio regulador", "propuesta de convenio"],
    },
  ],
  mercantil: [
    {
      id: "titulo_ejecutivo",
      label_es: "Título ejecutivo o documento base con requisitos",
      label_en: "Enforceable instrument meets statutory requirements",
      authority: "LGTOC Art. 170 (pagaré) / Art. 76 (letra)",
      requirement: "required",
      patterns: ["pagare", "letra de cambio", "titulo ejecutivo", "cheque"],
    },
    {
      id: "requerimiento_pago",
      label_es: "Auto de exequendo / requerimiento de pago",
      label_en: "Payment demand order issued",
      authority: "Código de Comercio Art. 1392",
      requirement: "required",
      patterns: ["auto de exequendo", "requerimiento de pago", "embargo"],
    },
    {
      id: "excepciones_mercantiles",
      label_es: "Excepciones oponibles analizadas",
      label_en: "Available defenses analyzed",
      authority: "LGTOC Art. 8",
      requirement: "required",
      patterns: ["excepciones", "articulo 8", "falsedad de firma"],
    },
    {
      id: "caducidad_cambiaria",
      label_es: "Caducidad / prescripción cambiaria verificada",
      label_en: "Negotiable-instrument limitation period verified",
      authority: "LGTOC Art. 165 y 174",
      requirement: "required",
      patterns: ["prescripcion", "caducidad", "tres años"],
    },
    {
      id: "interes_moratorio",
      label_es: "Intereses moratorios pactados y no usurarios",
      label_en: "Default interest agreed and non-usurious",
      authority: "Jurisprudencia 1a./J. 46/2014 (usura)",
      requirement: "recommended",
      patterns: ["interes moratorio", "usura", "tasa de interes"],
    },
  ],
  fiscal: [
    {
      id: "resolucion_impugnada",
      label_es: "Resolución impugnada identificada y notificada",
      label_en: "Challenged tax ruling identified and served",
      authority: "LFPCA Art. 14 fr. III",
      requirement: "required",
      patterns: ["resolucion impugnada", "credito fiscal", "notificacion"],
    },
    {
      id: "plazo_30_dias",
      label_es: "Demanda dentro de los 30 días hábiles",
      label_en: "Claim filed within 30 business days",
      authority: "LFPCA Art. 13",
      requirement: "required",
      patterns: ["treinta dias", "30 dias habiles", "plazo para demandar"],
    },
    {
      id: "conceptos_impugnacion",
      label_es: "Conceptos de impugnación y agravios",
      label_en: "Grounds of challenge stated",
      authority: "LFPCA Art. 14 fr. VI",
      requirement: "required",
      patterns: ["conceptos de impugnacion", "agravios"],
    },
    {
      id: "garantia_interes_fiscal",
      label_es: "Garantía del interés fiscal / suspensión",
      label_en: "Tax interest guaranteed / collection suspended",
      authority: "CFF Art. 141; LFPCA Art. 24",
      requirement: "recommended",
      patterns: ["garantia del interes fiscal", "suspension del procedimiento administrativo de ejecucion", "pae"],
    },
    {
      id: "motivacion_visita",
      label_es: "Fundamentación y motivación del acto de fiscalización",
      label_en: "Audit act properly grounded and reasoned",
      authority: "CPEUM Art. 16; CFF Art. 38",
      requirement: "required",
      patterns: ["orden de visita", "fundamentacion y motivacion", "acta final"],
    },
  ],
  administrativo: [
    {
      id: "acto_administrativo",
      label_es: "Acto administrativo identificado con sus elementos",
      label_en: "Administrative act and its elements identified",
      authority: "LFPA Art. 3",
      requirement: "required",
      patterns: ["acto administrativo", "resolucion administrativa", "oficio"],
    },
    {
      id: "audiencia_previa",
      label_es: "Garantía de audiencia previa respetada",
      label_en: "Prior hearing guarantee respected",
      authority: "CPEUM Art. 14",
      requirement: "required",
      patterns: ["garantia de audiencia", "derecho de audiencia", "procedimiento administrativo"],
    },
    {
      id: "recurso_revision",
      label_es: "Recurso de revisión o juicio contencioso promovido",
      label_en: "Administrative appeal or contentious claim filed",
      authority: "LFPA Art. 83; LFPCA Art. 13",
      requirement: "required",
      patterns: ["recurso de revision", "juicio contencioso administrativo"],
    },
    {
      id: "notificacion_valida",
      label_es: "Notificación del acto legalmente practicada",
      label_en: "Act validly served",
      authority: "LFPA Art. 35",
      requirement: "required",
      patterns: ["notificacion personal", "cedula de notificacion", "constancia de notificacion"],
    },
  ],
  apelacion: [
    {
      id: "sentencia_recurrida",
      label_es: "Sentencia o auto recurrido identificado",
      label_en: "Appealed judgment or order identified",
      authority: "Código procesal aplicable",
      requirement: "required",
      patterns: ["sentencia recurrida", "auto recurrido", "resolucion apelada"],
    },
    {
      id: "plazo_apelacion",
      label_es: "Recurso interpuesto dentro del plazo legal",
      label_en: "Appeal filed within the statutory term",
      authority: "CNPP Art. 471 / código local",
      requirement: "required",
      patterns: ["plazo para apelar", "tres dias", "diez dias", "interposicion del recurso"],
    },
    {
      id: "agravios",
      label_es: "Expresión de agravios",
      label_en: "Statement of grievances",
      authority: "CNPP Art. 471; CNPCyF",
      requirement: "required",
      patterns: ["agravios", "expresion de agravios"],
    },
    {
      id: "admision_recurso",
      label_es: "Auto de admisión del recurso",
      label_en: "Order admitting the appeal",
      authority: "CNPP Art. 473",
      requirement: "required",
      patterns: ["admision del recurso", "se admite el recurso"],
    },
  ],
  inmobiliario: [
    {
      id: "identificacion_partes",
      label_es: "Identificación de comprador y vendedor conforme a la Ley Antilavado",
      label_en: "Identification of buyer and seller under Mexico's AML law",
      authority: "Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita",
      requirement: "required",
      patterns: ["identificacion oficial", "ine", "pasaporte", "expediente de identificacion"],
    },
    {
      id: "libertad_gravamen_verificada",
      label_es: "Certificado de libertad de gravamen verificado antes de la firma",
      label_en: "No-lien certificate verified before signing",
      authority: "Ley del Notariado (estatal) — deber de verificación previa del notario",
      requirement: "required",
      patterns: ["libertad de gravamen", "certificado de gravamenes"],
    },
    {
      id: "fideicomiso_zona_restringida",
      label_es: "Fideicomiso bancario si el comprador es extranjero y el inmueble está en zona restringida",
      label_en: "Bank trust (fideicomiso) if the buyer is foreign and the property is in the restricted zone",
      authority: "CPEUM Art. 27; Ley de Inversión Extranjera",
      requirement: "recommended",
      patterns: ["fideicomiso", "zona restringida", "banco fiduciario"],
    },
    {
      id: "pago_isai",
      label_es: "Comprobante de pago del impuesto de traslado de dominio (ISAI)",
      label_en: "Proof of transfer-tax (ISAI) payment",
      authority: "Código Fiscal de la Federación / leyes fiscales locales",
      requirement: "required",
      patterns: ["isai", "impuesto sobre adquisicion de inmuebles"],
    },
    {
      id: "inscripcion_rpp_confirmada",
      label_es: "Confirmación de inscripción en el Registro Público de la Propiedad",
      label_en: "Confirmation of registration at the Registro Público de la Propiedad",
      authority: "Reglamento del Registro Público de la Propiedad (estatal)",
      requirement: "required",
      patterns: ["boleta de inscripcion", "folio real inscrito"],
    },
  ],
  // 2026-08-04: new profile — previously agrario cases evaluated against
  // the "civil" checklist above (demanda_requisitos under CNPCyF, etc.),
  // which has no concept of the RAN, the ejido assembly, or a deslinde.
  agrario: [
    {
      id: "demanda_agraria_requisitos",
      label_es: "Demanda agraria con requisitos de forma",
      label_en: "Agrarian complaint meets formal requirements",
      authority: "Ley Agraria Art. 170",
      requirement: "required",
      patterns: ["demanda agraria", "tribunal unitario agrario", "juicio agrario"],
    },
    {
      id: "certificado_ran",
      label_es: "Certificado o constancia del Registro Agrario Nacional exhibido",
      label_en: "Registro Agrario Nacional certificate or record attached",
      authority: "Ley Agraria Art. 152; Reglamento Interior del RAN",
      requirement: "required",
      patterns: ["certificado parcelario", "certificado de derechos agrarios", "registro agrario nacional", " ran "],
    },
    {
      id: "resolucion_asamblea_ejidal",
      label_es: "Resolución de asamblea ejidal o de bienes comunales acreditada",
      label_en: "Ejido or comunal-lands assembly resolution evidenced",
      authority: "Ley Agraria Art. 23",
      requirement: "required",
      patterns: ["asamblea ejidal", "asamblea general de ejidatarios", "acta de asamblea"],
    },
    {
      id: "emplazamiento_agrario",
      label_es: "Emplazamiento al demandado y, en su caso, al núcleo agrario",
      label_en: "Service of process on the defendant and, where relevant, the agrarian núcleo",
      authority: "Ley Agraria Art. 173",
      requirement: "required",
      patterns: ["emplazamiento", "citatorio", "notificacion personal"],
    },
    {
      id: "audiencia_ley_agraria",
      label_es: "Audiencia de ley (contestación, pruebas y alegatos en una sola audiencia)",
      label_en: "Statutory hearing (answer, evidence, and closing argument in one session)",
      authority: "Ley Agraria Art. 185",
      requirement: "required",
      patterns: ["audiencia de ley", "desahogo de pruebas", "alegatos"],
    },
    {
      id: "dictamen_deslinde",
      label_es: "Dictamen de deslinde o levantamiento topográfico, cuando el litigio verse sobre límites",
      label_en: "Boundary-survey (deslinde) opinion, when the dispute concerns limits",
      authority: "Ley Agraria Art. 56; Reglamento Interior del RAN",
      requirement: "recommended",
      patterns: ["deslinde", "levantamiento topografico", "plano parcelario"],
    },
    {
      id: "plazo_accion_agraria",
      label_es: "Acción promovida dentro del plazo aplicable",
      label_en: "Action filed within the applicable limitation period",
      authority: "Ley Agraria (el plazo varía según la acción ejercida)",
      requirement: "recommended",
      patterns: ["prescripcion", "caducidad"],
    },
  ],
  // 2026-08-04: new profile — previously electoral cases evaluated against
  // the "administrativo" checklist (acto administrativo impugnado, etc.),
  // which has no INE/OPLE, casilla, or campaign-finance concepts.
  electoral: [
    {
      id: "medio_de_impugnacion_requisitos",
      label_es: "Medio de impugnación con requisitos de forma",
      label_en: "Electoral challenge meets formal requirements",
      authority: "LGSMIME Art. 9",
      requirement: "required",
      patterns: ["juicio de inconformidad", "recurso de apelacion", "juicio para la proteccion"],
    },
    {
      id: "acta_de_escrutinio_y_computo",
      label_es: "Acta de escrutinio y cómputo de casilla exhibida",
      label_en: "Polling-station tally sheet attached",
      authority: "LGIPE",
      requirement: "required",
      patterns: ["acta de escrutinio y computo", "acta de la mesa directiva de casilla"],
    },
    {
      id: "informe_de_gastos_de_campana",
      label_es: "Informe de gastos de campaña presentado ante el INE",
      label_en: "Campaign-expense report filed with the INE",
      authority: "Reglamento de Fiscalización del INE",
      requirement: "recommended",
      patterns: ["informe de gastos de campana", "fiscalizacion"],
    },
    {
      id: "plazo_de_impugnacion",
      label_es: "Medio de impugnación presentado dentro del plazo de 4 días",
      label_en: "Challenge filed within the 4-day term",
      authority: "LGSMIME Art. 8",
      requirement: "required",
      patterns: ["dentro del plazo", "cuatro dias"],
    },
  ],
  // 2026-08-04: new profile — previously ambiental cases evaluated against
  // the "administrativo" checklist, which has no MIA, PROFEPA, or CONAGUA
  // concepts on it.
  ambiental: [
    {
      id: "mia_o_estudio_de_riesgo",
      label_es: "Manifestación de impacto ambiental o estudio de riesgo presentado",
      label_en: "Environmental impact assessment or risk study filed",
      authority: "LGEEPA Art. 28-35",
      requirement: "required",
      patterns: ["manifestacion de impacto ambiental", "estudio de riesgo ambiental", " mia "],
    },
    {
      id: "licencia_ambiental_vigente",
      label_es: "Licencia ambiental única o autorización vigente",
      label_en: "Current environmental license/authorization",
      authority: "LGEEPA",
      requirement: "required",
      patterns: ["licencia ambiental unica", "autorizacion en materia de impacto ambiental"],
    },
    {
      id: "acta_de_inspeccion_profepa",
      label_es: "Acta de inspección o visita de PROFEPA/ASEA, si hubo procedimiento sancionador",
      label_en: "PROFEPA/ASEA inspection record, if a sanctioning procedure was opened",
      authority: "LGEEPA (procedimiento administrativo sancionador)",
      requirement: "recommended",
      patterns: ["acta de inspeccion", "visita de verificacion", "procedimiento administrativo profepa"],
    },
    {
      id: "concesion_o_permiso_conagua",
      label_es: "Título de concesión de agua o permiso de descarga (si aplica)",
      label_en: "Water concession title or discharge permit (if applicable)",
      authority: "Ley de Aguas Nacionales",
      requirement: "recommended",
      patterns: ["titulo de concesion", "permiso de descarga", "conagua"],
    },
  ],
  // 2026-08-14: new profile (report-quality audit §14). Previously a
  // responsabilidad médica claim evaluated against the generic "civil"
  // checklist, which has no concept of informed consent, clinical-history
  // completeness, standard-of-care (lex artis) expert evidence, or the
  // causal link between the alleged medical act and the injury — the exact
  // elements a malpractice claim actually turns on. See
  // effectiveMxProfile's MEDICAL_MALPRACTICE_TEXT_SIGNAL (mx-pipeline.ts)
  // for how a civil/administrativo case routes here.
  responsabilidad_medica: [
    {
      id: "relacion_medico_paciente",
      label_es: "Relación médico-paciente (deber de cuidado) acreditada",
      label_en: "Physician-patient relationship (duty of care) established",
      authority: "Ley General de Salud Art. 51",
      requirement: "required",
      patterns: ["relacion medico paciente", "atencion medica prestada", "medico tratante"],
    },
    {
      id: "consentimiento_informado_resp_medica",
      label_es: "Consentimiento informado documentado",
      label_en: "Informed consent documented",
      authority: "NOM-004-SSA3-2012; Ley General de Salud Art. 51 Bis 2",
      requirement: "required",
      patterns: ["consentimiento informado", "carta de consentimiento", "consintio el procedimiento"],
    },
    {
      id: "expediente_clinico_completo",
      label_es: "Expediente clínico completo e integrado",
      label_en: "Complete, integrated clinical file",
      authority: "NOM-004-SSA3-2012",
      requirement: "required",
      patterns: ["expediente clinico", "historia clinica", "nota de evolucion", "nota medica"],
    },
    {
      id: "estandar_de_cuidado",
      label_es: "Estándar de cuidado aplicable (lex artis) identificado",
      label_en: "Applicable standard of care (lex artis) identified",
      authority: "NOM-004-SSA3-2012; guías de práctica clínica aplicables",
      requirement: "required",
      patterns: ["lex artis", "estandar de cuidado", "practica medica habitual", "guia de practica clinica"],
    },
    {
      id: "conducta_medica_cuestionada",
      label_es: "Conducta médica cuestionada (acción u omisión) precisada",
      label_en: "Challenged medical act or omission clearly identified",
      authority: "Código Civil aplicable (responsabilidad civil, hecho ilícito)",
      requirement: "required",
      patterns: ["negligencia medica", "impericia", "mala praxis", "omision medica", "error de diagnostico"],
    },
    {
      id: "nexo_causal",
      label_es: "Nexo causal entre la conducta médica y el daño acreditado",
      label_en: "Causal link between the medical act and the injury established",
      authority: "Código Civil aplicable (nexo causal, responsabilidad civil)",
      requirement: "required",
      patterns: ["nexo causal", "relacion de causalidad", "causa directa del dano"],
    },
    {
      id: "dictamen_pericial_medico_resp",
      label_es: "Dictamen pericial médico sobre el estándar de cuidado y/o el nexo causal",
      label_en: "Medical expert opinion on the standard of care and/or causation",
      authority: "CNPCyF Art. 341-360",
      requirement: "required",
      patterns: ["dictamen pericial medico", "perito medico", "dictamen medico"],
    },
    {
      id: "dano_acreditado",
      label_es: "Daño (material, moral o corporal) acreditado",
      label_en: "Injury (material, moral, or bodily) established",
      authority: "Código Civil aplicable Art. 1916 (daño moral) y responsabilidad civil",
      requirement: "required",
      patterns: ["dano moral", "dano material", "lesion corporal", "secuela", "incapacidad"],
    },
    {
      id: "arbitraje_medico_previo",
      label_es: "Queja o arbitraje médico ante CONAMED/CAMEC (vía alterna, si se agotó)",
      label_en: "CONAMED/CAMEC medical-arbitration complaint (alternate route, if pursued)",
      authority: "Reglamento de Procedimientos para la Atención de Quejas Médicas CONAMED",
      requirement: "recommended",
      patterns: ["conamed", "camec", "arbitraje medico", "queja medica"],
    },
  ],
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function complianceChecklist(materia: MxPipelineProfile): readonly ComplianceItem[] {
  return CHECKLISTS[materia];
}

/**
 * Evaluate the materia checklist against the corpus. `corpusText` should be
 * the concatenated extracted text of the case documents.
 */
export function evaluateProceduralCompliance(
  materia: MxPipelineProfile,
  corpusText: string,
): ComplianceReport {
  const hay = normalize(corpusText ?? "");
  const hasCorpus = hay.trim().length > 0;
  const items: ComplianceItemResult[] = complianceChecklist(materia).map((item) => {
    if (!hasCorpus) return { ...item, status: "no_documentado", evidence: null };
    let evidence: string | null = null;
    for (const p of item.patterns) {
      const at = hay.indexOf(normalize(p));
      if (at >= 0) {
        evidence = corpusText.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, " ").trim();
        break;
      }
    }
    return {
      ...item,
      status: evidence ? "cumplido" : "no_identificado_en_corpus",
      evidence,
    };
  });

  const satisfied = items.filter((i) => i.status === "cumplido").length;
  const requiredItems = items.filter((i) => i.requirement === "required");
  const missing_required = requiredItems.filter((i) => i.status !== "cumplido").length;
  const score = items.length === 0 ? 0 : Math.round((satisfied / items.length) * 100);

  // Hedged to match the discipline the findings this report feeds already
  // use (procedural-compliance.server.ts's "no necesariamente una omisión...
  // verifique contra el expediente oficial"): a pattern-search miss against
  // the supplied corpus is never phrased as a confirmed procedural defect.
  const summary = !hasCorpus
    ? "No hay texto extraído suficiente para evaluar el cumplimiento procesal."
    : missing_required === 0
      ? `Cumplimiento procesal completo en materia ${materia}: ${satisfied}/${items.length} requisitos documentados en el corpus.`
      : `No se identificaron en el corpus constancias o referencias suficientes para confirmar ${missing_required} elemento(s) procesal(es) obligatorio(s) o potencialmente aplicable(s) en materia ${materia}: ` +
        requiredItems
          .filter((i) => i.status !== "cumplido")
          .map((i) => `${i.label_es} (${i.authority})`)
          .join("; ") +
        ". Esto no demuestra por sí mismo que dichos elementos estén ausentes del expediente oficial — verifique contra el expediente antes de asumir un defecto procesal.";

  return { materia, evaluated: items.length, satisfied, missing_required, score, items, summary };
}
