/**
 * Mexican legal terminology dictionary.
 *
 * These terms are proper nouns or Mexican-legal concepts that must NOT be
 * translated literally into English. They are locked to their Spanish form
 * in every locale to preserve legal accuracy.
 *
 * Extend this list as new legal-specific terms enter the platform.
 */
export const LEGAL_TERMS: Record<string, string> = {
  // Jurisprudencia y órganos
  "legal.term.jurisprudencia": "Jurisprudencia",
  "legal.term.tesisAislada": "Tesis aislada",
  "legal.term.scjn": "Suprema Corte de Justicia de la Nación",
  "legal.term.tfja": "Tribunal Federal de Justicia Administrativa",
  "legal.term.poderJudicial": "Poder Judicial de la Federación",
  "legal.term.tcc": "Tribunales Colegiados de Circuito",
  "legal.term.semanario": "Semanario Judicial de la Federación",

  // Amparo
  "legal.term.amparo": "Amparo",
  "legal.term.amparoDirecto": "Amparo directo",
  "legal.term.amparoIndirecto": "Amparo indirecto",
  "legal.term.quejoso": "Quejoso",
  "legal.term.autoridadResponsable": "Autoridad responsable",
  "legal.term.terceroInteresado": "Tercero interesado",
  "legal.term.suspension": "Suspensión del acto reclamado",

  // Penal
  "legal.term.ministerio": "Ministerio Público",
  "legal.term.fiscalia": "Fiscalía",
  "legal.term.imputado": "Imputado",
  "legal.term.victima": "Víctima",
  "legal.term.ofendido": "Ofendido",
  "legal.term.carpetaInvestigacion": "Carpeta de investigación",
  "legal.term.vinculacionProceso": "Vinculación a proceso",
  "legal.term.medidasCautelares": "Medidas cautelares",
  "legal.term.autoApertura": "Auto de apertura a juicio",
  "legal.term.juicioOral": "Juicio oral",
  "legal.term.juezControl": "Juez de control",
  "legal.term.tribunalEnjuiciamiento": "Tribunal de Enjuiciamiento",
  "legal.term.cadenaCustodia": "Cadena de custodia",

  // Documentos oficiales / expediente
  "legal.term.expediente": "Expediente",
  "legal.term.asunto": "Asunto",
  "legal.term.dof": "Diario Oficial de la Federación",

  // Familiar
  "legal.term.divorcioIncausado": "Divorcio incausado",
  "legal.term.demandaDivorcio": "Demanda de divorcio",
  "legal.term.convenioRegulador": "Convenio regulador",
  "legal.term.guardaCustodia": "Guarda y custodia",
  "legal.term.regimenConvivencias": "Régimen de convivencias",
  "legal.term.pensionAlimenticia": "Pensión alimenticia",
  "legal.term.interesSuperior": "Interés superior de la niñez",
  "legal.term.patriaPotestad": "Patria potestad",
  "legal.term.sociedadConyugal": "Sociedad conyugal",
  "legal.term.separacionBienes": "Separación de bienes",
  "legal.term.estudioTrabajoSocial": "Estudio de trabajo social",
  "legal.term.estudioSocioeconomico": "Estudio socioeconómico",
  "legal.term.dictamenPsicologico": "Dictamen pericial en psicología",
  "legal.term.estudioPsicologico": "Estudio psicológico",
  "legal.term.compensacionDedicacionHogar": "Compensación por dedicación al hogar",
  "legal.term.actaMatrimonio": "Acta de matrimonio",
  "legal.term.actaNacimiento": "Acta de nacimiento",
  "legal.term.lgdnna": "Ley General de los Derechos de Niñas, Niños y Adolescentes",

  // Ambiental
  "legal.term.lgeepa": "LGEEPA",
  "legal.term.profepa": "PROFEPA",
  "legal.term.semarnat": "SEMARNAT",
  "legal.term.conagua": "CONAGUA",
  "legal.term.asea": "ASEA",
  "legal.term.conanp": "CONANP",
  "legal.term.conafor": "CONAFOR",
  "legal.term.mia": "Manifestación de Impacto Ambiental",
  "legal.term.lgvs": "Ley General de Vida Silvestre",
  "legal.term.lgpgir": "LGPGIR",
  "legal.term.leyAguasNacionales": "Ley de Aguas Nacionales",
  "legal.term.leyCambioClimatico": "Ley General de Cambio Climático",
  "legal.term.nomAmbiental": "Norma Oficial Mexicana ambiental",
  "legal.term.denunciaPopularAmbiental": "Denuncia popular ambiental",
  "legal.term.licenciaAmbientalUnica": "Licencia Ambiental Única",
  "legal.term.clausuraProfepa": "Clausura (PROFEPA)",
  "legal.term.danoAmbiental": "Daño ambiental",

  // Ordenamientos
  "legal.term.cpeum": "CPEUM",
  "legal.term.cnpp": "CNPP",
  "legal.term.cpf": "Código Penal Federal",
  "legal.term.ccf": "Código Civil Federal",
  "legal.term.ccom": "Código de Comercio",
  "legal.term.lft": "Ley Federal del Trabajo",
  "legal.term.leyAmparo": "Ley de Amparo",
  "legal.term.lfpdppp": "LFPDPPP",
  "legal.term.lgsm": "LGSM",
  "legal.term.cff": "Código Fiscal de la Federación",
};

/**
 * Common-law terms that must NEVER appear in Nyrava México outputs.
 * Used by the QA harness to flag drift.
 */
export const FORBIDDEN_COMMON_LAW_TERMS = [
  "felony",
  "misdemeanor",
  "plea bargain",
  "plea hearing",
  "grand jury",
  "indictment",
  "discovery motion",
  "deposition",
  "subpoena",
  "summary judgment",
  "tort",
  "hearsay",
  "Miranda",
  "exclusionary rule",
  "district attorney",
  " DA ",
  "jury trial",
  "jury instructions",
  "Federal Rules of Evidence",
  "Federal Rules of Civil Procedure",
  "common-law precedent",
  "stare decisis",
];
