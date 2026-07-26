/**
 * Report template localization — single-language report guarantee.
 *
 * The AI-generated narrative of a report is already written in the language
 * stored on the case (`cases.report_language`, resolved server-side by
 * getReportLocale() in src/lib/mexico-lock.ts, and stamped on the generated
 * row as `reports.generated_language`). The *template* around that narrative
 * — section headers, table column headers, labels, footers, page numbering,
 * disclaimers — used to be hardcoded English, which produced mixed-language
 * PDFs (English "Executive Summary" above Spanish "Cadena de custodia…").
 *
 * This module is the template's translation layer. Every string the exporter
 * emits passes through `rt()`:
 *   - locale "en" → returned unchanged (English is the source language)
 *   - locale "es" → exact-match dictionary lookup, then pattern rules
 *   - unknown string (AI narrative, case names, quotes, citations) → passes
 *     through untouched, because it is already in the report's language
 *
 * Historical reports are never retranslated: the exporter reads
 * `reports.generated_language` first and only falls back to the case's
 * current `report_language` when the row predates that column.
 */

export type ReportLocale = "es" | "en";

/**
 * Exact-match template phrases. Keys are the English source strings that
 * appear in src/lib/export.ts (section headings, table headers, labels,
 * scaffolding sentences); values are the Mexican-Spanish equivalents.
 * Mexican legal proper names (SCJN, DOF, amparo, jurisprudencia) are never
 * translated away.
 */
