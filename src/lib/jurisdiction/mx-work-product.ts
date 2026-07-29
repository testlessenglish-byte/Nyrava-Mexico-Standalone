// =============================================================================
// MEXICAN ATTORNEY WORK PRODUCT — drafting vehicles per procedural profile.
//
// Replaces the hardcoded U.S. binary (motion_to_suppress / motion_to_dismiss /
// motion_for_summary_judgment / discovery_request / trial_outline /
// settlement_demand) that runWorkProductEngine used for every case regardless
// of materia. Those vehicles do not exist in Mexican procedure: there is no
// summary judgment, no U.S.-style discovery request, and no "motion to
// suppress" — the equivalent is the exclusión de prueba ilícita raised in the
// audiencia intermedia under arts. 264 y 346 CNPP.
//
// Each entry is:
//   id     — stable snake_case slug persisted on case_work_product.document_type
//   es/en  — attorney-facing title
//   basis  — the Mexican procedural provision the draft must be written under
//   when   — the condition under which the engine should produce it
//
// `resumen_ejecutivo` is intentionally NOT the id of the factual summary:
// `case_summary` is preserved because writer.server.ts and export.ts gate the
// motions-suppressed PDF on exactly that value. Renaming it would change the
// report contract, which this remediation must not do.
//
// Pure data module — no AI, no DB, safe on the client.
// =============================================================================

import type { MxPipelineProfile } from "@/lib/execution/mx-pipeline";

export type MxWorkProductVehicle = {
  id: string;
  es: string;
  en: string;
  basis: string;
  when: string;
};

/** Produced for every materia. `case_summary` id is a load-bearing contract. */
const UNIVERSAL: MxWorkProductVehicle[] = [
  {
    id: "case_summary",
    es: "Resumen ejecutivo del asunto",
    en: "Executive case summary",
    basis: "Constancias del expediente",
    when: "siempre",
  },
  {
    id: "ofrecimiento_de_pruebas",
    es: "Escrito de ofrecimiento de pruebas",
    en: "Evidence offering brief",
    basis: "Reglas de ofrecimiento y admisión de pruebas de la materia",
    when: "cuando existan pruebas documentales, periciales o testimoniales por ofrecer",
  },
  {
    id: "alegatos",
    es: "Alegatos",
    en: "Closing argument brief",
    basis: "Alegatos de la audiencia o por escrito, según la materia",
    when: "cuando el expediente permita fijar la litis",
  },
  {
    id: "plan_de_interrogatorio",
    es: "Plan de interrogatorio y contrainterrogatorio",
    en: "Direct and cross-examination plan",
    basis: "Desahogo de la prueba testimonial/pericial en audiencia",
    when: "cuando existan testigos o peritos identificados",
  },
  {
    id: "preparacion_de_testigos",
    es: "Preparación de testigos y peritos",
    en: "Witness and expert preparation",
    basis: "Desahogo de la prueba testimonial/pericial en audiencia",
    when: "cuando existan testigos o peritos identificados",
  },
];

