// =============================================================================
// UNIVERSAL PRACTICE AREA ARCHITECTURE — module registry.
//
// Nyrava is ONE Mexican legal operating system. Every capability is either:
//
//   1. CORE PLATFORM  — present on every materia, no exceptions. Declared in
//      CORE_CAPABILITIES / CORE_TABS below. A component must never gate a core
//      capability on a materia.
//
//   2. PRACTICE AREA MODULE — specialized functionality declared per materia
//      in MX_DASHBOARD_MODULES below and resolved through
//      practice-areas.ts::isModuleApplicable(). A component must never test a
//      literal materia string ("inmobiliario", "penal", …) to decide whether a
//      module renders.
//
// Adding a future Mexican materia = adding entries to these tables (plus the
// generated policy tables in mexico-policy.ts). It must never require touching
// UI components, engines, or the pipeline.
//
// Scope is Mexican law only: penal, civil, mercantil, familiar, laboral,
// administrativo, fiscal, amparo, constitucional, electoral, agrario,
// ambiental, inmobiliario. Foreign practice areas are out of scope by design.
// =============================================================================
import type { MexicanCaseType } from "./mexico-types";

// ---------------------------------------------------------------------------
// 1. Core platform capabilities — guaranteed for EVERY materia
// ---------------------------------------------------------------------------

export const CORE_CAPABILITIES = [
  "case_management",
  "document_management",
  "ai_assistant",
  "reports",
  "timeline",
  "tasks",
  "calendar",
  "parties",
  "communications",
  "notes",
  "work_product",
  "search",
  "audit_trail",
  "version_history",
] as const;

export type CoreCapability = (typeof CORE_CAPABILITIES)[number];

/**
 * Workspace tab keys every materia gets. These are merged into
 * `UNIVERSAL_TABS` (practice-areas.ts) — the practice-area policy may only
 * ADD tabs on top of these, never remove one.
 */
export const CORE_TABS = [
  "dashboard",
  "intel", // documents
  "chat", // AI assistant
  "report",
  "timeline",
  "tasks",
  "calendar",
  "parties",
  "communications",
  "work", // notes + work product
  "findings",
  "evidence",
  "analyzers",
  "agents",
  "strategic",
  "attack",
] as const;

// ---------------------------------------------------------------------------
// 2. Practice-area modules (specialized surfaces layered on the core)
// ---------------------------------------------------------------------------

export const MX_DASHBOARD_MODULES: Record<MexicanCaseType, readonly string[]> = {
  penal: [
    "evidence_management",
    "discovery_review",
    "witness_management",
    "trial_prep",
    "sentencing_analysis",
    "motion_strategy",
    "chain_of_custody",
    "constitutional_review",
  ],
  civil: [
    "pleadings",
    "discovery",
    "expert_witnesses",
    "trial_prep",
    "damages_analysis",
    "motion_strategy",
  ],
  mercantil: [
    "pleadings",
    "discovery",
    "expert_witnesses",
    "titulos_de_credito",
    "corporate_governance",
    "motion_strategy",
  ],
  familiar: [
    "parenting_plan",
    "custody_analysis",
    "alimentos",
    "asset_division",
    "financial_disclosure",
  ],
  laboral: [
    "pleadings",
    "salary_computation",
    "reinstatement_analysis",
    "conciliation_tracking",
    "witness_management",
  ],
  administrativo: [
    "pleadings",
    "administrative_record",
    "nullity_analysis",
    "motion_strategy",
  ],
  fiscal: [
    "tax_assessment_review",
    "administrative_record",
    "nullity_analysis",
    "compliance_deadlines",
  ],
  amparo: [
    "constitutional_review",
    "suspension_analysis",
    "acto_reclamado",
    "authority_report_review",
    "motion_strategy",
  ],
  constitucional: [
    "constitutional_review",
    "conventionality_control",
    "human_rights_analysis",
    "motion_strategy",
  ],
  electoral: ["constitutional_review", "impugnation_tracking", "electoral_deadlines"],
  agrario: ["land_tenure_review", "ejido_governance", "registry", "expert_witnesses"],
  ambiental: [
    "environmental_impact_review",
    "permits_compliance",
    "profepa_tracking",
    "expert_witnesses",
  ],
  inmobiliario: [
    "transaction_center",
    "closing_readiness",
    "title_review",
    "registry",
    "escrow",
    "property_intelligence",
  ],
  migratorio: [
    "immigration_status",
    "eligibility_analysis",
    "document_sufficiency",
    "immigration_deadlines",
    "family_relationship",
    "employer_compliance",
    "verification_enforcement",
    "detention_deportation_risk",
    "refugee_non_refoulement",
    "child_vulnerability",
    "administrative_remedies",
    "nationality_naturalization",
    "current_law_validation",
  ],
};

