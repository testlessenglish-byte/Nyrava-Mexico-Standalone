// =============================================================================
// MISSING DOCUMENT CHECKLISTS — pure module.
//
// Per-materia inventory of the documents a complete Mexican case file must
// contain, each tied to its statutory hook. `resolveMissingDocuments` scans
// the extracted corpus for evidence of each document and reports which are
// present and which are missing — pattern-driven, deterministic, no model
// calls.
// =============================================================================

import type { MxPipelineProfile } from "../execution/mx-pipeline";

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
};

export function requiredDocuments(materia: MxPipelineProfile): readonly RequiredDocument[] {
  return CHECKLISTS[materia];
}

/**
 * Scan the corpus for evidence of each required document and split the
 * per-materia checklist into present / missing.
 */
export function resolveMissingDocuments(materia: MxPipelineProfile, corpusText: string): MissingDocumentsReport {
  const required = requiredDocuments(materia);
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
