// =============================================================================
// UNIVERSAL LEGAL-ACT REGISTRY (NYRAVA México)
//
// The deterministic evidence-synthesis engine is ONE platform capability. Its
// methodology (agreements, conflicts, complementarity, gaps, evidentiary
// weight, procedural sequence, cross-finding dependency) is identical for
// every Mexican matter. What changes per matter is only the VOCABULARY of
// legal facts and procedural events, declared here as data.
//
// Rules for this file:
//   · No case-specific, document-name-specific or dataset-specific entries.
//   · Every materia inherits UNIVERSAL_LEXICON (procedural/documentary acts
//     common to all Mexican proceedings) and layers its own acts on top.
//   · A future materia is supported by adding one entry to MATERIA_LEXICON
//     (or an alias) — never by touching the synthesis engine or the report.
//   · An unknown/absent materia degrades to the universal lexicon, so the
//     engine still produces the same analysis, only with fewer act kinds.
//
// All patterns are matched against accent-stripped, lower-cased text.
// =============================================================================

import { MX_CASE_TYPES, type MexicanCaseType } from "@/lib/jurisdiction/mexico-types";

export type ActKey = string;

/**
 * Reference from a legal act to a normative instrument declared in
 * src/lib/legal/authority-registry.ts. Data only — carries no conclusion.
 */
export type ActAuthorityRef = {
  authority_id: string;
  /** How central the instrument is to the act (0–1). Ranking hint only. */
  relevance_weight: number;
};

/** Period during which the act, as declared, is recognised. */
export type ActValidity = { from: string; until?: string | null };

export type ActRule = {
  act: ActKey;
  /** Attorney-facing Spanish label of the legal fact / procedural event. */
  label: string;
  re: RegExp;
  /** Alternative attorney-facing names for the same act. */
  aliases?: readonly string[];
  /** Authoritative context for the act (never state-duplicated). */
  authorities?: readonly ActAuthorityRef[];
  validity?: ActValidity;
};

/** Antecedent → consequent pair: two documents evidencing different links. */
export type ActSequence = { from: ActKey; to: ActKey; relation: string };

/** Act whose expected follow-up, when absent from the cited corpus, is stated. */
export type ActGap = { act: ActKey; needs: ActKey[]; gap: string };

export type ActLexicon = {
  acts: ActRule[];
  sequences: ActSequence[];
  gaps: ActGap[];
};


// ---------------------------------------------------------------------------
// Universal layer — present in every Mexican matter
// ---------------------------------------------------------------------------

const UNIVERSAL_ACTS: ActRule[] = [
  {
    act: "notificacion_realizada",
    label: "notificación practicada",
    aliases: ["notificación", "aviso", "emplazamiento"],
    re: /(se notific|notificacion personal|cedula de notificacion|emplazamiento|acuse de recibo|se corri[oó] traslado|notificado en)/,
    authorities: [
      { authority_id: "cpeum", relevance_weight: 0.95 },
      { authority_id: "cnpcf", relevance_weight: 0.8 },
      { authority_id: "codigo_procedimientos_civiles_estatal", relevance_weight: 0.7 },
    ],
    validity: { from: "1917-05-01", until: null },
  },
  {
    act: "autoridad_notificada",
    label: "conocimiento de la autoridad",
    aliases: ["vista a la autoridad", "oficio"],
    re: /(se dio vista a|oficio dirigido a|se hizo del conocimiento de la autoridad|se inform[oó] a la autoridad|presentado ante la autoridad|acuse de presentacion)/,
    authorities: [
      { authority_id: "cpeum", relevance_weight: 0.9 },
      { authority_id: "lfpa", relevance_weight: 0.6 },
    ],
    validity: { from: "1917-05-01", until: null },
  },
  {
    act: "plazo_procesal",
    label: "plazo o término procesal",
    aliases: ["término", "vencimiento", "caducidad"],
    re: /(plazo de \d|termino de \d|dentro de los \d{1,3} dias|vence el|caducidad|prescripcion|preclusion|surte efectos)/,
    authorities: [
      { authority_id: "cpeum", relevance_weight: 0.9 },
      { authority_id: "jurisprudencia_scjn", relevance_weight: 0.6 },
    ],
    validity: { from: "1917-05-01", until: null },
  },
  {
    act: "promocion_presentada",
    label: "promoción presentada",
    aliases: ["escrito inicial", "demanda", "denuncia"],
    re: /(escrito inicial|se present[oó] (?:la )?(?:demanda|denuncia|promocion|solicitud|recurso)|demanda presentada|por presentado)/,
    authorities: [{ authority_id: "cpeum", relevance_weight: 0.95 }],
    validity: { from: "1917-05-01", until: null },
  },
  {
    act: "acuerdo_dictado",
    label: "acuerdo o proveído dictado",
    aliases: ["auto", "proveído", "acuerdo"],
    re: /(auto de radicacion|se admite a tramite|acuerdo de fecha|proveido|se dicta auto|auto admisorio)/,
    authorities: [{ authority_id: "cpeum", relevance_weight: 0.9 }],
    validity: { from: "1917-05-01", until: null },
  },

  {
    act: "audiencia_celebrada",
    label: "audiencia celebrada",
    re: /(acta de audiencia|se celebr[oó] la audiencia|audiencia de|comparecencia de las partes|desahogo de la audiencia)/,
  },
  {
    act: "dictamen_rendido",
    label: "dictamen pericial rendido",
    re: /(dictamen pericial|perito design|rindi[oó] dictamen|opinion tecnica|peritaje)/,
  },
  {
    act: "testimonio_rendido",
    label: "declaración testimonial",
    re: /(declaracion del testigo|testimonial a cargo|manifest[oó] bajo protesta|entrevista al testigo|declar[oó] ante)/,
  },
  {
    act: "resolucion_dictada",
    label: "resolución o sentencia dictada",
    re: /(se resuelve|sentencia definitiva|resolucion de fecha|laudo|se declara (?:procedente|improcedente)|resolutivo primero)/,
  },
  {
    act: "recurso_interpuesto",
    label: "medio de impugnación interpuesto",
    re: /(recurso de (?:apelacion|revision|revocacion|queja|reclamacion)|se interpone recurso|inconformidad presentada|juicio de nulidad)/,
  },
  {
    act: "registro_inscrito",
    label: "inscripción registral",
    re: /(inscripcion en el registro|folio real|inscrito bajo|registro publico|quedo inscrit|constancia de inscripcion)/,
  },
  {
    act: "documento_certificado",
    label: "certificación o fe pública",
    re: /(doy fe|ante mi(?:,| ) notario|fedatario publico|copia certificada|certifico que|secretario de acuerdos certifica)/,
  },
];

const UNIVERSAL_SEQUENCES: ActSequence[] = [
  {
    from: "promocion_presentada",
    to: "acuerdo_dictado",
    relation: "la presentación de la promoción y el acuerdo recaído a ella",
  },
  {
    from: "acuerdo_dictado",
    to: "notificacion_realizada",
    relation: "el acuerdo dictado y su notificación a las partes",
  },
  {
    from: "notificacion_realizada",
    to: "plazo_procesal",
    relation: "la notificación practicada y el cómputo del plazo procesal",
  },
  {
    from: "audiencia_celebrada",
    to: "resolucion_dictada",
    relation: "el desahogo de la audiencia y la resolución dictada",
  },
  {
    from: "resolucion_dictada",
    to: "recurso_interpuesto",
    relation: "la resolución dictada y su impugnación",
  },
];

