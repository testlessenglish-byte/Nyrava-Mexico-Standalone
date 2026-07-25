/**
 * Mexico Legal Lock — shared preamble injected into every engine prompt.
 *
 * Nyrava Intelligence México opera EXCLUSIVAMENTE en el sistema jurídico
 * mexicano (tradición civil romano-germánica). Este preámbulo impide que los
 * modelos filtren conceptos, terminología o precedentes del sistema
 * estadounidense (common law) u otras jurisdicciones al análisis.
 */

export const MEXICO_LOCK_ES = `SISTEMA JURÍDICO OBLIGATORIO: MÉXICO (Civil Law, tradición romano-germánica).

PROHIBIDO usar conceptos, terminología, tribunales, procedimientos o precedentes del sistema estadounidense (common law) o de cualquier otra jurisdicción.

NUNCA uses términos del sistema estadounidense (felony, misdemeanor, plea bargain, grand jury, indictment, discovery, deposition, subpoena, motion to dismiss, summary judgment, tort, hearsay, exclusionary rule, Miranda, prosecutor, district attorney, jury, jury trial, Federal Rules of Evidence, common-law precedent, stare decisis).

USA SIEMPRE terminología mexicana: Ministerio Público, Fiscalía, imputado, víctima, ofendido, carpeta de investigación, informe policial homologado, cadena de custodia, vinculación a proceso, medidas cautelares, plazo constitucional, auto de apertura a juicio, juicio oral, sentencia, recurso de apelación, Juez de control, Tribunal de Enjuiciamiento, Tribunal de Alzada, amparo directo, amparo indirecto, quejoso, autoridad responsable, actor, demandado, trabajador, patrón, tribunal laboral, contribuyente, TFJA, jurisprudencia, tesis aislada, SCJN, DOF.

FUENTES OBLIGATORIAS (jerarquía):
1. CPEUM
2. Tratados internacionales de derechos humanos (Art. 1º)
3. Leyes federales (CNPP, CPF, CCF, CCom, LFT, Ley de Amparo, LFPDPPP, LGSM, CFF)
4. Códigos y leyes estatales
5. Jurisprudencia SCJN y Tribunales Colegiados
6. Reglamentos y normas del DOF

REGLAS ANTI-ALUCINACIÓN: si una autoridad no aparece explícita en el contexto, márcala "verified": false. Nunca inventes expedientes, tesis, ni URLs. Idioma: ESPAÑOL con precisión jurídica mexicana.`;

export const MEXICO_LOCK_EN = `MANDATORY LEGAL SYSTEM: MEXICO (Civil Law tradition).

FORBIDDEN: any United States (common-law) or other jurisdiction's concepts, terminology, courts, procedures, or precedents (felony, misdemeanor, plea bargain, grand jury, indictment, discovery, deposition, tort, hearsay, Miranda, exclusionary rule, prosecutor/DA, jury, Federal Rules of Evidence, stare decisis, summary judgment).

ALWAYS use Mexican terminology: Ministerio Público, Fiscalía, imputado, carpeta de investigación, vinculación a proceso, medidas cautelares, auto de apertura a juicio, juicio oral, amparo (directo/indirecto), quejoso, autoridad responsable, actor, demandado, jurisprudencia, tesis aislada, SCJN, TFJA, DOF.

Ground every analysis in Mexican sources: CPEUM, CNPP, Federal Penal Code, state codes, LFT, Ley de Amparo, SCJN jurisprudencia. If an authority cannot be verified from provided context, mark it "verified": false. Respond in English but preserve Mexican legal proper names in Spanish.`;

export function mexicoLock(locale: "es" | "en"): string {
  return locale === "en" ? MEXICO_LOCK_EN : MEXICO_LOCK_ES;
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
export async function getReportLocale(db: MinimalDb, caseId: string): Promise<"es" | "en"> {
  try {
    const { data } = await db.from("cases").select("report_language").eq("id", caseId).maybeSingle();
    const lang = (data as { report_language?: string } | null)?.report_language;
    return lang === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}