const ES: Record<string, string> = {
  "ATTORNEY WORK PRODUCT  \u00b7  PRIVILEGED & CONFIDENTIAL":
    "PRODUCTO DE TRABAJO DEL ABOGADO  \u00b7  PRIVILEGIADO Y CONFIDENCIAL",
  "This case was analyzed in LIMITED mode because the available corpus did not meet the platform's Evidence Sufficiency Score (ESS) threshold required to support quantitative scoring or formal motion recommendations.":
    "Este expediente se analiz\u00f3 en modo LIMITADO porque el corpus disponible no alcanz\u00f3 el umbral del Puntaje de Suficiencia Probatoria (ESS) requerido para sustentar puntajes cuantitativos o recomendaciones formales de promociones.",
  "An evidence-grounded narrative is rendered below for every section in which the corpus supplied sufficient verbatim material. Sections that would otherwise rely on inferred legal theories \u2014 quantitative scorecards, motion drafting, theory selection, and prioritized recommendations \u2014 have been withheld so that no claim in this report rests on speculation.":
    "A continuaci\u00f3n se presenta una narrativa sustentada en evidencia para cada secci\u00f3n en la que el corpus aport\u00f3 material textual suficiente. Las secciones que depender\u00edan de teor\u00edas jur\u00eddicas inferidas \u2014 puntajes cuantitativos, redacci\u00f3n de promociones, selecci\u00f3n de teor\u00eda del caso y recomendaciones priorizadas \u2014 se retuvieron para que ninguna afirmaci\u00f3n de este reporte descanse en especulaci\u00f3n.",
  "confidence level (how sure the classification is), an evidence strength (how well-sourced it is), and any related findings elsewhere in this report.":
    "nivel de confianza (qu\u00e9 tan segura es la clasificaci\u00f3n), una fuerza probatoria (qu\u00e9 tan sustentado est\u00e1) y los hallazgos relacionados en otras partes de este reporte.",
  "This report was generated using Nyrava Intelligence\u2122 and is intended to support\u2014not replace\u2014professional legal judgment. Attorneys remain responsible for reviewing and verifying all findings, citations, scores, legal analysis, and drafted work product against the official source record before filing or relying upon this report.":
    "Este reporte fue generado con Nyrava Intelligence\u2122 y busca apoyar \u2014no sustituir\u2014 el criterio jur\u00eddico profesional. El abogado es responsable de revisar y verificar todos los hallazgos, citas, puntajes, an\u00e1lisis jur\u00eddico y producto de trabajo contra el expediente oficial antes de presentarlo o sustentarse en \u00e9l.",
  "Nyrava Legal Intelligence": "Nyrava Legal Intelligence",
  // ---- Section headings (15-section report structure) ----
  "Table of Contents": "Índice",
  "Executive Summary": "Resumen Ejecutivo",
  "Case Overview": "Panorama General del Expediente",
  Facts: "Hechos",
  "Key Findings": "Hallazgos Clave",
  "Top Findings": "Hallazgos Principales",
  "Timeline Summary": "Resumen Cronológico",
  "Chronological Narrative": "Narrativa Cronológica",
  "Additional Verified Facts (Undated)": "Hechos Verificados Adicionales (sin fecha)",
  "Discovery Analysis": "Análisis de Vacíos Probatorios",
  "Evidence Map": "Mapa de Evidencia",
  "Evidence Coverage": "Cobertura Probatoria",
  "Evidence Intelligence": "Inteligencia de Evidencia",
  "Evidence Sources": "Fuentes de Evidencia",
  "Contradiction Analysis": "Análisis de Contradicciones",
  "Constitutional Analysis": "Análisis Constitucional",
  "Legal Issues & Case Law": "Cuestiones Jurídicas y Jurisprudencia",
  "Witness Intelligence": "Inteligencia de Testigos",
  "Theory Analysis": "Análisis de Teorías del Caso",
  "Multi-Perspective Analysis": "Análisis Multiperspectiva",
  "Risk Analysis": "Análisis de Riesgos",
  "Case Scorecard": "Tarjeta de Evaluación del Caso",
  "Dimension Detail": "Detalle por Dimensión",
  Recommendations: "Recomendaciones",
  "Recommended Actions": "Acciones Recomendadas",
  "Recommended next actions": "Siguientes acciones recomendadas",
  "Immediate Recommended Actions": "Acciones Inmediatas Recomendadas",
  "Recommended Motions": "Promociones Recomendadas",
  "Recommended Counter Strategy": "Estrategia de Contraataque Recomendada",
  "Strategic Opportunities": "Oportunidades Estratégicas",
  "Strategic Priorities": "Prioridades Estratégicas",
  "Strategic recommendations": "Recomendaciones estratégicas",
  "Strategy recommendations": "Recomendaciones de estrategia",
  "Strategy Synthesis": "Síntesis Estratégica",
  "Litigation Strategy Center": "Centro de Estrategia Litigiosa",
  "Litigation Impact Dashboard": "Panel de Impacto Litigioso",
  "Cross-Examination": "Interrogatorio y Contrainterrogatorio",
  "Attorney Action Center": "Centro de Acciones del Abogado",
  "Attorney Work Product": "Producto de Trabajo del Abogado",
  "Generated Work Product": "Producto de Trabajo Generado",
  "Audit Trail": "Registro de Auditoría",
  "Execution Manifest": "Manifiesto de Ejecución",
  "Agent Statistics": "Estadísticas de Agentes",
  "Appendix: Source Citations": "Anexo: Citas de Fuentes",
  "Missing or Needed Evidence": "Evidencia Faltante o Requerida",
  "Missing evidence": "Evidencia faltante",
  "Motion opportunities": "Oportunidades de promoción",
  "Next actions": "Siguientes acciones",
  "Score reasoning": "Fundamento de la calificación",
  "Source documents": "Documentos fuente",
  "Legal standard": "Estándar jurídico",
  "Draft outline": "Esquema del borrador",
  "Failed documents": "Documentos con error",
  "Cross-domain (activated)": "Materia cruzada (activada)",
  Enabled: "Habilitado",
  Generated: "Generado",
  Skipped: "Omitido",
  "Skipped — Not applicable to selected case type":
    "Omitido — No aplicable a la materia seleccionada",
  "Primary Defense": "Defensa Principal",
  "Primary Trial Theme": "Tema Central del Juicio",
  "Most Dangerous Witness": "Testigo Más Riesgoso",
  "Most Likely Defense Strategy": "Estrategia de Defensa Más Probable",
  "Biggest Trial Risk": "Mayor Riesgo en Juicio",
  "Biggest Weakness": "Mayor Debilidad",
  "Biggest Evidentiary Gap": "Mayor Vacío Probatorio",
  "Best Settlement Leverage": "Mejor Palanca de Negociación",
  "Winning the Case": "Cómo se Gana el Caso",
  "What Wins This Case?": "¿Qué gana este caso?",
  "What Could Lose This Case?": "¿Qué podría perder este caso?",
  "What Should Counsel Do This Week?": "¿Qué debe hacer el abogado esta semana?",
  "If I Were Lead Trial Counsel": "Si yo fuera el abogado principal",

  // ---- Data-value vocabulary (engine enums rendered inside cells) ----
  // Findings/evidence rows store canonical English enum values; the report
  // must never surface them raw in a Spanish document.
  Party: "Parte",
  Parties: "Partes",
  Perspective: "Perspectiva",
  prosecution: "Ministerio Público",
  defense: "Defensa",
  plaintiff: "parte actora",
  defendant: "parte demandada",
  claimant: "parte promovente",
  respondent: "autoridad responsable",
  petitioner: "parte quejosa",
  third_party: "tercero interesado",
  court: "órgano jurisdiccional",
  both: "ambas partes",
  neutral: "neutral",
  unknown: "no determinado",
  corroborating: "corroborante",
  contradictory: "contradictoria",
  duplicative: "duplicada",
  supporting: "de apoyo",
  undermining: "que debilita",
  inconclusive: "inconclusa",
  missing: "faltante",
  confirmed: "confirmada",
  unverified: "no verificada",
  disputed: "en disputa",
  probable: "probable",
  critical: "crítica",
  high: "alta",
  medium: "media",
  low: "baja",
  info: "informativa",
  minor: "menor",
  High: "Alta",
  Medium: "Media",
  Low: "Baja",
  "Very High": "Muy alta",
  "Very Low": "Muy baja",
  Credibility: "Credibilidad",
  "Discovery Violation": "Vacío probatorio",
  "Evidence Gap": "Vacío probatorio",
  "Chain of Custody": "Cadena de custodia",
  "Constitutional Violation": "Violación constitucional",
  Procedural: "Procesal",
  "Procedural Violation": "Violación procesal",
  Contradiction: "Contradicción",
  Timeline: "Cronología",
  "Legal Issue": "Cuestión jurídica",
  Damages: "Daños y perjuicios",
  Compliance: "Cumplimiento normativo",
  "Timeline Reconstruction": "Reconstrucción cronológica",
  "Insufficient evidence to draft a facts narrative without verbatim source quotes.":
    "Evidencia insuficiente para redactar la narrativa de hechos sin citas textuales del expediente.",
  "Evidence intelligence classification requiring review":
    "Clasificación de inteligencia de evidencia que requiere revisión",
  "Potential missing or undisclosed evidence": "Posible evidencia faltante o no aportada",
  "[EVIDENCE-BASED ANALYSIS]": "[ANÁLISIS SUSTENTADO EN EVIDENCIA]",
  "[ANALYSIS]": "[ANÁLISIS]",

  // ---- Table column headers ----
  Action: "Acción",
  Agent: "Agente",
  "AI Assessment": "Valoración de IA",
  Bias: "Sesgo",
  "Brady risk": "Riesgo de omisión de prueba de descargo",
  Category: "Categoría",
  Classification: "Clasificación",
  Confidence: "Confianza",
  "Credibility risk": "Riesgo de credibilidad",
  Dimension: "Dimensión",
  Doc: "Doc.",
  Docs: "Docs.",
  Document: "Documento",
  "Document A:": "Documento A:",
  "Document B:": "Documento B:",
  Error: "Error",
  Errors: "Errores",
  Evidence: "Evidencia",
  "Expected impact": "Impacto esperado",
  Filename: "Nombre de archivo",
  Finding: "Hallazgo",
  Findings: "Hallazgos",
  "Findings Produced": "Hallazgos producidos",
  "How to obtain / why critical": "Cómo obtenerla / por qué es crítica",
  Impact: "Impacto",
  Item: "Elemento",
  "Key pages": "Páginas clave",
  "Litigation Question": "Cuestión litigiosa",
  Metric: "Métrica",
  "Output / Explanation": "Resultado / Explicación",
  Owner: "Responsable",
  Page: "Página",
  Priority: "Prioridad",
  Promoted: "Promovido",
  Quote: "Cita textual",
  Reason: "Motivo",
  "Recommended motion": "Promoción recomendada",
  Reliability: "Confiabilidad",
  Role: "Rol",
  Score: "Puntaje",
  Scores: "Puntajes",
  Section: "Sección",
  Severity: "Gravedad",
  Size: "Tamaño",
  Source: "Fuente",
  Sources: "Fuentes",
  Status: "Estado",
  Suppressed: "Suprimido",
  Title: "Título",
  Topic: "Tema",
  Value: "Valor",
  Why: "Por qué",
  Witness: "Testigo",

  // ---- Uppercase / small-caps labels ----
  SOURCES: "FUENTES",
  CONFIDENCE: "CONFIANZA",
  STATUS: "ESTADO",
  REASON: "MOTIVO",
  "PRIMARY EVIDENCE": "EVIDENCIA PRINCIPAL",
  "LEGAL BASIS": "FUNDAMENTO JURÍDICO",
  "LIKELIHOOD OF SUCCESS": "PROBABILIDAD DE ÉXITO",
  "TOTAL RECOMMENDED": "TOTAL RECOMENDADO",
  "EVIDENCE STRENGTH": "FUERZA PROBATORIA",
  CRITICAL: "CRÍTICO",
  HIGH: "ALTO",
  MEDIUM: "MEDIO",
  CONSIDER: "CONSIDERAR",
  "CASE INTELLIGENCE REPORT": "REPORTE DE INTELIGENCIA DEL CASO",
  "C A S E   I N T E L L I G E N C E   R E P O R T":
    "R E P O R T E   D E   I N T E L I G E N C I A",
  "E X E C U T I V E   D A S H B O A R D": "P A N E L   E J E C U T I V O",
  "  ATTORNEY WORK PRODUCT  ·  PRIVILEGED & CONFIDENTIAL  ":
    "  PRODUCTO DE TRABAJO DEL ABOGADO  ·  PRIVILEGIADO Y CONFIDENCIAL  ",
  "Confidential Attorney Work Product": "Producto de trabajo del abogado — confidencial",

  // ---- Severity / status tiers ----
  Critical: "Crítico",
  "Critical Issues": "Cuestiones críticas",
  "High Priority": "Prioridad alta",
  "High-Priority Issues": "Cuestiones de prioridad alta",
  Moderate: "Moderado",
  "Moderate Issues": "Cuestiones moderadas",
  "Minor & Administrative Issues": "Cuestiones menores y administrativas",
  Strong: "Sólido",
  Limited: "Limitado",
  Additional: "Adicional",
  Uncertainty: "Incertidumbre",
  "Case Strength": "Fuerza del caso",
  "Risk Score": "Puntaje de riesgo",
  "Documents Analyzed": "Documentos analizados",
  "Agents Producing Output": "Agentes con resultados",
  "Engine Version": "Versión del motor",
  "Probability estimate": "Estimación de probabilidad",
  "Draft Available": "Borrador disponible",
  "Not Yet Generated": "Aún no generado",
  "Requires Attorney Review": "Requiere revisión del abogado",
  "Ready in Motion Intelligence": "Listo en Inteligencia de Promociones",
  "Constitutional Issues": "Cuestiones constitucionales",
  "Missing Evidence": "Evidencia faltante",

  // ---- Inline field labels ----
  "Additional evidence:": "Evidencia adicional:",
  "Anticipated opposing arguments:": "Argumentos previsibles de la contraparte:",
  "Case law:": "Jurisprudencia:",
  "Contradicting evidence:": "Evidencia contradictoria:",
  "Cross-examination:": "Contrainterrogatorio:",
  "Elements:": "Elementos:",
  "Evidence:": "Evidencia:",
  "How to obtain:": "Cómo obtenerla:",
  "How to present it:": "Cómo presentarla:",
  "Impeachment:": "Desacreditación:",
  "Legal Basis: ": "Fundamento jurídico: ",
  "Missing evidence:": "Evidencia faltante:",
  "Motion rankings:": "Jerarquía de promociones:",
  "Next actions:": "Siguientes acciones:",
  "Potential benefit:": "Beneficio potencial:",
  "Primary Evidence:": "Evidencia principal:",
  "Primary contributors — strengthens": "Factores principales — fortalecen",
  "Primary contributors — weakens": "Factores principales — debilitan",
  "Reason: ": "Motivo: ",
  "Recommended approach:": "Enfoque recomendado:",
  "Representative evidence:": "Evidencia representativa:",
  "Status: ": "Estado: ",
  "Supporting arguments:": "Argumentos de apoyo:",
  "Supporting evidence:": "Evidencia de apoyo:",
  "Supports:": "Apoya:",
  "Undermines:": "Debilita:",
  "Weaknesses:": "Debilidades:",
  "Why:": "Por qué:",

  // ---- Claim / verification tags ----
  "[FACT]": "[HECHO]",
  "[HYPOTHESIS REQUIRES VERIFICATION]": "[HIPÓTESIS — REQUIERE VERIFICACIÓN]",
  "[STRATEGIC ANALYSIS — NOT LEGAL ADVICE]": "[ANÁLISIS ESTRATÉGICO — NO ES ASESORÍA JURÍDICA]",
  "[STRATEGIC CONSIDERATION]": "[CONSIDERACIÓN ESTRATÉGICA]",

  // ---- Scaffolding sentences ----
  "A case-type read on the deterministic scorecard below, framed as the questions an attorney asks first rather than as raw dimension names.":
    "Una lectura de la tarjeta de evaluación determinista conforme a la materia, planteada como las preguntas que un abogado formula primero, en lugar de nombres técnicos de dimensiones.",
  "Document-by-document classification with confidence labels and legal impact.":
    "Clasificación documento por documento, con nivel de confianza e impacto jurídico.",
  "Each contradiction below pairs two specific record statements with the legal and strategic consequences for trial.":
    "Cada contradicción confronta dos afirmaciones concretas del expediente con sus consecuencias jurídicas y estratégicas para el juicio.",
  "Every citation below is verbatim from the case corpus. Use these to verify any claim in the report.":
    "Cada cita es textual del corpus del expediente. Úselas para verificar cualquier afirmación del reporte.",
  "Every finding rendered in this report has been validated against the source corpus and is safe to rely on. The suppressions below are conservative by design — they protect the work product from hallucinated legal conclusions while preserving the verified factual record.":
    "Todo hallazgo incluido en este reporte fue validado contra el corpus fuente y puede sustentarse. Las supresiones siguientes son conservadoras por diseño: protegen el producto de trabajo frente a conclusiones jurídicas alucinadas y preservan el registro fáctico verificado.",
  "Evidence-grounded. Citation-audited. Built for sensitive legal intelligence workflows.":
    "Sustentado en evidencia. Citas auditadas. Diseñado para flujos de inteligencia jurídica sensibles.",
  "Grouped by severity so the issues most likely to affect the outcome are read first. Each finding lists a ":
    "Agrupados por gravedad para leer primero las cuestiones que más pueden incidir en el resultado. Cada hallazgo indica un ",
  "Immediate next steps and strategic priorities, ahead of the detailed analysis that supports them.":
    "Siguientes pasos inmediatos y prioridades estratégicas, antes del análisis detallado que los sustenta.",
  "Independent analysis from each side of the dispute. All perspectives are produced regardless of which side counsel represents.":
    "Análisis independiente desde cada parte del litigio. Todas las perspectivas se generan sin importar a qué parte representa el abogado.",
  "Ingestion transparency: how complete is this analysis?":
    "Transparencia de ingesta: ¿qué tan completo es este análisis?",
  "Motion drafting and prioritized recommendations were withheld because this case did not meet the Evidence Sufficiency Score threshold.":
    "La redacción de promociones y las recomendaciones priorizadas se retuvieron porque el expediente no alcanzó el umbral de Suficiencia Probatoria (ESS).",
  "No dated timeline events were extracted from the available corpus.":
    "No se extrajeron eventos con fecha del corpus disponible.",
  "No recommendation narrative was available at export time.":
    "No había narrativa de recomendaciones disponible al momento de exportar.",
  "No verified discovery gaps survived evidence validation.":
    "Ningún vacío probatorio verificado superó la validación de evidencia.",
  "No verified facts were extracted from the available corpus. This typically indicates that the source documents lacked the quotable, document-anchored statements required to construct an evidence-grounded factual record. To enable a facts narrative, attach primary sources containing concrete factual assertions — pleadings, contemporaneous correspondence, contracts, transcripts, declarations, or signed reports — so the extraction layer can anchor each fact to a verbatim quote and page citation.":
    "No se extrajeron hechos verificados del corpus disponible. Esto suele indicar que los documentos fuente carecían de afirmaciones citables y ancladas a documento, necesarias para construir un registro fáctico sustentado en evidencia. Para habilitar la narrativa de hechos, adjunte fuentes primarias con afirmaciones concretas —promociones, correspondencia contemporánea, contratos, transcripciones, declaraciones o dictámenes firmados— de modo que la extracción pueda anclar cada hecho a una cita textual y su página.",
  "Numbered references from the report body, resolved to their source document and page.":
    "Referencias numeradas del cuerpo del reporte, resueltas a su documento fuente y página.",
  "Ready for attorney review — full drafts appear later in this report.":
    "Listo para revisión del abogado — los borradores completos aparecen más adelante en este reporte.",
  "Risk analysis is limited to the verified findings and source-document coverage shown in this report.":
    "El análisis de riesgos se limita a los hallazgos verificados y a la cobertura documental mostrada en este reporte.",
  "Routing record for this case. The execution manifest below shows which engines were run, which were skipped because they do not apply to the selected case type, and which were activated through cross-domain triggers.":
    "Registro de enrutamiento del expediente. El manifiesto de ejecución muestra qué motores se ejecutaron, cuáles se omitieron por no aplicar a la materia seleccionada y cuáles se activaron por disparadores de materia cruzada.",
  "Suppressed due to insufficient verified evidence.":
    "Suprimido por evidencia verificada insuficiente.",
  "The following events are reconstructed from the verified record, ordered by the earliest date associated with each finding. Each paragraph integrates the underlying evidence into a continuous factual narrative suitable for memorandum use.":
    "Los siguientes eventos se reconstruyen a partir del registro verificado, ordenados por la fecha más temprana asociada a cada hallazgo. Cada párrafo integra la evidencia subyacente en una narrativa fáctica continua, apta para uso en memorándum.",
  "The following verified facts could not be placed on the timeline because no date was associated with the source citation. They are nevertheless part of the established record and should be considered alongside the chronological narrative above.":
    "Los siguientes hechos verificados no pudieron ubicarse en la cronología porque la cita fuente no tenía fecha asociada. No obstante, forman parte del registro acreditado y deben considerarse junto con la narrativa cronológica anterior.",
  "The motions most likely to strengthen this case, ranked by priority. Drafting and editing continue in the Motion Intelligence module.":
    "Las promociones con mayor probabilidad de fortalecer el expediente, ordenadas por prioridad. La redacción y edición continúan en el módulo de Inteligencia de Promociones.",
  "This case was analyzed in LIMITED mode because the available corpus did not meet the platform's Evidence Sufficiency Score (ESS) threshold required to support quantitative scoring or formal motion recommendations. ":
    "Este expediente se analizó en modo LIMITADO porque el corpus disponible no alcanzó el umbral de Suficiencia Probatoria (ESS) requerido para sustentar puntajes cuantitativos o recomendaciones formales de promociones. ",
  "This section separates loaded agents from agents that actually analyzed evidence and agents that produced measurable work product. Agent totals are based on produced output, not initialization.":
    "Esta sección distingue entre agentes cargados, agentes que efectivamente analizaron evidencia y agentes que produjeron producto de trabajo medible. Los totales se basan en resultados producidos, no en la inicialización.",
  "To upgrade this matter to a full analysis, supply additional primary sources: pleadings, discovery responses, deposition transcripts, contemporaneous correspondence, contracts and amendments, expert reports, and any documentary evidence referenced in the existing record. Each additional verified source increases the ESS score, unlocks deterministic scoring, and enables the engine to draft motion outlines with supporting citations.":
    "Para elevar este asunto a un análisis completo, aporte fuentes primarias adicionales: promociones, desahogo de pruebas, testimoniales, correspondencia contemporánea, contratos y convenios modificatorios, dictámenes periciales y cualquier prueba documental referida en el expediente. Cada fuente verificada adicional incrementa el puntaje ESS, habilita la evaluación determinista y permite al motor esbozar promociones con citas de apoyo.",

  // ---- src/lib/export-legal-memo.ts — legal memorandum template ----
  "MEMORANDUM OF LAW": "MEMORÁNDUM LEGAL",
  "Re: ": "Asunto: ",
  "Date: ": "Fecha: ",
  "EXECUTIVE SUMMARY": "RESUMEN EJECUTIVO",
  "Bottom Line": "Conclusión Principal",
  "Bottom Line:": "Conclusión Principal:",
  "Case Strength:": "Fortaleza del Caso:",
  "Primary Risk:": "Riesgo Principal:",
  "Urgent Actions Required:": "Acciones Urgentes Requeridas:",
  "STATEMENT OF FACTS": "DECLARACIÓN DE HECHOS",
  "I. Chronology": "I. Cronología",
  "II. Undisputed Facts": "II. Hechos No Controvertidos",
  "III. Disputed Facts": "III. Hechos Controvertidos",
  "Opposing view: ": "Postura de la contraparte: ",
  "LEGAL ANALYSIS": "ANÁLISIS JURÍDICO",
  "Untitled Issue": "Cuestión sin título",
  RULE: "NORMA APLICABLE",
  "RULE:": "NORMA APLICABLE:",
  APPLICATION: "APLICACIÓN AL CASO",
  "APPLICATION:": "APLICACIÓN AL CASO:",
  CONCLUSION: "CONCLUSIÓN",
  "CONCLUSION:": "CONCLUSIÓN:",
  "Supporting Evidence:": "Evidencia de Apoyo:",
  "RECOMMENDED MOTIONS": "PROMOCIONES RECOMENDADAS",
  "Untitled Motion": "Promoción sin título",
  "Legal Standard": "Estándar Jurídico",
  "Legal Standard:": "Estándar Jurídico:",
  "Factual Basis:": "Base Fáctica:",
  "Likelihood of Success": "Probabilidad de Éxito",
  "Likelihood of Success:": "Probabilidad de Éxito:",
  "Likelihood:": "Probabilidad:",
  "Draft Paragraph:": "Párrafo Propuesto:",
  "EVIDENCE APPENDIX": "ANEXO DE EVIDENCIA",
  Exhibit: "Anexo",
  Description: "Descripción",
  "Key Quote": "Cita Textual",
  Proves: "Acredita",
  Risk: "Riesgo",
  "RISK MATRIX": "MATRIZ DE RIESGOS",
  Probability: "Probabilidad",
  Mitigation: "Mitigación",
  "NEXT ACTIONS": "SIGUIENTES ACCIONES",
  Deadline: "Fecha límite",
  "Attorney-reviewed work product. Nyrava Intelligence-generated draft — verify all citations before filing.":
    "Producto de trabajo revisado por el abogado. Borrador generado con Nyrava Intelligence — verifique todas las citas antes de presentarlo.",
  "Fundamento:": "Fundamento:",
  "Fundamento: ": "Fundamento: ",

  // ---- Jurisdiction Intelligence block (first block of every report) ----
  "Jurisdiction Intelligence": "Bloque de Inteligencia de Jurisdicción",
  Country: "País",
  "State / Federal entity": "Entidad federativa",
  Procedure: "Procedimiento",
  "Competent authority": "Órgano competente",
  "Applicable law": "Ley aplicable",
  "Relevant case law": "Jurisprudencia relevante",
  "Current procedural stage": "Etapa procesal actual",
  Fuero: "Fuero",
  federal: "federal",
  comun: "común",
  mixto: "mixto",
  "Unresolved — the case file does not contain enough information to determine this field.":
    "No determinado — el expediente no contiene datos suficientes para resolver este campo.",
  "No verified applicable case law has been recorded for this matter.":
    "No se ha registrado jurisprudencia aplicable verificada para este expediente.",
  "Procedural stage could not be determined from the available case file.":
    "Etapa procesal no determinada a partir del expediente disponible.",
  "Jurisdiction Intelligence has not yet run for this case.":
    "El análisis de jurisdicción aún no se ha ejecutado para este expediente.",

  // ---- Centro de Acciones — Recomendaciones Prioritarias (final section) ----
  "Action Center — Priority Recommendations": "Centro de Acciones — Recomendaciones Prioritarias",
  Recommendation: "Recomendación",
  "Legal basis": "Fundamento legal",
  Urgency: "Urgencia",
  "High priority": "🔴 Alta",
  "Medium priority": "🟠 Media",
  "Low priority": "🟢 Baja",
  "No prioritized recommendations are available for this case.":
    "No hay recomendaciones priorizadas disponibles para este expediente.",

  // ---- Skip reasons (Spanish, engine-agnostic) ----
  "Not applicable to the selected materia.": "No aplicable a la materia del expediente.",
  "No physical evidence was found in the case file to support a chain-of-custody analysis.":
    "No se detectó evidencia física en el expediente para sustentar un análisis de cadena de custodia.",
  "No constitutional issue was detected in the case file.":
    "No se detectó una cuestión constitucional en el expediente.",
  "Not generated because insufficient evidence exists.":
    "No generado — el expediente no aportó evidencia suficiente.",
  "No skip reason was provided by the analysis engine.":
    "El motor de análisis omitió esta sección sin registrar un motivo.",
};