const UNIVERSAL_GAPS: ActGap[] = [
  {
    act: "promocion_presentada",
    needs: ["acuerdo_dictado", "resolucion_dictada"],
    gap: "Ninguno de los documentos citados acredita el acuerdo o resolución recaída a la promoción presentada.",
  },
  {
    act: "acuerdo_dictado",
    needs: ["notificacion_realizada"],
    gap: "Ninguno de los documentos citados acredita la notificación del acuerdo dictado.",
  },
  {
    act: "resolucion_dictada",
    needs: ["notificacion_realizada", "recurso_interpuesto"],
    gap: "Ninguno de los documentos citados acredita la notificación de la resolución ni su firmeza.",
  },
];

export const UNIVERSAL_LEXICON: ActLexicon = {
  acts: UNIVERSAL_ACTS,
  sequences: UNIVERSAL_SEQUENCES,
  gaps: UNIVERSAL_GAPS,
};

// ---------------------------------------------------------------------------
// Obligational layer — shared by the patrimonial matters
// ---------------------------------------------------------------------------

const OBLIGATION_ACTS: ActRule[] = [
  {
    act: "contrato_celebrado",
    label: "celebración del contrato",
    re: /(celebran el (?:presente )?contrato|contrato celebrado|suscriben el|de com[uú]n acuerdo celebran|convenio celebrado|clausula primera)/,
  },
  {
    act: "obligacion_creada",
    label: "creación de una obligación",
    re: /(se obliga|se obligan|obligacion de pago|se compromete a|se comprometen a|debera pagar|deberan pagar|contrae la obligacion|queda obligad)/,
  },
  {
    act: "obligacion_cumplida",
    label: "cumplimiento de la obligación",
    re: /(dio cumplimiento|se dio cumplimiento|cumpli[oó] con|liquid[oó] el adeudo|saldo cubierto|finiquit|pago total|carta finiquito|no existe adeudo)/,
  },
  {
    act: "pago_reconocido",
    label: "reconocimiento de pago",
    re: /(recib[ií] de conformidad|acuse de pago|pago recibido|comprobante de pago|transferencia (?:por|de)|dep[oó]sito por|abono por|se pag[oó])/,
  },
  {
    act: "incumplimiento_alegado",
    label: "incumplimiento señalado",
    re: /(incumpli|no pag[oó]|adeudo pendiente|saldo insoluto|mora|falta de pago|omiti[oó] entregar|rescision por)/,
  },
  {
    act: "requerimiento_de_pago",
    label: "requerimiento o interpelación",
    re: /(requerimiento de pago|se requiere el pago|interpelacion judicial|se apercibe|carta de requerimiento)/,
  },
  {
    act: "posesion_entregada",
    label: "entrega de la posesión",
    re: /(entrega de la posesion|posesion material|acta de entrega|se entrega el inmueble|entrega recepcion)/,
  },
  {
    act: "danos_reclamados",
    label: "daños y perjuicios reclamados",
    re: /(danos y perjuicios|dano moral|indemnizacion por|reparacion del dano|lucro cesante)/,
  },
];

const OBLIGATION_SEQUENCES: ActSequence[] = [
  {
    from: "contrato_celebrado",
    to: "obligacion_creada",
    relation: "la celebración del contrato y la obligación que de él deriva",
  },
  {
    from: "obligacion_creada",
    to: "obligacion_cumplida",
    relation: "la creación de la obligación y su cumplimiento",
  },
  {
    from: "obligacion_creada",
    to: "pago_reconocido",
    relation: "la creación de la obligación y el pago reconocido",
  },
  {
    from: "obligacion_creada",
    to: "incumplimiento_alegado",
    relation: "la obligación pactada y el incumplimiento señalado",
  },
  {
    from: "incumplimiento_alegado",
    to: "requerimiento_de_pago",
    relation: "el incumplimiento señalado y el requerimiento formulado",
  },
  {
    from: "contrato_celebrado",
    to: "posesion_entregada",
    relation: "la celebración del contrato y la entrega de la posesión",
  },
  {
    from: "contrato_celebrado",
    to: "registro_inscrito",
    relation: "la celebración del contrato y su inscripción registral",
  },
];

const OBLIGATION_GAPS: ActGap[] = [
  {
    act: "obligacion_creada",
    needs: ["obligacion_cumplida", "pago_reconocido"],
    gap: "Ninguno de los documentos citados acredita el cumplimiento de la obligación referida.",
  },
  {
    act: "incumplimiento_alegado",
    needs: ["requerimiento_de_pago", "notificacion_realizada"],
    gap: "Ninguno de los documentos citados acredita el requerimiento o interpelación previa al incumplimiento señalado.",
  },
  {
    act: "contrato_celebrado",
    needs: ["registro_inscrito", "posesion_entregada", "pago_reconocido"],
    gap: "Ninguno de los documentos citados acredita actos de ejecución posteriores a la celebración del contrato.",
  },
];

const OBLIGATION_LEXICON: ActLexicon = {
  acts: OBLIGATION_ACTS,
  sequences: OBLIGATION_SEQUENCES,
  gaps: OBLIGATION_GAPS,
};

// ---------------------------------------------------------------------------
// Matter-specific layers
// ---------------------------------------------------------------------------

const FAMILIAR: ActLexicon = {
  acts: [
    {
      act: "guarda_custodia",
      label: "guarda y custodia",
      re: /(guarda y custodia|custodia provisional|custodia definitiva|custodia compartida)/,
    },
    {
      act: "regimen_convivencia",
      label: "régimen de convivencia o visitas",
      re: /(regimen de (?:convivencia|visitas)|convivencias supervisadas|dias de convivencia)/,
    },
    {
      act: "pension_alimenticia",
      label: "pensión alimenticia",
      re: /(pension alimenticia|alimentos provisionales|alimentos definitivos|porcentaje del salario|deposito de alimentos)/,
    },
    {
      act: "violencia_familiar",
      label: "violencia familiar o medida de protección",
      re: /(violencia familiar|medidas de proteccion|orden de proteccion|maltrato|agresion fisica o psicologica)/,
    },
    {
      act: "convenio_familiar",
      label: "convenio entre los progenitores",
      re: /(convenio de divorcio|propuesta de convenio|convenio judicial|acuerdo parental|clausulas del convenio)/,
    },
    {
      act: "interes_superior_menor",
      label: "valoración del interés superior del menor",
      re: /(interes superior (?:del|de la|de los) (?:menor|nina|nino|adolescente)|escucha del menor|estudio psicosocial|dictamen psicologico del menor)/,
    },
    {
      act: "estado_civil_acreditado",
      label: "acreditación del estado civil o filiación",
      re: /(acta de matrimonio|acta de nacimiento|acta de divorcio|reconocimiento de paternidad|prueba de adn)/,
    },
  ],
  sequences: [
    {
      from: "convenio_familiar",
      to: "pension_alimenticia",
      relation: "el convenio celebrado y la obligación alimentaria que de él deriva",
    },
    {
      from: "violencia_familiar",
      to: "regimen_convivencia",
      relation: "los hechos de violencia y la modalidad de convivencia decretada",
    },
    {
      from: "guarda_custodia",
      to: "regimen_convivencia",
      relation: "la custodia atribuida y el régimen de convivencia correlativo",
    },
    {
      from: "interes_superior_menor",
      to: "resolucion_dictada",
      relation: "la valoración del interés superior del menor y la resolución dictada",
    },
  ],
  gaps: [
    {
      act: "pension_alimenticia",
      needs: ["pago_reconocido", "resolucion_dictada"],
      gap: "Ninguno de los documentos citados acredita el pago o la fijación judicial de la pensión alimenticia referida.",
    },
    {
      act: "guarda_custodia",
      needs: ["interes_superior_menor"],
      gap: "Ninguno de los documentos citados contiene el estudio o valoración del interés superior del menor que sustente la custodia.",
    },
    {
      act: "violencia_familiar",
      needs: ["resolucion_dictada", "documento_certificado"],
      gap: "Ninguno de los documentos citados acredita la medida de protección decretada frente a los hechos de violencia.",
    },
  ],
};

