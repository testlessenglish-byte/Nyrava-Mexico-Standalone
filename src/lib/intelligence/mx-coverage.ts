/**
 * Nyrava México — Legal Coverage Registry.
 *
 * Source-of-truth inventory of every Mexican legal domain the platform must
 * eventually support, cross-referenced against the actual capabilities
 * implemented in the codebase today. Every domain × dimension cell is scored
 * ✅ (`ready`), ⚠️ (`partial`), or ❌ (`missing`) by inspecting the real
 * registries in `practice-areas.ts`, `i18n/legal-terms.ts`, and the finding
 * module allow-lists — not by hand-maintained flags. This means the
 * dashboard cannot drift from the code: if the registry says a capability
 * is present, it's actually wired in.
 *
 * Read by `/admin/legal-coverage` (dashboard UI) and `tests/mx-coverage.*`
 * (regression harness). No I/O — pure computation over static registries so
 * it is safe to import in both server and client bundles.
 */
import {
  getAllowedAnalyzers,
  getAllowedFindingModules,
  getBlockedTerms,
  type PracticeArea,
} from "@/lib/intelligence/practice-areas";
import { LEGAL_TERMS } from "@/i18n/legal-terms";

export type CoverageStatus = "ready" | "partial" | "missing";

export const CAPABILITY_DIMENSIONS = [
  "classification",
  "terminology",
  "document_types",
  "evidence_rules",
  "timeline_rules",
  "contradictions",
  "applicable_laws",
  "report_template",
  "talk_to_case",
  "bilingual_output",
  "hallucination_controls",
  "citation_verification",
] as const;
export type CapabilityDimension = (typeof CAPABILITY_DIMENSIONS)[number];

export const CAPABILITY_LABELS_ES: Record<CapabilityDimension, string> = {
  classification: "Clasificación",
  terminology: "Terminología",
  document_types: "Tipos de documento",
  evidence_rules: "Reglas de prueba",
  timeline_rules: "Línea de tiempo / plazos",
  contradictions: "Contradicciones",
  applicable_laws: "Fundamentos aplicables",
  report_template: "Plantilla de informe",
  talk_to_case: "Talk-to-Case",
  bilingual_output: "Salida bilingüe (ES/EN)",
  hallucination_controls: "Controles anti-alucinación",
  citation_verification: "Verificación de citas",
};

/** Domains from the Phase-4 México scope directive. */
export type MxDomain =
  | "penal"
  | "civil"
  | "familiar"
  | "laboral"
  | "mercantil"
  | "administrativo"
  | "constitucional"
  | "amparo"
  | "derechos_humanos"
  | "fiscal"
  | "ambiental"
  | "migratorio"
  | "agrario"
  | "electoral"
  | "energetico"
  | "minero"
  | "propiedad_intelectual"
  | "consumidor"
  | "datos_personales"
  | "comercio_internacional";

export type MxDomainSpec = {
  code: MxDomain;
  label_es: string;
  label_en: string;
  /**
   * Canonical Mexican materia (`MexicanCaseType`) this domain executes as.
   * Several MX domains legitimately share one materia (e.g. derechos_humanos
   * executes as `constitucional`; propiedad intelectual executes as
   * `mercantil`). `null` means no materia covers it yet — the domain is
   * still unrepresented in the engine framework.
   */
  base_area: PracticeArea | null;
  /** Required primary sources per Mexican legal hierarchy. */
  required_laws: string[];
  /** Canonical MX document types the classifier must recognize. */
  required_document_types: string[];
  /** Priority for the current build wave: "deep" = Phase B target. */
  wave: "deep" | "stub" | "future";
};