/**
 * Pattern rules for strings the exporter builds by interpolation, so they
 * can never be matched exactly (page stamps, priority labels, percentages).
 */
const ES_PATTERNS: Array<[RegExp, string]> = [
  [/^Page (\d+) \/ (\d+)$/, "Página $1 / $2"],
  [/^Priority: /, "Prioridad: "],
  [/^Likelihood of Success: ~(\d+)%$/, "Probabilidad de éxito: ~$1%"],
  [/^Generated (.+)$/, "Generado $1"],
  [/^(\d+) of (\d+)$/, "$1 de $2"],
  [/^Page (\d+)$/, "Página $1"],
  [/\bAttorney Work Product\b/, "Producto de Trabajo del Abogado"],
  [/\bEvidence Sufficiency Score\b/, "Puntaje de Suficiencia Probatoria"],
];

/**
 * Interpolated fragments: sentences the exporter concatenates with runtime
 * numbers, so they can never match a dictionary key exactly.
 */
const ES_FRAGMENTS: Array<[RegExp, string]> = [
  [
    /The intake included (\d+) source documents? and produced (\d+) verified findings?\./g,
    "La ingesta incluy\u00f3 $1 documento(s) fuente y produjo $2 hallazgo(s) verificado(s).",
  ],
  [/\bEngine v/g, "Motor v"],
  [/\bStatus: /g, "Estado: "],
  [/\bLimited Analysis\b/g, "An\u00e1lisis limitado"],
  [/\bScores Suppressed\b/g, "Puntajes suprimidos"],
  [/\bRecommendations Suppressed\b/g, "Recomendaciones suprimidas"],
  [/\bScores Enabled\b/g, "Puntajes habilitados"],
  [/\bRecommendations Enabled\b/g, "Recomendaciones habilitadas"],
  [/\bGenerated Findings:/g, "Hallazgos generados:"],
  [/\bVerified Findings:/g, "Hallazgos verificados:"],
  [/\bRendered Findings:/g, "Hallazgos incluidos:"],
  [/\bDocuments:/g, "Documentos:"],
  // Engine-emitted narrative scaffolding and enum values glued to runtime data.
  [/\bCase type:/g, "Materia:"],
  [/Document corpus: (\d+) documents? reviewed\./g, "Corpus documental: $1 documento(s) revisado(s)."],
  [/Verified issues identified: (\d+)\./g, "Cuestiones verificadas identificadas: $1."],
  [/\((\d+) pages?\)/g, "($1 pág.)"],
  [/\bLegal significance:/g, "Relevancia jurídica:"],
  [/\bRelated findings:/g, "Hallazgos relacionados:"],
  [/\bTimeline Reconstruction\b/g, "Reconstrucción cronológica"],
  [/\bDiscovery Violation\b/g, "Vacío probatorio"],
  [/\bChain of Custody\b/g, "Cadena de custodia"],
  [/\bCRITICAL ISSUES\b/g, "CUESTIONES CRÍTICAS"],
  [/\bHIGH[- ]PRIORITY ISSUES\b/g, "CUESTIONES DE PRIORIDAD ALTA"],
  [/\bMODERATE ISSUES\b/g, "CUESTIONES MODERADAS"],
  [/\bMINOR & ADMINISTRATIVE ISSUES\b/g, "CUESTIONES MENORES Y ADMINISTRATIVAS"],
  [/\bconf\./g, "confianza"],
  [/\bcritical\b/g, "crítica"],
  [/\bDOC (\d+):/g, "DOC $1:"],
  [/\bComplete\b/g, "Completo"],
  [/\bPriority\b/g, "Prioridad"],
  // US procedural-concept leaks (defense in depth alongside mx-terminology.ts).
  [/\bDiscovery Violations?\b/g, "Deficiencia probatoria"],
  [/\bDiscovery\b/g, "Vacíos probatorios"],
  [/\bDeposition(s)?\b/g, "Declaración$1"],
  [/\bPleadings\b/g, "Promociones"],
  [/\bComplaint\b/g, "Demanda"],
  [/\bSummary [Jj]udgment\b/g, "Resolución anticipada"],
  [/\bJury\b/g, "Tribunal de Enjuiciamiento"],
  [/\bVerdict\b/g, "Resolución del tribunal"],
];

