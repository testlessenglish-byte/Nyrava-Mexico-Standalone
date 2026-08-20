// =============================================================================
// MISSING DOCUMENT CHECKLISTS — pure module.
//
// Per-materia inventory of the documents a complete Mexican case file must
// contain, each tied to its statutory hook. `resolveMissingDocuments` scans
// the extracted corpus for evidence of each document and reports which are
// present and which are missing — pattern-driven, deterministic, no model
// calls.
// =============================================================================

import {
  type MxPipelineProfile,
  type ConstitucionalReviewSubtype,
  resolveConstitucionalReviewSubtype,
} from "../execution/mx-pipeline";

export type RequiredDocument = {
  id: string;
  label_es: string;
  label_en: string;
  /** Statutory hook, e.g. "CNPP Art. 227". */
  authority: string;
  /** Corpus text patterns (accent/case-insensitive) that evidence this document exists in the file. */
  patterns: readonly string[];
};

export type RequiredDocumentStatus = RequiredDocument & {
  present: boolean;
  evidence: string | null;
};

export type MissingDocumentsReport = {
  materia: MxPipelineProfile;
  required: RequiredDocument[];
  present: RequiredDocumentStatus[];
  missing: RequiredDocumentStatus[];
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const CHECKLISTS: Record<MxPipelineProfile, readonly RequiredDocument[]> = {
  migratorio: [
    {
      id: "identidad_viaje",
      label_es: "Documento de identidad o viaje vigente",
      label_en: "Current identity or travel document",
      authority: "Ley de Migración y Reglamento de la Ley de Migración",
      patterns: ["pasaporte", "documento de identidad y viaje", "documento de viaje"],
    },
    {
      id: "documento_condicion_estancia",
      label_es: "Visa, tarjeta o documento de condición de estancia",
      label_en: "Visa, resident card or immigration-status document",
      authority: "Ley de Migración y Reglamento de la Ley de Migración",
      patterns: ["visa", "residente temporal", "residente permanente", "tarjeta de residente", "condicion de estancia"],
    },
    {
      id: "acuse_tramite",
      label_es: "Acuse y número de trámite ante la autoridad competente",
      label_en: "Official filing receipt and proceeding number",
      authority: "Lineamientos y ficha oficial vigente del trámite aplicable",
      patterns: ["acuse de recibo", "numero de tramite", "número de trámite", "número único de trámite", "nut"],
    },
    {
      id: "resolucion_notificacion",
      label_es: "Resolución y constancia de notificación, si existen",
      label_en: "Decision and service record, if issued",
      authority: "Ley Federal de Procedimiento Administrativo; ley especial aplicable",
      patterns: ["resolucion", "resolución", "constancia de notificacion", "cedula de notificacion", "oficio de notificacion"],
    },
    {
      id: "vinculo_familiar",
      label_es: "Documentos de vínculo familiar, cuando sean fundamento del trámite",
      label_en: "Family-relationship records when relied upon",
      authority: "Ley de Migración y Reglamento de la Ley de Migración",
      patterns: ["acta de nacimiento", "acta de matrimonio", "vinculo familiar", "unidad familiar"],
    },
    {
      id: "refugio_comar",
      label_es: "Constancias de solicitud o procedimiento ante COMAR, cuando aplique",
      label_en: "COMAR refugee-proceeding records, when applicable",
      authority: "Ley sobre Refugiados, Protección Complementaria y Asilo Político",
      patterns: ["comar", "solicitud de reconocimiento de la condicion de refugiado", "proteccion complementaria", "no devolucion"],
    },
    {
      id: "nacionalidad_sre",
      label_es: "Constancias de nacionalidad o naturalización ante SRE, cuando aplique",
      label_en: "SRE nationality or naturalization records, when applicable",
      authority: "Constitución Art. 30; Ley de Nacionalidad",
      patterns: ["carta de naturalizacion", "certificado de nacionalidad mexicana", "declaratoria de nacionalidad", "secretaria de relaciones exteriores"],
    },
  ],
  penal: [
    {
      id: "carpeta_investigacion",
      label_es: "Carpeta de investigación",
      label_en: "Investigation file",
      authority: "CNPP Art. 213-221",
      patterns: ["carpeta de investigacion", "numero unico de caso"],
    },
    {
      id: "dictamenes_periciales",
      label_es: "Dictámenes periciales",
      label_en: "Expert opinions (dictámenes periciales)",
      authority: "CNPP Art. 368-372",
      patterns: ["dictamen pericial", "peritaje", "dictamen en criminalistica", "dictamen medico legista"],
    },
    {
      id: "entrevistas",
      label_es: "Entrevistas a testigos y a la víctima",
      label_en: "Witness and victim interviews",
      authority: "CNPP Art. 133-136",
      patterns: ["entrevista al testigo", "entrevista a la victima", "acta de entrevista"],
    },
    {
      id: "cadena_custodia",
      label_es: "Registro de cadena de custodia",
      label_en: "Chain-of-custody record",
      authority: "CNPP Art. 227-228",
      patterns: ["cadena de custodia", "registro de cadena"],
    },
    {
      id: "informe_policial_homologado",
      label_es: "Informe Policial Homologado (IPH)",
      label_en: "Standardized police report (IPH)",
      authority: "CNPP Art. 132",
      patterns: ["informe policial homologado", "iph"],
    },
    {
      id: "auto_vinculacion",
      label_es: "Auto de vinculación a proceso",
      label_en: "Binding-over order",
      authority: "CNPP Art. 313-316",
      patterns: ["auto de vinculacion a proceso"],
    },
    {
      id: "acuerdo_reparatorio",
      label_es: "Acuerdo reparatorio o de salidas alternas (si aplica)",
      label_en: "Reparation agreement / alternative resolution (if applicable)",
      authority: "CNPP Art. 184-190",
      patterns: ["acuerdo reparatorio", "suspension condicional del proceso"],
    },
  ],
  amparo: [
    {
      id: "acto_reclamado_doc",
      label_es: "Documento que contiene el acto reclamado",
      label_en: "Document embodying the challenged act",
      authority: "Ley de Amparo Art. 108 fr. IV",
      patterns: ["acto reclamado"],
    },
    {
      id: "demanda_amparo_doc",
      label_es: "Demanda de amparo",
      label_en: "Amparo claim",
      authority: "Ley de Amparo Art. 108",
      patterns: ["demanda de amparo"],
    },
    {
      id: "suspension_doc",
      label_es: "Resolución de suspensión",
      label_en: "Stay (suspensión) ruling",
      authority: "Ley de Amparo Art. 125-129",
      patterns: ["suspension provisional", "suspension definitiva", "incidente de suspension"],
    },
    {
      id: "informe_justificado_doc",
      label_es: "Informe justificado",
      label_en: "Authority's justifying report",
      authority: "Ley de Amparo Art. 117-119",
      patterns: ["informe justificado"],
    },
    {
      id: "constancias_notificacion",
      label_es: "Constancias de notificación del acto reclamado",
      label_en: "Notice-of-act service records",
      authority: "Ley de Amparo Art. 21-22",
      patterns: ["constancia de notificacion", "cedula de notificacion"],
    },
  ],
  fiscal: [
    {
      id: "resolucion_determinante",
      label_es: "Resolución determinante del crédito fiscal",
      label_en: "Tax assessment ruling",
      authority: "CFF Art. 50",
      patterns: ["resolucion determinante", "liquidacion"],
    },
    {
      id: "creditos_fiscales",
      label_es: "Documentación de créditos fiscales",
      label_en: "Tax-credit documentation",
      authority: "CFF Art. 4",
      patterns: ["credito fiscal", "cedula de liquidacion"],
    },
    {
      id: "requerimientos_sat",
      label_es: "Requerimientos del SAT",
      label_en: "SAT information requests",
      authority: "CFF Art. 42, 53",
      patterns: ["requerimiento de informacion", "requerimiento del sat", "oficio de observaciones"],
    },
    {
      id: "acta_final_visita",
      label_es: "Acta final de visita domiciliaria",
      label_en: "Final on-site audit report",
      authority: "CFF Art. 46-49",
      patterns: ["acta final", "acta parcial", "visita domiciliaria"],
    },
    {
      id: "garantia_interes_fiscal_doc",
      label_es: "Garantía del interés fiscal",
      label_en: "Tax interest guarantee",
      authority: "CFF Art. 141",
      patterns: ["garantia del interes fiscal", "fianza", "embargo en via administrativa"],
    },
  ],
  derechos_humanos: [
    {
      id: "queja_doc",
      label_es: "Queja presentada ante la comisión de derechos humanos",
      label_en: "Complaint filed with the human-rights commission",
      authority: "Ley de la CNDH Art. 25-27",
      patterns: ["queja ante la comision", "cndh", "comision estatal de derechos humanos"],
    },
    {
      id: "expediente_queja",
      label_es: "Expediente de queja integrado",
      label_en: "Complaint file on record",
      authority: "Ley de la CNDH Art. 34-40",
      patterns: ["expediente de queja", "investigacion de la comision"],
    },
    {
      id: "recomendacion_doc",
      label_es: "Recomendación emitida",
      label_en: "Recommendation issued",
      authority: "Ley de la CNDH Art. 44-46",
      patterns: ["recomendacion", "punto recomendatorio"],
    },
  ],
  constitucional: [
    {
      id: "norma_o_acto_impugnado_doc",
      label_es: "Norma general o acto impugnado identificado",
      label_en: "Challenged general norm or act identified",
      authority:
        "Ley Reglamentaria del Art. 105 Arts. 22 fr. III y 61 fr. III; Ley de Amparo Art. 88",
      patterns: [
        "norma impugnada",
        "acto impugnado",
        "norma general impugnada",
        "decreto impugnado",
      ],
    },
    {
      id: "acreditacion_legitimacion_doc",
      label_es: "Documento que acredita la legitimación del promovente",
      label_en: "Document evidencing the promovente's standing",
      authority: "CPEUM Art. 105 fr. I-II; Ley de Amparo Art. 81",
      patterns: ["legitimacion activa", "legitimacion procesal", "acredita su legitimacion"],
    },
    {
      id: "sentencia_o_norma_publicada",
      label_es: "Sentencia de amparo o publicación de la norma en el diario/periódico oficial",
      label_en: "Amparo judgment or official-gazette publication of the norm",
      authority: "Ley Reglamentaria del Art. 105 Art. 60; Ley de Amparo Art. 86",
      patterns: [
        "diario oficial de la federacion",
        "periodico oficial",
        "sentencia que concede el amparo",
        "sentencia que niega el amparo",
      ],
    },
  ],
  civil: [
    {
      id: "contrato",
      label_es: "Contrato base de la acción",
      label_en: "Contract underlying the claim",
      authority: "CCF Art. 1792-1859",
      patterns: ["contrato de", "clausulas", "contrato base de la accion"],
    },
    {
      id: "notificaciones_civil",
      label_es: "Constancias de notificación / emplazamiento",
      label_en: "Service-of-process records",
      authority: "CNPCyF Art. 128-137",
      patterns: ["emplazamiento", "cedula de notificacion", "razon actuarial"],
    },
    {
      id: "poderes",
      label_es: "Poderes e instrumentos de representación",
      label_en: "Powers of attorney / representation instruments",
      authority: "CCF Art. 2554-2596",
      patterns: ["poder notarial", "poder general", "instrumento notarial", "escritura publica"],
    },
    {
      id: "pruebas_documentales",
      label_es: "Pruebas documentales ofrecidas",
      label_en: "Documentary evidence offered",
      authority: "CNPCyF Art. 293-300",
      patterns: ["prueba documental", "anexo documental", "documental publica", "documental privada"],
    },
  ],
  familiar: [
    {
      id: "actas_registro_civil",
      label_es: "Actas del Registro Civil (matrimonio, nacimiento)",
      label_en: "Civil registry records (marriage, birth)",
      authority: "CCF Art. 39-45",
      patterns: ["acta de matrimonio", "acta de nacimiento"],
    },
    {
      id: "convenio_regulador",
      label_es: "Convenio regulador",
      label_en: "Settlement agreement (convenio regulador)",
      authority: "CNPCyF Art. 620",
      patterns: ["convenio regulador"],
    },
    {
      id: "estudios_psicosociales_doc",
      label_es: "Estudios psicológicos y socioeconómicos",
      label_en: "Psychological / socioeconomic assessments",
      authority: "CNPCyF Art. 638",
      patterns: ["estudio psicologico", "estudio socioeconomico", "dictamen psicologico"],
    },
    {
      id: "comprobantes_ingresos",
      label_es: "Comprobantes de ingresos para pensión alimenticia",
      label_en: "Income records for child/spousal support",
      authority: "CCF Art. 311",
      patterns: ["comprobante de ingresos", "recibo de nomina", "constancia de percepciones"],
    },
  ],
  laboral: [
    {
      id: "contrato_trabajo",
      label_es: "Contrato individual de trabajo",
      label_en: "Individual employment contract",
      authority: "LFT Art. 24-26",
      patterns: ["contrato individual de trabajo"],
    },
    {
      id: "recibos_nomina",
      label_es: "Recibos de nómina",
      label_en: "Payroll receipts",
      authority: "LFT Art. 132 fr. VII, 804",
      patterns: ["recibo de nomina", "recibo de pago"],
    },
    {
      id: "aviso_rescision_doc",
      label_es: "Aviso de rescisión",
      label_en: "Notice of termination",
      authority: "LFT Art. 47",
      patterns: ["aviso de rescision", "aviso de despido"],
    },
    {
      id: "constancia_imss",
      label_es: "Constancia de inscripción al IMSS",
      label_en: "IMSS registration record",
      authority: "Ley del Seguro Social Art. 15",
      patterns: ["constancia de vigencia de derechos", "constancia imss", "afiliacion al imss"],
    },
    {
      id: "constancia_conciliacion",
      label_es: "Constancia de conciliación / no conciliación",
      label_en: "Conciliation / non-conciliation record",
      authority: "LFT Art. 684-A a 684-E",
      patterns: ["constancia de no conciliacion", "constancia de conciliacion"],
    },
  ],
  mercantil: [
    {
      id: "titulo_credito",
      label_es: "Título de crédito o documento mercantil base",
      label_en: "Negotiable instrument / underlying commercial document",
      authority: "LGTOC Art. 5, 76, 170",
      patterns: ["pagare", "letra de cambio", "cheque"],
    },
    {
      id: "acta_asamblea",
      label_es: "Acta de asamblea",
      label_en: "Shareholders' meeting minutes",
      authority: "LGSM Art. 178-194",
      patterns: ["acta de asamblea"],
    },
    {
      id: "estados_financieros",
      label_es: "Estados financieros",
      label_en: "Financial statements",
      authority: "Código de Comercio Art. 33-49",
      patterns: ["estados financieros", "balance general"],
    },
    {
      id: "contrato_mercantil",
      label_es: "Contrato mercantil",
      label_en: "Commercial contract",
      authority: "Código de Comercio Art. 78-88",
      patterns: ["contrato mercantil", "contrato de compraventa mercantil"],
    },
  ],
  administrativo: [
    {
      id: "acto_administrativo_doc",
      label_es: "Acto administrativo impugnado",
      label_en: "Challenged administrative act",
      authority: "LFPA Art. 3",
      patterns: ["acto administrativo", "resolucion administrativa", "oficio"],
    },
    {
      id: "constancia_notificacion_admin",
      label_es: "Constancia de notificación del acto",
      label_en: "Act notice record",
      authority: "LFPA Art. 35",
      patterns: ["constancia de notificacion", "cedula de notificacion"],
    },
    {
      id: "recurso_revision_doc",
      label_es: "Recurso de revisión promovido",
      label_en: "Administrative review appeal filed",
      authority: "LFPA Art. 83",
      patterns: ["recurso de revision"],
    },
  ],
  apelacion: [
    {
      id: "sentencia_apelada",
      label_es: "Sentencia o auto apelado",
      label_en: "Appealed judgment or order",
      authority: "Código procesal aplicable",
      patterns: ["sentencia recurrida", "auto recurrido", "resolucion apelada"],
    },
    {
      id: "escrito_agravios",
      label_es: "Escrito de expresión de agravios",
      label_en: "Statement of grievances",
      authority: "CNPP Art. 471; CNPCyF",
      patterns: ["expresion de agravios", "escrito de agravios"],
    },
    {
      id: "constancias_primera_instancia",
      label_es: "Constancias del expediente de primera instancia",
      label_en: "First-instance case file records",
      authority: "CNPCyF / CNPP (apelación)",
      patterns: ["expediente de primera instancia", "autos originales"],
    },
  ],
  inmobiliario: [
    {
      id: "escritura_publica",
      label_es: "Escritura pública de propiedad",
      label_en: "Public deed of title",
      authority: "Ley del Notariado (estatal)",
      patterns: ["escritura publica", "escritura numero", "ante la fe del notario"],
    },
    {
      id: "libertad_gravamen",
      label_es: "Certificado de libertad de gravamen",
      label_en: "Certificate of no liens",
      authority: "Registro Público de la Propiedad",
      patterns: ["libertad de gravamen", "certificado de gravamenes"],
    },
    {
      id: "no_adeudo_predial",
      label_es: "Constancia de no adeudo predial",
      label_en: "Property-tax good-standing certificate",
      authority: "Tesorería municipal",
      patterns: ["no adeudo predial", "constancia de no adeudo del impuesto predial"],
    },
    {
      id: "constancia_catastral",
      label_es: "Boleta / constancia catastral",
      label_en: "Cadastral certificate",
      authority: "Dirección de Catastro municipal",
      patterns: ["constancia catastral", "boleta catastral", "clave catastral"],
    },
    {
      id: "no_adeudo_agua",
      label_es: "Constancia de no adeudo de agua",
      label_en: "Water good-standing certificate",
      authority: "Organismo operador de agua municipal",
      patterns: ["no adeudo de agua", "constancia de no adeudo del servicio de agua"],
    },
    {
      id: "recibo_cfe",
      label_es: "Recibo de CFE al corriente",
      label_en: "Current CFE (electricity) bill",
      authority: "Comisión Federal de Electricidad",
      patterns: ["comision federal de electricidad", "recibo cfe"],
    },
    {
      id: "levantamiento_topografico",
      label_es: "Levantamiento topográfico / plano de medidas y colindancias",
      label_en: "Survey / boundary and measurement plan",
      authority: "N/A — instrumento técnico",
      patterns: ["levantamiento topografico", "medidas y colindancias"],
    },
    {
      id: "carta_no_adeudo_condominio",
      label_es: "Carta de no adeudo de cuotas de condominio",
      label_en: "Condominium dues clearance letter",
      authority: "Administración del condominio / fraccionamiento",
      patterns: ["no adeudo de mantenimiento", "administracion del condominio", "cuotas de mantenimiento al corriente"],
    },
    {
      id: "cancelacion_hipoteca",
      label_es: "Cancelación de hipoteca (si aplica)",
      label_en: "Mortgage release (if applicable)",
      authority: "Registro Público de la Propiedad",
      patterns: ["cancelacion de hipoteca", "liberacion de gravamen hipotecario"],
    },
    {
      id: "poder_notarial",
      label_es: "Poder notarial (si se actúa por representación)",
      label_en: "Power of attorney (if acting by representation)",
      authority: "Ley del Notariado (estatal)",
      patterns: ["poder notarial", "poder general para actos de dominio"],
    },
  ],
  // 2026-08-04: new profile — agrario previously used "civil"'s checklist
  // (contrato base de la accion, poderes...), which has no RAN, ejido, or
  // deslinde documents on it at all.
  agrario: [
    {
      id: "certificado_ran",
      label_es: "Certificado parcelario o de derechos agrarios (RAN)",
      label_en: "RAN parcel / agrarian-rights certificate",
      authority: "Registro Agrario Nacional",
      patterns: ["certificado parcelario", "certificado de derechos agrarios", "registro agrario nacional"],
    },
    {
      id: "resolucion_asamblea_ejidal",
      label_es: "Acta o resolución de asamblea ejidal / de bienes comunales",
      label_en: "Ejido or comunal-lands assembly minutes / resolution",
      authority: "Ley Agraria Art. 23",
      patterns: ["acta de asamblea", "asamblea ejidal", "asamblea general de ejidatarios"],
    },
    {
      id: "plano_parcelario_deslinde",
      label_es: "Plano parcelario o dictamen de deslinde",
      label_en: "Parcel plan or boundary-survey opinion",
      authority: "Registro Agrario Nacional",
      patterns: ["plano parcelario", "deslinde", "levantamiento topografico"],
    },
    {
      id: "constancia_posesion_agraria",
      label_es: "Constancia de posesión emitida por el comisariado ejidal",
      label_en: "Possession certificate issued by the comisariado ejidal",
      authority: "Ley Agraria Art. 152",
      patterns: ["constancia de posesion", "comisariado ejidal", "constancia posesoria"],
    },
    {
      id: "credencial_ejidatario",
      label_es: "Credencial o reconocimiento como ejidatario, comunero o posesionario",
      label_en: "Credential or recognition as ejidatario, comunero, or posesionario",
      authority: "Ley Agraria Art. 15-16",
      patterns: ["credencial de ejidatario", "reconocimiento de comunero", "posesionario"],
    },
  ],
  // 2026-08-04: new profile — electoral previously used "administrativo"'s
  // checklist, which has no electoral-specific documents on it at all.
  electoral: [
    {
      id: "acta_de_escrutinio_y_computo",
      label_es: "Acta de escrutinio y cómputo de casilla",
      label_en: "Polling-station tally sheet",
      authority: "LGIPE",
      patterns: ["acta de escrutinio y computo", "acta de la mesa directiva de casilla"],
    },
    {
      id: "constancia_de_registro_candidatura",
      label_es: "Constancia de registro de candidatura",
      label_en: "Candidacy registration record",
      authority: "LGIPE Art. 10",
      patterns: ["constancia de registro", "registro de candidatura"],
    },
    {
      id: "informe_de_gastos_de_campana",
      label_es: "Informe de gastos de campaña",
      label_en: "Campaign-expense report",
      authority: "Reglamento de Fiscalización del INE",
      patterns: ["informe de gastos de campana", "fiscalizacion de gastos"],
    },
    {
      id: "cadena_de_custodia_paquete_electoral",
      label_es: "Constancia de cadena de custodia del paquete electoral",
      label_en: "Ballot-package chain-of-custody record",
      authority: "LGIPE",
      patterns: ["cadena de custodia", "paquete electoral"],
    },
  ],
  // 2026-08-04: new profile — ambiental previously used "administrativo"'s
  // checklist, which has no MIA/PROFEPA/CONAGUA documents on it.
  ambiental: [
    {
      id: "mia_documento",
      label_es: "Manifestación de impacto ambiental",
      label_en: "Environmental impact assessment",
      authority: "LGEEPA Art. 28-35",
      patterns: ["manifestacion de impacto ambiental", " mia "],
    },
    {
      id: "licencia_ambiental_unica_doc",
      label_es: "Licencia ambiental única",
      label_en: "Single environmental license",
      authority: "LGEEPA",
      patterns: ["licencia ambiental unica"],
    },
    {
      id: "acta_de_inspeccion_doc",
      label_es: "Acta de inspección o visita de verificación",
      label_en: "Inspection or verification-visit record",
      authority: "PROFEPA/ASEA",
      patterns: ["acta de inspeccion", "visita de verificacion"],
    },
    {
      id: "titulo_concesion_agua_doc",
      label_es: "Título de concesión de agua",
      label_en: "Water concession title",
      authority: "Ley de Aguas Nacionales",
      patterns: ["titulo de concesion", "concesion de agua"],
    },
  ],
  responsabilidad_medica: [
    {
      id: "expediente_clinico",
      label_es: "Expediente clínico completo",
      label_en: "Complete clinical file",
      authority: "NOM-004-SSA3-2012",
      patterns: ["expediente clinico", "historia clinica", "nota de evolucion", "nota medica"],
    },
    {
      id: "consentimiento_informado",
      label_es: "Consentimiento informado",
      label_en: "Informed consent",
      authority: "NOM-004-SSA3-2012; Ley General de Salud Art. 51 Bis 2",
      patterns: ["consentimiento informado", "carta de consentimiento"],
    },
    {
      id: "dictamen_pericial_medico",
      label_es: "Dictamen pericial médico",
      label_en: "Medical expert opinion",
      authority: "CNPCyF Art. 341-360",
      patterns: ["dictamen pericial medico", "perito medico", "dictamen medico"],
    },
    {
      id: "estudios_diagnosticos",
      label_es: "Estudios de laboratorio e imagen",
      label_en: "Laboratory and imaging studies",
      authority: "NOM-004-SSA3-2012",
      patterns: ["resultado de laboratorio", "estudio de imagen", "radiografia", "tomografia", "resonancia"],
    },
  ],
};

/**
 * Per-subtype authority override for the "constitucional" checklist's items
 * whose `authority` field (above) combines multiple proceedings' governing
 * law into one string — same bug/fix as procedural-compliance.ts's
 * CONSTITUCIONAL_AUTHORITY_OVERRIDES (see that file's comment for the full
 * rationale and the real-case reproduction). Every value here is a VERBATIM
 * substring already present in that item's combined citation.
 */
const CONSTITUCIONAL_AUTHORITY_OVERRIDES: Partial<
  Record<string, Partial<Record<ConstitucionalReviewSubtype, string>>>
> = {
  norma_o_acto_impugnado_doc: {
    controversia_constitucional: "Ley Reglamentaria del Art. 105 Art. 22 fr. III",
    accion_inconstitucionalidad: "Ley Reglamentaria del Art. 105 Art. 61 fr. III",
    amparo_en_revision: "Ley de Amparo Art. 88",
  },
  acreditacion_legitimacion_doc: {
    controversia_constitucional: "CPEUM Art. 105 fr. I",
    accion_inconstitucionalidad: "CPEUM Art. 105 fr. II",
    amparo_en_revision: "Ley de Amparo Art. 81",
  },
  sentencia_o_norma_publicada: {
    accion_inconstitucionalidad: "Ley Reglamentaria del Art. 105 Art. 60",
    amparo_en_revision: "Ley de Amparo Art. 86",
  },
};

export function requiredDocuments(
  materia: MxPipelineProfile,
  corpusText?: string,
): readonly RequiredDocument[] {
  const base = CHECKLISTS[materia];
  if (materia !== "constitucional" || !corpusText) return base;
  const subtype = resolveConstitucionalReviewSubtype(corpusText);
  if (!subtype) return base;
  return base.map((doc) => {
    const override = CONSTITUCIONAL_AUTHORITY_OVERRIDES[doc.id]?.[subtype];
    return override ? { ...doc, authority: override } : doc;
  });
}

/**
 * Scan the corpus for evidence of each required document and split the
 * per-materia checklist into present / missing.
 */
export function resolveMissingDocuments(materia: MxPipelineProfile, corpusText: string): MissingDocumentsReport {
  const required = requiredDocuments(materia, corpusText);
  const hay = normalize(corpusText ?? "");
  const hasCorpus = hay.trim().length > 0;

  const evaluated: RequiredDocumentStatus[] = required.map((doc) => {
    if (!hasCorpus) return { ...doc, present: false, evidence: null };
    let evidence: string | null = null;
    for (const p of doc.patterns) {
      const at = hay.indexOf(normalize(p));
      if (at >= 0) {
        evidence = corpusText.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, " ").trim();
        break;
      }
    }
    return { ...doc, present: evidence !== null, evidence };
  });

  return {
    materia,
    required: [...required],
    present: evaluated.filter((d) => d.present),
    missing: evaluated.filter((d) => !d.present),
  };
}
