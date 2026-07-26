// Reads from the canonical execution hook — no local subscriptions, no
// hardcoded stage list, no timestamp fallbacks. Every panel that shows
// pipeline status renders identically because they all consume the same
// hook.
//
// Labels and statuses are jurisdiction-aware: stage names come from the
// Mexican pipeline profile for the case's materia (src/lib/execution/mx-pipeline)
// and are rendered through i18n, and stages that are not legally relevant for
// that materia are not shown at all.
import type { Database } from "@/integrations/supabase/types";
import { useCaseExecution } from "@/hooks/useCaseExecution";
import type { StageState } from "@/lib/execution/canonical";
import { isStageRelevantForCaseType, stageLabelKey, statusLabelKey } from "@/lib/execution/mx-pipeline";
import { useI18n } from "@/i18n";

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

type Case = Database["public"]["Tables"]["cases"]["Row"];

export function PipelineStatusGrid({ caseRow }: { caseRow: Case; runs?: unknown }) {
  const { t } = useI18n();
  const { stages } = useCaseExecution(caseRow.id);
  const caseType = (caseRow as { case_type?: string | null }).case_type ?? null;
  // Hide the parallel multi-agent stage from the primary pipeline grid, plus
  // any stage that isn't legally relevant for this materia.
  const displayStages = stages.filter((s) => s.key !== "multi_agent" && isStageRelevantForCaseType(caseType, s.key));

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("pipeline.grid.title")}
        </h2>
        <span className="text-xs text-muted-foreground">{t("pipeline.grid.subtitle")}</span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {displayStages.map((s, i) => {
          // "OMITIDO" on its own tells the attorney nothing. The ledger row
          // carries the reason the stage was skipped (or blocked/failed);
          // render it under the label so the grid explains itself.
          const detail =
            s.state === "skipped"
              ? (s.row?.skipped_reason ?? null)
              : s.state === "blocked" || s.state === "failed"
                ? (s.row?.error ?? null)
                : null;
          return (
            <li
              key={s.key}
              className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm ${tone(s.state)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="font-medium">{t(stageLabelKey(s.key, caseType))}</span>
                </span>
                <span className="text-xs uppercase tracking-wide">{t(statusLabelKey(s.state))}</span>
              </div>
              {detail ? (
                <p className="pl-7 text-xs leading-snug opacity-80" title={detail}>
                  {detail.length > 160 ? `${detail.slice(0, 160)}…` : detail}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
