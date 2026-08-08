/**
 * Mexico Legal Lock — shared preamble injected into every engine prompt.
 *
 * Nyrava Intelligence México opera EXCLUSIVAMENTE en el sistema jurídico
 * mexicano (tradición civil romano-germánica). Este preámbulo impide que los
 * modelos filtren conceptos, terminología o precedentes del sistema
 * estadounidense (common law) u otras jurisdicciones al análisis.
 */

export const MEXICO_LOCK_ES = `MÉXICO (civil law, tradición romano-germánica). Prohibido: terminología/tribunales/precedentes de EE.UU. u otra jurisdicción — nunca: felony, misdemeanor, plea bargain, grand jury, indictment, discovery, deposition, subpoena, summary judgment, tort, hearsay, exclusionary rule, Miranda, prosecutor, district attorney, jury, jury trial, Federal Rules of Evidence, stare decisis.

Usa siempre: Ministerio Público, Fiscalía, imputado, víctima, ofendido, carpeta de investigación, informe policial homologado, cadena de custodia, vinculación a proceso, medidas cautelares, plazo constitucional, auto de apertura a juicio, juicio oral, sentencia, recurso de apelación, Juez de control, Tribunal de Enjuiciamiento, Tribunal de Alzada, amparo directo/indirecto, quejoso, autoridad responsable, actor, demandado, trabajador, patrón, tribunal laboral, contribuyente, TFJA, jurisprudencia, tesis aislada, SCJN, DOF.

Fuentes (jerarquía): CPEUM > tratados DDHH (Art. 1º) > leyes federales (CNPP, CPF, CCF, CCom, LFT, Ley de Amparo, LFPDPPP, LGSM, CFF) > códigos/leyes estatales > jurisprudencia SCJN/Tribunales Colegiados > reglamentos/DOF.

Anti-alucinación: si una autoridad no aparece explícita en el contexto, márcala "verified": false. Nunca inventes expedientes, tesis, ni URLs. Español, precisión jurídica mexicana.`;

export const MEXICO_LOCK_EN = `MANDATORY LEGAL SYSTEM: MEXICO (Civil Law tradition).

FORBIDDEN: any United States (common-law) or other jurisdiction's concepts, terminology, courts, procedures, or precedents (felony, misdemeanor, plea bargain, grand jury, indictment, discovery, deposition, tort, hearsay, Miranda, exclusionary rule, prosecutor/DA, jury, Federal Rules of Evidence, stare decisis, summary judgment).

ALWAYS use Mexican terminology: Ministerio Público, Fiscalía, imputado, carpeta de investigación, vinculación a proceso, medidas cautelares, auto de apertura a juicio, juicio oral, amparo (directo/indirecto), quejoso, autoridad responsable, actor, demandado, jurisprudencia, tesis aislada, SCJN, TFJA, DOF.

Ground every analysis in Mexican sources: CPEUM, CNPP, Federal Penal Code, state codes, LFT, Ley de Amparo, SCJN jurisprudencia. If an authority cannot be verified from provided context, mark it "verified": false. Respond in English but preserve Mexican legal proper names in Spanish.`;

export function mexicoLock(locale: "es" | "en"): string {
  return locale === "en" ? MEXICO_LOCK_EN : MEXICO_LOCK_ES;
}

/**
 * Grounding Contract — shared preamble injected into every finding-generating
 * prompt (the general analyzer AND every materia-specific investigator
 * agent) alongside mexicoLock. One authoritative copy so every detector, in
 * every practice area, is bound by the same rule instead of ~50 individually
 * drifting prompt variants.
 *
 * Exists to close a real production defect: an amparo-specific investigator
 * agent asked "does suspensión/notificación/definitividad apply here?" would
 * satisfy its own "ground every finding in a verbatim quote" instruction by
 * quoting the LAW ITSELF (the article text describing what suspensión or
 * notificación generally requires) rather than a case-specific fact, and
 * would report the ABSENCE of a notification/suspension document as proof
 * the corresponding act was defective. Both are the same underlying error:
 * treating a citation-floor pass (some quote exists, and it verifies against
 * the corpus) as sufficient, when the quote is legal RESEARCH, not a case
 * FACT. See src/lib/intelligence/procedural-defect-grounding.server.ts for
 * the deterministic backstop this preamble's directives make enforceable.
 */
