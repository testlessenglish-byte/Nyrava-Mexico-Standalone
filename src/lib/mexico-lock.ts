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