// ---------------------------------------------------------------------------
// 3. Attorney-facing lifecycle statuses (never written by the pipeline)
// ---------------------------------------------------------------------------

/** Values shared by every materia. */
export const CORE_LIFECYCLE_STATUSES = [
  "intake",
  "working",
  "waiting_on_client",
  "closed",
  "archived",
] as const;

/** Materia-specific waiting/closing states layered on the core list. */
export const MX_LIFECYCLE_STATUSES: Record<MexicanCaseType, readonly string[]> = {
  penal: ["waiting_on_ministerio_publico", "waiting_on_hearing", "in_trial", "sentenced"],
  civil: ["waiting_on_counterparty", "waiting_on_court", "in_trial", "judgment_issued"],
  mercantil: ["waiting_on_counterparty", "waiting_on_court", "judgment_issued"],
  familiar: ["waiting_on_counterparty", "waiting_on_court", "agreement_reached"],
  laboral: ["waiting_on_conciliation", "waiting_on_court", "settlement_reached"],
  administrativo: ["waiting_on_authority", "waiting_on_court", "resolution_issued"],
  fiscal: ["waiting_on_authority", "waiting_on_court", "resolution_issued"],
  amparo: ["waiting_on_authority", "waiting_on_court", "suspension_granted", "resolution_issued"],
  constitucional: ["waiting_on_authority", "waiting_on_court", "resolution_issued"],
  electoral: ["waiting_on_authority", "waiting_on_court", "resolution_issued"],
  agrario: ["waiting_on_authority", "waiting_on_court", "resolution_issued"],
  ambiental: ["waiting_on_authority", "waiting_on_court", "resolution_issued"],
  inmobiliario: [
    "waiting_on_buyer",
    "waiting_on_seller",
    "waiting_on_notary",
    "waiting_on_registry",
    "waiting_on_municipality",
    "ready_to_close",
    "closing_scheduled",
  ],
  migratorio: [
    "waiting_on_client",
    "waiting_on_inm",
    "waiting_on_comar",
    "waiting_on_sre",
    "waiting_on_tfja",
    "waiting_on_court",
    "prevention_response_due",
    "interview_scheduled",
    "resolution_issued",
  ],
};

/** Full ordered list for a materia (core first, then specialized). */
export function lifecycleStatusesFor(t: MexicanCaseType): readonly string[] {
  const specialized = MX_LIFECYCLE_STATUSES[t] ?? [];
  return [
    "intake",
    "working",
    "waiting_on_client",
    ...specialized,
    "closed",
    "archived",
  ];
}

// ---------------------------------------------------------------------------
// 4. Party roles (core roster + materia-specific roles)
// ---------------------------------------------------------------------------

export const CORE_PARTY_ROLES = [
  "cliente",
  "contraparte",
  "abogado_contrario",
  "co_abogado",
  "juez",
  "perito",
  "testigo",
  "otro",
] as const;

