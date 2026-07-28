// Parity verification — proves every consumer module sees identical
// canonical counts from a single report row. Renders a green badge when
// every count matches what canonical helpers return, otherwise lists the
// exact divergences.
//
// Since every module is required to read via canonical helpers, parity
// can only fail when a module bypasses them. This badge surfaces the
// failure immediately so regression is visible during development.

import { useMemo } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import {
  getCanonicalCounts,
  paritySignature,
  type CanonicalCounts,
  type ReportLike,
} from "@/lib/intelligence/canonical";

export type ModuleProjection = {
  module: string;
  counts: Partial<CanonicalCounts>;
};

export function ParityBadge({
  report,
  projections,
}: {
  report: ReportLike;
  /**
   * Optional projections from other modules. If omitted, the badge simply
   * surfaces canonical counts + signature. Pass projections from
   * Dashboard/Evidence/Timeline/Witness/etc. to force a hard parity check.
   */
  projections?: ModuleProjection[];
}) {
  const canonical = useMemo(() => getCanonicalCounts(report), [report]);
  const signature = useMemo(() => paritySignature(report), [report]);

  const mismatches = useMemo(() => {
    if (!projections || projections.length === 0) return [];
    const out: Array<{ module: string; key: keyof CanonicalCounts; expected: number; got: number }> = [];
    for (const p of projections) {
      for (const k of Object.keys(p.counts) as Array<keyof CanonicalCounts>) {
        const expected = canonical[k];
        const got = p.counts[k] ?? 0;
        if (expected !== got) out.push({ module: p.module, key: k, expected, got });
      }
    }
    return out;
  }, [projections, canonical]);

  const verified = mismatches.length === 0;

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {verified ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-500" />
          )}
          <span className={"font-semibold " + (verified ? "text-emerald-300" : "text-red-300")}>
            {verified ? "PARITY VERIFIED" : "PARITY FAILED"}
          </span>
          <span className="text-muted-foreground">· {projections?.length ?? 0} module{(projections?.length ?? 0) === 1 ? "" : "s"} checked</span>
        </div>
        <code className="hidden sm:inline truncate text-[10px] text-muted-foreground">{signature}</code>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <Count label="Findings" value={canonical.findings} />
        <Count label="Contradictions" value={canonical.contradictions} />
        <Count label="Disputed" value={canonical.disputed_issues} />
        <Count label="Missing Evidence" value={canonical.missing_evidence} />
        <Count label="Timeline" value={canonical.timeline_events} />
        <Count label="Witnesses" value={canonical.witnesses} />
        <Count label="Strategies" value={canonical.strategies} />
        <Count label="Opportunities" value={canonical.opportunities} />
        <Count label="Motions" value={canonical.motions} />
        <Count label="Evidence" value={canonical.evidence} />
        <Count label="Theories" value={canonical.theories} />
        <Count label="Constitutional" value={canonical.constitutional} />
      </div>

      {!verified && (
        <ul className="mt-3 space-y-1 rounded bg-red-500/10 p-2 text-red-300">
          {mismatches.map((m, i) => (
            <li key={i}>
              <span className="font-semibold">{m.module}</span>: <code>{m.key}</code> = {m.got} (canonical = {m.expected})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  );
}

export default ParityBadge;
