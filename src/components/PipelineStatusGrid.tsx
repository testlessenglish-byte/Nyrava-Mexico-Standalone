// Reads from the canonical execution hook — no local subscriptions, no
// hardcoded stage list, no timestamp fallbacks. Every panel that shows
// pipeline status renders identically because they all consume the same
// hook.
import type { Database } from "@/integrations/supabase/types";
import { useCaseExecution } from "@/hooks/useCaseExecution";
import type { StageState } from "@/lib/execution/canonical";

function tone(state: StageState) {
  switch (state) {
    case "complete": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "running":  return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 animate-pulse";
    case "failed":   return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
    case "blocked":  return "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300";
    case "waiting":  return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "skipped":  return "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300";
    default:         return "border-border bg-muted text-muted-foreground";
  }
}

function label(state: StageState) {
  switch (state) {
    case "complete": return "Complete";
    case "running":  return "Running";
    case "failed":   return "Failed";
    case "blocked":  return "Blocked";
    case "waiting":  return "Waiting";
    case "skipped":  return "Skipped";
    default:         return "Locked";
  }
}

type Case = Database["public"]["Tables"]["cases"]["Row"];

export function PipelineStatusGrid({ caseRow }: { caseRow: Case; runs?: unknown }) {
  const { stages } = useCaseExecution(caseRow.id);
  // Hide the parallel multi-agent stage from the primary pipeline grid.
  const displayStages = stages.filter((s) => s.key !== "multi_agent");

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pipeline Status
        </h2>
        <span className="text-xs text-muted-foreground">
          Canonical execution state.
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {displayStages.map((s, i) => (
          <li
            key={s.key}
            className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${tone(s.state)}`}
          >
            <span className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-semibold tabular-nums">
                {i + 1}
              </span>
              <span className="font-medium">{s.label}</span>
            </span>
            <span className="text-xs uppercase tracking-wide">{label(s.state)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
