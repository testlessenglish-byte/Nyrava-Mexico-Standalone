// =============================================================================
// CANONICAL MEXICAN CASE-TYPE VOCABULARY (materias).
//
// This is the ONLY case-type vocabulary that exists in this platform. Every
// layer — UI, database, server functions, pipeline stages, AI agents, report
// engine — stores, routes on, and renders these exact values. There is no
// second vocabulary and no translation table between vocabularies.
//
// Type-only module so that both the policy data tables and the jurisdiction
// module can import it without a cycle.
// =============================================================================

export const MX_CASE_TYPES = [
  "penal",
  "civil",
  "mercantil",
  "familiar",
  "laboral",
  "administrativo",
  "fiscal",
  "amparo",
  "electoral",
  "agrario",
  "constitucional",
  "ambiental",
  "inmobiliario",
] as const;

export type MexicanCaseType = (typeof MX_CASE_TYPES)[number];

/** Attorney-facing materia labels (es default, en for the bilingual report layer). */
export const MX_CASE_TYPE_LABELS: Record<MexicanCaseType, { es: string; en: string }> = {
  penal: { es: "Derecho Penal (Sistema Acusatorio)", en: "Criminal Law (Accusatory System)" },
  civil: { es: "Derecho Civil", en: "Civil Law" },
  mercantil: { es: "Derecho Mercantil", en: "Commercial Law" },
  familiar: { es: "Derecho Familiar", en: "Family Law" },
  laboral: { es: "Derecho Laboral", en: "Labor Law" },
  administrativo: { es: "Derecho Administrativo", en: "Administrative Law" },
  fiscal: { es: "Derecho Fiscal", en: "Tax Law" },
  amparo: { es: "Juicio de Amparo", en: "Amparo Proceeding" },
  electoral: { es: "Derecho Electoral", en: "Electoral Law" },
  agrario: { es: "Derecho Agrario", en: "Agrarian Law" },
  constitucional: { es: "Derecho Constitucional / Derechos Humanos", en: "Constitutional Law / Human Rights" },
  ambiental: { es: "Derecho Ambiental", en: "Environmental Law" },
  inmobiliario: { es: "Bienes Raíces (Transacción Inmobiliaria)", en: "Real Estate (Property Transaction)" },
};

export function isMexicanCaseType(v: unknown): v is MexicanCaseType {
  return typeof v === "string" && (MX_CASE_TYPES as readonly string[]).includes(v);
}
