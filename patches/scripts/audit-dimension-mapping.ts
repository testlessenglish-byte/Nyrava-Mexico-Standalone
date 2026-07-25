// Cross-case audit: catches the "finding exists, dimension didn't move"
// class of bug across every case that has ever run — not just the one
// benchmark case that surfaced it.
//
// Three independent checks per case, each targeting one of the three
// confirmed bugs:
//
//   1. DEAD_MAPPING — a dimension shows 0 contributors, but the case has
//      findings whose CONTENT (per computeDimensionTags, run fresh here)
//      clearly belongs to that dimension. This is Bug A/B's signature:
//      the finding exists, the content is on-topic, the mapping just
//      never landed.
//
//   2. GROUNDING_BLACKOUT — an agent generated findings (agent_findings.
//      findings has entries) but zero of them made it into case_findings
//      under that agent's source_module. This is Bug C's signature: a
//      dimension reading "clean" that's actually "unverifiable."
//
//   3. DUPLICATE_CANONICAL — two findings in the same case, mapped to the
//      same dimension, with near-identical titles and identical severity/
//      confidence, both counted as separate -25 (or whatever) contributors.
//      This is the double-count bug spotted in the original benchmark
//      report ("Unverified Overnight Custody Gap" + "Overnight Evidence
//      Custody Gap" both critical -25 under the same dimension).
//
// Usage:
//   npx tsx patches/scripts/audit-dimension-mapping.ts                 # all cases
//   npx tsx patches/scripts/audit-dimension-mapping.ts --case=<uuid>   # one case
//   npx tsx patches/scripts/audit-dimension-mapping.ts --ci            # exit(1) on any finding, for release-gate wiring
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
//
// NOTE: import path below points at src/lib/intelligence/dimension-map.server.ts
// (where that file actually lives in this repo), not a sibling "../dimension-map.server"
// — this file lives at patches/scripts/, two levels up from src/.

import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
import { computeDeterministicScorecard, applicableDimensionsFor } from "../../src/lib/intelligence/scoring.server";
import { computeDimensionTags, dimensionKeyFromTag } from "../../src/lib/intelligence/dimension-map.server";
import type { Finding } from "../../src/lib/intelligence/types";

const CI_MODE = process.argv.includes("--ci");
const ONE_CASE = process.argv.find((a) => a.startsWith("--case="))?.split("=")[1];

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Cheap similarity: normalized-title token overlap. Good enough to catch
// "Unverified Overnight Custody Gap" vs "Overnight Evidence Custody Gap"
// without pulling in a real string-distance library.
function titleOverlap(a: string, b: string): number {
  const ta = new Set(titleKey(a).split(" ").filter((w) => w.length > 3));
  const tb = new Set(titleKey(b).split(" ").filter((w) => w.length > 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter((w) => tb.has(w)).length;
  return inter / Math.min(ta.size, tb.size);
}

type Issue = {
  case_id: string;
  type: "DEAD_MAPPING" | "GROUNDING_BLACKOUT" | "DUPLICATE_CANONICAL";
  dimension?: string;
  detail: string;
};

async function auditCase(caseId: string, caseType: string | undefined): Promise<Issue[]> {
  const issues: Issue[] = [];

  const { data: findingsRaw, error: fErr } = await supabaseAdmin
    .from("case_findings")
    .select("*")
    .eq("case_id", caseId);
  if (fErr) throw fErr;
  const findings = (findingsRaw ?? []) as unknown as Finding[];
  if (findings.length === 0) return issues;

  // --- Check 1: DEAD_MAPPING ---
  const scorecard = computeDeterministicScorecard(findings, caseType);
  const applicable = applicableDimensionsFor(caseType);
  for (const dimKey of applicable) {
    const dim = scorecard.dimensions[dimKey];
    if (!dim || dim.contributor_count > 0) continue;
    // Would fresh content-based tagging assign ANY finding to this dimension?
    const onTopic = findings.filter((f) =>
      computeDimensionTags(f).some((t) => dimensionKeyFromTag(t) === dimKey),
    );
    if (onTopic.length > 0) {
      issues.push({
        case_id: caseId,
        type: "DEAD_MAPPING",
        dimension: dimKey,
        detail:
          `Dimension "${dim.dimension}" held at baseline (0 contributors) but ${onTopic.length} ` +
          `finding(s) are on-topic by content: ${onTopic.slice(0, 3).map((f) => `"${f.title}"`).join(", ")}` +
          (onTopic.length > 3 ? `, +${onTopic.length - 3} more` : ""),
      });
    }
  }

  // --- Check 2: GROUNDING_BLACKOUT ---
  const { data: agentRows, error: aErr } = await supabaseAdmin
    .from("agent_findings")
    .select("agent_type,findings")
    .eq("case_id", caseId);
  if (aErr) throw aErr;
  for (const a of agentRows ?? []) {
    const generated = Array.isArray(a.findings) ? a.findings.length : 0;
    if (generated === 0) continue;
    const persisted = findings.filter((f) => f.source_module === `agent:${a.agent_type}`).length;
    if (persisted === 0) {
      issues.push({
        case_id: caseId,
        type: "GROUNDING_BLACKOUT",
        detail:
          `Agent "${a.agent_type}" generated ${generated} finding(s) but 0 reached case_findings — ` +
          `likely dropped entirely by a grounding/citation gate. Any dimension this agent normally ` +
          `feeds will read as "clean" when it is actually "unverified."`,
      });
    }
  }

  // --- Check 3: DUPLICATE_CANONICAL ---
  const byDim = new Map<string, Finding[]>();
  for (const f of findings) {
    for (const t of computeDimensionTags(f)) {
      const key = dimensionKeyFromTag(t);
      const arr = byDim.get(key) ?? [];
      arr.push(f);
      byDim.set(key, arr);
    }
  }
  for (const [dimKey, group] of byDim.entries()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.severity !== b.severity) continue;
        if (titleOverlap(a.title, b.title) >= 0.6) {
          issues.push({
            case_id: caseId,
            type: "DUPLICATE_CANONICAL",
            dimension: dimKey,
            detail: `Possible duplicate contributors to "${dimKey}": "${a.title}" and "${b.title}" ` +
              `(both severity=${a.severity}) — verify these are distinct facts, not the same event double-counted.`,
          });
        }
      }
    }
  }

  return issues;
}