/**
 * Long dictionary phrases are also applied as substring replacements, so a
 * template sentence that got glued to an interpolated fragment still switches
 * language instead of falling back to English.
 */
const ES_LONG_PHRASES: Array<[string, string]> = Object.entries(ES)
  .filter(([k]) => k.length >= 40)
  .sort((a, b) => b[0].length - a[0].length);

let current: ReportLocale = "es";

/** Set the locale for the report currently being exported. */
export function setReportTemplateLocale(locale: ReportLocale) {
  current = locale;
}

export function getReportTemplateLocale(): ReportLocale {
  return current;
}

/**
 * Resolve which language a report must render in.
 * `reports.generated_language` wins so historical documents keep the language
 * they were generated in; `cases.report_language` is the fallback for rows
 * written before that column existed.
 */
export function resolveReportLocale(
  reportRow: Record<string, unknown> | null | undefined,
  caseRow: Record<string, unknown> | null | undefined,
): ReportLocale {
  const generated = (reportRow ?? {})["generated_language"];
  if (generated === "en" || generated === "es") return generated;
  const preferred = (caseRow ?? {})["report_language"];
  return preferred === "en" ? "en" : "es";
}

/** Translate one template string. Unknown strings pass through unchanged. */
export function rt(value: string): string {
  if (current === "en" || !value) return value;
  const exact = ES[value];
  if (exact != null) return exact;
  // Tolerate incidental surrounding whitespace without losing it.
  const trimmed = value.trim();
  if (trimmed !== value) {
    const hit = ES[trimmed];
    if (hit != null) return value.replace(trimmed, hit);
  }
  // All-caps label whose title-case form is in the dictionary (e.g. "SEVERITY"
  // → "GRAVEDAD"): translate then re-uppercase, so uppercase styling variants
  // don't need duplicate entries.
  if (/^[A-Z][A-Z\s&/·.\-]*$/.test(trimmed) && trimmed.length > 2) {
    const key = Object.keys(ES).find((k) => k.toUpperCase() === trimmed);
    if (key) return value.replace(trimmed, ES[key].toUpperCase());
  }
  // Mixed string: template sentences concatenated with runtime values.
  // Longest phrases first, then interpolation fragments, then the generic
  // patterns (page stamps, standalone terms). Order matters: a short pattern
  // must never short-circuit a long-phrase replacement.
  let out = value;
  for (const [en, es] of ES_LONG_PHRASES) {
    if (out.includes(en)) out = out.split(en).join(es);
  }
  for (const [re, to] of ES_FRAGMENTS) out = out.replace(re, to);
  for (const [re, to] of ES_PATTERNS) out = out.replace(re, to);
  return out;
}