export const MX_PARTY_ROLES: Record<MexicanCaseType, readonly string[]> = {
  penal: ["imputado", "victima", "ministerio_publico", "asesor_juridico", "policia", "defensor"],
  civil: ["actor", "demandado", "tercero_interesado"],
  mercantil: ["actor", "demandado", "acreedor", "deudor", "aval", "tercero_interesado"],
  familiar: ["conyuge", "menor", "tutor", "dif", "albacea"],
  laboral: ["trabajador", "patron", "sindicato", "centro_conciliacion", "inspector"],
  administrativo: ["autoridad", "particular", "tercero_interesado"],
  fiscal: ["contribuyente", "sat", "autoridad", "tercero_interesado"],
  amparo: ["quejoso", "autoridad_responsable", "tercero_interesado", "ministerio_publico_federal"],
  constitucional: ["promovente", "autoridad_responsable", "tercero_interesado"],
  electoral: ["actor", "autoridad_electoral", "partido_politico", "tercero_interesado"],
  agrario: ["ejidatario", "comisariado_ejidal", "nucleo_agrario", "autoridad"],
  ambiental: ["denunciante", "profepa", "semarnat", "autoridad", "particular"],
  inmobiliario: [
    "comprador",
    "vendedor",
    "notario",
    "corredor",
    "acreedor_hipotecario",
    "registro_publico",
    "municipio",
    "escrow",
  ],
  migratorio: [
    "persona_migrante",
    "solicitante",
    "refugiado",
    "empleador",
    "familiar",
    "inm",
    "comar",
    "sre",
    "dif",
    "autoridad_responsable",
    "tercero_interesado",
  ],
};

export function partyRolesFor(t: MexicanCaseType): readonly string[] {
  return [...CORE_PARTY_ROLES, ...(MX_PARTY_ROLES[t] ?? [])];
}

// ---------------------------------------------------------------------------
// 5. Default task templates (the surface is core; the content is practice-aware)
// ---------------------------------------------------------------------------

export interface MxTaskTemplate {
  /** Stable id so a template is never seeded twice into the same case. */
  key: string;
  title: { es: string; en: string };
  priority: "low" | "normal" | "high";
  /** Days from today used as an initial due date suggestion. */
  dueInDays?: number;
}

const CORE_TASK_TEMPLATES: readonly MxTaskTemplate[] = [
  {
    key: "core_review_documents",
    title: { es: "Revisar documentos del expediente", en: "Review case documents" },
    priority: "high",
    dueInDays: 3,
  },
  {
    key: "core_confirm_parties",
    title: { es: "Confirmar partes y datos de contacto", en: "Confirm parties and contacts" },
    priority: "normal",
    dueInDays: 5,
  },
  {
    key: "core_review_report",
    title: { es: "Revisar el informe de inteligencia", en: "Review the intelligence report" },
    priority: "normal",
    dueInDays: 7,
  },
];

