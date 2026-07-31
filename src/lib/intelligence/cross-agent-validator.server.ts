// Addendum §27 — cross-agent reasoning audit.
//
// Deterministic, no-AI-call consistency pass across every finding a case's
// agents/engines produced. Runs as a FINAL step after the pipeline's
// normal, dependency-gated stage loop finishes (see
// runPipelineForCase in pipeline-runner.server.ts) — it is intentionally
// NOT registered as one of the gated stages in
// src/lib/execution/canonical.ts, because that dependency graph is exactly
// the machinery keeping today's case processing reliable and this addendum
// work must not touch it.
//
// Advisory only: never throws, never blocks report generation, never
// retries a stage. It writes one row to cross_agent_audit per run and
// returns a summary. When it finds something it can't resolve
// deterministically, it records the disagreement for attorney review
// rather than silently picking a side (addendum §27's "agent disagreement
// handling").
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

type FindingRow = {
  id: string;
  case_id: string;
  canonical_finding_id: string | null;
  source_module: string;
  category: string;
  title: string;
  severity: string;
  confidence: number;
  affected_party: string | null;
  rationale: unknown;
};

export type AuditCheck = { name: string; status: "pass" | "warn"; detail: string };
export type AuditConflict = { kind: string; detail: string; finding_ids: string[] };

export type CrossAgentAuditResult = {
  ok: boolean;
  status: "ok" | "warnings" | "conflicts";
  checks: AuditCheck[];
  conflicts: AuditConflict[];
};

/** Runs every check and writes the result to cross_agent_audit. Best-effort
 * — returns a benign "ok" result (rather than throwing) if it can't even
 * read the data it needs, since a validator failure must never be mistaken
 * for a pipeline failure. */