/** Exposed for tests: how many template phrases are covered. */
export const REPORT_ES_KEY_COUNT = Object.keys(ES).length;

// =============================================================================
// Dynamic procedural-role resolution.
//
// Party roles ("plaintiff"/"defendant") don't map onto a single Mexican
// procedural pair — the correct label depends entirely on the case's
// materia. This mirrors the role table in
// src/lib/intelligence/mx-terminology.ts (PARTY_ROLES_BY_PROFILE) so the
// exporter never renders a raw English role label or a role that doesn't
// exist in the matter's materia.
// =============================================================================

export type MxMateria =
  | "penal"
  | "amparo"
  | "derechos_humanos"
  | "laboral"
  | "civil"
  | "familiar"
  | "mercantil"
  | "fiscal"
  | "administrativo"
  | "apelacion";

export type ProceduralRoles = {
  /** Label for the party that initiates the action / accuses / claims. */
  plaintiff: string;
  /** Label for the party against whom the action is directed. */
  defendant: string;
  /** Materia this pair was resolved for. */
  materia: MxMateria | "generic";
};

const PROCEDURAL_ROLES_BY_MATERIA: Record<MxMateria, ProceduralRoles> = {
  penal: { plaintiff: "Ministerio Público / víctima u ofendido", defendant: "imputado", materia: "penal" },
  amparo: { plaintiff: "quejoso", defendant: "autoridad responsable", materia: "amparo" },
  derechos_humanos: { plaintiff: "víctima / quejoso", defendant: "autoridad responsable", materia: "derechos_humanos" },
  laboral: { plaintiff: "parte actora (trabajador)", defendant: "parte demandada (patrón)", materia: "laboral" },
  civil: { plaintiff: "parte actora", defendant: "parte demandada", materia: "civil" },
  familiar: { plaintiff: "parte actora", defendant: "parte demandada", materia: "familiar" },
  mercantil: { plaintiff: "parte actora", defendant: "parte demandada", materia: "mercantil" },
  fiscal: { plaintiff: "contribuyente", defendant: "autoridad fiscal", materia: "fiscal" },
  administrativo: { plaintiff: "parte actora", defendant: "autoridad administrativa", materia: "administrativo" },
  apelacion: { plaintiff: "apelante / recurrente", defendant: "apelado", materia: "apelacion" },
};