async function main() {
  let caseIds: Array<{ id: string; case_type: string | undefined }> = [];
  if (ONE_CASE) {
    const { data, error } = await supabaseAdmin.from("cases").select("id,case_type").eq("id", ONE_CASE);
    if (error) throw error;
    caseIds = (data ?? []).map((c) => ({ id: c.id, case_type: c.case_type ?? undefined }));
  } else {
    const { data, error } = await supabaseAdmin.from("cases").select("id,case_type").eq("status", "complete");
    if (error) throw error;
    caseIds = (data ?? []).map((c) => ({ id: c.id, case_type: c.case_type ?? undefined }));
  }

  console.log(`Auditing ${caseIds.length} case(s)...\n`);
  const allIssues: Issue[] = [];
  for (const c of caseIds) {
    try {
      const issues = await auditCase(c.id, c.case_type);
      allIssues.push(...issues);
    } catch (e) {
      console.error(`[audit] case ${c.id} failed:`, (e as Error).message);
    }
  }

  const byType = { DEAD_MAPPING: 0, GROUNDING_BLACKOUT: 0, DUPLICATE_CANONICAL: 0 };
  for (const i of allIssues) byType[i.type]++;

  console.log(`=== Summary ===`);
  console.log(`Cases audited:        ${caseIds.length}`);
  console.log(`Dead mappings:        ${byType.DEAD_MAPPING}`);
  console.log(`Grounding blackouts:  ${byType.GROUNDING_BLACKOUT}`);
  console.log(`Duplicate candidates: ${byType.DUPLICATE_CANONICAL}`);
  console.log(`Total issues:         ${allIssues.length}\n`);

  if (allIssues.length > 0) {
    console.log(`=== Detail ===`);
    for (const i of allIssues) {
      console.log(`[${i.type}] case=${i.case_id}${i.dimension ? ` dim=${i.dimension}` : ""}\n  ${i.detail}\n`);
    }
  }

  console.log(JSON.stringify({ audited: caseIds.length, issues: allIssues }, null, 2));

  if (CI_MODE && allIssues.length > 0) {
    console.error(`\n[audit] FAILING: ${allIssues.length} issue(s) found. Wire this into release-gate.ts as a hard gate.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
