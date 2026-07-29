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
  witnessIntel: { categoryKey: "witness" },
} as const;

async function countFindings(
  db: Db,
  caseId: string,
  opts: { modulePrefix?: string; categoryKey?: string },
): Promise<number> {
  let q = db.from("case_findings").select("id", { count: "exact", head: true }).eq("case_id", caseId);
  if (opts.modulePrefix) q = q.like("source_module", `${opts.modulePrefix}%`);
  if (opts.categoryKey) q = q.eq("category_key", opts.categoryKey);
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

export async function deriveContradictions(db: Db, caseId: string) {
  const n = await countFindings(db, caseId, DERIVED_ENGINE_SOURCES.contradictions);
  return {
    value: { derived_from: "analyzers", contradictions: n },
    stats: { generated: n, accepted: n },
  };
}

export async function deriveDiscoveryGaps(db: Db, caseId: string) {
  const n = await countFindings(db, caseId, DERIVED_ENGINE_SOURCES.discoveryGaps);
  return {
    value: { derived_from: "analyzers", missing_evidence: n },
    stats: { generated: n, accepted: n },
  };
}

export async function deriveEvidenceIntel(db: Db, caseId: string) {
  const n = await countFindings(db, caseId, DERIVED_ENGINE_SOURCES.evidenceIntel);
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
  return {
    value: { derived_from: "agents.witness_credibility", witnesses: n },
    stats: { generated: n, accepted: n },
  };
}