const GENERIC_ROLES: ProceduralRoles = { plaintiff: "parte actora", defendant: "parte demandada", materia: "generic" };

/**
 * Resolve the correct Mexican procedural party-role labels for a given
 * materia. Unknown/unset materia falls back to the generic civil pair
 * (parte actora / parte demandada) rather than the US plaintiff/defendant
 * labels, so a report never surfaces a common-law role.
 */
export function resolveProceduralRoles(materia: string | null | undefined): ProceduralRoles {
  if (!materia) return GENERIC_ROLES;
  const key = materia.toLowerCase().trim() as MxMateria;
  return PROCEDURAL_ROLES_BY_MATERIA[key] ?? GENERIC_ROLES;
}

/**
 * Rewrite raw "plaintiff"/"defendant" (and their US-role synonyms) inside a
 * piece of template or engine-generated text into the correct role for the
 * given materia. Case-preserving, word-boundary matched.
 */
export function localizePartyRoles(text: string, materia: string | null | undefined): string {
  if (!text) return text;
  const roles = resolveProceduralRoles(materia);
  const map: Record<string, string> = {
    plaintiff: roles.plaintiff,
    plaintiffs: roles.plaintiff,
    "plaintiff's": `de la ${roles.plaintiff}`,
    defendant: roles.defendant,
    defendants: roles.defendant,
    "defendant's": `de la ${roles.defendant}`,
    prosecution: roles.materia === "penal" ? "Ministerio Público" : roles.plaintiff,
    prosecutor: "Ministerio Público",
  };
  let out = text;
  for (const [term, to] of Object.entries(map)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"), to);
  }
  return out;
}

