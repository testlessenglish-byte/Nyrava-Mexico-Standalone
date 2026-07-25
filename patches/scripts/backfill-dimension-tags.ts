// One-off backfill: compute and write dimension tags for every existing
// case_findings row across every case that has ever run — not just new
// findings going forward.
//
// Deliberately reuses computeDimensionTags() from dimension-map.server.ts
// rather than reimplementing the mapping rules in SQL. Two implementations
// of the same taxonomy is exactly the drift that caused the original bug
// (classify.server.ts vs scoring.server.ts diverging silently) — this
// script guarantees the backfill and the live write-path always agree,
// because they call the literal same function.
//
// Usage:
//   npx tsx patches/scripts/backfill-dimension-tags.ts            # dry run, prints a summary
//   npx tsx patches/scripts/backfill-dimension-tags.ts --apply    # writes changes
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
// (same as any other server script in this repo).
//
// NOTE: import path below points at src/lib/intelligence/dimension-map.server.ts
// (where that file actually lives in this repo), not a sibling "../dimension-map.server"
// — this file lives at patches/scripts/, two levels up from src/.

import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
import { computeDimensionTags, isDimensionTag } from "../../src/lib/intelligence/dimension-map.server";

const APPLY = process.argv.includes("--apply");
const PAGE_SIZE = 500;

type Row = { id: string; case_id: string; title: string | null; description: string | null; tags: string[] | null };

async function main() {
  let from = 0;
  let scanned = 0;
  let needsUpdate = 0;
  let updated = 0;
  const byCase = new Map<string, { total: number; changed: number }>();

  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("case_findings")
      .select("id,case_id,title,description,tags")
      .range(from, from + PAGE_SIZE - 1)
      .order("id");
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as Row[]) {
      scanned++;
      const existing = row.tags ?? [];
      const computed = computeDimensionTags(row);
      const existingDims = existing.filter(isDimensionTag);
      const same =
        existingDims.length === computed.length && computed.every((t) => existingDims.includes(t));

      const caseStats = byCase.get(row.case_id) ?? { total: 0, changed: 0 };
      caseStats.total++;

      if (!same) {
        needsUpdate++;
        caseStats.changed++;
        const nextTags = [...new Set([...existing.filter((t) => !isDimensionTag(t)), ...computed])];
        if (APPLY) {
          const { error: updErr } = await supabaseAdmin
            .from("case_findings")
            .update({ tags: nextTags })
            .eq("id", row.id);
          if (updErr) {
            console.error(`[backfill] failed to update finding ${row.id}:`, updErr.message);
          } else {
            updated++;
          }
        }
      }
      byCase.set(row.case_id, caseStats);
    }

    from += PAGE_SIZE;
  }

  console.log(`\nScanned ${scanned} findings across ${byCase.size} cases.`);
  console.log(`${needsUpdate} findings needed a dimension-tag update.`);
  if (APPLY) {
    console.log(`${updated} findings updated.`);
  } else {
    console.log(`Dry run — no writes made. Re-run with --apply to write changes.`);
  }

  const worst = [...byCase.entries()]
    .filter(([, s]) => s.changed > 0)
    .sort((a, b) => b[1].changed - a[1].changed)
    .slice(0, 20);
  if (worst.length) {
    console.log(`\nTop cases by findings needing update:`);
    for (const [caseId, s] of worst) {
      console.log(`  ${caseId}: ${s.changed}/${s.total} findings`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