export const MX_TASK_TEMPLATES: Record<MexicanCaseType, readonly MxTaskTemplate[]> = {
  penal: [
    {
      key: "penal_descubrimiento",
      title: { es: "Verificar descubrimiento probatorio", en: "Verify evidence discovery" },
      priority: "high",
      dueInDays: 5,
    },
    {
      key: "penal_cadena_custodia",
      title: { es: "Auditar cadena de custodia", en: "Audit chain of custody" },
      priority: "high",
      dueInDays: 7,
    },
    {
      key: "penal_audiencia",
      title: { es: "Preparar audiencia", en: "Prepare hearing" },
      priority: "high",
      dueInDays: 10,
    },
  ],
  civil: [
    {
      key: "civil_contestacion",
      title: { es: "Preparar contestación / demanda", en: "Prepare pleading" },
      priority: "high",
      dueInDays: 9,
    },
    {
      key: "civil_pruebas",
      title: { es: "Ofrecer pruebas", en: "Offer evidence" },
      priority: "normal",
      dueInDays: 15,
    },
  ],
  mercantil: [
    {
      key: "mercantil_titulo",
      title: { es: "Verificar requisitos del título de crédito", en: "Verify credit instrument requirements" },
      priority: "high",
      dueInDays: 5,
    },
    {
      key: "mercantil_excepciones",
      title: { es: "Analizar excepciones oponibles", en: "Analyze available defenses" },
      priority: "normal",
      dueInDays: 8,
    },
  ],
  familiar: [
    {
      key: "familiar_convenio",
      title: { es: "Elaborar propuesta de convenio", en: "Draft settlement proposal" },
      priority: "high",
      dueInDays: 7,
    },
    {
      key: "familiar_alimentos",
      title: { es: "Calcular pensión alimenticia", en: "Compute child/spousal support" },
      priority: "normal",
      dueInDays: 10,
    },
  ],
  laboral: [
    {
      key: "laboral_conciliacion",
      title: { es: "Agendar audiencia de conciliación prejudicial", en: "Schedule pre-trial conciliation" },
      priority: "high",
      dueInDays: 5,
    },
    {
      key: "laboral_cuantificacion",
      title: { es: "Cuantificar prestaciones reclamadas", en: "Quantify claimed benefits" },
      priority: "normal",
      dueInDays: 10,
    },
  ],
  administrativo: [
    {
      key: "admin_expediente",
      title: { es: "Solicitar expediente administrativo", en: "Request administrative record" },
      priority: "high",
      dueInDays: 5,
    },
    {
      key: "admin_nulidad",
      title: { es: "Identificar causales de nulidad", en: "Identify grounds for nullity" },
      priority: "normal",
      dueInDays: 10,
    },
  ],
  fiscal: [
    {
      key: "fiscal_plazos",
      title: { es: "Verificar plazos de caducidad y prescripción", en: "Verify statute of limitations" },
      priority: "high",
      dueInDays: 3,
    },
    {
      key: "fiscal_liquidacion",
      title: { es: "Revisar determinación del crédito fiscal", en: "Review tax assessment" },
      priority: "normal",
      dueInDays: 10,
    },
  ],
  amparo: [
    {
      key: "amparo_suspension",
      title: { es: "Solicitar / dar seguimiento a la suspensión", en: "Request or track suspension" },
      priority: "high",
      dueInDays: 2,
    },
    {
      key: "amparo_informe",
      title: { es: "Analizar informe justificado", en: "Analyze authority report" },
      priority: "normal",
      dueInDays: 10,
    },
  ],
  constitucional: [
    {
      key: "const_convencionalidad",
      title: { es: "Preparar control de convencionalidad", en: "Prepare conventionality control argument" },
      priority: "high",
      dueInDays: 10,
    },
  ],
  electoral: [
    {
      key: "electoral_plazo",
      title: { es: "Verificar plazo de impugnación", en: "Verify challenge deadline" },
      priority: "high",
      dueInDays: 2,
    },
  ],
  agrario: [
    {
      key: "agrario_tenencia",
      title: { es: "Revisar tenencia de la tierra y RAN", en: "Review land tenure and RAN records" },
      priority: "high",
      dueInDays: 7,
    },
  ],
  ambiental: [
    {
      key: "ambiental_permisos",
      title: { es: "Verificar permisos y manifestación de impacto ambiental", en: "Verify permits and impact statement" },
      priority: "high",
      dueInDays: 7,
    },
  ],
  inmobiliario: [
    {
      key: "inmo_libertad_gravamen",
      title: { es: "Obtener certificado de libertad de gravamen", en: "Obtain lien-free certificate" },
      priority: "high",
      dueInDays: 5,
    },
    {
      key: "inmo_no_adeudo",
      title: { es: "Reunir constancias de no adeudo (predial, agua, CFE)", en: "Collect no-debt certificates" },
      priority: "high",
      dueInDays: 7,
    },
    {
      key: "inmo_notaria",
      title: { es: "Coordinar firma ante notario", en: "Coordinate notary signing" },
      priority: "normal",
      dueInDays: 14,
    },
    {
      key: "inmo_registro",
      title: { es: "Inscribir escritura en el Registro Público", en: "Record deed with the public registry" },
      priority: "normal",
      dueInDays: 30,
    },
  ],
  migratorio: [
    {
      key: "migratorio_vigencia",
      title: { es: "Verificar vigencia de estancia y documentos", en: "Verify status and document validity" },
      priority: "high",
      dueInDays: 1,
    },
    {
      key: "migratorio_prevencion",
      title: { es: "Confirmar plazo para responder prevención", en: "Confirm prevention-response deadline" },
      priority: "high",
      dueInDays: 1,
    },
    {
      key: "migratorio_fuente_actual",
      title: { es: "Verificar requisitos y fuente oficial vigente", en: "Verify current official requirements and source" },
      priority: "high",
      dueInDays: 2,
    },
    {
      key: "migratorio_suficiencia",
      title: { es: "Revisar suficiencia documental", en: "Review document sufficiency" },
      priority: "normal",
      dueInDays: 3,
    },
  ],
};

