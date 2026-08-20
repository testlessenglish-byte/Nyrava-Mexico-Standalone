// =============================================================================
// EXECUTION PROFILE — the legal-framework facts that govern a materia,
// independent of which engines happen to run for a given case.
//
// This is deliberately NOT a jurisprudence/citation database. SCJN tesis
// registry numbers, Corte IDH paragraph citations, and similar case-specific
// references are never hardcoded here — inventing or misremembering a
// citation is a professional-conduct hazard, not a productivity shortcut.
// `precedentGuidance` points to the right BODY of binding jurisprudence
// (which court, which chamber, which doctrine) and explicitly tells the
// reader to verify the exact citation before it goes in a filing; it never
// asserts a specific case number.
//
// What IS safe and useful to declare statically: which body of law governs,
// which constitutional articles are typically implicated, which ratified
// treaties apply, who carries the burden of proof, and what standing a party
// must show — all verifiable, static facts about Mexican procedural law, not
// case-specific findings that vary per matter.
// =============================================================================

import type { MexicanCaseType } from "./mexico-types";

export type JurisdictionLevel = "federal" | "estatal" | "municipal" | "indigena" | "internacional";

export type GoverningLaw = { readonly code: string; readonly title_es: string };
export type ConstitutionalArticle = { readonly article: string; readonly title_es: string };
export type Treaty = { readonly short: string; readonly title_es: string };

export type ExecutionProfile = {
  readonly jurisdictionLevels: readonly JurisdictionLevel[];
  readonly governingLaws: readonly GoverningLaw[];
  readonly constitutionalArticles: readonly ConstitutionalArticle[];
  readonly treaties: readonly Treaty[];
  readonly burdenOfProof: string;
  readonly standing: string;
  readonly precedentGuidance: string;
};

