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

export async function runLegalQaGate(args: {
  db: Db;
  caseId: string;
}): Promise<LegalQaReport> {
  const { db, caseId } = args;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await (db as any)
    .from("cases")
    .select("case_type, report_language")
    .eq("id", caseId)
    .maybeSingle();
  const row = (caseRow ?? {}) as { case_type?: string | null; report_language?: string | null };
  const materia = resolveMxProfile(row.case_type ?? null);
  const locale: "es" | "en" = row.report_language === "en" ? "en" : "es";

  const remediations: LegalQaReport["remediations"] = [];
  const violations: (QaViolation & { table: string; field: string })[] = [];
  let checked_rows = 0;
  let checked_fields = 0;
  let remediated_fields = 0;

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
        if (replacements.length > 0) {
          remediated_fields += 1;
          patch[field] = text;
          for (const rep of replacements) remediations.push({ table: target.table, field, ...rep });
        }
        for (const v of auditText(text, { profile: materia, locale })) {
          violations.push({ ...v, table: target.table, field });
        }
      }

      for (const field of target.json) {
        const value = r[field] as JsonValue | undefined;
        if (value === undefined || value === null) continue;
        checked_fields += 1;
        const sink: { from: string; to: string }[] = [];
        const next = remediateJson(value, materia, sink);
        if (sink.length > 0) {
          remediated_fields += 1;
          patch[field] = next as unknown;
          for (const rep of sink) remediations.push({ table: target.table, field, ...rep });
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

  const deduped = dedupeViolations(violations) as (QaViolation & { table: string; field: string })[];
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