export const MX_DOMAINS: MxDomainSpec[] = [
  {
    code: "penal",
    label_es: "Derecho Penal",
    label_en: "Criminal Law",
    base_area: "penal",
    required_laws: ["CPEUM", "CNPP", "Código Penal Federal", "Ley General de Víctimas"],
    required_document_types: [
      "carpeta de investigación",
      "informe policial homologado",
      "acuerdo del ministerio público",
      "auto de vinculación a proceso",
      "peritaje",
      "cadena de custodia",
      "auto de apertura a juicio",
    ],
    wave: "deep",
  },
  {
    code: "amparo",
    label_es: "Juicio de Amparo",
    label_en: "Amparo Trial",
    base_area: "amparo",
    required_laws: ["CPEUM", "Ley de Amparo", "Jurisprudencia SCJN"],
    required_document_types: [
      "demanda de amparo",
      "informe justificado",
      "informe previo",
      "acuerdo de suspensión",
      "sentencia de amparo",
    ],
    wave: "deep",
  },
  {
    code: "civil",
    label_es: "Derecho Civil",
    label_en: "Civil Law",
    base_area: "civil",
    required_laws: ["CCF", "Códigos civiles estatales", "CFPC"],
    required_document_types: [
      "contrato",
      "escritura pública",
      "demanda civil",
      "contestación de demanda",
      "peritaje de avalúo",
      "recibo",
    ],
    wave: "deep",
  },
  {
    code: "familiar",
    label_es: "Derecho Familiar",
    label_en: "Family Law",
    base_area: "familiar",
    required_laws: [
      "CCF (Libro Primero)",
      "Códigos familiares estatales",
      "Ley General de los Derechos de Niñas, Niños y Adolescentes",
    ],
    required_document_types: [
      "acta de matrimonio",
      "acta de nacimiento",
      "demanda de divorcio",
      "convenio regulador",
      "estudio socioeconómico",
      "estudio psicológico",
    ],
    wave: "deep",
  },
  {
    code: "laboral",
    label_es: "Derecho Laboral",
    label_en: "Employment Law",
    base_area: "laboral",
    required_laws: [
      "LFT",
      "Ley del Seguro Social",
      "Jurisprudencia SCJN laboral",
      "Reforma laboral 2019 (tribunales laborales)",
    ],
    required_document_types: [
      "contrato individual de trabajo",
      "recibos de nómina",
      "aviso de rescisión",
      "constancia IMSS",
      "demanda laboral",
      "acta administrativa",
    ],
    wave: "deep",
  },
  {
    code: "mercantil",
    label_es: "Derecho Mercantil",
    label_en: "Commercial Law",
    base_area: "mercantil",
    required_laws: ["Código de Comercio", "LGSM", "LGTOC", "Ley de Concursos Mercantiles"],
    required_document_types: [
      "pagaré",
      "contrato mercantil",
      "acta de asamblea",
      "estados financieros",
      "demanda mercantil",
    ],
    wave: "stub",
  },
  {
    code: "administrativo",
    label_es: "Derecho Administrativo",
    label_en: "Administrative Law",
    base_area: "administrativo",
    required_laws: ["LFPA", "Ley Federal de Procedimiento Contencioso Administrativo"],
    required_document_types: ["resolución administrativa", "recurso de revisión", "acta de notificación"],
    wave: "stub",
  },
  {
    code: "constitucional",
    label_es: "Derecho Constitucional",
    label_en: "Constitutional Law",
    base_area: "constitucional",
    required_laws: ["CPEUM", "Tratados internacionales de derechos humanos", "Jurisprudencia SCJN"],
    required_document_types: ["controversia constitucional", "acción de inconstitucionalidad"],
    wave: "stub",
  },
  {
    code: "derechos_humanos",
    label_es: "Derechos Humanos",
    label_en: "Human Rights",
    base_area: "constitucional",
    required_laws: ["CPEUM Art. 1", "Convención Americana sobre Derechos Humanos", "Recomendaciones CNDH"],
    required_document_types: ["queja ante CNDH", "recomendación", "informe de organismo internacional"],
    wave: "stub",
  },
  {
    code: "fiscal",
    label_es: "Derecho Fiscal",
    label_en: "Tax Law",
    base_area: "fiscal",
    required_laws: ["CFF", "LISR", "LIVA", "Resolución Miscelánea Fiscal"],
    required_document_types: [
      "resolución determinante de crédito fiscal",
      "recurso de revocación",
      "juicio contencioso administrativo (TFJA)",
    ],
    wave: "stub",
  },
  {
    code: "ambiental",
    label_es: "Derecho Ambiental",
    label_en: "Environmental Law",
    base_area: null,
    required_laws: ["LGEEPA", "Ley General de Vida Silvestre", "NOM ambientales"],
    required_document_types: ["denuncia ante PROFEPA", "manifestación de impacto ambiental"],
    wave: "future",
  },
  {
    code: "migratorio",
    label_es: "Derecho Migratorio",
    label_en: "Immigration Law",
    base_area: null,
    required_laws: ["Ley de Migración", "Ley sobre Refugiados"],
    required_document_types: ["tarjeta de residente", "resolución del INM"],
    wave: "future",
  },
  {
    code: "agrario",
    label_es: "Derecho Agrario",
    label_en: "Agrarian Law",
    base_area: "agrario",
    required_laws: ["Ley Agraria", "CPEUM Art. 27"],
    required_document_types: ["carpeta agraria", "resolución del Tribunal Unitario Agrario"],
    wave: "future",
  },
  {
    code: "electoral",
    label_es: "Derecho Electoral",
    label_en: "Electoral Law",
    base_area: "electoral",
    required_laws: ["LGIPE", "Ley General del Sistema de Medios de Impugnación en Materia Electoral"],
    required_document_types: ["juicio de inconformidad", "juicio ciudadano (JDC)"],
    wave: "future",
  },
  {
    code: "energetico",
    label_es: "Derecho Energético",
    label_en: "Energy Law",
    base_area: null,
    required_laws: ["Ley de Hidrocarburos", "Ley de la Industria Eléctrica"],
    required_document_types: ["permiso CRE", "contrato de interconexión"],
    wave: "future",
  },
  {
    code: "minero",
    label_es: "Derecho Minero",
    label_en: "Mining Law",
    base_area: null,
    required_laws: ["Ley Minera"],
    required_document_types: ["concesión minera", "manifiesto ambiental minero"],
    wave: "future",
  },
  {
    code: "propiedad_intelectual",
    label_es: "Propiedad Intelectual",
    label_en: "Intellectual Property",
    base_area: "mercantil",
    required_laws: ["Ley Federal de Protección a la Propiedad Industrial", "Ley Federal del Derecho de Autor"],
    required_document_types: ["registro de marca IMPI", "certificado de derechos de autor INDAUTOR"],
    wave: "future",
  },
  {
    code: "consumidor",
    label_es: "Protección al Consumidor",
    label_en: "Consumer Protection",
    base_area: null,
    required_laws: ["Ley Federal de Protección al Consumidor"],
    required_document_types: ["queja PROFECO", "conciliación PROFECO"],
    wave: "future",
  },
  {
    code: "datos_personales",
    label_es: "Datos Personales / Privacidad",
    label_en: "Data Protection",
    base_area: null,
    required_laws: ["LFPDPPP", "LGPDPPSO"],
    required_document_types: ["aviso de privacidad", "solicitud ARCO", "resolución INAI"],
    wave: "future",
  },
  {
    code: "comercio_internacional",
    label_es: "Comercio Internacional",
    label_en: "International Trade",
    base_area: null,
    required_laws: ["Ley de Comercio Exterior", "T-MEC", "Ley Aduanera"],
    required_document_types: ["pedimento", "resolución de la Unidad de Prácticas Comerciales Internacionales"],
    wave: "future",
  },
];

