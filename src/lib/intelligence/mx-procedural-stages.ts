// =============================================================================
// PROCEDURAL STAGE MAP — pure module.
//
// For every materia (Mexican pipeline profile) this module defines the
// ordered sequence of procedural stages a matter passes through, each with
// its statutory hook and the corpus text patterns that evidence it was
// reached. `resolveProceduralStage` walks the sequence against the extracted
// document corpus and reports where the matter currently stands: which
// stages are documented as completed, which one is "current" (the furthest
// stage evidenced), what should come next, and which earlier stages in the
// sequence were never documented (a procedural risk — e.g. a case that shows
// a sentencia but no constancia of emplazamiento).
//
// Deterministic, pattern-driven — no model calls, so it can never invent a
// procedural history that isn't in the record.
// =============================================================================

import {
  type MxPipelineProfile,
  type ConstitucionalReviewSubtype,
  resolveConstitucionalReviewSubtype,
} from "../execution/mx-pipeline";

export type ProceduralStageDef = {
  id: string;
  label_es: string;
  label_en: string;
  /** Statutory hook, e.g. "CNPP Art. 313-316". */
  authority: string;
  /** Corpus text patterns (accent/case-insensitive) that evidence this stage was reached. */
  patterns: readonly string[];
};

export type ProceduralStageStatus = ProceduralStageDef & {
  detected: boolean;
  evidence: string | null;
};

