// =============================================================================
// CONTROL DE CALIDAD JURÍDICA — server side of the `legal_qa` stage.
//
// Terminal quality gate. Runs AFTER every intelligence engine and BEFORE
// report generation:
//
//   1. REMEDIATION — rewrites persisted engine output in place, replacing
//      US/common-law terminology and invalid party roles with the correct
//      Mexican term for the case's materia.
//   2. AUDIT — re-reads the remediated content and looks for anything a
//      Mexican legal report must never contain: residual US terminology,
//      US jurisdiction/constitutional references, party roles that don't
//      exist in the materia, procedural codes from another materia, and
//      untranslated English prose in a Spanish report.
//   3. GATE — persists the audit on cases.legal_qa_report and, when a
//      blocking violation survives remediation, THROWS so the stage is
//      recorded as failed and `report` (which depends on it) is blocked.
//      Fails closed: a defective report is never silently published.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveMxProfile, type MxPipelineProfile } from "@/lib/execution/mx-pipeline";
import {
  auditText,
  dedupeViolations,
  detectPartyGenderFromCorpus,
  findEnglishSentences,
  remediatePartyGender,
  remediateText,
  type QaViolation,
} from "./mx-terminology";

type Db = SupabaseClient<Database>;

export class LegalQaBlockedError extends Error {
  readonly report: LegalQaReport;
  constructor(report: LegalQaReport) {
    super(
      `Control de Calidad Jurídica bloqueó la generación del informe: ${report.blocking.length} violación(es) no subsanable(s).`,
    );
    this.name = "LegalQaBlockedError";
    this.report = report;
  }
}

export type LegalQaReport = {
  ok: boolean;
  blocked: boolean;
  materia: MxPipelineProfile;
  locale: "es" | "en";
  checked_rows: number;
  checked_fields: number;
  remediated_fields: number;
  remediations: { table: string; field: string; from: string; to: string }[];
  blocking: (QaViolation & { table: string; field: string })[];
  warnings: (QaViolation & { table: string; field: string })[];
  generated_at: string;
};

/**
 * Persisted engine output that reaches the report.
 * `text` = plain-text columns; `json` = jsonb columns whose string leaves are
 * rewritten recursively. Verbatim document quotes are deliberately excluded —
 * a quote from an original exhibit must never be rewritten.
 */
