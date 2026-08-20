import { z } from "zod";

/**
 * Canonical Mexican immigration/refugee/nationality registry.
 *
 * This is policy data, not legal advice and not a substitute for current-law
 * verification. Every source used in a released report must still pass the
 * legal-source and citation gates.
 */
export const IMMIGRATION_PARENT = {
  key: "migratorio",
  label_es: "Derecho Migratorio, Refugio y Nacionalidad",
  label_en: "Mexican Immigration, Refugee and Nationality Law",
  country: "MX",
  default_fuero: "federal",
} as const;

export const IMMIGRATION_SUBTYPES = [
  ["visa_ingreso", "Visa y autorización de ingreso", "Visa and entry authorization"],
  ["residencia_temporal", "Residencia temporal", "Temporary residence"],
  ["residencia_permanente", "Residencia permanente", "Permanent residence"],
  ["canje_visa", "Canje de visa por tarjeta de residencia", "Visa exchange for residence card"],
  ["renovacion_migratoria", "Renovación migratoria", "Immigration renewal"],
  ["reposicion_documento", "Reposición de documento migratorio", "Replacement immigration document"],
  ["permiso_salida_regreso", "Permiso de salida y regreso", "Exit and re-entry permit"],
  ["cambio_condicion_estancia", "Cambio de condición de estancia", "Change of immigration status"],
  ["permiso_trabajo", "Permiso para trabajar", "Work authorization"],
  ["cambio_empleador", "Cambio de empleador", "Change of employer"],
  ["unidad_familiar", "Unidad familiar", "Family unity"],
  ["regularizacion", "Regularización migratoria", "Immigration regularization"],
  ["correccion_datos", "Corrección de datos migratorios", "Correction of immigration data"],
  ["negativa_tramite", "Negativa de trámite migratorio", "Denial of immigration application"],
  ["cancelacion_estancia", "Cancelación de condición de estancia", "Cancellation of immigration status"],
  ["constancia_empleador", "Constancia de inscripción de empleador", "Employer registration certificate"],
  ["actualizacion_empleador", "Actualización de constancia de empleador", "Employer certificate update"],
  ["oferta_empleo", "Oferta de empleo", "Employment offer"],
  ["actividad_remunerada", "Autorización para actividades remuneradas", "Authorization for paid activities"],
  ["verificacion_empleador", "Verificación migratoria de empleador", "Employer immigration verification"],
  ["sancion_empleador", "Sanción a empleador", "Employer sanction"],
  ["movilidad_corporativa", "Movilidad corporativa y personal extranjero", "Corporate mobility and foreign personnel"],
  ["visita_verificacion", "Visita de verificación migratoria", "Immigration verification visit"],
  ["revision_migratoria", "Revisión migratoria", "Immigration inspection"],
  ["presentacion_inm", "Presentación ante el INM", "Presentation before INM"],
  ["procedimiento_administrativo", "Procedimiento administrativo migratorio", "Immigration administrative proceeding"],
  ["estacion_migratoria", "Estación migratoria o estancia provisional", "Immigration station or provisional stay"],
  ["retorno_asistido", "Retorno asistido", "Assisted return"],
  ["deportacion", "Deportación", "Deportation"],
  ["orden_salida", "Orden de salida", "Departure order"],
  ["restriccion_reingreso", "Restricción de reingreso", "Re-entry restriction"],
  ["expulsion_constitucional", "Expulsión constitucional", "Constitutional expulsion"],
  ["detencion_impugnacion", "Impugnación de detención migratoria", "Immigration detention challenge"],
  ["alternativa_detencion", "Solicitud de libertad o alternativa a la detención", "Release or detention-alternative request"],
  ["refugio", "Reconocimiento de la condición de refugiado", "Refugee-status recognition"],
  ["proteccion_complementaria", "Protección complementaria", "Complementary protection"],
  ["asilo_politico", "Asilo político", "Political asylum"],
  ["reunificacion_familiar", "Reunificación familiar", "Family reunification"],
  ["razones_humanitarias", "Razones humanitarias", "Humanitarian grounds"],
  ["no_devolucion", "Principio de no devolución", "Non-refoulement"],
  ["negativa_comar", "Negativa de COMAR", "COMAR denial"],
  ["abandono_desistimiento", "Abandono o desistimiento", "Abandonment or withdrawal"],
  ["cancelacion_cesacion", "Cancelación o cesación", "Cancellation or cessation"],
  ["recurso_refugio", "Recurso administrativo", "Administrative appeal"],
  ["nulidad_refugio", "Juicio de nulidad", "Nullity proceeding"],
  ["amparo_refugio", "Amparo en materia de refugio", "Refugee-law amparo"],
  ["nacionalidad_nacimiento", "Nacionalidad mexicana por nacimiento", "Mexican nationality by birth"],
  ["nacionalidad_filiacion", "Reconocimiento por filiación", "Nationality recognition by filiation"],
  ["doble_nacionalidad", "Doble nacionalidad", "Dual nationality"],
  ["declaratoria_nacionalidad", "Declaratoria de nacionalidad", "Nationality declaration"],
  ["certificado_nacionalidad", "Certificado de nacionalidad", "Nationality certificate"],
  ["naturalizacion", "Naturalización", "Naturalization"],
  ["naturalizacion_residencia", "Naturalización por residencia", "Naturalization by residence"],
  ["naturalizacion_matrimonio", "Naturalización por matrimonio", "Naturalization by marriage"],
  ["naturalizacion_hijos", "Naturalización por hijos mexicanos", "Naturalization through Mexican children"],
  ["recuperacion_nacionalidad", "Recuperación o aclaración de nacionalidad", "Recovery or clarification of nationality"],
  ["negativa_naturalizacion", "Negativa de naturalización", "Naturalization denial"],
  ["impugnacion_amparo", "Impugnación y amparo", "Challenge and amparo"],
  ["recurso_administrativo", "Recurso administrativo", "Administrative appeal"],
  ["tfja", "Juicio contencioso administrativo ante el TFJA", "Administrative litigation before TFJA"],
  ["amparo_indirecto", "Amparo indirecto", "Indirect amparo"],
  ["amparo_directo", "Amparo directo", "Direct amparo"],
  ["suspension_urgente", "Suspensión urgente", "Urgent suspension"],
  ["omision_demora", "Omisión o demora de autoridad", "Authority omission or delay"],
  ["notificacion_defectuosa", "Notificación defectuosa", "Defective notice"],
  ["fundamentacion_motivacion", "Falta de fundamentación y motivación", "Failure to state legal grounds and reasons"],
  ["incompetencia_autoridad", "Incompetencia de la autoridad", "Lack of authority competence"],
  ["debido_proceso", "Violación al debido proceso", "Due-process violation"],
  ["unidad_familiar_violacion", "Violación a la unidad familiar", "Family-unity violation"],
  ["interes_superior_ninez", "Violación al interés superior de la niñez", "Best-interests-of-the-child violation"],
  ["no_devolucion_violacion", "Violación al principio de no devolución", "Non-refoulement violation"],
  ["detencion_ilegal", "Detención migratoria ilegal", "Unlawful immigration detention"],
] as const;