export function taskTemplatesFor(t: MexicanCaseType): readonly MxTaskTemplate[] {
  return [...CORE_TASK_TEMPLATES, ...(MX_TASK_TEMPLATES[t] ?? [])];
}

// ---------------------------------------------------------------------------
// 6. AI persona per materia — the assistant adapts to the active practice area
// ---------------------------------------------------------------------------

export const MX_AI_PERSONA: Record<MexicanCaseType, string> = {
  penal:
    "Actúas como litigante penalista mexicano con amplia experiencia en el sistema acusatorio adversarial (CNPP): teoría del caso, control de detención, vinculación a proceso, cadena de custodia, descubrimiento probatorio y audiencia intermedia.",
  civil:
    "Actúas como litigante civil mexicano: contratos, responsabilidad civil, daño moral, arrendamiento y ejecución, conforme al Código Civil y Código de Procedimientos Civiles aplicables.",
  mercantil:
    "Actúas como litigante mercantil mexicano: títulos de crédito (LGTOC), juicio ejecutivo mercantil, oral mercantil, materia societaria y concursal.",
  familiar:
    "Actúas como abogado familiarista mexicano: divorcio, guarda y custodia, convivencias, alimentos, régimen patrimonial y sucesiones, siempre bajo el interés superior del menor.",
  laboral:
    "Actúas como litigante laboral mexicano conforme a la LFT y la reforma de 2019: conciliación prejudicial, tribunales laborales, ofrecimiento de trabajo y cuantificación de prestaciones.",
  administrativo:
    "Actúas como litigante administrativo mexicano: juicio contencioso administrativo, causales de nulidad, responsabilidades administrativas y procedimiento ante el TFJA.",
  fiscal:
    "Actúas como litigante fiscal mexicano: CFF, facultades de comprobación, determinación de créditos fiscales, caducidad, prescripción y juicio de nulidad ante el TFJA.",
  amparo:
    "Actúas como especialista en juicio de amparo (directo e indirecto): acto reclamado, procedencia, suspensión, informe justificado y conceptos de violación conforme a la Ley de Amparo.",
  constitucional:
    "Actúas como constitucionalista mexicano: control de constitucionalidad y convencionalidad, derechos humanos, controversias constitucionales y acciones de inconstitucionalidad.",
  electoral:
    "Actúas como especialista en derecho electoral mexicano: medios de impugnación, plazos perentorios y criterios del TEPJF.",
  agrario:
    "Actúas como especialista en derecho agrario mexicano: núcleos ejidales, tenencia de la tierra, RAN y tribunales unitarios agrarios.",
  ambiental:
    "Actúas como especialista en derecho ambiental mexicano: LGEEPA, manifestaciones de impacto ambiental, PROFEPA y responsabilidad ambiental.",
  inmobiliario:
    "Actúas como abogado inmobiliario transaccional mexicano: due diligence de título, certificado de libertad de gravamen, catastro, constancias de no adeudo, fideicomiso y cierre ante notario. No es litigio.",
  migratorio:
    "Actúas como especialista en derecho migratorio, refugio y nacionalidad mexicana. Aplicas exclusivamente derecho mexicano y fuentes oficiales vigentes del INM, SRE, COMAR, DOF, TFJA y Poder Judicial de la Federación. Distingues hechos verificados, inferencias y requisitos pendientes; nunca sustituyes una fuente oficial con memoria del modelo.",
};

export function aiPersonaFor(t: MexicanCaseType): string {
  return MX_AI_PERSONA[t];
}

export const materiaDashboardModules = (t: MexicanCaseType): readonly string[] =>
  MX_DASHBOARD_MODULES[t] ?? [];