// =============================================================================
// Skip-reason vocabulary.
//
// Every "Omitido" section must carry a Spanish reason, sourced from the
// engine when it provides one, or resolved from this table when the engine
// only supplies a machine-readable reason code / generic English sentence.
// =============================================================================

const SKIP_REASON_ES: Record<string, string> = {
  not_applicable_to_materia: "No aplicable a la materia del expediente.",
  no_physical_evidence: "No se detectó evidencia física en el expediente para sustentar un análisis de cadena de custodia.",
  no_constitutional_issue: "No se detectó una cuestión constitucional en el expediente.",
  insufficient_evidence: "No generado — el expediente no aportó evidencia suficiente.",
  below_ess_threshold: "No generado — el expediente no alcanzó el umbral de Suficiencia Probatoria (ESS).",
  out_of_scope_case_type: "Omitido — este motor no aplica a la materia seleccionada para este expediente.",
  no_witnesses_identified: "No se identificaron testigos en el expediente disponible.",
  no_documents_of_this_type: "No se localizaron documentos del tipo requerido para este análisis.",
};

/** Localize a skip/omission reason: engine-provided Spanish text passes through; English/coded reasons resolve via the table above. */
export function skipReasonEs(reason: string | null | undefined): string {
  if (!reason) return "El motor de análisis omitió esta sección sin registrar un motivo.";
  const trimmed = reason.trim();
  const coded = SKIP_REASON_ES[trimmed.toLowerCase().replace(/[\s-]+/g, "_")];
  if (coded) return coded;
  // Already Spanish (has accented characters or known ES words) — keep as is.
  if (/[áéíóúñ¿¡]/i.test(trimmed)) return trimmed;
  return rt(trimmed) !== trimmed ? rt(trimmed) : trimmed;
}

/** Build a Spanish export filename base for the current report locale (no extension). */
export function localizedFileBase(caseName: string, kind: "reporte" | "memorando" = "reporte"): string {
  const base = (caseName || (current === "en" ? "case" : "expediente"))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || (current === "en" ? "case" : "expediente");
  if (current === "en") return base;
  return `${base}-${kind}`;
}