const SUCESIONES: ActLexicon = {
  acts: [
    {
      act: "defuncion_acreditada",
      label: "acreditación del fallecimiento",
      re: /(acta de defuncion|fallecimiento de|de cujus|autor de la sucesion)/,
    },
    {
      act: "testamento_otorgado",
      label: "otorgamiento de testamento",
      re: /(testamento publico abierto|testamento olografo|ultima voluntad|instituye heredero)/,
    },
    {
      act: "declaracion_herederos",
      label: "declaración de herederos",
      re: /(declaracion de herederos|reconocimiento de derechos hereditarios|seccion (?:primera|segunda)|denuncia (?:del|de la) (?:intestado|sucesion))/,
    },
    {
      act: "albacea_designado",
      label: "designación y aceptación del albacea",
      re: /(albacea|acepta(?:cion)? del cargo|discernimiento del cargo|interventor designado)/,
    },
    {
      act: "inventario_avaluo",
      label: "inventario y avalúo de la masa hereditaria",
      re: /(inventario y avaluo|masa hereditaria|caudal hereditario|avaluo del inmueble hereditario)/,
    },
    {
      act: "adjudicacion_bienes",
      label: "adjudicación de bienes",
      re: /(adjudicacion (?:de bienes|por herencia)|escritura de adjudicacion|particion de la herencia|proyecto de particion)/,
    },
  ],
  sequences: [
    {
      from: "defuncion_acreditada",
      to: "declaracion_herederos",
      relation: "el fallecimiento acreditado y la declaración de herederos",
    },
    {
      from: "declaracion_herederos",
      to: "albacea_designado",
      relation: "la declaración de herederos y la designación del albacea",
    },
    {
      from: "albacea_designado",
      to: "inventario_avaluo",
      relation: "el cargo de albacea y la formación del inventario",
    },
    {
      from: "inventario_avaluo",
      to: "adjudicacion_bienes",
      relation: "el inventario formado y la adjudicación de los bienes",
    },
  ],
  gaps: [
    {
      act: "declaracion_herederos",
      needs: ["inventario_avaluo", "albacea_designado"],
      gap: "Ninguno de los documentos citados acredita el inventario o el albaceazgo posteriores a la declaración de herederos.",
    },
    {
      act: "testamento_otorgado",
      needs: ["defuncion_acreditada"],
      gap: "Ninguno de los documentos citados acredita el fallecimiento que abre la sucesión testamentaria referida.",
    },
  ],
};

const PENAL: ActLexicon = {
  acts: [
    {
      act: "denuncia_querella",
      label: "denuncia o querella presentada",
      re: /(denuncia (?:presentada|de hechos)|querella|carpeta de investigacion|noticia criminal)/,
    },
    {
      act: "cadena_custodia",
      label: "registro de cadena de custodia",
      re: /(cadena de custodia|registro de cadena|embalaje|indicio (?:numero|marcado)|sellado del indicio)/,
    },
    {
      act: "aseguramiento_objetos",
      label: "aseguramiento o decomiso",
      re: /(aseguramiento de|objetos asegurados|decomiso|puesta a disposicion de los bienes)/,
    },
    {
      act: "cateo_registro",
      label: "cateo, inspección o registro",
      re: /(orden de cateo|inspeccion ministerial|registro del domicilio|acta de cateo|revision corporal)/,
    },
    {
      act: "detencion_realizada",
      label: "detención y puesta a disposición",
      re: /(detencion en flagrancia|puesta a disposicion|informe policial homologado|control de detencion)/,
    },
    {
      act: "entrevista_declaracion",
      label: "entrevista o declaración ministerial",
      re: /(entrevista al?(?: la)? (?:testigo|victima|imputado)|declaracion ministerial|ampliacion de declaracion)/,
    },
    {
      act: "dictamen_forense",
      label: "dictamen forense",
      re: /(dictamen (?:medico|quimico|balistico|dactiloscopico|forense)|necropsia|informe pericial en materia de)/,
    },
    {
      act: "imputacion_formulada",
      label: "formulación de imputación",
      re: /(formulacion de imputacion|se formula imputacion|audiencia inicial|vinculacion a proceso)/,
    },
    {
      act: "medida_cautelar",
      label: "medida cautelar impuesta",
      re: /(prision preventiva|medida cautelar|garantia economica|presentacion periodica)/,
    },
    {
      act: "derechos_leidos",
      label: "lectura de derechos y defensa técnica",
      re: /(lectura de derechos|derechos del imputado|defensor publico|asistencia consular|se le hizo saber sus derechos)/,
    },
  ],
  sequences: [
    {
      from: "denuncia_querella",
      to: "imputacion_formulada",
      relation: "la noticia criminal y la formulación de imputación",
    },
    {
      from: "detencion_realizada",
      to: "derechos_leidos",
      relation: "la detención y la lectura de derechos al detenido",
    },
    {
      from: "aseguramiento_objetos",
      to: "cadena_custodia",
      relation: "el aseguramiento del indicio y su registro de cadena de custodia",
    },
    {
      from: "cadena_custodia",
      to: "dictamen_forense",
      relation: "la cadena de custodia del indicio y el dictamen practicado sobre él",
    },
    {
      from: "imputacion_formulada",
      to: "medida_cautelar",
      relation: "la imputación formulada y la medida cautelar impuesta",
    },
  ],
  gaps: [
    {
      act: "aseguramiento_objetos",
      needs: ["cadena_custodia"],
      gap: "Ninguno de los documentos citados acredita la cadena de custodia del indicio asegurado.",
    },
    {
      act: "detencion_realizada",
      needs: ["derechos_leidos", "acuerdo_dictado"],
      gap: "Ninguno de los documentos citados acredita la lectura de derechos ni el control judicial de la detención.",
    },
    {
      act: "cateo_registro",
      needs: ["acuerdo_dictado", "resolucion_dictada"],
      gap: "Ninguno de los documentos citados contiene la autorización judicial del acto de molestia practicado.",
    },
  ],
};