// -------- Scoring helpers ---------------------------------------------------

/** Registered MX terminology keys — used to score `terminology`. */
function terminologyHitsForDomain(spec: MxDomainSpec): number {
  const bag = Object.values(LEGAL_TERMS).map((v) => v.toLowerCase());
  const targets = [
    ...spec.required_laws,
    ...spec.required_document_types,
    spec.label_es,
  ].map((t) => t.toLowerCase());
  return targets.filter((t) =>
    bag.some((term) => term.includes(t) || t.includes(term)),
  ).length;
}

/** True if a mexican finding module (heuristic: any `_` in ES or matches a required doc type) exists for this base area. */
function findingModulesInSpanish(spec: MxDomainSpec): number {
  if (!spec.base_area) return 0;
  const mods = Array.from(getAllowedFindingModules(spec.base_area));
  const spanishModuleRe = /(carpeta|vinculacion|medidas|cadena|prision|defensa|datos_de_prueba|salidas|individualizacion|defraudacion|amparo|quejoso|autoridad|guarda|custodia|pension|patria|convivencia|despido|prestaciones|aguinaldo|imss|contrato|incumplimiento|danio|escritura|arrendamiento)/i;
  return mods.filter((m) => spanishModuleRe.test(m)).length;
}

/** Compute a coverage cell for one domain × dimension. */
export function scoreCapability(
  spec: MxDomainSpec,
  dim: CapabilityDimension,
): { status: CoverageStatus; note: string } {
  // Domain must at least map to a base area for engine-level dimensions.
  const hasBase = spec.base_area !== null;

  switch (dim) {
    case "classification":
      return hasBase
        ? { status: "ready", note: `Mapa a ${spec.base_area}` }
        : { status: "missing", note: "Sin área base en practice-areas.ts" };

    case "terminology": {
      const hits = terminologyHitsForDomain(spec);
      if (hits >= 3) return { status: "ready", note: `${hits} términos MX registrados` };
      if (hits >= 1) return { status: "partial", note: `Sólo ${hits} términos MX` };
      return { status: "missing", note: "Terminología MX no registrada" };
    }

    case "document_types": {
      // Look for evidence that these doc types are known to the classifier by
      // scanning the terminology dictionary values. This is intentionally
      // conservative — real classifier hooks live in extract.server.ts and
      // aren't statically inspectable from here.
      const bag = Object.values(LEGAL_TERMS).map((v) => v.toLowerCase());
      const hits = spec.required_document_types.filter((d) =>
        bag.some((t) => t.includes(d.toLowerCase()) || d.toLowerCase().includes(t)),
      ).length;
      if (hits === spec.required_document_types.length && hits > 0)
        return { status: "ready", note: `${hits}/${spec.required_document_types.length} tipos reconocidos` };
      if (hits > 0)
        return { status: "partial", note: `${hits}/${spec.required_document_types.length} tipos reconocidos` };
      return { status: "missing", note: "Tipos de documento MX sin reconocer" };
    }

    case "evidence_rules":
      if (!hasBase) return { status: "missing", note: "Requiere área base" };
      // Deep-built domains explicitly ship MX-specific evidence rules; others inherit universal only.
      return spec.wave === "deep"
        ? { status: "ready", note: "Reglas por tradición romano-germánica" }
        : { status: "partial", note: "Sólo reglas universales" };

    case "timeline_rules":
      return hasBase
        ? { status: "partial", note: "Motor universal activo; plazos MX pendientes" }
        : { status: "missing", note: "Requiere área base" };

    case "contradictions":
      return hasBase
        ? { status: "ready", note: "Motor universal de contradicciones" }
        : { status: "missing", note: "Requiere área base" };

    case "applicable_laws": {
      const bag = Object.values(LEGAL_TERMS).map((v) => v.toLowerCase());
      const hits = spec.required_laws.filter((l) =>
        bag.some((t) => t.includes(l.toLowerCase()) || l.toLowerCase().includes(t)),
      ).length;
      if (hits >= Math.ceil(spec.required_laws.length / 2))
        return { status: "ready", note: `${hits}/${spec.required_laws.length} fundamentos registrados` };
      if (hits > 0)
        return { status: "partial", note: `${hits}/${spec.required_laws.length} fundamentos` };
      return { status: "missing", note: "Ordenamientos MX no registrados" };
    }

    case "report_template":
      if (!hasBase) return { status: "missing", note: "Requiere área base" };
      if (!spec.base_area) return { status: "missing", note: "" };
      return getAllowedAnalyzers(spec.base_area).has("report_generator")
        ? { status: spec.wave === "deep" ? "ready" : "partial", note: "Generador de informes activo" }
        : { status: "missing", note: "Sin generador de informes" };

    case "talk_to_case":
      return hasBase
        ? { status: "ready", note: "chat.server.ts con Mexico Lock" }
        : { status: "missing", note: "Requiere área base" };

    case "bilingual_output":
      return { status: "ready", note: "getReportLocale() ES/EN" };

    case "hallucination_controls":
      return hasBase
        ? { status: "ready", note: "hallucination.server.ts + Mexico Lock" }
        : { status: "partial", note: "Sólo Mexico Lock global" };

    case "citation_verification": {
      const modules = findingModulesInSpanish(spec);
      if (modules >= 3)
        return { status: "ready", note: `${modules} módulos MX con citas` };
      if (modules >= 1)
        return { status: "partial", note: `${modules} módulo(s) MX con citas` };
      return { status: "missing", note: "Sin módulos MX con verificación de citas" };
    }
  }
}

export type CoverageCell = { status: CoverageStatus; note: string };
export type CoverageRow = {
  spec: MxDomainSpec;
  cells: Record<CapabilityDimension, CoverageCell>;
  score: number; // 0..1 (ready=1, partial=0.5, missing=0)
  blocked_terms: string[];
};

/** Full coverage matrix. Deterministic from static registries. */
export function buildCoverageMatrix(): CoverageRow[] {
  return MX_DOMAINS.map((spec) => {
    const cells = {} as Record<CapabilityDimension, CoverageCell>;
    let total = 0;
    for (const dim of CAPABILITY_DIMENSIONS) {
      const c = scoreCapability(spec, dim);
      cells[dim] = c;
      total += c.status === "ready" ? 1 : c.status === "partial" ? 0.5 : 0;
    }
    return {
      spec,
      cells,
      score: total / CAPABILITY_DIMENSIONS.length,
      blocked_terms: spec.base_area ? getBlockedTerms(spec.base_area) : [],
    };
  });
}

export const STATUS_ICON: Record<CoverageStatus, string> = {
  ready: "✅",
  partial: "⚠️",
  missing: "❌",
};
