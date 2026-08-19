// Derived no-op engines.
//
// The Analyzers stage already produces contradictions, missing_evidence, and
// procedural (evidence intelligence) findings in one batched, merged, grounded
// LLM pass and writes them to case_findings under source_module = "analyzer:*".
// The Agents stage's witness_credibility sub-agent already produces witness
// findings under category_key = "witness".
//
// Prior to this file, four "standalone" engines (contradictions,
// discovery_gaps, evidence_intelligence, witness_intelligence) re-derived the
// same categories with independent, un-batched LLM calls — duplicate work
// that also blew the 30K TPM cap on any moderately large case (413s).
//
// These functions replace those calls: no LLM, just count what Analyzers /
// Agents already produced, and return the same shape (`{ value, stats }`) the
// prior engines returned so `runEngine(...)` continues to record real
// generated/accepted numbers in `pipeline_engine_runs`.
//
// IMPORTANT: these helpers are used by BOTH the automatic pipeline and the
// manual per-engine rerun buttons. A manual rerun happens after a report may
// already have been released. Any upstream intelligence rerun therefore must
// invalidate report/gate artifacts that were assembled from the previous
// snapshot. Otherwise the UI can show a clean current engine result while the
// PDF/JSON continues serving an older contradiction/missing-evidence count.
//
// NOTE (category_key fix): `category` on case_findings holds the localized,
// human-facing label (Spanish for MX cases, e.g. "Testimonio de Testigo") —
// it must never be used for internal filtering. `category_key` holds the
// fixed, locale-independent machine token ("witness", "contradiction", etc.)
// and is what every derive*() below must match against.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

// Shared source-of-truth for the source_module prefixes / category_key this
// file counts against. Kept here (not re-typed inline at each call site) so a
// rename in the Analyzers/Agents stage that writes these values can't
// silently desync from what this file matches against — a mismatch here
// previously would have shown up only as "findings count = 0" with nothing
// distinguishing it from a real zero.
export const DERIVED_ENGINE_SOURCES = {
  contradictions: { modulePrefix: "analyzer:contradiction" },
  discoveryGaps: { modulePrefix: "analyzer:missing" },
  evidenceIntel: { modulePrefix: "analyzer:procedural" },
  // Witness findings come from the Agents stage. Historically only
  // `category_key='witness'` was matched, but the agent writes rows with a
  // NULL category_key and `source_module='agent:witness_credibility'`, so the
  // witness engine reported 0 on cases that had hundreds of witness findings.
  witnessIntel: { categoryKey: "witness", modulePrefix: "agent:witness_credibility" },
} as const;

async function countFindings(
  db: Db,
  caseId: string,
  opts: { modulePrefix?: string; categoryKey?: string },
): Promise<number> {
  let q = db.from("case_findings").select("id", { count: "exact", head: true }).eq("case_id", caseId);
  // When both are supplied they are alternatives (OR), not a conjunction: a
  // finding qualifies if the producing module matches OR it was categorized.
  if (opts.modulePrefix && opts.categoryKey) {
    q = q.or(`source_module.like.${opts.modulePrefix}%,category_key.eq.${opts.categoryKey}`);
  } else if (opts.modulePrefix) {
    q = q.like("source_module", `${opts.modulePrefix}%`);
  } else if (opts.categoryKey) {
    q = q.eq("category_key", opts.categoryKey);
  }
  const { count, error } = await q;
  // A query failure ("0 findings because the DB errored") must not look
  // identical to "0 findings because the case genuinely has none" — these
  // counts feed pipeline_engine_runs and downstream reporting, and a
  // silently-swallowed error previously understated case findings instead
  // of surfacing as a failed engine run. Throw so the caller (runEngine)
  // records a real `failed` row instead of a false "generated: 0, accepted: 0".
  if (error) {
    throw new Error(
      `countFindings failed (case=${caseId}, modulePrefix=${opts.modulePrefix ?? "-"}, categoryKey=${opts.categoryKey ?? "-"}): ${error.message}`,
    );
  }
  return count ?? 0;
}

/**
 * Invalidate every downstream artifact that can legally depend on a derived
 * analyzer/agent result. This is deliberately idempotent and safe during the
 * normal pipeline: before report generation these tables are empty anyway.
 * On a manual rerun after release, it prevents an old report/canonical mirror
 * or old hallucination/QA result from surviving beside the new engine state.
 */
async function invalidateDownstreamSnapshot(db: Db, caseId: string, source: string): Promise<void> {
  const derivedTables = ["report_versions", "canonical_analysis", "reports"] as const;
  for (const table of derivedTables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from(table).delete().eq("case_id", caseId);
    if (error) {
      throw new Error(`[${source}] failed invalidating ${table}: ${error.message}`);
    }
  }

  // shared_brief is a cached upstream snapshot. It previously survived a
  // manual contradiction/derived-engine rerun and could re-inject an older
  // contradiction into later report assembly even when case_findings was
  // currently clean. Clear it together with every report/release gate field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow, error: readError } = await (db as any)
    .from("cases")
    .select("status")
    .eq("id", caseId)
    .maybeSingle();
  if (readError) throw new Error(`[${source}] failed reading case state: ${readError.message}`);

  const currentStatus = String(caseRow?.status ?? "");
  const terminal = new Set(["released", "complete", "needs_revision"]);
  const patch: Record<string, unknown> = {
    report_at: null,
    hallucination_at: null,
    completed_at: null,
    shared_brief: null,
    shared_brief_at: null,
    hallucination_report: null,
    legal_qa_report: null,
    report_checkpoint_count: 0,
  };
  if (terminal.has(currentStatus)) {
    patch.status = "needs_revision";
    patch.status_message = "Upstream intelligence changed; regenerate report and verification gates";
    patch.progress = 90;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (db as any).from("cases").update(patch).eq("id", caseId);
  if (updateError) {
    throw new Error(`[${source}] failed invalidating case report state: ${updateError.message}`);
  }
}

export async function deriveContradictions(db: Db, caseId: string) {
  const n = await countFindings(db, caseId, DERIVED_ENGINE_SOURCES.contradictions);
  await invalidateDownstreamSnapshot(db, caseId, "deriveContradictions");
  return {
    value: { derived_from: "analyzers", contradictions: n },
    stats: { generated: n, accepted: n },
  };
}

export async function deriveDiscoveryGaps(db: Db, caseId: string) {
  const n = await countFindings(db, caseId, DERIVED_ENGINE_SOURCES.discoveryGaps);
  await invalidateDownstreamSnapshot(db, caseId, "deriveDiscoveryGaps");
  return {
    value: { derived_from: "analyzers", missing_evidence: n },
    stats: { generated: n, accepted: n },
  };
}

export async function deriveEvidenceIntel(db: Db, caseId: string) {
  const n = await countFindings(db, caseId, DERIVED_ENGINE_SOURCES.evidenceIntel);
  await invalidateDownstreamSnapshot(db, caseId, "deriveEvidenceIntel");
  return {
    value: { derived_from: "analyzers", procedural_issues: n },
    stats: { generated: n, accepted: n },
  };
}

export async function deriveWitnessIntel(db: Db, caseId: string) {
  // Agents' witness_credibility sub-agent writes findings with
  // category_key='witness' via the AGENTS pipeline. Count those instead of
  // re-running an LLM sweep.
  const n = await countFindings(db, caseId, DERIVED_ENGINE_SOURCES.witnessIntel);
  await invalidateDownstreamSnapshot(db, caseId, "deriveWitnessIntel");
  return {
    value: { derived_from: "agents.witness_credibility", witnesses: n },
    stats: { generated: n, accepted: n },
  };
}