const LABORAL: ActLexicon = {
  acts: [
    {
      act: "relacion_laboral",
      label: "existencia de la relación laboral",
      re: /(contrato individual de trabajo|relacion laboral|fecha de ingreso|puesto desempenado|jornada de trabajo)/,
    },
    {
      act: "salario_acreditado",
      label: "salario y pagos acreditados",
      re: /(recibo de nomina|salario diario integrado|pago de nomina|percepciones y deducciones|cfdi de nomina)/,
    },
    {
      act: "terminacion_relacion",
      label: "terminación de la relación laboral",
      re: /(despido|rescision de la relacion|aviso de rescision|renuncia voluntaria|baja del trabajador)/,
    },
    {
      act: "horas_extra",
      label: "tiempo extraordinario",
      re: /(horas extra|tiempo extraordinario|jornada extraordinaria|control de asistencia|registro de entradas)/,
    },
    {
      act: "seguridad_social",
      label: "inscripción y aportaciones de seguridad social",
      re: /(imss|infonavit|afore|alta ante el instituto|semanas cotizadas|riesgo de trabajo)/,
    },
    {
      act: "prestaciones_pagadas",
      label: "pago de prestaciones",
      re: /(aguinaldo|prima vacacional|vacaciones pagadas|ptu|finiquito laboral|liquidacion pagada)/,
    },
    {
      act: "contrato_colectivo",
      label: "contrato colectivo o sindical",
      re: /(contrato colectivo|sindicato|revision contractual|emplazamiento a huelga|clausula de exclusion)/,
    },
  ],
  sequences: [
    {
      from: "relacion_laboral",
      to: "salario_acreditado",
      relation: "la relación laboral acreditada y el salario efectivamente pagado",
    },
    {
      from: "terminacion_relacion",
      to: "prestaciones_pagadas",
      relation: "la terminación de la relación y el pago de las prestaciones correlativas",
    },
    {
      from: "relacion_laboral",
      to: "seguridad_social",
      relation: "la relación laboral y su registro ante las instituciones de seguridad social",
    },
    {
      from: "terminacion_relacion",
      to: "notificacion_realizada",
      relation: "la terminación y el aviso o notificación al trabajador",
    },
  ],
  gaps: [
    {
      act: "terminacion_relacion",
      needs: ["notificacion_realizada", "prestaciones_pagadas"],
      gap: "Ninguno de los documentos citados acredita el aviso de rescisión ni el pago de prestaciones derivado de la terminación.",
    },
    {
      act: "horas_extra",
      needs: ["salario_acreditado"],
      gap: "Ninguno de los documentos citados contiene registros de pago que reflejen el tiempo extraordinario referido.",
    },
    {
      act: "relacion_laboral",
      needs: ["seguridad_social", "salario_acreditado"],
      gap: "Ninguno de los documentos citados acredita el registro de seguridad social ni los pagos de la relación laboral referida.",
    },
  ],
};

const ADMINISTRATIVO: ActLexicon = {
  acts: [
    {
      act: "acto_administrativo",
      label: "emisión del acto administrativo",
      re: /(acto administrativo|oficio numero|resolucion administrativa|acuerdo de la autoridad|se emite la orden)/,
    },
    {
      act: "competencia_autoridad",
      label: "fundamentación de la competencia",
      re: /(competencia de la autoridad|fundamento de competencia|articulo .{0,30}reglamento interior|autoridad emisora)/,
    },
    {
      act: "procedimiento_administrativo",
      label: "integración del expediente administrativo",
      re: /(expediente administrativo|procedimiento administrativo|garantia de audiencia|visita de verificacion|acta circunstanciada)/,
    },
    {
      act: "sancion_impuesta",
      label: "sanción o multa impuesta",
      re: /(multa impuesta|sancion administrativa|clausura|revocacion de (?:permiso|licencia)|inhabilitacion)/,
    },
    {
      act: "recurso_administrativo",
      label: "recurso administrativo interpuesto",
      re: /(recurso de revision administrativa|recurso de inconformidad|juicio contencioso administrativo|tfja)/,
    },
  ],
  sequences: [
    {
      from: "procedimiento_administrativo",
      to: "acto_administrativo",
      relation: "la sustanciación del procedimiento y el acto administrativo emitido",
    },
    {
      from: "acto_administrativo",
      to: "notificacion_realizada",
      relation: "el acto administrativo y su notificación al particular",
    },
    {
      from: "acto_administrativo",
      to: "recurso_administrativo",
      relation: "el acto emitido y su impugnación en sede administrativa",
    },
    {
      from: "sancion_impuesta",
      to: "recurso_administrativo",
      relation: "la sanción impuesta y el medio de defensa promovido",
    },
  ],
  gaps: [
    {
      act: "acto_administrativo",
      needs: ["competencia_autoridad"],
      gap: "Ninguno de los documentos citados contiene la fundamentación de competencia de la autoridad emisora.",
    },
    {
      act: "sancion_impuesta",
      needs: ["procedimiento_administrativo"],
      gap: "Ninguno de los documentos citados acredita la garantía de audiencia previa a la sanción impuesta.",
    },
    {
      act: "acto_administrativo",
      needs: ["notificacion_realizada"],
      gap: "Ninguno de los documentos citados acredita la notificación legal del acto administrativo referido.",
    },
  ],
};

const FISCAL: ActLexicon = {
  acts: [
    {
      act: "obligacion_fiscal",
      label: "obligación fiscal registrada",
      re: /(rfc|obligaciones fiscales|regimen fiscal|constancia de situacion fiscal|declaracion (?:anual|provisional))/,
    },
    {
      act: "comprobante_fiscal",
      label: "comprobante fiscal digital",
      re: /(cfdi|comprobante fiscal|uuid fiscal|factura electronica|complemento de pago)/,
    },
    {
      act: "registro_contable",
      label: "registro contable",
      re: /(contabilidad electronica|poliza contable|balanza de comprobacion|estado de cuenta bancario|auxiliar contable)/,
    },
    {
      act: "facultades_comprobacion",
      label: "ejercicio de facultades de comprobación",
      re: /(visita domiciliaria|revision de gabinete|requerimiento de informacion|orden de visita|facultades de comprobacion)/,
    },
    {
      act: "credito_fiscal",
      label: "determinación de crédito fiscal",
      re: /(credito fiscal|liquidacion determinada|contribuciones omitidas|actualizacion y recargos|resolucion determinante)/,
    },
    {
      act: "pago_contribucion",
      label: "pago de contribuciones",
      re: /(linea de captura|pago de contribuciones|acuse de pago sat|entero del impuesto|compensacion aplicada)/,
    },
  ],
  sequences: [
    {
      from: "facultades_comprobacion",
      to: "credito_fiscal",
      relation: "el ejercicio de facultades de comprobación y el crédito fiscal determinado",
    },
    {
      from: "comprobante_fiscal",
      to: "registro_contable",
      relation: "el comprobante fiscal y su registro en la contabilidad",
    },
    {
      from: "credito_fiscal",
      to: "pago_contribucion",
      relation: "el crédito determinado y el pago o garantía correspondiente",
    },
    {
      from: "credito_fiscal",
      to: "recurso_interpuesto",
      relation: "el crédito determinado y su impugnación",
    },
  ],
  gaps: [
    {
      act: "credito_fiscal",
      needs: ["facultades_comprobacion"],
      gap: "Ninguno de los documentos citados acredita el ejercicio de facultades de comprobación que precede al crédito determinado.",
    },
    {
      act: "comprobante_fiscal",
      needs: ["pago_contribucion", "registro_contable"],
      gap: "Ninguno de los documentos citados acredita el pago o el registro contable del comprobante fiscal referido.",
    },
  ],
};