export type ImmigrationSubtype = (typeof IMMIGRATION_SUBTYPES)[number][0];

export const IMMIGRATION_AUTHORITIES = {
  inm: {
    label: "Instituto Nacional de Migración (INM)",
    scope: ["estancia", "residencia", "regularizacion", "verificacion", "ejecucion"],
  },
  sre: {
    label: "Secretaría de Relaciones Exteriores y consulados de México",
    scope: ["visas", "nacionalidad", "naturalizacion"],
  },
  comar: {
    label: "Comisión Mexicana de Ayuda a Refugiados (COMAR)",
    scope: ["refugio", "proteccion_complementaria"],
  },
  dif: {
    label: "DIF y Procuradurías de Protección de Niñas, Niños y Adolescentes",
    scope: ["ninez", "adolescentes", "vulnerabilidad"],
  },
  tfja: {
    label: "Tribunal Federal de Justicia Administrativa",
    scope: ["nulidad", "contencioso_administrativo"],
  },
  pjf: {
    label: "Poder Judicial de la Federación",
    scope: ["amparo", "suspension", "revision_constitucional"],
  },
  cndh: {
    label: "Comisión Nacional de los Derechos Humanos",
    scope: ["queja_derechos_humanos"],
  },
} as const;

export const IMMIGRATION_OFFICIAL_SOURCES = [
  ["CPEUM", "Constitución Política de los Estados Unidos Mexicanos", "DOF"],
  ["LM", "Ley de Migración", "DOF"],
  ["RLM", "Reglamento de la Ley de Migración", "DOF"],
  ["LINEAMIENTOS_TRAMITES_INM", "Lineamientos para trámites y procedimientos migratorios", "INM/DOF"],
  ["LINEAMIENTOS_VISAS_SRE", "Lineamientos generales para la expedición de visas", "SRE/DOF"],
  ["LRPCAP", "Ley sobre Refugiados, Protección Complementaria y Asilo Político", "DOF"],
  ["RLRPCAP", "Reglamento de la Ley sobre Refugiados y Protección Complementaria", "DOF"],
  ["LN", "Ley de Nacionalidad", "DOF"],
  ["RLN", "Reglamento de la Ley de Nacionalidad", "DOF"],
  ["LFPA", "Ley Federal de Procedimiento Administrativo", "DOF"],
  ["LFPCA", "Ley Federal de Procedimiento Contencioso Administrativo", "DOF"],
  ["LA", "Ley de Amparo", "DOF"],
  ["LGDNNA", "Ley General de los Derechos de Niñas, Niños y Adolescentes", "DOF"],
  ["TRATADOS_MX", "Tratados internacionales vinculantes para México", "SRE/DOF"],
  ["JURISPRUDENCIA_PJF", "Jurisprudencia de la SCJN y del Poder Judicial de la Federación", "SJF"],
  ["PRECEDENTES_TFJA", "Precedentes del Tribunal Federal de Justicia Administrativa", "TFJA"],
  ["REQUISITOS_INM", "Requisitos oficiales vigentes del INM", "INM"],
  ["REQUISITOS_SRE", "Requisitos oficiales vigentes de SRE y consulados mexicanos", "SRE"],
  ["REQUISITOS_COMAR", "Requisitos oficiales vigentes de COMAR", "COMAR"],
  ["DERECHOS_FEDERALES", "Disposiciones federales vigentes de derechos", "DOF"],
] as const;