const BY_PROFILE: Record<MxPipelineProfile, MxWorkProductVehicle[]> = {
  penal: [
    {
      id: "teoria_del_caso",
      es: "Teoría del caso",
      en: "Case theory",
      basis: "Arts. 394-399 CNPP (alegatos de apertura y clausura)",
      when: "siempre en materia penal",
    },
    {
      id: "solicitud_exclusion_prueba_ilicita",
      es: "Solicitud de exclusión de prueba ilícita",
      en: "Motion to exclude unlawfully obtained evidence",
      basis: "Arts. 264, 346 y 357 CNPP; art. 20 apartado A fr. IX CPEUM",
      when: "cuando existan indicios de obtención de prueba con violación de derechos fundamentales",
    },
    {
      id: "solicitud_de_no_vinculacion_a_proceso",
      es: "Solicitud de no vinculación a proceso",
      en: "Brief opposing bind-over to trial",
      basis: "Arts. 313-319 CNPP",
      when: "cuando el caso se encuentre antes del auto de vinculación",
    },
    {
      id: "impugnacion_de_medidas_cautelares",
      es: "Solicitud de revisión de medidas cautelares",
      en: "Request to review precautionary measures",
      basis: "Arts. 153-171 CNPP",
      when: "cuando exista prisión preventiva u otra medida cautelar impuesta",
    },
    {
      id: "solicitud_descubrimiento_probatorio",
      es: "Solicitud de descubrimiento probatorio",
      en: "Evidence disclosure request",
      basis: "Arts. 337-340 CNPP",
      when: "cuando falten registros de la carpeta de investigación",
    },
    {
      id: "guion_de_audiencia_de_juicio_oral",
      es: "Guion de audiencia de juicio oral",
      en: "Oral trial hearing outline",
      basis: "Arts. 391-399 CNPP",
      when: "cuando exista auto de apertura a juicio oral",
    },
  ],
  amparo: [
    {
      id: "demanda_de_amparo",
      es: "Demanda de amparo",
      en: "Amparo complaint",
      basis: "Arts. 108 y 175 Ley de Amparo",
      when: "cuando el acto reclamado esté identificado",
    },
    {
      id: "incidente_de_suspension",
      es: "Escrito de suspensión del acto reclamado",
      en: "Stay of the challenged act",
      basis: "Arts. 125-158 Ley de Amparo",
      when: "cuando el acto reclamado sea de ejecución inminente o continuada",
    },
    {
      id: "recurso_de_revision",
      es: "Recurso de revisión",
      en: "Revision appeal",
      basis: "Arts. 81-96 Ley de Amparo",
      when: "cuando exista resolución de primera instancia adversa",
    },
  ],
  derechos_humanos: [
    {
      id: "demanda_de_amparo",
      es: "Demanda de amparo (derechos fundamentales)",
      en: "Amparo complaint (fundamental rights)",
      basis: "Art. 1º CPEUM; arts. 108 y 175 Ley de Amparo",
      when: "cuando exista acto de autoridad violatorio de derechos humanos",
    },
    {
      id: "queja_ante_organismo_de_derechos_humanos",
      es: "Queja ante organismo de derechos humanos (CNDH / comisión estatal)",
      en: "Human-rights commission complaint",
      basis: "Ley de la Comisión Nacional de los Derechos Humanos",
      when: "cuando proceda la vía no jurisdiccional",
    },
  ],
  laboral: [
    {
      id: "demanda_laboral",
      es: "Demanda laboral",
      en: "Labor complaint",
      basis: "Arts. 870-891 LFT (procedimiento ordinario ante tribunal laboral)",
      when: "cuando la parte trabajadora sea la promovente",
    },
    {
      id: "contestacion_demanda_laboral",
      es: "Contestación de demanda y excepciones",
      en: "Labor answer and defenses",
      basis: "Arts. 873-878 LFT",
      when: "cuando la parte patronal sea la representada",
    },
    {
      id: "solicitud_de_conciliacion_prejudicial",
      es: "Solicitud de conciliación prejudicial",
      en: "Pre-trial conciliation request",
      basis: "Arts. 684-A a 684-E LFT (CFCRL / centros locales)",
      when: "cuando no exista constancia de conciliación prejudicial",
    },
    {
      id: "propuesta_de_convenio_laboral",
      es: "Propuesta de convenio laboral",
      en: "Labor settlement proposal",
      basis: "Art. 33 LFT (convenio ratificado)",
      when: "cuando exista margen de arreglo cuantificado en el expediente",
    },
  ],
  civil: [
    {
      id: "demanda_civil",
      es: "Escrito inicial de demanda",
      en: "Civil complaint",
      basis: "Código Civil aplicable y código procesal civil de la entidad",
      when: "cuando la parte representada sea actora",
    },
    {
      id: "contestacion_de_demanda",
      es: "Contestación de demanda y excepciones",
      en: "Answer and defenses",
      basis: "Excepciones dilatorias y perentorias del código procesal aplicable",
      when: "cuando la parte representada sea demandada",
    },
    {
      id: "propuesta_de_convenio_judicial",
      es: "Propuesta de convenio judicial",
      en: "Judicial settlement proposal",
      basis: "Convenio judicial / mediación conforme a la legislación local",
      when: "cuando existan cifras acreditadas en el expediente",
    },
  ],
  familiar: [
    {
      id: "demanda_familiar",
      es: "Escrito inicial en materia familiar",
      en: "Family law petition",
      basis: "Código Civil/Familiar y código procesal de la entidad",
      when: "cuando la parte representada sea promovente",
    },
    {
      id: "convenio_regulador",
      es: "Propuesta de convenio regulador",
      en: "Parenting and support agreement proposal",
      basis: "Convenio regulador (guarda y custodia, alimentos, convivencias)",
      when: "cuando existan menores o alimentos involucrados",
    },
    {
      id: "solicitud_de_medidas_provisionales",
      es: "Solicitud de medidas provisionales",
      en: "Provisional measures request",
      basis: "Medidas provisionales y órdenes de protección de la legislación local",
      when: "cuando existan indicios de riesgo o desatención",
    },
  ],
  mercantil: [
    {
      id: "demanda_mercantil",
      es: "Demanda mercantil",
      en: "Commercial complaint",
      basis: "Código de Comercio (juicio ejecutivo u oral mercantil); LGTOC",
      when: "cuando la parte representada sea actora",
    },
    {
      id: "contestacion_y_excepciones_mercantiles",
      es: "Contestación y excepciones",
      en: "Commercial answer and defenses",
      basis: "Arts. 1396-1414 Código de Comercio",
      when: "cuando la parte representada sea demandada",
    },
    {
      id: "objecion_de_documentos",
      es: "Objeción de documentos y firma",
      en: "Document and signature objection",
      basis: "Arts. 1247-1250 Código de Comercio",
      when: "cuando exista título de crédito o firma cuestionada",
    },
  ],
  fiscal: [
    {
      id: "recurso_de_revocacion",
      es: "Recurso de revocación",
      en: "Administrative tax appeal",
      basis: "Arts. 116-133 CFF",
      when: "cuando exista resolución determinante de crédito fiscal",
    },
    {
      id: "demanda_de_nulidad",
      es: "Demanda de juicio contencioso administrativo (nulidad)",
      en: "Tax nullity complaint before the TFJA",
      basis: "Ley Federal de Procedimiento Contencioso Administrativo",
      when: "cuando proceda la vía contenciosa ante el TFJA",
    },
    {
      id: "solicitud_de_suspension_del_pae",
      es: "Solicitud de suspensión del procedimiento administrativo de ejecución",
      en: "Stay of tax enforcement proceedings",
      basis: "Arts. 141 y 144 CFF",
      when: "cuando exista embargo o requerimiento de pago",
    },
  ],
  administrativo: [
    {
      id: "recurso_de_revision_administrativo",
      es: "Recurso de revisión administrativo",
      en: "Administrative revision appeal",
      basis: "Arts. 83-96 Ley Federal de Procedimiento Administrativo",
      when: "cuando exista resolución administrativa impugnable en sede administrativa",
    },
    {
      id: "demanda_de_nulidad",
      es: "Demanda de juicio de nulidad",
      en: "Nullity complaint",
      basis: "Ley Federal de Procedimiento Contencioso Administrativo",
      when: "cuando proceda la vía contenciosa administrativa",
    },
    {
      id: "solicitud_de_suspension_del_acto",
      es: "Solicitud de suspensión del acto impugnado",
      en: "Stay of the challenged administrative act",
      basis: "Arts. 24-28 LFPCA",
      when: "cuando el acto sea de ejecución inminente",
    },
  ],
  apelacion: [
    {
      id: "escrito_de_agravios",
      es: "Escrito de expresión de agravios",
      en: "Statement of grievances on appeal",
      basis: "Recurso de apelación conforme al código procesal aplicable",
      when: "siempre en segunda instancia",
    },
  ],
  inmobiliario: [
    {
      id: "memorandum_de_cierre",
      es: "Memorándum de cierre de la operación",
      en: "Closing memorandum",
      basis: "Escritura pública, RPP y obligaciones fiscales de la operación",
      when: "siempre en operaciones inmobiliarias",
    },
    {
      id: "carta_de_requerimiento_documental",
      es: "Carta de requerimiento documental a la contraparte o autoridad",
      en: "Document request letter to counterparty or authority",
      basis: "Due diligence documental (RPP, catastro, tesorería, notaría)",
      when: "cuando falten constancias del expediente de cierre",
    },
  ],
};

export function mxWorkProductVehicles(profile: MxPipelineProfile): MxWorkProductVehicle[] {
  return [...BY_PROFILE[profile], ...UNIVERSAL];
}

/** JSON-schema enum string for the AI prompt, e.g. `"a"|"b"|"c"`. */
export function mxWorkProductEnum(profile: MxPipelineProfile): string {
  return mxWorkProductVehicles(profile)
    .map((v) => `"${v.id}"`)
    .join("|");
}

/** Human-readable catalogue injected into the prompt, with legal basis. */
export function mxWorkProductGuide(profile: MxPipelineProfile, locale: "es" | "en"): string {
  return mxWorkProductVehicles(profile)
    .map((v) => `- ${v.id} — ${locale === "en" ? v.en : v.es} (${v.basis}); genera si: ${v.when}`)
    .join("\n");
}

/** True when the slug is a valid drafting vehicle for the profile. */
export function isMxWorkProductAllowed(profile: MxPipelineProfile, id: string | null | undefined): boolean {
  if (!id) return false;
  return mxWorkProductVehicles(profile).some((v) => v.id === id);
}