const AGRARIO: ActLexicon = {
  acts: [
    {
      act: "asamblea_ejidal",
      label: "asamblea ejidal celebrada",
      re: /(asamblea (?:general )?(?:de ejidatarios|ejidal)|acta de asamblea|quorum de la asamblea|convocatoria a asamblea)/,
    },
    {
      act: "resolucion_agraria",
      label: "resolución agraria o dotación",
      re: /(resolucion presidencial|dotacion de tierras|ampliacion del ejido|tribunal unitario agrario)/,
    },
    {
      act: "derechos_ejidales",
      label: "acreditación de derechos ejidales",
      re: /(certificado (?:parcelario|de derechos)|titulo de propiedad ejidal|padron de ejidatarios|calidad de ejidatario|avecindado)/,
    },
    {
      act: "posesion_agraria",
      label: "posesión de la unidad de dotación",
      re: /(posesion de la parcela|posesion material de la unidad|explotacion de la parcela|usufructo parcelario)/,
    },
    {
      act: "limites_deslinde",
      label: "límites, deslinde y medición",
      re: /(deslinde|linderos|plano (?:topografico|interno)|medicion de la parcela|conflicto de limites)/,
    },
    {
      act: "registro_agrario",
      label: "inscripción ante el Registro Agrario Nacional",
      re: /(registro agrario nacional|ran|inscripcion agraria|constancia del ran)/,
    },
  ],
  sequences: [
    {
      from: "asamblea_ejidal",
      to: "derechos_ejidales",
      relation: "el acuerdo de asamblea y el certificado de derechos que de él deriva",
    },
    {
      from: "derechos_ejidales",
      to: "registro_agrario",
      relation: "los derechos reconocidos y su inscripción registral agraria",
    },
    {
      from: "limites_deslinde",
      to: "posesion_agraria",
      relation: "el deslinde practicado y la posesión ejercida sobre la superficie",
    },
  ],
  gaps: [
    {
      act: "asamblea_ejidal",
      needs: ["registro_agrario", "derechos_ejidales"],
      gap: "Ninguno de los documentos citados acredita la inscripción o el certificado derivado del acuerdo de asamblea.",
    },
    {
      act: "posesion_agraria",
      needs: ["derechos_ejidales", "limites_deslinde"],
      gap: "Ninguno de los documentos citados acredita el título o el deslinde que respalde la posesión referida.",
    },
  ],
};

const MERCANTIL: ActLexicon = {
  acts: [
    {
      act: "titulo_credito",
      label: "título de crédito suscrito",
      re: /(pagare|letra de cambio|cheque(?: numero)?|titulo de credito|endoso en propiedad)/,
    },
    {
      act: "acto_comercio",
      label: "acto de comercio documentado",
      re: /(operacion mercantil|orden de compra|remision de mercancia|contrato de suministro|acto de comercio)/,
    },
    {
      act: "estado_cuenta_certificado",
      label: "estado de cuenta certificado",
      re: /(estado de cuenta certificado|certificacion de contador|saldo certificado)/,
    },
    {
      act: "protesto_requerimiento",
      label: "protesto o requerimiento mercantil",
      re: /(protesto|falta de pago del titulo|requerimiento mercantil|devolucion del cheque)/,
    },
    {
      act: "garantia_otorgada",
      label: "garantía otorgada",
      re: /(aval|garantia prendaria|hipoteca en garantia|obligado solidario|fianza otorgada)/,
    },
  ],
  sequences: [
    {
      from: "acto_comercio",
      to: "titulo_credito",
      relation: "la operación mercantil y el título de crédito que la documenta",
    },
    {
      from: "titulo_credito",
      to: "protesto_requerimiento",
      relation: "el título suscrito y el protesto o requerimiento por su falta de pago",
    },
    {
      from: "titulo_credito",
      to: "garantia_otorgada",
      relation: "la obligación cambiaria y la garantía que la respalda",
    },
  ],
  gaps: [
    {
      act: "titulo_credito",
      needs: ["protesto_requerimiento", "requerimiento_de_pago"],
      gap: "Ninguno de los documentos citados acredita el protesto o requerimiento del título de crédito referido.",
    },
  ],
};

const CORPORATIVO: ActLexicon = {
  acts: [
    {
      act: "acta_constitutiva",
      label: "constitución de la sociedad",
      re: /(acta constitutiva|escritura constitutiva|estatutos sociales|objeto social)/,
    },
    {
      act: "asamblea_socios",
      label: "asamblea de socios o accionistas",
      re: /(asamblea (?:general )?(?:ordinaria|extraordinaria|de accionistas|de socios)|acta de asamblea|libro de actas)/,
    },
    {
      act: "poder_otorgado",
      label: "otorgamiento de poderes",
      re: /(poder (?:general|especial)|apoderado legal|facultades para actos de|revocacion de poder)/,
    },
    {
      act: "cambio_estructura",
      label: "modificación estructural societaria",
      re: /(aumento de capital|reduccion de capital|fusion|escision|transmision de acciones|cesion de partes sociales)/,
    },
  ],
  sequences: [
    {
      from: "asamblea_socios",
      to: "cambio_estructura",
      relation: "el acuerdo de asamblea y la modificación societaria adoptada",
    },
    {
      from: "cambio_estructura",
      to: "registro_inscrito",
      relation: "la modificación societaria y su inscripción en el registro de comercio",
    },
    {
      from: "acta_constitutiva",
      to: "poder_otorgado",
      relation: "la constitución de la sociedad y las facultades conferidas a sus representantes",
    },
  ],
  gaps: [
    {
      act: "cambio_estructura",
      needs: ["registro_inscrito", "asamblea_socios"],
      gap: "Ninguno de los documentos citados acredita el acuerdo de asamblea o la inscripción registral de la modificación societaria.",
    },
  ],
};