export const FORBIDDEN_FOREIGN_IMMIGRATION_TERMS = [
  "USCIS",
  "ICE",
  "green card",
  "removal court",
  "I-130",
  "I-485",
  "adjustment of status",
  "American asylum court",
] as const;

const optionalShort = z.string().trim().max(300).optional().nullable();
const optionalDate = z.string().trim().max(40).optional().nullable();

export const immigrationMatterMetadataSchema = z.object({
  internal_matter_number: optionalShort,
  client_name: optionalShort,
  client_aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  nationality: optionalShort,
  date_of_birth: optionalDate,
  passport_number: optionalShort,
  current_condition_of_stay: optionalShort,
  requested_benefit: optionalShort,
  entry_date: optionalDate,
  expiration_date: optionalDate,
  inm_expediente_number: optionalShort,
  comar_expediente_number: optionalShort,
  sre_consular_number: optionalShort,
  tfja_court_case_number: optionalShort,
  responsible_authority: optionalShort,
  procedural_stage: optionalShort,
  responsible_attorney: optionalShort,
  assigned_team: optionalShort,
  matter_status: optionalShort,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  important_dates: z.array(z.object({ label: z.string().max(120), date: z.string().max(40) })).max(30).default([]),
  confidentiality_level: z.enum(["standard", "confidential", "highly_confidential"]).default("confidential"),
  immigration_subtype: z.string().trim().max(120).optional().nullable(),
});

export type ImmigrationMatterMetadata = z.infer<typeof immigrationMatterMetadataSchema>;

export function parseImmigrationMatterMetadata(input: unknown): ImmigrationMatterMetadata {
  return immigrationMatterMetadataSchema.parse(input);
}

export function maskSensitiveIdentifier(value: string | null | undefined): string | null {
  const compact = String(value ?? "").replace(/\s+/g, "");
  if (!compact) return null;
  if (compact.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, compact.length - 4))}${compact.slice(-4)}`;
}

export function subtypeLabel(
  value: string | null | undefined,
  locale: "es" | "en" = "es",
): string | null {
  const row = IMMIGRATION_SUBTYPES.find(([key]) => key === value);
  return row ? row[locale === "es" ? 1 : 2] : null;
}