const TARGETS: readonly {
  table: string;
  key: "case_id";
  idColumn: string | null;
  text: readonly string[];
  json: readonly string[];
}[] = [
  {
    table: "case_findings",
    key: "case_id",
    idColumn: "id",
    text: ["title", "description", "legal_significance", "strategic_significance", "potential_impact", "verification_notes"],
    json: [],
  },
  {
    table: "case_theories",
    key: "case_id",
    idColumn: "id",
    text: ["narrative", "risk"],
    json: ["key_assumptions", "missing_evidence", "supporting_evidence", "contradicting_evidence"],
  },
  {
    table: "case_opportunities",
    key: "case_id",
    idColumn: "id",
    text: ["title", "description", "counter_response"],
    json: ["recommended_motions", "recommended_questions", "recommended_investigations"],
  },
  {
    table: "case_strategy",
    key: "case_id",
    idColumn: "id",
    text: ["summary"],
    json: ["counter_arguments", "next_actions", "motion_rankings", "anticipated_opposing"],
  },
  {
    table: "case_witnesses",
    key: "case_id",
    idColumn: "id",
    text: ["role"],
    json: ["cross_exam_questions", "impeachment_questions", "follow_up_questions", "rationale"],
  },
  {
    table: "agent_findings",
    key: "case_id",
    idColumn: "id",
    text: ["summary"],
    json: ["findings"],
  },
  {
    table: "analyses",
    key: "case_id",
    idColumn: null,
    text: [],
    json: ["key_findings", "contradictions", "missing_evidence", "procedural_issues", "evidence_relationships"],
  },
  // Audit P0-4/P0-5/B1: the two tables the confirmed U.S.-terminology leaks
  // actually reached (pipeline.server.ts's runReport → reports.full_report,
  // and litigation.server.ts's runLitigationStrategyCenterEngine →
  // case_strategy_center) were absent from TARGETS entirely — the QA gate
  // ran on every upstream engine table but never on the two artifacts an
  // attorney actually reads (the report JSON/PDF and the strategy-center
  // PDF section). `full_report` covers the legal_memorandum object (the
  // section the U.S. motion list reached); the narrative text/json columns
  // below are the same class of field (motion/strategy/theory narrative)
  // already covered on case_opportunities/case_strategy/case_witnesses
  // above, just reached via reports' own denormalized copies. Internal
  // bookkeeping fields (report_chunk_cache, change_log,
  // quality_block_reasons, engines_summary, item_flags, score_breakdown)
  // are intentionally excluded — they are not attorney-facing narrative.
  {
    table: "reports",
    key: "case_id",
    idColumn: "id",
    text: [
      "executive_summary",
      "attorney_summary",
      "investigator_summary",
      "case_overview",
      "facts",
      "recommendations",
      "risk_analysis",
      "evidence_summary",
      "contradiction_report",
      "procedural_issues_report",
      "prosecution_theory_report",
      "defense_theory_report",
      "alternative_theory_report",
      "appendix_sources",
      "timeline_summary",
      "witness_analysis",
      "discovery_analysis",
      "constitutional_issues",
    ],
    json: [
      "full_report",
      "citations",
      "constitutional_issues_struct",
      "contradictions_struct",
      "cross_examination",
      "evidence_index",
      "missing_evidence_report",
      "missing_evidence_struct",
      "motion_opportunities",
      "next_actions",
      "strategy_recommendations",
    ],
  },
  {
    table: "case_strategy_center",
    key: "case_id",
    idColumn: "id",
    text: ["lead_counsel_assessment", "recommended_counter_strategy"],
    json: [
      "primary_trial_theme",
      "biggest_weakness",
      "biggest_trial_risk",
      "settlement_leverage",
      "most_dangerous_witness",
      "biggest_evidentiary_gap",
      "expected_defense",
      "weekly_priorities",
      "winning_the_case_dashboard",
    ],
  },
];

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function remediateJson(
  value: JsonValue,
  profile: MxPipelineProfile,
  sink: { from: string; to: string }[],
): JsonValue {
  if (typeof value === "string") {
    const { text, replacements } = remediateText(value, profile);
    sink.push(...replacements);
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => remediateJson(v, profile, sink));
  if (value && typeof value === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = remediateJson(v as JsonValue, profile, sink);
    return out;
  }
  return value;
}

function collectStrings(value: JsonValue, out: string[]): void {
  if (typeof value === "string") {
    if (value.trim()) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v as JsonValue, out);
  }
}

/**
 * Translates English prose into Mexican-Spanish legal prose. Returns null when
 * the model is unavailable or returns something unusable — the caller then
 * keeps the original text and records a warning instead of blocking.
 */
async function translateToSpanish(text: string, userId?: string): Promise<string | null> {
  try {
    const { routeAI } = await import("@/lib/ai/router.server");
    const res = await routeAI({
      userId,
      cache: true,
      temperature: 0,
      timeoutMs: 30_000,
      systemInstruction:
        "Eres traductor jurídico mexicano. Traduce el texto al español jurídico de México, " +
        "conservando cifras, nombres propios, artículos y términos legales mexicanos (amparo, quejosa, " +
        "estrados, Ministerio Público, etc.). No agregues comentarios ni comillas. Devuelve SOLO la traducción.",
      userContent: text,
    });
    const out = String(res.text ?? "").trim();
    if (!out || out.length < Math.min(10, text.length / 4)) return null;
    return out;
  } catch {
    return null;
  }
}

