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

// Status text color only — the card itself stays a uniform, consistent
// background for every tile (matching how BigMetric colors just the number,
// not the whole card). Tinting every tile's background per-status was what
// made the grid look inconsistent and low-contrast (especially "skipped"
// tiles, which read as a random washed-out green instead of a neutral,
// clearly-secondary state).
function toneText(state: StageState) {
  switch (state) {
    case "complete": return "text-success";
    case "running":  return "text-primary";
    case "failed":   return "text-destructive";
    case "blocked":  return "text-warning";
    case "waiting":  return "text-warning";
    case "skipped":  return "text-muted-foreground";
    default:         return "text-muted-foreground";
  }
}

function toneRing(state: StageState) {
  switch (state) {
    case "complete": return "border-success/30";
    case "running":  return "border-primary/40 animate-pulse";
    case "failed":   return "border-destructive/40";
    case "blocked":  return "border-warning/30";
    case "waiting":  return "border-warning/30";
    default:         return "border-border";
  }
}

type Case = Database["public"]["Tables"]["cases"]["Row"];

export function PipelineStatusGrid({ caseRow }: { caseRow: Case; runs?: unknown }) {
  const { t } = useI18n();
  const { stages } = useCaseExecution(caseRow.id);
  const caseType = (caseRow as { case_type?: string | null }).case_type ?? null;
  const caseName = (caseRow as { name?: string | null }).name ?? null;
  // Show every stage that is legally relevant for this materia, including the
  // 13-agent run that closes the pipeline after the report.
  const displayStages = stages.filter((s) => isStageRelevantForCaseType(caseType, s.key, caseName));

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
              className={`flex flex-col gap-1 rounded-md border bg-secondary/40 px-3 py-2 text-sm ${toneRing(s.state)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-semibold tabular-nums ${toneText(s.state)}`}
                  >
                    {i + 1}
                  </span>
                  <span className="font-medium text-foreground">{t(stageLabelKey(s.key, caseType))}</span>
                </span>
                <span className={`text-xs font-semibold uppercase tracking-wide ${toneText(s.state)}`}>
                  {t(statusLabelKey(s.state))}
                </span>
              </div>
              {detail ? (
                <p className="pl-7 text-xs leading-snug text-muted-foreground" title={detail}>
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