const INMOBILIARIO: ActLexicon = {
  acts: [
    {
      act: "titulo_propiedad",
      label: "título de propiedad",
      re: /(escritura publica de compraventa|titulo de propiedad|antecedente registral|escritura numero)/,
    },
    {
      act: "certificado_gravamenes",
      label: "certificado de libertad de gravámenes",
      re: /(certificado de (?:libertad de )?gravamenes|libre de gravamen|sin gravamen inscrito)/,
    },
    {
      act: "avaluo_practicado",
      label: "avalúo practicado",
      re: /(avaluo (?:comercial|bancario|catastral)|valor de mercado del inmueble|perito valuador)/,
    },
    {
      act: "predial_servicios",
      label: "constancias de predial y servicios",
      re: /(impuesto predial|boleta predial|constancia de no adeudo|servicio de agua|derechos de agua)/,
    },
    {
      act: "uso_suelo",
      label: "uso de suelo y licencias",
      re: /(uso de suelo|licencia de construccion|constancia de alineamiento|numero oficial)/,
    },
  ],
  sequences: [
    {
      from: "titulo_propiedad",
      to: "registro_inscrito",
      relation: "el título de propiedad y su inscripción en el Registro Público",
    },
    {
      from: "certificado_gravamenes",
      to: "titulo_propiedad",
      relation: "el estado registral del inmueble y el título que lo respalda",
    },
    {
      from: "avaluo_practicado",
      to: "titulo_propiedad",
      relation: "el valor determinado y la operación traslativa documentada",
    },
  ],
  gaps: [
    {
      act: "titulo_propiedad",
      needs: ["registro_inscrito", "certificado_gravamenes"],
      gap: "Ninguno de los documentos citados acredita la inscripción registral ni el estado de gravámenes del inmueble.",
    },
  ],
};

const AMPARO: ActLexicon = {
  acts: [
    {
      act: "acto_reclamado",
      label: "acto reclamado señalado",
      re: /(acto reclamado|se reclama de|autoridad responsable|actos de ejecucion reclamados)/,
    },
    {
      act: "demanda_amparo",
      label: "demanda de amparo presentada",
      re: /(demanda de amparo|amparo indirecto|amparo directo|juicio de amparo numero)/,
    },
    {
      act: "suspension_concedida",
      label: "suspensión del acto reclamado",
      re: /(suspension (?:provisional|definitiva|de plano)|se concede la suspension|incidente de suspension)/,
    },
    {
      act: "informe_justificado",
      label: "informe previo o justificado",
      re: /(informe (?:previo|justificado)|rinde informe la autoridad|se requiere el informe)/,
    },
    {
      act: "audiencia_constitucional",
      label: "audiencia constitucional",
      re: /(audiencia constitucional|se celebra la audiencia constitucional|proyecto de sentencia de amparo)/,
    },
    {
      act: "cumplimiento_ejecutoria",
      label: "cumplimiento de la ejecutoria",
      re: /(cumplimiento de (?:la sentencia|la ejecutoria)|requerimiento de cumplimiento|incidente de inejecucion|recurso de queja)/,
    },
    {
      act: "derecho_fundamental",
      label: "derecho fundamental invocado",
      re: /(articulo (?:1o|1|14|16|17|20|22|31)\b|derechos humanos|debido proceso|legalidad y seguridad juridica|convencionalidad)/,
    },
  ],
  sequences: [
    {
      from: "demanda_amparo",
      to: "acuerdo_dictado",
      relation: "la demanda de amparo y el auto admisorio recaído a ella",
    },
    {
      from: "acto_reclamado",
      to: "suspension_concedida",
      relation: "el acto reclamado y la suspensión decretada sobre él",
    },
    {
      from: "suspension_concedida",
      to: "informe_justificado",
      relation: "la suspensión decretada y el informe rendido por la autoridad",
    },
    {
      from: "audiencia_constitucional",
      to: "resolucion_dictada",
      relation: "la audiencia constitucional y la sentencia de amparo",
    },
    {
      from: "resolucion_dictada",
      to: "cumplimiento_ejecutoria",
      relation: "la sentencia de amparo y su cumplimiento",
    },
  ],
  gaps: [
    {
      act: "acto_reclamado",
      needs: ["informe_justificado", "documento_certificado"],
      gap: "Ninguno de los documentos citados contiene la constancia de la autoridad responsable respecto del acto reclamado.",
    },
    {
      act: "suspension_concedida",
      needs: ["notificacion_realizada", "cumplimiento_ejecutoria"],
      gap: "Ninguno de los documentos citados acredita la notificación o el acatamiento de la suspensión concedida.",
    },
  ],
};

const CONSTITUCIONAL: ActLexicon = {
  acts: [
    {
      act: "derecho_fundamental",
      label: "derecho fundamental invocado",
      re: /(derechos humanos|bloque de constitucionalidad|control de convencionalidad|principio pro persona|interes legitimo)/,
    },
    {
      act: "norma_impugnada",
      label: "norma o acto impugnado",
      re: /(norma impugnada|precepto reclamado|inconstitucionalidad de|accion de inconstitucionalidad|controversia constitucional)/,
    },
    {
      act: "criterio_jurisprudencial",
      label: "criterio jurisprudencial invocado",
      re: /(tesis (?:aislada|jurisprudencial)|jurisprudencia (?:\d|por contradiccion)|scjn|registro digital)/,
    },
    {
      act: "recomendacion_organismo",
      label: "recomendación de organismo protector",
      re: /(cndh|comision (?:nacional|estatal) de derechos humanos|recomendacion \d{1,3}\/\d{4}|informe del organismo)/,
    },
  ],
  sequences: [
    {
      from: "norma_impugnada",
      to: "criterio_jurisprudencial",
      relation: "la norma impugnada y el criterio jurisprudencial aplicable",
    },
    {
      from: "derecho_fundamental",
      to: "resolucion_dictada",
      relation: "el derecho invocado y la resolución que se pronuncia sobre él",
    },
  ],
  gaps: [
    {
      act: "norma_impugnada",
      needs: ["criterio_jurisprudencial", "resolucion_dictada"],
      gap: "Ninguno de los documentos citados aporta criterio o resolución que resuelva sobre la norma impugnada.",
    },
  ],
};

const ELECTORAL: ActLexicon = {
  acts: [
    {
      act: "acto_electoral",
      label: "acto o acuerdo de la autoridad electoral",
      re: /(acuerdo (?:ine|ige|del consejo)|resolucion del instituto electoral|convocatoria electoral|registro de candidatura)/,
    },
    {
      act: "jornada_computo",
      label: "jornada electoral y cómputo",
      re: /(acta de escrutinio|casilla (?:numero|basica)|computo (?:distrital|municipal)|paquete electoral|jornada electoral)/,
    },
    {
      act: "medio_impugnacion_electoral",
      label: "medio de impugnación electoral",
      re: /(juicio (?:de inconformidad|para la proteccion de los derechos)|recurso de apelacion electoral|jdc|trife|tepjf)/,
    },
    {
      act: "queja_procedimiento_sancionador",
      label: "procedimiento sancionador electoral",
      re: /(procedimiento especial sancionador|queja electoral|violencia politica en razon de genero|propaganda indebida)/,
    },
  ],
  sequences: [
    {
      from: "jornada_computo",
      to: "medio_impugnacion_electoral",
      relation: "el cómputo realizado y su impugnación",
    },
    {
      from: "acto_electoral",
      to: "notificacion_realizada",
      relation: "el acuerdo electoral y su notificación o publicitación",
    },
    {
      from: "queja_procedimiento_sancionador",
      to: "resolucion_dictada",
      relation: "la queja presentada y la resolución del procedimiento sancionador",
    },
  ],
  gaps: [
    {
      act: "medio_impugnacion_electoral",
      needs: ["jornada_computo", "acto_electoral"],
      gap: "Ninguno de los documentos citados contiene el acto o cómputo cuya impugnación se plantea.",
    },
  ],
};