export type ProceduralStageResolution = {
  materia: MxPipelineProfile;
  stages: ProceduralStageStatus[];
  /** Furthest stage evidenced in the corpus, or null if none was detected. */
  current: ProceduralStageStatus | null;
  /** All detected stages, in sequence order. */
  completed: ProceduralStageStatus[];
  /** The stage immediately following `current` in the sequence, or null at the end. */
  next: ProceduralStageDef | null;
  /** Stages that precede `current` in the sequence but were never documented — a gap. */
  missing_requirements: ProceduralStageDef[];
  /** Spanish, attorney-facing risk narratives derived from the gaps above. */
  procedural_risks: string[];
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const STAGE_MAPS: Record<MxPipelineProfile, readonly ProceduralStageDef[]> = {
  penal: [
    {
      id: "denuncia_querella",
      label_es: "Denuncia o querella",
      label_en: "Criminal complaint filed",
      authority: "CNPP Art. 221-222",
      patterns: ["denuncia", "querella", "noticia criminal"],
    },
    {
      id: "carpeta_investigacion",
      label_es: "Carpeta de investigación iniciada",
      label_en: "Investigation file opened",
      authority: "CNPP Art. 213-221",
      patterns: ["carpeta de investigacion", "numero unico de caso", "nuc "],
    },
    {
      id: "control_detencion",
      label_es: "Control de la detención / audiencia inicial",
      label_en: "Detention review / initial hearing",
      authority: "CNPP Art. 307-308",
      patterns: ["control de la detencion", "audiencia inicial", "calificacion de la detencion"],
    },
    {
      id: "vinculacion_proceso",
      label_es: "Vinculación a proceso",
      label_en: "Binding-over order",
      authority: "CNPP Art. 313-316",
      patterns: ["vinculacion a proceso", "auto de vinculacion"],
    },
    {
      id: "medidas_cautelares",
      label_es: "Imposición de medidas cautelares",
      label_en: "Precautionary measures imposed",
      authority: "CNPP Art. 153-158",
      patterns: ["medidas cautelares", "prision preventiva", "garantia economica"],
    },
    {
      id: "investigacion_complementaria",
      label_es: "Cierre de investigación complementaria",
      label_en: "Supplemental investigation closed",
      authority: "CNPP Art. 321",
      patterns: ["cierre de investigacion", "investigacion complementaria"],
    },
    {
      id: "etapa_intermedia",
      label_es: "Etapa intermedia / auto de apertura a juicio",
      label_en: "Intermediate stage / order opening trial",
      authority: "CNPP Art. 334-347",
      patterns: ["auto de apertura a juicio", "etapa intermedia", "acusacion"],
    },
    {
      id: "juicio_oral",
      label_es: "Juicio oral / audiencia de debate",
      label_en: "Oral trial / debate hearing",
      authority: "CNPP Art. 348-401",
      patterns: ["audiencia de juicio oral", "audiencia de debate"],
    },
    {
      id: "sentencia",
      label_es: "Sentencia dictada",
      label_en: "Judgment rendered",
      authority: "CNPP Art. 399-409",
      patterns: ["sentencia condenatoria", "sentencia absolutoria", "individualizacion de la sancion"],
    },
    {
      id: "ejecucion",
      label_es: "Ejecución de sanciones",
      label_en: "Sentence enforcement",
      authority: "Ley Nacional de Ejecución Penal",
      patterns: ["juez de ejecucion", "ejecucion de la pena"],
    },
  ],
  amparo: [
    {
      id: "acto_reclamado",
      label_es: "Identificación del acto reclamado",
      label_en: "Challenged act identified",
      authority: "Ley de Amparo Art. 108 fr. IV",
      patterns: ["acto reclamado"],
    },
    {
      id: "demanda_amparo",
      label_es: "Presentación de la demanda de amparo",
      label_en: "Amparo claim filed",
      authority: "Ley de Amparo Art. 108",
      patterns: ["demanda de amparo"],
    },
    {
      id: "auto_admision",
      label_es: "Auto que admite la demanda",
      label_en: "Order admitting the claim",
      authority: "Ley de Amparo Art. 112-113",
      patterns: ["auto admisorio", "se admite a tramite la demanda de amparo"],
    },
    {
      id: "suspension",
      label_es: "Resolución de la suspensión",
      label_en: "Ruling on the stay (suspensión)",
      authority: "Ley de Amparo Art. 125-129",
      patterns: ["suspension provisional", "suspension definitiva", "incidente de suspension"],
    },
    {
      id: "informe_justificado",
      label_es: "Rendición del informe justificado",
      label_en: "Authority's justifying report filed",
      authority: "Ley de Amparo Art. 117-119",
      patterns: ["informe justificado"],
    },
    {
      id: "audiencia_constitucional",
      label_es: "Audiencia constitucional",
      label_en: "Constitutional hearing",
      authority: "Ley de Amparo Art. 119-124",
      patterns: ["audiencia constitucional"],
    },
    {
      id: "sentencia_amparo",
      label_es: "Sentencia de amparo",
      label_en: "Amparo judgment",
      authority: "Ley de Amparo Art. 73-79",
      patterns: ["sentencia que concede el amparo", "sentencia que niega el amparo", "sentencia de amparo"],
    },
    {
      id: "cumplimiento_ejecutoria",
      label_es: "Cumplimiento de la ejecutoria",
      label_en: "Compliance with the amparo ruling",
      authority: "Ley de Amparo Art. 192-198",
      patterns: ["cumplimiento de la ejecutoria", "cumplimiento sustituto"],
    },
  ],
  derechos_humanos: [
    {
      id: "hechos_violatorios",
      label_es: "Registro de los hechos presuntamente violatorios",
      label_en: "Alleged violation recorded",
      authority: "Ley de la CNDH Art. 3",
      patterns: ["hechos violatorios", "presunta violacion a derechos humanos"],
    },
    {
      id: "queja",
      label_es: "Presentación de la queja",
      label_en: "Complaint filed",
      authority: "Ley de la CNDH Art. 25-27",
      patterns: ["queja ante la comision", "cndh", "comision estatal de derechos humanos"],
    },
    {
      id: "investigacion_comision",
      label_es: "Investigación por la comisión",
      label_en: "Commission investigation",
      authority: "Ley de la CNDH Art. 34-40",
      patterns: ["expediente de queja", "investigacion de la comision"],
    },
    {
      id: "recomendacion",
      label_es: "Emisión de recomendación",
      label_en: "Recommendation issued",
      authority: "Ley de la CNDH Art. 44-46",
      patterns: ["recomendacion", "punto recomendatorio"],
    },
    {
      id: "seguimiento_reparacion",
      label_es: "Seguimiento y reparación integral",
      label_en: "Follow-up and integral reparation",
      authority: "Ley General de Víctimas Art. 26-27",
      patterns: ["reparacion integral", "seguimiento a la recomendacion"],
    },
  ],
  constitucional: [
    {
      id: "norma_o_acto_impugnado",
      label_es: "Identificación de la norma o acto impugnado",
      label_en: "Challenged norm or act identified",
      authority: "Ley Reglamentaria del Art. 105 Arts. 22 y 61; Ley de Amparo Art. 88",
      patterns: ["norma impugnada", "acto impugnado"],
    },
    {
      id: "presentacion_demanda_constitucional",
      label_es: "Presentación de la demanda o recurso",
      label_en: "Complaint or appeal filed",
      authority: "Ley Reglamentaria del Art. 105 Arts. 21 y 60; Ley de Amparo Art. 86",
      patterns: [
        "demanda de controversia constitucional",
        "demanda de accion de inconstitucionalidad",
        "recurso de revision",
      ],
    },
    {
      id: "admision_constitucional",
      label_es: "Auto de admisión",
      label_en: "Order admitting the claim",
      authority: "Ley Reglamentaria del Art. 105 Art. 25; Ley de Amparo Art. 92",
      patterns: ["se admite a tramite", "auto admisorio"],
    },
    {
      id: "conceptos_de_invalidez_o_agravios",
      label_es: "Conceptos de invalidez o agravios formulados",
      label_en: "Concepts of invalidity or grievances stated",
      authority: "Ley Reglamentaria del Art. 105 Arts. 22 fr. VII y 61 fr. V",
      patterns: ["conceptos de invalidez", "agravios"],
    },
    {
      id: "sentencia_constitucional",
      label_es: "Sentencia del Pleno o la Sala de la SCJN",
      label_en: "SCJN Pleno/Sala judgment",
      authority: "Ley Reglamentaria del Art. 105 Arts. 41-45 y 72-73",
      patterns: ["sentencia del pleno", "resuelve la suprema corte", "engrose"],
    },
  ],
  laboral: [
    {
      id: "conciliacion_prejudicial",
      label_es: "Conciliación prejudicial",
      label_en: "Mandatory pre-trial conciliation",
      authority: "LFT Art. 684-A a 684-E",
      patterns: ["centro de conciliacion", "constancia de no conciliacion", "conciliacion prejudicial"],
    },
    {
      id: "demanda_laboral",
      label_es: "Presentación de la demanda laboral",
      label_en: "Labor claim filed",
      authority: "LFT Art. 872",
      patterns: ["demanda laboral"],
    },
    {
      id: "contestacion_laboral",
      label_es: "Contestación de la demanda",
      label_en: "Answer to the claim filed",
      authority: "LFT Art. 873, 878",
      patterns: ["contestacion de demanda", "excepciones y defensas"],
    },
    {
      id: "audiencia_preliminar",
      label_es: "Audiencia preliminar",
      label_en: "Preliminary hearing",
      authority: "LFT Art. 873-879",
      patterns: ["audiencia preliminar"],
    },
    {
      id: "ofrecimiento_pruebas_laboral",
      label_es: "Ofrecimiento y admisión de pruebas",
      label_en: "Evidence offered and admitted",
      authority: "LFT Art. 880-885",
      patterns: ["ofrecimiento de pruebas", "admision de pruebas"],
    },
    {
      id: "audiencia_juicio_laboral",
      label_es: "Audiencia de juicio",
      label_en: "Trial hearing",
      authority: "LFT Art. 873",
      patterns: ["audiencia de juicio"],
    },
    {
      id: "laudo",
      label_es: "Dictado del laudo o sentencia laboral",
      label_en: "Labor award/judgment rendered",
      authority: "LFT Art. 889-891",
      patterns: ["laudo", "sentencia laboral"],
    },
    {
      id: "ejecucion_laudo",
      label_es: "Ejecución del laudo",
      label_en: "Enforcement of the labor award",
      authority: "LFT Art. 940-950",
      patterns: ["ejecucion del laudo", "embargo laboral"],
    },
  ],
  civil: [
    {
      id: "demanda_civil",
      label_es: "Presentación de la demanda",
      label_en: "Complaint filed",
      authority: "CNPCyF Art. 267",
      patterns: ["escrito de demanda", "demanda civil"],
    },
    {
      id: "emplazamiento",
      label_es: "Emplazamiento a la parte demandada",
      label_en: "Service of process on the defendant",
      authority: "CNPCyF Art. 128-137",
      patterns: ["emplazamiento", "cedula de notificacion", "razon actuarial"],
    },
    {
      id: "contestacion_civil",
      label_es: "Contestación de demanda",
      label_en: "Answer filed",
      authority: "CNPCyF Art. 279",
      patterns: ["contestacion de demanda"],
    },
    {
      id: "ofrecimiento_pruebas_civil",
      label_es: "Ofrecimiento y admisión de pruebas",
      label_en: "Evidence offered and admitted",
      authority: "CNPCyF Art. 293-300",
      patterns: ["ofrecimiento de pruebas", "auto admisorio de pruebas"],
    },
    {
      id: "desahogo_pruebas",
      label_es: "Desahogo de pruebas",
      label_en: "Evidence taken",
      authority: "CNPCyF Art. 301-330",
      patterns: ["desahogo de pruebas", "audiencia de pruebas"],
    },
    {
      id: "alegatos",
      label_es: "Formulación de alegatos",
      label_en: "Closing arguments filed",
      authority: "CNPCyF Art. 348",
      patterns: ["alegatos"],
    },
    {
      id: "sentencia_civil",
      label_es: "Sentencia definitiva",
      label_en: "Final judgment",
      authority: "CNPCyF Art. 350-360",
      patterns: ["sentencia definitiva"],
    },
    {
      id: "ejecucion_sentencia",
      label_es: "Ejecución de sentencia",
      label_en: "Judgment enforcement",
      authority: "CNPCyF Art. 400-420",
      patterns: ["via de apremio", "ejecucion de sentencia"],
    },
  ],
  familiar: [
    {
      id: "demanda_familiar",
      label_es: "Presentación de la demanda familiar",
      label_en: "Family claim filed",
      authority: "CNPCyF Art. 618",
      patterns: ["demanda de divorcio", "demanda familiar"],
    },
    {
      id: "medidas_provisionales",
      label_es: "Medidas provisionales decretadas",
      label_en: "Provisional measures ordered",
      authority: "CNPCyF Art. 626",
      patterns: ["medidas provisionales", "guarda y custodia", "pension alimenticia"],
    },
    {
      id: "contestacion_familiar",
      label_es: "Contestación de la demanda familiar",
      label_en: "Answer to the family claim filed",
      authority: "CNPCyF Art. 619",
      patterns: ["contestacion de demanda"],
    },
    {
      id: "estudios_psicosociales",
      label_es: "Práctica de estudios psicosociales",
      label_en: "Psychosocial assessments conducted",
      authority: "CNPCyF Art. 638",
      patterns: ["estudio psicologico", "estudio socioeconomico"],
    },
    {
      id: "audiencia_familiar",
      label_es: "Audiencia de juicio familiar",
      label_en: "Family trial hearing",
      authority: "CNPCyF Art. 640",
      patterns: ["audiencia de juicio familiar", "audiencia de juicio"],
    },
    {
      id: "sentencia_familiar",
      label_es: "Sentencia familiar",
      label_en: "Family judgment",
      authority: "CNPCyF Art. 645",
      patterns: ["sentencia definitiva", "sentencia de divorcio"],
    },
  ],
  mercantil: [
    {
      id: "demanda_mercantil",
      label_es: "Presentación de la demanda mercantil",
      label_en: "Commercial claim filed",
      authority: "Código de Comercio Art. 1061",
      patterns: ["demanda mercantil", "juicio ejecutivo mercantil", "juicio oral mercantil"],
    },
    {
      id: "auto_exequendo",
      label_es: "Auto de exequendo / requerimiento de pago",
      label_en: "Payment demand order issued",
      authority: "Código de Comercio Art. 1392",
      patterns: ["auto de exequendo", "requerimiento de pago", "embargo"],
    },
    {
      id: "contestacion_mercantil",
      label_es: "Contestación y oposición de excepciones",
      label_en: "Answer and defenses filed",
      authority: "Código de Comercio Art. 1399",
      patterns: ["contestacion de demanda", "excepciones"],
    },
    {
      id: "pruebas_mercantil",
      label_es: "Ofrecimiento y desahogo de pruebas",
      label_en: "Evidence offered and taken",
      authority: "Código de Comercio Art. 1401",
      patterns: ["ofrecimiento de pruebas", "desahogo de pruebas"],
    },
    {
      id: "sentencia_mercantil",
      label_es: "Sentencia mercantil",
      label_en: "Commercial judgment",
      authority: "Código de Comercio Art. 1406-1410",
      patterns: ["sentencia definitiva"],
    },
    {
      id: "ejecucion_mercantil",
      label_es: "Ejecución de sentencia / remate",
      label_en: "Judgment enforcement / auction",
      authority: "Código de Comercio Art. 1410-1414",
      patterns: ["remate", "via de apremio"],
    },
  ],
  fiscal: [
    {
      id: "acto_fiscalizacion",
      label_es: "Acto de fiscalización (orden de visita/revisión)",
      label_en: "Audit act (visit/desk-review order)",
      authority: "CFF Art. 42-49",
      patterns: ["orden de visita", "revision de gabinete", "orden de auditoria"],
    },
    {
      id: "resolucion_determinante",
      label_es: "Resolución determinante del crédito fiscal",
      label_en: "Tax assessment ruling issued",
      authority: "CFF Art. 50",
      patterns: ["resolucion determinante", "credito fiscal", "liquidacion"],
    },
    {
      id: "recurso_revocacion",
      label_es: "Recurso de revocación interpuesto",
      label_en: "Administrative appeal (revocación) filed",
      authority: "CFF Art. 116-133",
      patterns: ["recurso de revocacion"],
    },
    {
      id: "juicio_contencioso",
      label_es: "Juicio contencioso administrativo (TFJA)",
      label_en: "Contentious administrative claim (TFJA)",
      authority: "LFPCA Art. 1-14",
      patterns: ["juicio contencioso administrativo", "tribunal federal de justicia administrativa", "tfja"],
    },
    {
      id: "sentencia_tfja",
      label_es: "Sentencia del TFJA",
      label_en: "TFJA judgment",
      authority: "LFPCA Art. 49-52",
      patterns: ["sentencia definitiva", "sala regional"],
    },
  ],
  administrativo: [
    {
      id: "acto_administrativo",
      label_es: "Emisión del acto administrativo",
      label_en: "Administrative act issued",
      authority: "LFPA Art. 3",
      patterns: ["acto administrativo", "resolucion administrativa", "oficio"],
    },
    {
      id: "notificacion_administrativa",
      label_es: "Notificación del acto",
      label_en: "Act served on the interested party",
      authority: "LFPA Art. 35",
      patterns: ["notificacion personal", "cedula de notificacion"],
    },
    {
      id: "recurso_revision_administrativo",
      label_es: "Recurso de revisión administrativo",
      label_en: "Administrative review appeal",
      authority: "LFPA Art. 83",
      patterns: ["recurso de revision"],
    },
    {
      id: "juicio_contencioso_administrativo",
      label_es: "Juicio contencioso administrativo",
      label_en: "Contentious administrative claim",
      authority: "LFPCA Art. 13",
      patterns: ["juicio contencioso administrativo"],
    },
    {
      id: "sentencia_administrativa",
      label_es: "Sentencia administrativa",
      label_en: "Administrative judgment",
      authority: "LFPCA Art. 49-52",
      patterns: ["sentencia definitiva"],
    },
  ],
  apelacion: [
    {
      id: "sentencia_recurrida",
      label_es: "Sentencia o auto recurrido",
      label_en: "Appealed judgment or order",
      authority: "Código procesal aplicable",
      patterns: ["sentencia recurrida", "auto recurrido", "resolucion apelada"],
    },
    {
      id: "interposicion_apelacion",
      label_es: "Interposición del recurso de apelación",
      label_en: "Appeal filed",
      authority: "CNPP Art. 471 / código local",
      patterns: ["interposicion del recurso", "recurso de apelacion"],
    },
    {
      id: "admision_apelacion",
      label_es: "Admisión del recurso",
      label_en: "Appeal admitted",
      authority: "CNPP Art. 473",
      patterns: ["se admite el recurso", "admision del recurso"],
    },
    {
      id: "expresion_agravios",
      label_es: "Expresión de agravios",
      label_en: "Statement of grievances filed",
      authority: "CNPP Art. 471; CNPCyF",
      patterns: ["expresion de agravios", "agravios"],
    },
    {
      id: "vista_contraparte",
      label_es: "Vista a la contraparte / contestación de agravios",
      label_en: "Opposing party's response to grievances",
      authority: "CNPCyF (segunda instancia)",
      patterns: ["contestacion de agravios", "vista a la contraparte"],
    },
    {
      id: "resolucion_segunda_instancia",
      label_es: "Resolución de segunda instancia",
      label_en: "Second-instance ruling",
      authority: "CNPCyF / CNPP (apelación)",
      patterns: ["confirma la sentencia", "revoca la sentencia", "modifica la sentencia", "resolucion de segunda instancia"],
    },
  ],
  inmobiliario: [
    {
      id: "due_diligence",
      label_es: "Due diligence / verificación de título",
      label_en: "Due diligence / title verification",
      authority: "Práctica notarial estándar",
      patterns: ["due diligence", "verificacion de titulo", "estudio de titulo"],
    },
    {
      id: "firma_escritura",
      label_es: "Firma de la escritura ante Notario Público",
      label_en: "Deed signed before a Notario Público",
      authority: "Ley del Notariado (estatal)",
      patterns: ["escritura publica numero", "ante la fe del notario", "firma de la escritura"],
    },
    {
      id: "pago_isai",
      label_es: "Pago del impuesto de traslado de dominio (ISAI/ISR)",
      label_en: "Transfer-tax payment (ISAI/ISR)",
      authority: "Código Fiscal de la Federación / leyes fiscales locales",
      patterns: ["impuesto sobre adquisicion de inmuebles", "isai", "pago de impuesto de traslado de dominio"],
    },
    {
      id: "inscripcion_rpp",
      label_es: "Inscripción en el Registro Público de la Propiedad",
      label_en: "Registration at the Registro Público de la Propiedad",
      authority: "Reglamento del Registro Público de la Propiedad (estatal)",
      patterns: ["inscripcion en el registro publico", "folio real inscrito", "boleta de inscripcion"],
    },
    {
      id: "cierre",
      label_es: "Cierre (entrega y liberación de fondos)",
      label_en: "Closing (possession transfer and funds release)",
      authority: "Contrato de compraventa / instrucciones de cierre",
      patterns: ["entrega de posesion", "liberacion de fondos", "cierre de la operacion"],
    },
  ],
  // 2026-08-04: new profile — the audiencia de ley concentrates
  // contestación, ofrecimiento/desahogo de pruebas, and alegatos into a
  // single hearing (Ley Agraria Art. 185), unlike civil's separated stages.
  agrario: [
    {
      id: "demanda_agraria",
      label_es: "Presentación de la demanda agraria",
      label_en: "Agrarian complaint filed",
      authority: "Ley Agraria Art. 170",
      patterns: ["demanda agraria", "escrito de demanda"],
    },
    {
      id: "emplazamiento_agrario",
      label_es: "Emplazamiento o citación al demandado",
      label_en: "Service of process / notice to the defendant",
      authority: "Ley Agraria Art. 173",
      patterns: ["emplazamiento", "citatorio", "notificacion personal"],
    },
    {
      id: "audiencia_de_ley",
      label_es: "Audiencia de ley (contestación, pruebas y alegatos)",
      label_en: "Statutory hearing (answer, evidence, and closing argument)",
      authority: "Ley Agraria Art. 185",
      patterns: ["audiencia de ley", "desahogo de pruebas", "alegatos"],
    },
    {
      id: "sentencia_agraria",
      label_es: "Sentencia",
      label_en: "Judgment",
      authority: "Ley Agraria Art. 189",
      patterns: ["sentencia", "resolutivos"],
    },
    {
      id: "ejecucion_sentencia_agraria",
      label_es: "Ejecución de sentencia",
      label_en: "Judgment enforcement",
      authority: "Ley Agraria Art. 192",
      patterns: ["ejecucion de sentencia", "cumplimiento de sentencia"],
    },
  ],
  // 2026-08-04: new profile.
  electoral: [
    {
      id: "acto_o_resolucion_impugnada",
      label_es: "Acto o resolución impugnada emitida",
      label_en: "Challenged act or resolution issued",
      authority: "LGSMIME Art. 6",
      patterns: ["acuerdo impugnado", "resolucion impugnada"],
    },
    {
      id: "presentacion_medio_de_impugnacion",
      label_es: "Presentación del medio de impugnación",
      label_en: "Electoral challenge filed",
      authority: "LGSMIME Art. 9",
      patterns: ["juicio de inconformidad", "recurso de apelacion", "juicio para la proteccion"],
    },
    {
      id: "sustanciacion_electoral",
      label_es: "Sustanciación (informe circunstanciado, pruebas)",
      label_en: "Substantiation (informe circunstanciado, evidence)",
      authority: "LGSMIME Art. 17-18",
      patterns: ["informe circunstanciado", "tercero interesado"],
    },
    {
      id: "sentencia_electoral",
      label_es: "Sentencia del TEPJF u OPLE",
      label_en: "TEPJF or OPLE judgment",
      authority: "LGSMIME",
      patterns: ["sentencia", "resuelve"],
    },
  ],
  // 2026-08-04: new profile.
  ambiental: [
    {
      id: "mia_presentada",
      label_es: "Presentación de la MIA o estudio de riesgo",
      label_en: "Environmental impact assessment / risk study filed",
      authority: "LGEEPA Art. 28-35",
      patterns: ["manifestacion de impacto ambiental", "estudio de riesgo ambiental"],
    },
    {
      id: "visita_de_inspeccion",
      label_es: "Visita de inspección PROFEPA/ASEA",
      label_en: "PROFEPA/ASEA inspection visit",
      authority: "LGEEPA (procedimiento administrativo sancionador)",
      patterns: ["visita de verificacion", "acta de inspeccion"],
    },
    {
      id: "medidas_de_seguridad_o_clausura",
      label_es: "Medidas de seguridad o clausura impuestas",
      label_en: "Safety measures or closure imposed",
      authority: "LGEEPA",
      patterns: ["medidas de seguridad", "clausura"],
    },
    {
      id: "resolucion_administrativa_ambiental",
      label_es: "Resolución del procedimiento administrativo sancionador",
      label_en: "Sanctioning-procedure resolution",
      authority: "LGEEPA",
      patterns: ["resolucion administrativa", "resolutivo"],
    },
  ],
  // Responsabilidad médica (private-practice claim) is procedurally an
  // ordinary civil action — same demanda/emplazamiento/contestación/
  // pruebas/alegatos/sentencia sequence under the CNPCyF, no distinct
  // procedural stages of its own. What differs is the CHECKLIST content
  // (procedural-compliance.ts) and required-documents list
  // (mx-missing-documents.ts), not this stage sequence — duplicated here
  // deliberately rather than aliased, so a future change to civil's stage
  // list doesn't silently also change this profile's list should the two
  // ever need to diverge (e.g. once a public-institution/administrativo
  // variant is modeled).
  responsabilidad_medica: [
    {
      id: "demanda_resp_medica",
      label_es: "Presentación de la demanda",
      label_en: "Complaint filed",
      authority: "CNPCyF Art. 267",
      patterns: ["escrito de demanda", "demanda civil"],
    },
    {
      id: "emplazamiento_resp_medica",
      label_es: "Emplazamiento a la parte demandada",
      label_en: "Service of process on the defendant",
      authority: "CNPCyF Art. 128-137",
      patterns: ["emplazamiento", "cedula de notificacion", "razon actuarial"],
    },
    {
      id: "contestacion_resp_medica",
      label_es: "Contestación de demanda",
      label_en: "Answer filed",
      authority: "CNPCyF Art. 279",
      patterns: ["contestacion de demanda"],
    },
    {
      id: "ofrecimiento_pruebas_resp_medica",
      label_es: "Ofrecimiento y admisión de pruebas, incluido el dictamen pericial médico",
      label_en: "Evidence offered and admitted, including the medical expert opinion",
      authority: "CNPCyF Art. 293-300, 341-360",
      patterns: ["ofrecimiento de pruebas", "auto admisorio de pruebas", "dictamen pericial medico"],
    },
    {
      id: "desahogo_pruebas_resp_medica",
      label_es: "Desahogo de pruebas",
      label_en: "Evidence taken",
      authority: "CNPCyF Art. 301-330",
      patterns: ["desahogo de pruebas", "audiencia de pruebas"],
    },
    {
      id: "alegatos_resp_medica",
      label_es: "Formulación de alegatos",
      label_en: "Closing arguments filed",
      authority: "CNPCyF Art. 348",
      patterns: ["alegatos"],
    },
    {
      id: "sentencia_resp_medica",
      label_es: "Sentencia definitiva",
      label_en: "Final judgment",
      authority: "CNPCyF Art. 350-360",
      patterns: ["sentencia definitiva"],
    },
  ],
};

/**
 * Per-subtype authority override for the "constitucional" stage map's items
 * whose `authority` field (above) combines multiple proceedings' governing
 * law into one string — same bug/fix as procedural-compliance.ts's
 * CONSTITUCIONAL_AUTHORITY_OVERRIDES (see that file's comment for the full
 * rationale and the real-case reproduction). Every value here is a VERBATIM
 * substring already present in that item's combined citation; items with no
 * verified per-subtype alternative on record (admision_constitucional's
 * "Art. 25" component, sentencia_constitucional) are left untouched rather
 * than guessed at.
 */
const CONSTITUCIONAL_AUTHORITY_OVERRIDES: Partial<
  Record<string, Partial<Record<ConstitucionalReviewSubtype, string>>>
> = {
  norma_o_acto_impugnado: {
    controversia_constitucional: "Ley Reglamentaria del Art. 105 Art. 22",
    accion_inconstitucionalidad: "Ley Reglamentaria del Art. 105 Art. 61",
    amparo_en_revision: "Ley de Amparo Art. 88",
  },
  presentacion_demanda_constitucional: {
    controversia_constitucional: "Ley Reglamentaria del Art. 105 Art. 21",
    accion_inconstitucionalidad: "Ley Reglamentaria del Art. 105 Art. 60",
    amparo_en_revision: "Ley de Amparo Art. 86",
  },
  admision_constitucional: {
    amparo_en_revision: "Ley de Amparo Art. 92",
  },
  conceptos_de_invalidez_o_agravios: {
    controversia_constitucional: "Ley Reglamentaria del Art. 105 Art. 22 fr. VII",
    accion_inconstitucionalidad: "Ley Reglamentaria del Art. 105 Art. 61 fr. V",
    amparo_en_revision: "Ley de Amparo Art. 88",
  },
};

export function proceduralStageMap(
  materia: MxPipelineProfile,
  corpusText?: string,
): readonly ProceduralStageDef[] {
  const base = STAGE_MAPS[materia];
  if (materia !== "constitucional" || !corpusText) return base;
  const subtype = resolveConstitucionalReviewSubtype(corpusText);
  if (!subtype) return base;
  return base.map((def) => {
    const override = CONSTITUCIONAL_AUTHORITY_OVERRIDES[def.id]?.[subtype];
    return override ? { ...def, authority: override } : def;
  });
}

/**
 * Resolve where a matter currently stands in its procedural sequence based
 * on the extracted document corpus. Pure, deterministic pattern matching —
 * the "current" stage is the furthest-along stage evidenced in the record;
 * any earlier stage in the sequence that was never documented is flagged as
 * a procedural risk (a gap in the record, not necessarily a gap in reality,
 * but one the attorney must be able to explain).
 */
export function resolveProceduralStage(
  materia: MxPipelineProfile,
  corpusText: string,
): ProceduralStageResolution {
  const defs = proceduralStageMap(materia, corpusText);
  const hay = normalize(corpusText ?? "");
  const hasCorpus = hay.trim().length > 0;

  const stages: ProceduralStageStatus[] = defs.map((def) => {
    if (!hasCorpus) return { ...def, detected: false, evidence: null };
    let evidence: string | null = null;
    for (const p of def.patterns) {
      const at = hay.indexOf(normalize(p));
      if (at >= 0) {
        evidence = corpusText.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, " ").trim();
        break;
      }
    }
    return { ...def, detected: evidence !== null, evidence };
  });

  let currentIdx = -1;
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].detected) {
      currentIdx = i;
      break;
    }
  }

  const current = currentIdx >= 0 ? stages[currentIdx] : null;
  const completed = stages.filter((s) => s.detected);
  const next = currentIdx >= 0 && currentIdx < stages.length - 1 ? defs[currentIdx + 1] : currentIdx === -1 ? defs[0] ?? null : null;

  const missing_requirements: ProceduralStageDef[] =
    currentIdx >= 0 ? stages.slice(0, currentIdx).filter((s) => !s.detected).map(({ detected: _d, evidence: _e, ...def }) => def) : [];

  const procedural_risks = missing_requirements.map(
    (m) =>
      `El expediente evidencia la etapa "${current?.label_es}" sin documentar previamente "${m.label_es}" (${m.authority}); ` +
      "debe verificarse que dicha etapa se haya cumplido para no exponer el trámite a una reposición del procedimiento.",
  );

  return { materia, stages, current, completed, next, missing_requirements, procedural_risks };
}