export async function runCrossAgentValidator(
  db: Db,
  args: { caseId: string; userId: string; reportVersion?: number | null },
): Promise<CrossAgentAuditResult> {
  const benign: CrossAgentAuditResult = { ok: true, status: "ok", checks: [], conflicts: [] };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: findingsData, error } = await (db as any)
      .from("case_findings")
      .select(
        "id,case_id,canonical_finding_id,source_module,category,title,severity,confidence,affected_party,rationale",
      )
      .eq("case_id", args.caseId)
      .not("source_module", "like", "projection:%");
    if (error) return benign;
    const findings = (findingsData ?? []) as FindingRow[];

    const checks: AuditCheck[] = [];
    const conflicts: AuditConflict[] = [];

    // Check 1 — every row actually belongs to the case queried. Trivial
    // given the .eq filter above, but a real safety net: if this ever
    // fails it means a write path leaked a finding onto the wrong case,
    // which is a correctness bug worth surfacing loudly rather than
    // silently trusting the query filter.
    const crossCaseLeak = findings.filter((f) => f.case_id !== args.caseId);
    checks.push(
      crossCaseLeak.length === 0
        ? { name: "same_case_context", status: "pass", detail: "All findings reference this case." }
        : {
            name: "same_case_context",
            status: "warn",
            detail: `${crossCaseLeak.length} finding(s) reference a different case_id.`,
          },
    );
    if (crossCaseLeak.length > 0) {
      conflicts.push({
        kind: "cross_case_contamination",
        detail:
          "Finding(s) attached to this case reference a different case_id — possible data integrity issue.",
        finding_ids: crossCaseLeak.map((f) => f.id),
      });
    }

    // Check 2 — duplicate canonical identity. canonical-id.ts's dedup
    // pipeline should prevent this at write time; this re-verifies nothing
    // slipped through, since agents/engines write independently and not
    // every write path is equally strict.
    const byCanonical = new Map<string, FindingRow[]>();
    for (const f of findings) {
      if (!f.canonical_finding_id) continue;
      const arr = byCanonical.get(f.canonical_finding_id) ?? [];
      arr.push(f);
      byCanonical.set(f.canonical_finding_id, arr);
    }
    const duplicated = Array.from(byCanonical.entries()).filter(([, rows]) => rows.length > 1);
    checks.push(
      duplicated.length === 0
        ? {
            name: "canonical_id_uniqueness",
            status: "pass",
            detail: "No duplicate canonical_finding_id values.",
          }
        : {
            name: "canonical_id_uniqueness",
            status: "warn",
            detail: `${duplicated.length} canonical_finding_id value(s) appear more than once.`,
          },
    );
    for (const [cid, rows] of duplicated) {
      conflicts.push({
        kind: "duplicate_canonical_finding",
        detail: `canonical_finding_id "${cid}" appears on ${rows.length} findings — the dedup pipeline may have been bypassed for one of these write paths.`,
        finding_ids: rows.map((f) => f.id),
      });
    }

    // Check 3 — high-confidence conclusions with no recorded contrary
    // evidence. Not necessarily wrong, but exactly the pattern addendum
    // §25 says must not be presented as high confidence without comment:
    // a strong conclusion that nobody checked for a counter-argument.
    const highConfidenceNoContrary = findings.filter((f) => {
      if (f.confidence < 0.85) return false;
      const r = (f.rationale ?? {}) as { contrary_evidence?: unknown };
      return !Array.isArray(r.contrary_evidence) || r.contrary_evidence.length === 0;
    });
    checks.push(
      highConfidenceNoContrary.length === 0
        ? {
            name: "high_confidence_has_contrary_check",
            status: "pass",
            detail: "Every high-confidence finding records a contrary-evidence check.",
          }
        : {
            name: "high_confidence_has_contrary_check",
            status: "warn",
            detail: `${highConfidenceNoContrary.length} finding(s) at ≥0.85 confidence have no recorded contrary evidence.`,
          },
    );

    // Check 4 — findings whose own rationale already flagged themselves
    // (unsupported hedge language with nothing backing it — see
    // confidence-dimensions.ts). Aggregated here so it's visible at the
    // case level, not just buried per-finding.
    const selfFlagged = findings.filter((f) => {
      const r = (f.rationale ?? {}) as { attorney_review_required?: unknown };
      return Boolean(r.attorney_review_required);
    });
    checks.push(
      selfFlagged.length === 0
        ? {
            name: "unsupported_language_scan",
            status: "pass",
            detail: "No findings flagged unsupported conclusion language without support.",
          }
        : {
            name: "unsupported_language_scan",
            status: "warn",
            detail: `${selfFlagged.length} finding(s) use an unsupported-conclusion phrase without an accompanying evidence or authority reference.`,
          },
    );

    // Check 5 — possible party inversion: the same finding title/category
    // asserted for BOTH affected_party sides by different source_modules
    // without being marked as a genuine two-sided theory comparison. A
    // coarse signal, not a hard proof — surfaced as a conflict for a human
    // to look at rather than auto-resolved.
    const byTitleCategory = new Map<string, Set<string>>();
    for (const f of findings) {
      if (!f.affected_party || f.affected_party === "both" || f.affected_party === "neutral")
        continue;
      const key = `${f.category}::${f.title.toLowerCase().trim()}`;
      const parties = byTitleCategory.get(key) ?? new Set<string>();
      parties.add(f.affected_party);
      byTitleCategory.set(key, parties);
    }
    const possibleInversions = Array.from(byTitleCategory.entries()).filter(
      ([, parties]) => parties.size > 1,
    );
    checks.push(
      possibleInversions.length === 0
        ? {
            name: "party_consistency",
            status: "pass",
            detail: "No finding asserts conflicting affected_party values under the same title.",
          }
        : {
            name: "party_consistency",
            status: "warn",
            detail: `${possibleInversions.length} finding title(s) recorded for both defense and prosecution — verify this is an intentional two-sided comparison, not a party mix-up.`,
          },
    );
    for (const [key] of possibleInversions) {
      const matches = findings.filter(
        (f) => `${f.category}::${f.title.toLowerCase().trim()}` === key,
      );
      conflicts.push({
        kind: "possible_party_inversion",
        detail: `"${matches[0]?.title}" appears with conflicting affected_party values across agents.`,
        finding_ids: matches.map((f) => f.id),
      });
    }

    const status: CrossAgentAuditResult["status"] =
      conflicts.length > 0
        ? "conflicts"
        : checks.some((c) => c.status === "warn")
          ? "warnings"
          : "ok";
    const result: CrossAgentAuditResult = { ok: true, status, checks, conflicts };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("cross_agent_audit").insert({
      case_id: args.caseId,
      user_id: args.userId,
      report_version: args.reportVersion ?? null,
      checks,
      conflicts,
      status,
    });

    return result;
  } catch {
    return benign;
  }
}