export const EXECUTION_PROFILES: Record<MexicanCaseType, ExecutionProfile> = {
  penal: {
    jurisdictionLevels: ["federal", "estatal"],
    governingLaws: [
      { code: "CNPP", title_es: "Código Nacional de Procedimientos Penales" },
      { code: "CPF / CP estatal", title_es: "Código Penal Federal o del fuero común aplicable" },
      { code: "LGV", title_es: "Ley General de Víctimas" },
    ],
    constitutionalArticles: [
      { article: "Art. 14", title_es: "Debido proceso, irretroactividad de la ley" },
      { article: "Art. 16", title_es: "Legalidad, orden de aprehensión, cateo" },
      { article: "Art. 19", title_es: "Plazo constitucional, auto de vinculación a proceso" },
      { article: "Art. 20", title_es: "Proceso acusatorio y oral; derechos del imputado y de la víctima" },
      { article: "Art. 21", title_es: "Investigación de los delitos, Ministerio Público" },
    ],
    treaties: [
      { short: "CADH", title_es: "Convención Americana sobre Derechos Humanos" },
      { short: "PIDCP", title_es: "Pacto Internacional de Derechos Civiles y Políticos" },
    ],
    burdenOfProof:
      "Corresponde al Ministerio Público probar los elementos del delito y la responsabilidad penal más allá de toda duda razonable; rige la presunción de inocencia del imputado (art. 20, apartado B, fracción I CPEUM).",
    standing:
      "Ministerio Público (acción penal pública) o víctima/ofendido (acción penal privada en los delitos que la ley lo permita); el imputado y su defensa tienen derecho de audiencia en todas las etapas.",
    precedentGuidance:
      "Jurisprudencia obligatoria de la Primera Sala de la SCJN en materia penal y de los Plenos Regionales sobre el sistema acusatorio; verificar registro y rubro exactos antes de invocarla.",
  },
  civil: {
    jurisdictionLevels: ["estatal", "federal"],
    governingLaws: [
      { code: "CC Federal / estatal", title_es: "Código Civil aplicable" },
      { code: "CNPCF / CFPC / código local", title_es: "Código Nacional o local de Procedimientos Civiles y Familiares" },
    ],
    constitutionalArticles: [
      { article: "Art. 14", title_es: "Debido proceso, garantía de audiencia" },
      { article: "Art. 17", title_es: "Acceso a la justicia, tutela judicial efectiva" },
    ],
    treaties: [{ short: "CADH", title_es: "Convención Americana sobre Derechos Humanos (arts. 8 y 25)" }],
    burdenOfProof:
      "Quien afirma un hecho está obligado a probarlo — la carga recae sobre el actor respecto de los hechos constitutivos de su acción y sobre el demandado respecto de sus excepciones.",
    standing:
      "Interés jurídico derivado de la titularidad del derecho subjetivo controvertido (legitimación ad causam) y capacidad procesal para comparecer en juicio (legitimación ad processum).",
    precedentGuidance:
      "Jurisprudencia de la Primera Sala de la SCJN y de los Tribunales Colegiados de Circuito en materia civil; verificar cita exacta antes de invocarla.",
  },
  familiar: {
    jurisdictionLevels: ["estatal"],
    governingLaws: [
      { code: "CC Federal / estatal (libro de familia)", title_es: "Código Civil aplicable" },
      { code: "LGDNNA", title_es: "Ley General de los Derechos de Niñas, Niños y Adolescentes" },
    ],
    constitutionalArticles: [
      { article: "Art. 4", title_es: "Igualdad, interés superior de la niñez, protección de la familia" },
    ],
    treaties: [
      { short: "CDN", title_es: "Convención sobre los Derechos del Niño" },
      { short: "CADH", title_es: "Convención Americana sobre Derechos Humanos" },
    ],
    burdenOfProof:
      "Rige el interés superior de la niñez como consideración primordial; en alimentos, el acreedor debe acreditar necesidad y el deudor su capacidad económica; en violencia familiar corresponde a quien la alega acreditarla, con flexibilización probatoria.",
    standing:
      "Cónyuges/concubinos, ascendientes, descendientes o quien tenga interés jurídico directo en la relación familiar; el Ministerio Público y la Procuraduría de Protección de NNA pueden intervenir en representación del interés superior del menor.",
    precedentGuidance:
      "Jurisprudencia de la Primera Sala de la SCJN sobre interés superior de la niñez y perspectiva de género en materia familiar.",
  },
  mercantil: {
    jurisdictionLevels: ["federal", "estatal"],
    governingLaws: [
      { code: "Código de Comercio", title_es: "Código de Comercio" },
      { code: "LGTOC", title_es: "Ley General de Títulos y Operaciones de Crédito" },
      { code: "LGSM", title_es: "Ley General de Sociedades Mercantiles" },
      { code: "LCM", title_es: "Ley de Concursos Mercantiles" },
    ],
    constitutionalArticles: [
      { article: "Art. 5", title_es: "Libertad de comercio" },
      { article: "Art. 28", title_es: "Competencia económica" },
    ],
    treaties: [{ short: "Convención de Nueva York", title_es: "Reconocimiento y ejecución de laudos arbitrales extranjeros" }],
    burdenOfProof:
      "Quien afirma la existencia de la obligación mercantil debe probarla; en títulos de crédito la carga se atenúa por la literalidad y autonomía del título, que se presume válido salvo prueba en contrario.",
    standing:
      "Tenedor legítimo del título de crédito, parte del contrato mercantil, o accionista/socio con interés jurídico directo en la sociedad.",
    precedentGuidance:
      "Jurisprudencia de la Primera Sala de la SCJN en materia mercantil y criterios de los Tribunales Colegiados especializados.",
  },
  laboral: {
    jurisdictionLevels: ["federal", "estatal"],
    governingLaws: [
      { code: "LFT", title_es: "Ley Federal del Trabajo" },
      { code: "LSS", title_es: "Ley del Seguro Social" },
      { code: "LINFONAVIT", title_es: "Ley del INFONAVIT" },
    ],
    constitutionalArticles: [{ article: "Art. 123", title_es: "Derecho al trabajo" }],
    treaties: [{ short: "OIT", title_es: "Convenios de la Organización Internacional del Trabajo ratificados por México" }],
    burdenOfProof:
      "En el despido corresponde al patrón acreditar la causa de rescisión y exhibir la documentación laboral (contrato, recibos, registro IMSS); el trabajador debe acreditar la relación laboral cuando ésta se controvierte.",
    standing:
      "Trabajador o sus beneficiarios (acción individual) o sindicato (acción colectiva) frente al patrón; debe acreditarse la relación de trabajo o el interés en su reconocimiento.",
    precedentGuidance:
      "Jurisprudencia de la Segunda Sala de la SCJN en materia laboral, en particular sobre la carga probatoria del patrón.",
  },
  administrativo: {
    jurisdictionLevels: ["federal", "estatal", "municipal"],
    governingLaws: [
      { code: "LFPA", title_es: "Ley Federal de Procedimiento Administrativo" },
      { code: "LFPCA", title_es: "Ley Federal de Procedimiento Contencioso Administrativo" },
      { code: "LOTFJA", title_es: "Ley Orgánica del Tribunal Federal de Justicia Administrativa" },
    ],
    constitutionalArticles: [
      { article: "Art. 14", title_es: "Debido proceso" },
      { article: "Art. 16", title_es: "Fundamentación y motivación" },
      { article: "Art. 17", title_es: "Acceso a la justicia" },
    ],
    treaties: [{ short: "CADH", title_es: "Garantías judiciales aplicadas al procedimiento administrativo" }],
    burdenOfProof:
      "La autoridad debe fundar y motivar el acto administrativo (art. 16 CPEUM); en el juicio de nulidad el actor debe desvirtuar la presunción de legalidad del acto, salvo causal que traslade la carga a la autoridad (p. ej. incompetencia).",
    standing:
      "Interés jurídico o legítimo de quien resiente el acto administrativo impugnado; la autoridad demandada debe tener competencia para haberlo emitido.",
    precedentGuidance: "Jurisprudencia de la Segunda Sala de la SCJN y del Pleno/Salas del TFJA en materia administrativa.",
  },
  fiscal: {
    jurisdictionLevels: ["federal", "estatal"],
    governingLaws: [
      { code: "CFF", title_es: "Código Fiscal de la Federación" },
      { code: "LISR", title_es: "Ley del Impuesto sobre la Renta" },
      { code: "LIVA", title_es: "Ley del Impuesto al Valor Agregado" },
    ],
    constitutionalArticles: [
      { article: "Art. 31, fr. IV", title_es: "Proporcionalidad y equidad tributaria" },
      { article: "Art. 16", title_es: "Fundamentación y motivación, visitas domiciliarias" },
    ],
    treaties: [{ short: "CDI", title_es: "Tratados para evitar la doble tributación, según el caso" }],
    burdenOfProof:
      "La autoridad fiscal debe acreditar los hechos en que funda el crédito fiscal al ejercer facultades de comprobación; el contribuyente debe acreditar las deducciones, exenciones o saldos a favor que pretenda hacer valer.",
    standing:
      "Contribuyente directamente afectado por la resolución determinante o el acto de autoridad fiscal; responsables solidarios cuando la ley les atribuya esa calidad.",
    precedentGuidance: "Jurisprudencia de la Segunda Sala de la SCJN en materia fiscal y criterios del Pleno del TFJA.",
  },
  amparo: {
    jurisdictionLevels: ["federal"],
    governingLaws: [
      { code: "Ley de Amparo", title_es: "Ley de Amparo, Reglamentaria de los artículos 103 y 107 de la CPEUM" },
    ],
    constitutionalArticles: [
      { article: "Art. 103", title_es: "Procedencia del juicio de amparo" },
      { article: "Art. 107", title_es: "Bases procesales del amparo" },
    ],
    treaties: [
      { short: "CADH", title_es: "Convención Americana sobre Derechos Humanos" },
      { short: "PIDCP", title_es: "Pacto Internacional de Derechos Civiles y Políticos" },
    ],
    burdenOfProof:
      "El quejoso debe acreditar la existencia del acto reclamado y su interés jurídico o legítimo; la autoridad responsable debe justificar la constitucionalidad y legalidad del acto en su informe justificado.",
    standing:
      "Interés jurídico (titularidad de un derecho subjetivo afectado) o interés legítimo (afectación a una situación jurídica derivada del ordenamiento) — art. 5, fracción I, Ley de Amparo.",
    precedentGuidance:
      "Jurisprudencia obligatoria de los Tribunales Colegiados de Circuito y de la SCJN en materia de amparo; verificar registro y rubro exactos antes de invocarla.",
  },
  constitucional: {
    jurisdictionLevels: ["federal", "estatal", "internacional"],
    governingLaws: [
      { code: "Ley Reg. Art. 105", title_es: "Ley Reglamentaria de las Fracciones I y II del Artículo 105 Constitucional" },
    ],
    constitutionalArticles: [
      { article: "Art. 105", title_es: "Controversias constitucionales y acciones de inconstitucionalidad" },
      { article: "Art. 1", title_es: "Principio pro persona, control de convencionalidad" },
    ],
    treaties: [
      { short: "CADH", title_es: "Convención Americana sobre Derechos Humanos" },
      { short: "PIDCP", title_es: "Pacto Internacional de Derechos Civiles y Políticos" },
      { short: "CVDT", title_es: "Convención de Viena sobre el Derecho de los Tratados (jerarquía normativa)" },
    ],
    burdenOfProof:
      "En la acción de inconstitucionalidad no hay controversia entre partes sino control abstracto — quien promueve debe expresar conceptos de invalidez; en la controversia constitucional, el actor debe acreditar la invasión a su esfera de competencias.",
    standing:
      "Controversia constitucional: los entes enumerados taxativamente en el art. 105, fracción I (federación, estados, municipios, alcaldías, poderes de un mismo estado, entre otros). Acción de inconstitucionalidad: los sujetos de la fracción II (33% de una legislatura, CNDH/comisión estatal, partidos políticos, Fiscalía General, entre otros).",
    precedentGuidance:
      "Jurisprudencia del Pleno de la SCJN en controversias constitucionales y acciones de inconstitucionalidad; criterios de la Corte Interamericana cuando el planteamiento involucre derechos humanos.",
  },
  electoral: {
    jurisdictionLevels: ["federal", "estatal"],
    governingLaws: [
      { code: "LGIPE", title_es: "Ley General de Instituciones y Procedimientos Electorales" },
      { code: "LGSMIME", title_es: "Ley General del Sistema de Medios de Impugnación en Materia Electoral" },
      { code: "LGPP", title_es: "Ley General de Partidos Políticos" },
    ],
    constitutionalArticles: [
      { article: "Art. 35", title_es: "Derechos políticos" },
      { article: "Art. 41", title_es: "Organización de las elecciones" },
      { article: "Art. 116, fr. IV", title_es: "Bases electorales estatales" },
    ],
    treaties: [
      { short: "CADH", title_es: "Convención Americana sobre Derechos Humanos (art. 23 — derechos políticos)" },
      { short: "CEDAW", title_es: "Convención sobre la Eliminación de la Discriminación contra la Mujer" },
    ],
    burdenOfProof:
      "Quien alega una irregularidad electoral debe aportar prueba suficiente para acreditarla, dado el principio de definitividad de las etapas electorales y la presunción de validez de los actos de la autoridad electoral.",
    standing:
      "Partidos políticos, candidaturas, ciudadanía en lo individual (cuando la ley lo permita) o autoridades electorales, según el medio de impugnación de que se trate.",
    precedentGuidance: "Jurisprudencia obligatoria de la Sala Superior del TEPJF.",
  },
  agrario: {
    jurisdictionLevels: ["federal", "indigena"],
    governingLaws: [
      { code: "Ley Agraria", title_es: "Ley Agraria" },
      { code: "LOTA", title_es: "Ley Orgánica de los Tribunales Agrarios" },
      { code: "Reglamento del RAN", title_es: "Reglamento Interior del Registro Agrario Nacional" },
    ],
    constitutionalArticles: [{ article: "Art. 27", title_es: "Propiedad de tierras, régimen ejidal y comunal" }],
    treaties: [{ short: "Convenio 169 OIT", title_es: "Pueblos Indígenas y Tribales (cuando el núcleo agrario sea indígena)" }],
    burdenOfProof:
      "Quien alega titularidad de derechos agrarios (parcelarios, de uso común o posesorios) debe acreditarla con certificado/constancia del Registro Agrario Nacional o con la resolución de la asamblea ejidal; en despojo, el poseedor debe acreditar la posesión anterior al hecho reclamado.",
    standing:
      "Ejidatario, comunero, posesionario o avecindado reconocido por el núcleo agrario; el núcleo de población ejidal o comunal por conducto de sus órganos de representación (comisariado ejidal o de bienes comunales).",
    precedentGuidance:
      "Jurisprudencia de los Tribunales Colegiados especializados en materia agraria y de la Segunda Sala de la SCJN en la materia.",
  },
  ambiental: {
    jurisdictionLevels: ["federal", "estatal", "municipal"],
    governingLaws: [
      { code: "LGEEPA", title_es: "Ley General del Equilibrio Ecológico y la Protección al Ambiente" },
      { code: "LGVS", title_es: "Ley General de Vida Silvestre" },
      { code: "LAN", title_es: "Ley de Aguas Nacionales" },
      { code: "LGCC", title_es: "Ley General de Cambio Climático" },
    ],
    constitutionalArticles: [{ article: "Art. 4", title_es: "Derecho a un medio ambiente sano" }],
    treaties: [
      { short: "Acuerdo de Escazú", title_es: "Acceso a la información, participación y justicia ambiental" },
      { short: "CDB", title_es: "Convenio sobre la Diversidad Biológica" },
    ],
    burdenOfProof:
      "En responsabilidad ambiental rige con frecuencia un estándar objetivo (LFRA): basta acreditar el daño y el nexo causal, sin necesidad de probar culpa; la autoridad (PROFEPA/ASEA/CONAGUA) debe fundar y motivar las medidas de seguridad o sanciones que imponga.",
    standing:
      "Cualquier habitante de la comunidad afectada (acción popular, art. 189 LGEEPA), la PROFEPA de oficio, o quien acredite un interés legítimo derivado del daño ambiental.",
    precedentGuidance:
      "Jurisprudencia de la Primera Sala de la SCJN sobre el derecho a un medio ambiente sano y responsabilidad ambiental objetiva.",
  },
  inmobiliario: {
    jurisdictionLevels: ["estatal", "municipal"],
    governingLaws: [
      { code: "CC Federal / estatal", title_es: "Código Civil aplicable (compraventa, propiedad)" },
      { code: "LGAHOTDU", title_es: "Ley General de Asentamientos Humanos, Ordenamiento Territorial y Desarrollo Urbano" },
    ],
    constitutionalArticles: [{ article: "Art. 27", title_es: "Propiedad; zona restringida en fronteras y costas" }],
    treaties: [],
    burdenOfProof:
      "No aplica un estándar contencioso — es una revisión de diligencia debida: el vendedor debe acreditar titularidad libre de gravámenes y el cumplimiento de las obligaciones fiscales/municipales asociadas al inmueble antes del cierre.",
    standing:
      "No aplica en sentido procesal — las partes de la transacción son comprador y vendedor (o sus representantes con poder notarial).",
    precedentGuidance: "No aplica jurisprudencia contenciosa — verificar criterios registrales y catastrales locales vigentes.",
  },
  migratorio: {
    jurisdictionLevels: ["federal", "internacional"],
    governingLaws: [
      { code: "LM", title_es: "Ley de Migración" },
      { code: "RLM", title_es: "Reglamento de la Ley de Migración" },
      { code: "LRPCAP", title_es: "Ley sobre Refugiados, Protección Complementaria y Asilo Político" },
      { code: "LN", title_es: "Ley de Nacionalidad" },
      { code: "LFPA / LFPCA", title_es: "Procedimiento administrativo y contencioso administrativo federal" },
      { code: "LA", title_es: "Ley de Amparo" },
      { code: "LGDNNA", title_es: "Ley General de los Derechos de Niñas, Niños y Adolescentes" },
    ],
    constitutionalArticles: [
      { article: "Art. 1", title_es: "Derechos humanos, principio pro persona y no discriminación" },
      { article: "Art. 4", title_es: "Unidad familiar e interés superior de la niñez" },
      { article: "Art. 11", title_es: "Libertad de tránsito, asilo y refugio" },
      { article: "Arts. 14 y 16", title_es: "Debido proceso, fundamentación y motivación" },
      { article: "Art. 33", title_es: "Personas extranjeras y expulsión constitucional" },
    ],
    treaties: [
      { short: "CADH", title_es: "Convención Americana sobre Derechos Humanos" },
      { short: "Convención de 1951", title_es: "Convención sobre el Estatuto de los Refugiados y Protocolo de 1967" },
      { short: "CDN", title_es: "Convención sobre los Derechos del Niño" },
      { short: "CAT", title_es: "Convención contra la Tortura" },
      { short: "CTM", title_es: "Convención sobre Trabajadores Migratorios y sus Familiares" },
    ],
    burdenOfProof:
      "La persona aporta los hechos y documentos a su alcance; la autoridad debe integrar, conservar, fundar y motivar el expediente. En refugio y no devolución se exige valoración integral, compartida y sensible a vulnerabilidad.",
    standing:
      "La persona afectada, solicitante, familiar o representante acreditado; en niñez intervienen las autoridades de protección. La legitimación para nulidad o amparo depende del acto, afectación y vía concreta.",
    precedentGuidance:
      "Consultar únicamente jurisprudencia vigente y verificable de la SCJN/PJF y, para nulidad, precedentes aplicables del TFJA. Confirmar registro, órgano, época, vigencia y texto oficial antes de citar.",
  },

};

export function executionProfileFor(caseType: MexicanCaseType): ExecutionProfile {
  return EXECUTION_PROFILES[caseType];
}