const AMBIENTAL: ActLexicon = {
  acts: [
    {
      act: "autorizacion_ambiental",
      label: "autorización o licencia ambiental",
      re: /(manifestacion de impacto ambiental|autorizacion en materia de impacto|licencia ambiental unica|semarnat|resolutivo ambiental)/,
    },
    {
      act: "inspeccion_ambiental",
      label: "inspección o verificación ambiental",
      re: /(visita de inspeccion ambiental|profepa|acta de inspeccion|verificacion ambiental)/,
    },
    {
      act: "dano_ambiental",
      label: "daño o afectación ambiental",
      re: /(dano ambiental|contaminacion de|descarga de aguas residuales|afectacion al ecosistema|residuos peligrosos)/,
    },
    {
      act: "medida_correctiva",
      label: "medida correctiva o de urgente aplicación",
      re: /(medidas correctivas|medidas de urgente aplicacion|clausura temporal|plan de remediacion|restauracion del sitio)/,
    },
    {
      act: "monitoreo_tecnico",
      label: "estudio o monitoreo técnico",
      re: /(estudio tecnico justificativo|muestreo|analisis de laboratorio acreditado|monitoreo ambiental|nom-\d{3})/,
    },
  ],
  sequences: [
    {
      from: "inspeccion_ambiental",
      to: "medida_correctiva",
      relation: "la inspección practicada y las medidas correctivas ordenadas",
    },
    {
      from: "dano_ambiental",
      to: "monitoreo_tecnico",
      relation: "la afectación señalada y el soporte técnico que la mide",
    },
    {
      from: "autorizacion_ambiental",
      to: "inspeccion_ambiental",
      relation: "la autorización otorgada y la verificación de su cumplimiento",
    },
  ],
  gaps: [
    {
      act: "dano_ambiental",
      needs: ["monitoreo_tecnico", "dictamen_rendido"],
      gap: "Ninguno de los documentos citados aporta soporte técnico o pericial que cuantifique la afectación ambiental referida.",
    },
    {
      act: "medida_correctiva",
      needs: ["resolucion_dictada", "notificacion_realizada"],
      gap: "Ninguno de los documentos citados acredita la resolución o notificación de las medidas correctivas ordenadas.",
    },
  ],
};

const CONSUMIDOR: ActLexicon = {
  acts: [
    {
      act: "relacion_consumo",
      label: "relación de consumo acreditada",
      re: /(contrato de adhesion|ticket de compra|orden de servicio|proveedor y consumidor|garantia del producto)/,
    },
    {
      act: "queja_profeco",
      label: "queja ante PROFECO",
      re: /(profeco|queja del consumidor|conciliacion ante la procuraduria|citatorio conciliatorio)/,
    },
    {
      act: "incumplimiento_proveedor",
      label: "incumplimiento del proveedor",
      re: /(no se presto el servicio|producto defectuoso|negativa de garantia|cobro indebido|cargo no reconocido)/,
    },
  ],
  sequences: [
    {
      from: "relacion_consumo",
      to: "incumplimiento_proveedor",
      relation: "la relación de consumo y el incumplimiento imputado al proveedor",
    },
    {
      from: "incumplimiento_proveedor",
      to: "queja_profeco",
      relation: "el incumplimiento y la reclamación administrativa presentada",
    },
  ],
  gaps: [
    {
      act: "queja_profeco",
      needs: ["relacion_consumo"],
      gap: "Ninguno de los documentos citados acredita la relación de consumo que sustenta la reclamación.",
    },
  ],
};

const PROPIEDAD_INTELECTUAL: ActLexicon = {
  acts: [
    {
      act: "registro_pi",
      label: "registro de derecho de propiedad intelectual",
      re: /(impi|indautor|registro de marca|titulo de patente|registro de obra|numero de expediente marcario)/,
    },
    {
      act: "uso_infractor",
      label: "uso presuntamente infractor",
      re: /(uso no autorizado|infraccion administrativa en materia de comercio|reproduccion no autorizada|signo confundible|pirateria)/,
    },
    {
      act: "licencia_cesion",
      label: "licencia o cesión de derechos",
      re: /(contrato de licencia|cesion de derechos patrimoniales|regalias|autorizacion de uso de la marca)/,
    },
  ],
  sequences: [
    {
      from: "registro_pi",
      to: "uso_infractor",
      relation: "la titularidad registrada y el uso presuntamente infractor",
    },
    {
      from: "licencia_cesion",
      to: "registro_pi",
      relation: "la transmisión de derechos y su constancia registral",
    },
  ],
  gaps: [
    {
      act: "uso_infractor",
      needs: ["registro_pi"],
      gap: "Ninguno de los documentos citados acredita la titularidad registral del derecho presuntamente infringido.",
    },
  ],
};

const MIGRATORIO: ActLexicon = {
  acts: [
    {
      act: "situacion_migratoria",
      label: "situación migratoria documentada",
      re: /(inm|instituto nacional de migracion|condicion de estancia|forma migratoria|presentacion del extranjero|alojamiento en estacion migratoria)/,
    },
    {
      act: "solicitud_proteccion",
      label: "solicitud de protección internacional",
      re: /(comar|solicitud de la condicion de refugiado|proteccion complementaria|asilo politico|entrevista de elegibilidad)/,
    },
    {
      act: "resolucion_migratoria",
      label: "resolución migratoria",
      re: /(resolucion de (?:alojamiento|deportacion|retorno asistido)|acuerdo de presentacion|constancia de tramite migratorio)/,
    },
  ],
  sequences: [
    {
      from: "situacion_migratoria",
      to: "resolucion_migratoria",
      relation: "la situación migratoria documentada y la resolución dictada",
    },
    {
      from: "solicitud_proteccion",
      to: "resolucion_migratoria",
      relation: "la solicitud de protección y la determinación de la autoridad",
    },
  ],
  gaps: [
    {
      act: "resolucion_migratoria",
      needs: ["notificacion_realizada"],
      gap: "Ninguno de los documentos citados acredita la notificación de la resolución migratoria referida.",
    },
  ],
};