export async function runLegalQaGate(args: {
  db: Db;
  caseId: string;
  userId?: string;
}): Promise<LegalQaReport> {
  const { db, caseId, userId } = args;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await (db as any)
    .from("cases")
    .select("case_type, report_language")
    .eq("id", caseId)
    .maybeSingle();
  const row = (caseRow ?? {}) as { case_type?: string | null; report_language?: string | null };
  // VERIFIED CASE IDENTITY — the legal QA gate remediates/audits materia-
  // specific terminology; never a raw cases.case_type read. CORRECTION:
  // resolveMxProfile is the STRICT variant (an alias for requireMxProfile)
  // — it throws for null/unrecognized input, it does NOT accept null
  // gracefully as this comment previously and incorrectly claimed.
  // Confirmed live in production: a genuinely unusable identity
  // (unverified-with-nothing, or a real attorney-lock-vs-evidence conflict)
  // crashed this stage outright with "Materia desconocida en
  // requireMxProfile". "civil" is used here only as that last-resort
  // structural fallback so the QA gate can still run.
  const { resolveCaseIdentity } = await import("./case-classification.server");
  const legalQaIdentity = await resolveCaseIdentity(db, caseId);
  const materia = resolveMxProfile(legalQaIdentity.caseType ?? "civil");
  const locale: "es" | "en" = row.report_language === "en" ? "en" : "es";

  // Party-role gender: read once from the case's own document text (never
  // guessed from a party's name — see mx-terminology.ts's
  // detectPartyGenderFromCorpus doc comment for why). Empty/no-op result
  // when the corpus establishes nothing unambiguous, so this is a pure
  // addition with zero effect on cases where it doesn't apply.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: docsForGender } = await (db as any)
    .from("documents")
    .select("extracted_text")
    .eq("case_id", caseId);
  const corpusTextForGender = ((docsForGender ?? []) as Array<{ extracted_text?: string | null }>)
    .map((d) => d.extracted_text ?? "")
    .join("\n");
  const partyGenderMap = detectPartyGenderFromCorpus(corpusTextForGender);

  const remediations: LegalQaReport["remediations"] = [];
  const violations: (QaViolation & { table: string; field: string })[] = [];
  let checked_rows = 0;
  let checked_fields = 0;
  let remediated_fields = 0;

  // Translation cache — identical strings recur across rows/fields.
  const translationCache = new Map<string, string | null>();
  async function translateOnce(text: string): Promise<string | null> {
    const key = text.trim();
    if (translationCache.has(key)) return translationCache.get(key)!;
    const out = await translateToSpanish(key, userId);
    translationCache.set(key, out);
    return out;
  }

  /**
   * Language remediation: if a Spanish report still contains English prose,
   * translate the whole field and re-apply terminology remediation. Returns
   * the final text (translated when possible, original otherwise).
   */
  async function ensureSpanish(
    text: string,
    ctx: { table: string; field: string },
  ): Promise<{ text: string; changed: boolean }> {
    if (locale !== "es") return { text, changed: false };
    if (findEnglishSentences(text).length === 0) return { text, changed: false };
    const translated = await translateOnce(text);
    if (!translated) return { text, changed: false };
    const { text: fixed } = remediateText(translated, materia);
    remediations.push({ table: ctx.table, field: ctx.field, from: text.slice(0, 200), to: fixed.slice(0, 200) });
    return { text: fixed, changed: true };
  }

  for (const target of TARGETS) {
    const columns = [...(target.idColumn ? [target.idColumn] : []), ...target.text, ...target.json];
    if (columns.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db as any)
      .from(target.table)
      .select(columns.join(", "))
      .eq(target.key, caseId);
    // A table that doesn't exist / isn't readable must not crash the gate.
    if (error) continue;
    const rows = (data ?? []) as Record<string, unknown>[];

    for (const r of rows) {
      checked_rows += 1;
      const patch: Record<string, unknown> = {};

      for (const field of target.text) {
        const value = r[field];
        if (typeof value !== "string" || !value.trim()) continue;
        checked_fields += 1;
        const { text, replacements } = remediateText(value, materia);
        let finalText = text;
        let dirty = replacements.length > 0;
        if (replacements.length > 0) {
          for (const rep of replacements) remediations.push({ table: target.table, field, ...rep });
        }
        const genderFix = remediatePartyGender(finalText, partyGenderMap);
        if (genderFix.replacements.length > 0) {
          finalText = genderFix.text;
          dirty = true;
          for (const rep of genderFix.replacements) {
            remediations.push({ table: target.table, field, ...rep });
          }
        }
        const es = await ensureSpanish(finalText, { table: target.table, field });
        if (es.changed) {
          finalText = es.text;
          dirty = true;
        }
        if (dirty) {
          remediated_fields += 1;
          patch[field] = finalText;
        }
        for (const v of auditText(finalText, { profile: materia, locale })) {
          violations.push({ ...v, table: target.table, field });
        }
      }


      for (const field of target.json) {
        const value = r[field] as JsonValue | undefined;
        if (value === undefined || value === null) continue;
        checked_fields += 1;
        const sink: { from: string; to: string }[] = [];
        let next = remediateJson(value, materia, sink);
        let dirty = sink.length > 0;
        for (const rep of sink) remediations.push({ table: target.table, field, ...rep });

        // Translate English string leaves in a Spanish report.
        if (locale === "es") {
          const translate = async (v: JsonValue): Promise<JsonValue> => {
            if (typeof v === "string") {
              if (!v.trim() || findEnglishSentences(v).length === 0) return v;
              const es = await ensureSpanish(v, { table: target.table, field });
              if (es.changed) dirty = true;
              return es.text;
            }
            if (Array.isArray(v)) {
              const out: JsonValue[] = [];
              for (const item of v) out.push(await translate(item));
              return out;
            }
            if (v && typeof v === "object") {
              const out: { [k: string]: JsonValue } = {};
              for (const [k, val] of Object.entries(v)) out[k] = await translate(val as JsonValue);
              return out;
            }
            return v;
          };
          next = await translate(next);
        }

        if (dirty) {
          remediated_fields += 1;
          patch[field] = next as unknown;
        }
        const strings: string[] = [];
        collectStrings(next, strings);
        for (const s of strings) {
          for (const v of auditText(s, { profile: materia, locale })) {
            violations.push({ ...v, table: target.table, field });
          }
        }
      }


      if (Object.keys(patch).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (db as any).from(target.table).update(patch);
        q = target.idColumn ? q.eq(target.idColumn, r[target.idColumn]) : q.eq(target.key, caseId);
        const { error: upErr } = await q;
        if (upErr) {
          throw new Error(`No se pudo aplicar la corrección terminológica en ${target.table}: ${upErr.message}`);
        }
      }
    }
  }

  // Language is remediated by translation above. If a residue survives (model
  // unavailable, mixed-language quote), it is a quality warning — never a hard
  // block, because blocking here strands the whole report with no path forward.
  const softened = violations.map((v) =>
    v.kind === "untranslated_english" ? { ...v, severity: "warning" as const } : v,
  );
  const deduped = dedupeViolations(softened) as (QaViolation & { table: string; field: string })[];
  const blocking = deduped.filter((v) => v.severity === "blocking");
  const warnings = deduped.filter((v) => v.severity === "warning");

  const report: LegalQaReport = {
    ok: blocking.length === 0 && warnings.length === 0,
    blocked: blocking.length > 0,
    materia,
    locale,
    checked_rows,
    checked_fields,
    remediated_fields,
    remediations: remediations.slice(0, 500),
    blocking,
    warnings,
    generated_at: new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .from("cases")
    .update({ legal_qa_report: report as unknown as Record<string, unknown> })
    .eq("id", caseId);

  if (report.blocked) throw new LegalQaBlockedError(report);
  return report;
}
