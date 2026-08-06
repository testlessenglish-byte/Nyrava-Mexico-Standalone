// =============================================================================
// LEGAL AUTHORITY REGISTRY (NYRAVA México) — DATA ONLY.
//
// This module declares WHICH normative instruments exist, at what level of the
// Mexican jerarquía de normas they sit, in which jurisdiction they operate and
// during which period they are in force. It contains NO reasoning, NO AI calls
// and NO case-specific or document-specific logic.
//
// Rules for this file:
//   · Data only. Every export is either a type, a literal table or a pure
//     lookup over that table.
//   · Never duplicated per state. State-level instruments are declared ONCE as
//     generic entities (state left undefined = "the applicable entidad
//     federativa"); the jurisdiction resolver binds the concrete state at
//     runtime.
//   · Nothing here decides anything about a case. It only provides
//     authoritative context to the validity and synthesis layers.
// =============================================================================

export type LegalSourceType =
  | "constitucion"
  | "codigo_federal"
  | "codigo_estatal"
  | "ley_federal"
  | "ley_estatal"
  | "reglamento"
  | "jurisprudencia"
  | "criterio_judicial"
  | "administrativo";

export type JurisdictionLevel = "federal" | "state" | "municipal";

export type LegalAuthority = {
  id: string;
  source_type: LegalSourceType;
  jurisdiction: JurisdictionLevel;
  /** Entidad federativa when the instrument is specific to one; omitted for
   *  generic state-level instruments (bound at resolution time). */
  state?: string;
  effective_from: string;
  effective_until?: string | null;
  /** Position in the Mexican normative hierarchy (10 = Constitución). */
  authority_weight: number;
  /** Attorney-facing Spanish name of the instrument. */
  label: string;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const LEGAL_AUTHORITIES: readonly LegalAuthority[] = [
  // --- Constitutional tier -------------------------------------------------
  {
    id: "cpeum",
    source_type: "constitucion",
    jurisdiction: "federal",
    effective_from: "1917-05-01",
    effective_until: null,
    authority_weight: 10,
    label: "Constitución Política de los Estados Unidos Mexicanos",
  },
  {
    id: "constitucion_estatal",
    source_type: "codigo_estatal",
    jurisdiction: "state",
    effective_from: "1917-05-01",
    effective_until: null,
    authority_weight: 9,
    label: "Constitución Política de la entidad federativa",
  },

  // --- Federal procedural / substantive codes ------------------------------
  {
    id: "cnpp",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "2014-03-05",
    effective_until: null,
    authority_weight: 9,
    label: "Código Nacional de Procedimientos Penales",
  },
  {
    id: "cpf",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "1931-08-14",
    effective_until: null,
    authority_weight: 9,
    label: "Código Penal Federal",
  },
  {
    id: "ccf",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "1928-05-26",
    effective_until: null,
    authority_weight: 8,
    label: "Código Civil Federal",
  },
  {
    id: "cfpc",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "1943-02-24",
    effective_until: null,
    authority_weight: 8,
    label: "Código Federal de Procedimientos Civiles",
  },
  {
    id: "cnpcf",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "2023-06-08",
    effective_until: null,
    authority_weight: 9,
    label: "Código Nacional de Procedimientos Civiles y Familiares",
  },
  {
    id: "ccom",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "1890-01-01",
    effective_until: null,
    authority_weight: 9,
    label: "Código de Comercio",
  },
  {
    id: "cff",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "1982-01-01",
    effective_until: null,
    authority_weight: 9,
    label: "Código Fiscal de la Federación",
  },

  // --- Federal statutes ----------------------------------------------------
  {
    id: "ley_amparo",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2013-04-03",
    effective_until: null,
    authority_weight: 9,
    label: "Ley de Amparo",
  },
  {
    id: "lft",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1970-05-01",
    effective_until: null,
    authority_weight: 9,
    label: "Ley Federal del Trabajo",
  },
  {
    id: "lss",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1997-07-01",
    effective_until: null,
    authority_weight: 8,
    label: "Ley del Seguro Social",
  },
  {
    id: "lfpca",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2006-01-01",
    effective_until: null,
    authority_weight: 9,
    label: "Ley Federal de Procedimiento Contencioso Administrativo",
  },
  {
    id: "lfpa",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1995-06-01",
    effective_until: null,
    authority_weight: 8,
    label: "Ley Federal de Procedimiento Administrativo",
  },
  {
    id: "ley_agraria",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1992-02-27",
    effective_until: null,
    authority_weight: 9,
    label: "Ley Agraria",
  },
  {
    id: "lgipe",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2014-05-24",
    effective_until: null,
    authority_weight: 9,
    label: "Ley General de Instituciones y Procedimientos Electorales",
  },
  {
    id: "lgsmime",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1996-11-23",
    effective_until: null,
    authority_weight: 9,
    label: "Ley General del Sistema de Medios de Impugnación en Materia Electoral",
  },
  {
    id: "lgeepa",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1988-03-01",
    effective_until: null,
    authority_weight: 9,
    label: "Ley General del Equilibrio Ecológico y la Protección al Ambiente",
  },
  {
    id: "lfpc",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1993-01-25",
    effective_until: null,
    authority_weight: 9,
    label: "Ley Federal de Protección al Consumidor",
  },
  {
    id: "lfppi",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2020-11-05",
    effective_until: null,
    authority_weight: 9,
    label: "Ley Federal de Protección a la Propiedad Industrial",
  },
  {
    id: "lfda",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1997-03-24",
    effective_until: null,
    authority_weight: 9,
    label: "Ley Federal del Derecho de Autor",
  },
  {
    id: "ley_migracion",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2011-05-26",
    effective_until: null,
    authority_weight: 9,
    label: "Ley de Migración",
  },
  {
    id: "lnn",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2006-06-02",
    effective_until: null,
    authority_weight: 9,
    label: "Ley de Navegación y Comercio Marítimos",
  },
  {
    id: "lgnnna",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2014-12-05",
    effective_until: null,
    authority_weight: 9,
    label: "Ley General de los Derechos de Niñas, Niños y Adolescentes",
  },
  {
    id: "lnsijpa",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2016-06-18",
    effective_until: null,
    authority_weight: 9,
    label: "Ley Nacional del Sistema Integral de Justicia Penal para Adolescentes",
  },
  {
    id: "lcm",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "2000-05-13",
    effective_until: null,
    authority_weight: 9,
    label: "Ley de Concursos Mercantiles",
  },
  {
    id: "lgsm",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1934-08-04",
    effective_until: null,
    authority_weight: 9,
    label: "Ley General de Sociedades Mercantiles",
  },
  {
    id: "lgtoc",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1932-09-15",
    effective_until: null,
    authority_weight: 9,
    label: "Ley General de Títulos y Operaciones de Crédito",
  },

  // --- Superseded federal instruments (kept for temporal validity) ---------
  {
    id: "ley_amparo_1936",
    source_type: "ley_federal",
    jurisdiction: "federal",
    effective_from: "1936-01-10",
    effective_until: "2013-04-02",
    authority_weight: 9,
    label: "Ley de Amparo (abrogada, 1936)",
  },
  {
    id: "cfpp_1934",
    source_type: "codigo_federal",
    jurisdiction: "federal",
    effective_from: "1934-08-30",
    effective_until: "2016-06-18",
    authority_weight: 9,
    label: "Código Federal de Procedimientos Penales (abrogado)",
  },

  // --- Generic state-level instruments (never duplicated per entidad) ------
  {
    id: "codigo_civil_estatal",
    source_type: "codigo_estatal",
    jurisdiction: "state",
    effective_from: "1928-05-26",
    effective_until: null,
    authority_weight: 8,
    label: "Código Civil de la entidad federativa",
  },
  {
    id: "codigo_procedimientos_civiles_estatal",
    source_type: "codigo_estatal",
    jurisdiction: "state",
    effective_from: "1932-09-01",
    effective_until: null,
    authority_weight: 8,
    label: "Código de Procedimientos Civiles de la entidad federativa",
  },
  {
    id: "codigo_familiar_estatal",
    source_type: "codigo_estatal",
    jurisdiction: "state",
    effective_from: "1928-05-26",
    effective_until: null,
    authority_weight: 8,
    label: "Código Familiar / Civil de la entidad federativa",
  },
  {
    id: "codigo_penal_estatal",
    source_type: "codigo_estatal",
    jurisdiction: "state",
    effective_from: "1931-08-14",
    effective_until: null,
    authority_weight: 8,
    label: "Código Penal de la entidad federativa",
  },
  {
    id: "ley_procedimiento_administrativo_estatal",
    source_type: "ley_estatal",
    jurisdiction: "state",
    effective_from: "1995-06-01",
    effective_until: null,
    authority_weight: 7,
    label: "Ley de Procedimiento Administrativo de la entidad federativa",
  },
  {
    id: "ley_hacienda_estatal",
    source_type: "ley_estatal",
    jurisdiction: "state",
    effective_from: "1982-01-01",
    effective_until: null,
    authority_weight: 7,
    label: "Ley de Hacienda de la entidad federativa",
  },
  {
    id: "ley_electoral_estatal",
    source_type: "ley_estatal",
    jurisdiction: "state",
    effective_from: "2014-05-24",
    effective_until: null,
    authority_weight: 7,
    label: "Ley Electoral de la entidad federativa",
  },
  {
    id: "registro_publico_estatal",
    source_type: "ley_estatal",
    jurisdiction: "state",
    effective_from: "1928-05-26",
    effective_until: null,
    authority_weight: 7,
    label: "Ley del Registro Público de la Propiedad y del Comercio de la entidad federativa",
  },

  // --- Municipal tier ------------------------------------------------------
  {
    id: "reglamento_municipal_construccion",
    source_type: "reglamento",
    jurisdiction: "municipal",
    effective_from: "1970-01-01",
    effective_until: null,
    authority_weight: 5,
    label: "Reglamento municipal de construcción y uso de suelo",
  },
  {
    id: "bando_policia_gobierno",
    source_type: "reglamento",
    jurisdiction: "municipal",
    effective_from: "1970-01-01",
    effective_until: null,
    authority_weight: 4,
    label: "Bando de Policía y Buen Gobierno",
  },

  // --- Judicial / administrative criteria ---------------------------------
  {
    id: "jurisprudencia_scjn",
    source_type: "jurisprudencia",
    jurisdiction: "federal",
    effective_from: "1917-05-01",
    effective_until: null,
    authority_weight: 9,
    label: "Jurisprudencia obligatoria de la SCJN y Plenos Regionales",
  },
  {
    id: "criterio_tcc",
    source_type: "criterio_judicial",
    jurisdiction: "federal",
    effective_from: "1917-05-01",
    effective_until: null,
    authority_weight: 6,
    label: "Criterios aislados de Tribunales Colegiados de Circuito",
  },
  {
    id: "criterio_tfja",
    source_type: "administrativo",
    jurisdiction: "federal",
    effective_from: "1937-01-01",
    effective_until: null,
    authority_weight: 5,
    label: "Precedentes del Tribunal Federal de Justicia Administrativa",
  },
  {
    id: "criterio_tepjf",
    source_type: "criterio_judicial",
    jurisdiction: "federal",
    effective_from: "1996-11-23",
    effective_until: null,
    authority_weight: 7,
    label: "Jurisprudencia y tesis del TEPJF",
  },
] as const;

const BY_ID: ReadonlyMap<string, LegalAuthority> = new Map(
  LEGAL_AUTHORITIES.map((a) => [a.id, a]),
);

export function getAuthority(id: string): LegalAuthority | undefined {
  return BY_ID.get(id);
}

export function getAuthorities(ids: readonly string[]): LegalAuthority[] {
  const out: LegalAuthority[] = [];
  for (const id of ids) {
    const a = BY_ID.get(id);
    if (a) out.push(a);
  }
  return out;
}

/** Authorities that apply to every Mexican matter regardless of materia. */
export const UNIVERSAL_AUTHORITY_IDS: readonly string[] = [
  "cpeum",
  "jurisprudencia_scjn",
];

/**
 * Materia → authority ids. Declarative only: this states which instruments
 * form the normative frame of a matter, not what to conclude from them.
 * State-level instruments appear once, generically.
 */
export const MATERIA_AUTHORITY_IDS: Record<string, readonly string[]> = {
  civil: ["ccf", "codigo_civil_estatal", "codigo_procedimientos_civiles_estatal", "cnpcf"],
  familiar: ["codigo_familiar_estatal", "cnpcf", "lgnnna"],
  penal: ["cnpp", "cpf", "codigo_penal_estatal"],
  mercantil: ["ccom", "lgtoc", "lgsm", "ccf"],
  laboral: ["lft", "lss"],
  administrativo: ["lfpa", "lfpca", "ley_procedimiento_administrativo_estatal", "criterio_tfja"],
  fiscal: ["cff", "lfpca", "ley_hacienda_estatal", "criterio_tfja"],
  amparo: ["ley_amparo", "criterio_tcc"],
  constitucional: ["ley_amparo", "criterio_tcc"],
  electoral: ["lgipe", "lgsmime", "ley_electoral_estatal", "criterio_tepjf"],
  agrario: ["ley_agraria"],
  ambiental: ["lgeepa", "lfpa"],
  inmobiliario: ["codigo_civil_estatal", "registro_publico_estatal", "reglamento_municipal_construccion"],

  // Sub-materias / practice aliases — inherit, never fork.
  general_civil: ["ccf", "codigo_civil_estatal", "cnpcf"],
  contratos: ["ccf", "codigo_civil_estatal"],
  arrendamiento: ["codigo_civil_estatal", "cnpcf"],
  cobranza: ["ccom", "lgtoc"],
  cobranza_judicial: ["ccom", "lgtoc"],
  responsabilidad_civil: ["ccf", "codigo_civil_estatal"],
  sucesiones: ["codigo_civil_estatal", "cnpcf"],
  familiar_sucesiones: ["codigo_familiar_estatal", "codigo_civil_estatal", "cnpcf"],
  penal_adolescentes: ["lnsijpa", "cnpp"],
  mercantil_concursal: ["lcm", "ccom"],
  mercantil_corporativo: ["lgsm", "ccom"],
  corporativo: ["lgsm", "ccom"],
  consumidor: ["lfpc", "ccom"],
  propiedad_intelectual: ["lfppi", "lfda"],
  migratorio: ["ley_migracion", "lfpa"],
  maritimo: ["lnn", "ccom"],
  derechos_humanos: ["ley_amparo", "criterio_tcc"],
};

/** Materias whose competence is exclusively federal (state law never displaces). */
export const FEDERAL_ONLY_MATERIAS: readonly string[] = [
  "amparo",
  "constitucional",
  "fiscal",
  "laboral",
  "agrario",
  "migratorio",
  "maritimo",
  "propiedad_intelectual",
  "consumidor",
  "mercantil",
  "mercantil_concursal",
  "mercantil_corporativo",
  "corporativo",
  "cobranza",
  "cobranza_judicial",
  "derechos_humanos",
];