const MARITIMO: ActLexicon = {
  acts: [
    {
      act: "operacion_maritima",
      label: "operación marítima documentada",
      re: /(conocimiento de embarque|bill of lading|contrato de fletamento|manifiesto de carga|arribo del buque)/,
    },
    {
      act: "averia_siniestro",
      label: "avería o siniestro marítimo",
      re: /(averia (?:gruesa|particular)|protesta de mar|siniestro maritimo|abordaje|derrame)/,
    },
    {
      act: "autoridad_maritima",
      label: "actuación de la autoridad marítima",
      re: /(capitania de puerto|autoridad maritima|semar|despacho de salida|inspeccion del buque)/,
    },
  ],
  sequences: [
    {
      from: "operacion_maritima",
      to: "averia_siniestro",
      relation: "la operación documentada y el siniestro que la afectó",
    },
    {
      from: "averia_siniestro",
      to: "autoridad_maritima",
      relation: "el siniestro y la intervención de la autoridad marítima",
    },
  ],
  gaps: [
    {
      act: "averia_siniestro",
      needs: ["dictamen_rendido", "autoridad_maritima"],
      gap: "Ninguno de los documentos citados aporta constancia de autoridad o peritaje sobre el siniestro referido.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry: materia → layers that compose its lexicon
// ---------------------------------------------------------------------------

/**
 * Layers are composed in order; the universal layer is always prepended by
 * resolveActLexicon(). Aliases (sucesiones, arrendamiento, cobranza…) resolve
 * to the same composition as their canonical materia plus their own layer.
 */
const MATERIA_LAYERS: Record<string, ActLexicon[]> = {
  // Canonical materias (MX_CASE_TYPES)
  civil: [OBLIGATION_LEXICON],
  familiar: [FAMILIAR, OBLIGATION_LEXICON],
  penal: [PENAL],
  mercantil: [OBLIGATION_LEXICON, MERCANTIL],
  laboral: [LABORAL, OBLIGATION_LEXICON],
  administrativo: [ADMINISTRATIVO],
  fiscal: [FISCAL, ADMINISTRATIVO],
  agrario: [AGRARIO],
  electoral: [ELECTORAL],
  ambiental: [AMBIENTAL, ADMINISTRATIVO],
  inmobiliario: [INMOBILIARIO, OBLIGATION_LEXICON],
  amparo: [AMPARO, CONSTITUCIONAL],
  constitucional: [CONSTITUCIONAL, AMPARO],

  // Sub-materias and practice aliases — inherit, never fork the methodology.
  general_civil: [OBLIGATION_LEXICON],
  contratos: [OBLIGATION_LEXICON],
  arrendamiento: [OBLIGATION_LEXICON, INMOBILIARIO],
  cobranza: [OBLIGATION_LEXICON, MERCANTIL],
  cobranza_judicial: [OBLIGATION_LEXICON, MERCANTIL],
  responsabilidad_civil: [OBLIGATION_LEXICON],
  sucesiones: [SUCESIONES, OBLIGATION_LEXICON],
  familiar_sucesiones: [SUCESIONES, FAMILIAR, OBLIGATION_LEXICON],
  penal_adolescentes: [PENAL],
  mercantil_concursal: [OBLIGATION_LEXICON, MERCANTIL, CORPORATIVO],
  mercantil_corporativo: [CORPORATIVO, OBLIGATION_LEXICON, MERCANTIL],
  corporativo: [CORPORATIVO, OBLIGATION_LEXICON],
  consumidor: [CONSUMIDOR, OBLIGATION_LEXICON],
  propiedad_intelectual: [PROPIEDAD_INTELECTUAL, OBLIGATION_LEXICON],
  migratorio: [MIGRATORIO, ADMINISTRATIVO],
  maritimo: [MARITIMO, OBLIGATION_LEXICON],
};

function normKey(v?: string | null): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z_]/g, "");
}

function mergeLexicons(layers: ActLexicon[]): ActLexicon {
  const acts: ActRule[] = [];
  const seenAct = new Set<string>();
  for (const l of layers) {
    for (const a of l.acts) {
      if (seenAct.has(a.act)) continue;
      seenAct.add(a.act);
      acts.push(a);
    }
  }
  const sequences: ActSequence[] = [];
  const seenSeq = new Set<string>();
  for (const l of layers) {
    for (const s of l.sequences) {
      const k = `${s.from}>${s.to}`;
      if (seenSeq.has(k) || !seenAct.has(s.from) || !seenAct.has(s.to)) continue;
      seenSeq.add(k);
      sequences.push(s);
    }
  }
  const gaps: ActGap[] = [];
  const seenGap = new Set<string>();
  for (const l of layers) {
    for (const g of l.gaps) {
      if (seenGap.has(g.act) || !seenAct.has(g.act)) continue;
      const needs = g.needs.filter((n) => seenAct.has(n));
      if (!needs.length) continue;
      seenGap.add(g.act);
      gaps.push({ ...g, needs });
    }
  }
  return { acts, sequences, gaps };
}

const CACHE = new Map<string, ActLexicon>();

/**
 * Resolves the act lexicon for a materia. Unknown or absent materia → the
 * universal lexicon, so the engine's output shape never changes.
 */
export function resolveActLexicon(caseType?: string | null): ActLexicon {
  const key = normKey(caseType);
  const cached = CACHE.get(key);
  if (cached) return cached;
  const layers = MATERIA_LAYERS[key] ?? [];
  const merged = mergeLexicons([UNIVERSAL_LEXICON, ...layers]);
  CACHE.set(key, merged);
  return merged;
}

/** Every act label declared anywhere in the registry (display lookup). */
export const ALL_ACT_LABELS: Record<ActKey, string> = (() => {
  const out: Record<string, string> = {};
  for (const layers of [[UNIVERSAL_LEXICON], ...Object.values(MATERIA_LAYERS)]) {
    for (const l of layers) for (const a of l.acts) out[a.act] ??= a.label;
  }
  return out;
})();

export function actLabel(act: ActKey): string {
  return ALL_ACT_LABELS[act] ?? act.replace(/_/g, " ");
}

/** Materia keys with a declared layer (canonical materias + aliases). */
export const SUPPORTED_MATERIAS: string[] = Object.keys(MATERIA_LAYERS);

/** Canonical materias, re-exported so parity tests can assert full coverage. */
export const CANONICAL_MATERIAS: readonly MexicanCaseType[] = MX_CASE_TYPES;

// ---------------------------------------------------------------------------
// Authority layer (data only)
//
// Acts declare their authoritative context inline via `authorities`. Nothing
// here is state-duplicated: state-level instruments are generic entries in
// src/lib/legal/authority-registry.ts and are bound to a concrete entidad
// federativa by the jurisdiction resolver.
// ---------------------------------------------------------------------------

const ACT_RULE_INDEX: Record<ActKey, ActRule> = (() => {
  const out: Record<string, ActRule> = {};
  for (const layers of [[UNIVERSAL_LEXICON], ...Object.values(MATERIA_LAYERS)]) {
    for (const l of layers) for (const a of l.acts) out[a.act] ??= a;
  }
  return out;
})();

/** Authority references declared for an act (empty when none are declared). */
export function actAuthorityRefs(act: ActKey): readonly ActAuthorityRef[] {
  return ACT_RULE_INDEX[act]?.authorities ?? [];
}

/** Declared validity window of an act, when the registry states one. */
export function actValidity(act: ActKey): ActValidity | undefined {
  return ACT_RULE_INDEX[act]?.validity;
}

/** Attorney-facing aliases declared for an act. */
export function actAliases(act: ActKey): readonly string[] {
  return ACT_RULE_INDEX[act]?.aliases ?? [];
}