export const GROUNDING_CONTRACT_ES = `CONTRATO DE FUNDAMENTACIÓN (aplica a TODA materia y a CADA hallazgo):

1. Una norma, artículo o doctrina jurídica citada, POR SÍ SOLA, NUNCA es un hallazgo del caso. Es investigación jurídica ("marco legal aplicable"), no un hallazgo. Solo se convierte en hallazgo cuando el corpus contiene además un HECHO CONCRETO Y ESPECÍFICO DE ESTE EXPEDIENTE (una fecha, un acto, una omisión, una autoridad, un documento) al que esa norma se aplica. Nunca saltes de "la ley dice X" a "en este caso ocurrió una violación de X" sin ese hecho intermedio, verificable con cita textual propia (no la misma cita de la norma).

2. La AUSENCIA de un documento o constancia NUNCA es evidencia de un defecto. Si no hay constancia de notificación, eso NO significa "notificación defectuosa" — significa que no se puede determinar el estado de la notificación con el corpus disponible. Nunca conviertas "no encontré prueba de X" en "X fue indebido/defectuoso/incumplido". Omite el hallazgo, o indica expresamente que no puede determinarse con el corpus disponible — jamás afirmes el incumplimiento.

3. No generes un hallazgo sobre un tema (suspensión, notificación, definitividad, competencia, plazos, jurisdicción) solo porque ese tema forma parte del marco legal de esta materia. Genera el hallazgo únicamente si el propio corpus plantea, documenta o discute ese tema específico en este expediente. Si el corpus no lo plantea: el tema es NO APLICABLE para este hallazgo, no una omisión que deba señalarse como defecto.

4. No confundas conceptos jurídicos relacionados pero distintos: un argumento planteado por primera vez en una instancia posterior NO es automáticamente "falta de agotamiento de recursos ordinarios"; la falta de agotamiento NO es automáticamente "falta de definitividad"; renuncia (waiver), preclusión y "argumento no preservado" son conceptos distintos entre sí. Usa el concepto que el propio corpus establece, no el más parecido o el más grave.

5. Todo hallazgo que alegue una violación, defecto, incumplimiento o irregularidad procesal debe estar anclado a una cita textual que describa un HECHO ocurrido en este expediente (con fecha, acto u omisión concretos) — nunca a una cita que sea, en sí misma, el texto de la norma o un principio doctrinal general. Si la única cita disponible para un hallazgo es el texto de la ley o una máxima doctrinal sin hecho específico, NO generes el hallazgo.`;

export const GROUNDING_CONTRACT_EN = `GROUNDING CONTRACT (applies to EVERY practice area and EVERY finding):

1. A cited legal rule, article, or doctrine, BY ITSELF, is NEVER a case finding. It is legal research ("applicable legal framework"), not a finding. It only becomes a finding once the corpus also contains a SPECIFIC, CASE-LEVEL FACT (a date, an act, an omission, an authority, a document) that the rule applies to. Never jump from "the law says X" to "X was violated in this case" without that intermediate fact, grounded in its own verbatim quote (not the same quote as the rule itself).

2. The ABSENCE of a document or record is NEVER evidence of a defect. No notification record on file does NOT mean "defective notification" — it means notification status cannot be determined from the available corpus. Never convert "I found no proof of X" into "X was improper/defective/non-compliant." Omit the finding, or state explicitly that it cannot be determined from the available corpus — never assert non-compliance.

3. Do not generate a finding on a topic (suspension, notification, definitividad/exhaustion, jurisdiction, deadlines) merely because that topic is part of the applicable legal framework for this materia. Only generate it if the corpus itself raises, documents, or discusses that specific topic in this case. If the corpus does not raise it: the topic is NOT APPLICABLE to this finding, not an omission to flag as a defect.

4. Do not conflate related-but-distinct legal concepts: an argument raised for the first time on a later instance is NOT automatically "failure to exhaust ordinary remedies"; failure to exhaust is NOT automatically "lack of definitividad"; waiver, forfeiture, and "unpreserved argument" are distinct concepts from each other. Use whichever concept the corpus itself establishes, not the closest-sounding or most severe one.

5. Every finding alleging a violation, defect, non-compliance, or procedural irregularity must be anchored to a verbatim quote describing a FACT that occurred in this case (a concrete date, act, or omission) — never to a quote that is itself the text of the rule or a general doctrinal statement. If the only quote available for a finding is the law's own text or a doctrinal maxim with no case-specific fact, DO NOT generate the finding.`;

export function groundingContract(locale: "es" | "en"): string {
  return locale === "en" ? GROUNDING_CONTRACT_EN : GROUNDING_CONTRACT_ES;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalDb = { from: (table: string) => any };

/**
 * Resolve the language to reason/write in for a given case — Phase 21
 * (bilingual system). Reads cases.report_language (added in migration
 * 20260725130000_bilingual_language_fields.sql); falls back to "es" if
 * unset, matching src/i18n's DEFAULT_LOCALE and the platform's primary
 * language. Every engine call site already has `db` and `caseId` in scope,
 * so this is called internally at each mexicoLock() call rather than
 * threading a new parameter through every function signature and caller.
 */
// A full pipeline run calls getReportLocale() ~20 separate times across
// pipeline.server.ts and the 5 engine files (each AI-prompt call site
// resolves it independently) — all for the SAME unchanging value for the
// SAME case. That's ~20 redundant DB round-trips added per run purely by
// this locale-threading work. Cache per caseId for a short window (long
// enough to cover one pipeline run, short enough that a user changing
// report_language mid-run — rare, but possible via the case settings
// panel — doesn't get stuck on a stale value for long).
const _localeCache = new Map<string, { value: "es" | "en"; expiresAt: number }>();
const LOCALE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — comfortably covers one run

export async function getReportLocale(db: MinimalDb, caseId: string): Promise<"es" | "en"> {
  const cached = _localeCache.get(caseId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const { data } = await db.from("cases").select("report_language").eq("id", caseId).maybeSingle();
    const lang = (data as { report_language?: string } | null)?.report_language;
    const value: "es" | "en" = lang === "en" ? "en" : "es";
    _localeCache.set(caseId, { value, expiresAt: Date.now() + LOCALE_CACHE_TTL_MS });
    return value;
  } catch {
    return "es";
  }
}
