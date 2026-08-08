// Master pipeline panel — single source of truth for engine state.
// Reads the shared `useCaseExecution` hook (canonical execution) so every
// screen shows identical data. Adds an "out of date" state when a new
// document has been uploaded after the last completed run.
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Clock, AlertTriangle, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCaseExecution } from "@/hooks/useCaseExecution";
import { PIPELINE_STAGE_TO_ENGINE } from "@/lib/execution/canonical";
import { mxPipelineStages, stageLabelKey, statusLabelKey, resolveMxProfile } from "@/lib/execution/mx-pipeline";
import { useI18n } from "@/i18n";
import { PRACTICE_AREA_LABELS, normalizePracticeArea } from "@/lib/intelligence/practice-areas";

type EngineRow = {
  id: string;
  engine: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  runtime_ms: number | null;
  generated: number;
  accepted: number;
  rejected: number;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at?: string | null;
};

type Visual = {
  state: "pending" | "running" | "completed" | "failed" | "skipped" | "out_of_date";
  row?: {
    status: string;
    ended_at?: string | null;
    runtime_ms?: number | null;
    generated?: number | null;
    accepted?: number | null;
    rejected?: number | null;
    error?: string | null;
  };
  outOfDate?: boolean;
};

/** i18n key for a visual state — statuses render in the user's language. */
function statusKey(v: Visual): string {
  return statusLabelKey(v.state === "completed" ? "completed" : v.state);
}

function statusClass(v: Visual): string {
  switch (v.state) {
    case "completed":
      return "text-success border-success/30";
    case "running":
      return "text-primary border-primary/40";
    case "failed":
      return "text-destructive border-destructive/30";
    case "skipped":
      return "text-warning border-warning/30";
    case "out_of_date":
      return "text-warning border-warning/30";
    default:
      return "text-muted-foreground border-border/20";
  }
}

function StatusIcon({ v }: { v: Visual }) {
  if (v.state === "completed") return <CheckCircle2 className="h-4 w-4" />;
  if (v.state === "running") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (v.state === "failed") return <XCircle className="h-4 w-4" />;
  if (v.state === "skipped") return <AlertTriangle className="h-4 w-4" />;
  if (v.state === "out_of_date") return <AlertTriangle className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}

function fmtMs(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function PipelinePanel({
  caseId,
  caseStatus,
  caseRow,
}: {
  caseId: string;
  caseStatus: string | null | undefined;
  caseRow?: Record<string, unknown> | null;
}) {
  const { t } = useI18n();
  const { runs, latestByEngine } = useCaseExecution(caseId);
  // Jurisdiction-aware pipeline: the case's materia decides which engines are
  // legally relevant, and how each one is named for a Mexican attorney.
  const caseType = (caseRow?.case_type as string | undefined) ?? null;
  const stageDefs = useMemo(() => mxPipelineStages(caseType), [caseType]);
  const materiaLabel = PRACTICE_AREA_LABELS[normalizePracticeArea(caseType)];
  const rows = runs;

  const [latestDocAt, setLatestDocAt] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("documents")
        .select("created_at")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data[0]) setLatestDocAt(data[0].created_at as string);
    };
    load();
    const ch = supabase
      .channel(`pipe-docs-${caseId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "documents", filter: `case_id=eq.${caseId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [caseId]);

  const visuals = useMemo<Record<string, Visual>>(() => {
    const out: Record<string, Visual> = {};
    for (const s of stageDefs) {
      const eng = PIPELINE_STAGE_TO_ENGINE[s.key];
      const row = latestByEngine.get(eng);
      if (!row) {
        out[s.key] = { state: "pending" };
        continue;
      }
      let state: Visual["state"] =
        row.status === "completed"
          ? "completed"
          : row.status === "running"
            ? "running"
            : row.status === "failed"
              ? "failed"
              : row.status === "skipped"
                ? "skipped"
                : "pending";
      let outOfDate = false;
      if (state === "completed" && row.ended_at && latestDocAt && new Date(latestDocAt) > new Date(row.ended_at)) {
        state = "out_of_date";
        outOfDate = true;
      }
      out[s.key] = { state, row, outOfDate };
    }
    return out;
  }, [latestByEngine, latestDocAt, stageDefs]);

  const anyRunning = !!(
    caseStatus &&
    [
      "running",
      "extracting",
      "analyzing",
      "agents_running",
      "intelligence_running",
      "scoring",
      "reporting",
      "generating_report",
      "queued",
    ].includes(caseStatus)
  );

  const completedCount = stageDefs.filter((s) => visuals[s.key]?.state === "completed").length;
  const failedCount = stageDefs.filter((s) => visuals[s.key]?.state === "failed").length;
  const outOfDateCount = stageDefs.filter((s) => visuals[s.key]?.state === "out_of_date").length;

  return (
    <div className="rounded-2xl border border-primary/15 bg-background/60 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("pipeline.panel.title")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("pipeline.panel.engines", { done: completedCount, total: stageDefs.length })}
            {anyRunning && <span className="text-warning"> · {t("pipeline.panel.running")}</span>}
            {failedCount > 0 && (
              <span className="text-destructive"> · {t("pipeline.panel.failed", { n: failedCount })}</span>
            )}
            {outOfDateCount > 0 && (
              <span className="text-warning"> · {t("pipeline.panel.outOfDate", { n: outOfDateCount })}</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
            {t("pipeline.panel.profile", { materia: materiaLabel })} · {resolveMxProfile(caseType)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowLog((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/40 px-3 py-1.5 text-xs text-foreground/80 hover:bg-card/50"
          >
            <FileText className="h-3.5 w-3.5" /> {showLog ? t("pipeline.panel.hideLog") : t("pipeline.panel.showLog")}
          </button>
        </div>
      </div>

      <ol className="space-y-1.5">
        {stageDefs.map((s, i) => {
          const v = visuals[s.key];
          const row = v.row;
          return (
            <li key={s.key} className={`flex items-center gap-3 rounded-lg border bg-secondary/40 px-3 py-2 ${statusClass(v)}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-mono">
                {i + 1}
              </span>
              <StatusIcon v={v} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {t(stageLabelKey(s.key, caseType))}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider opacity-80">{t(statusKey(v))}</span>
                </div>
                {row && (
                  <div className="text-[11px] text-muted-foreground">
                    {row.status === "completed" && (
                      <>
                        {fmtMs(row.runtime_ms)}
                        {(row.generated ?? 0) > 0 && <> · gen {row.generated}</>}
                        {(row.accepted ?? 0) > 0 && <> · ok {row.accepted}</>}
                        {(row.rejected ?? 0) > 0 && <> · rej {row.rejected}</>}
                      </>
                    )}
                    {row.status === "failed" && row.error && (
                      <span className="text-destructive">{row.error.slice(0, 140)}</span>
                    )}
                    {v.outOfDate && (
                      <span className="text-warning">
                        New evidence uploaded after this ran — Rerun Case recommended
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {showLog && (
        <div className="rounded-lg border border-border/40 bg-card/60 p-3">
          <h4 className="mb-2 text-xs font-semibold text-foreground/90">{t("pipeline.panel.logTitle")}</h4>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">{t("pipeline.panel.noRuns")}</p>
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-2">{t("pipeline.col.engine")}</th>
                    <th className="py-1 pr-2">{t("pipeline.col.status")}</th>
                    <th className="py-1 pr-2">{t("pipeline.col.started")}</th>
                    <th className="py-1 pr-2">{t("pipeline.col.ended")}</th>
                    <th className="py-1 pr-2">{t("pipeline.col.duration")}</th>
                    <th className="py-1 pr-2">{t("pipeline.col.output")}</th>
                  </tr>
                </thead>
                <tbody className="text-foreground/80">
                  {rows
                    .slice()
                    .reverse()
                    .map((r) => (
                      <tr key={r.id} className="border-t border-border/60">
                        <td className="py-1 pr-2 font-mono text-foreground/90">{r.engine}</td>
                        <td
                          className={`py-1 pr-2 ${r.status === "failed" ? "text-destructive" : r.status === "completed" ? "text-success" : "text-muted-foreground"}`}
                        >
                          {r.status}
                        </td>
                        <td className="py-1 pr-2">{fmtTime(r.started_at)}</td>
                        <td className="py-1 pr-2">{fmtTime(r.ended_at)}</td>
                        <td className="py-1 pr-2">{fmtMs(r.runtime_ms)}</td>
                        <td className="py-1 pr-2 text-muted-foreground">
                          {r.error ? (
                            <span className="text-destructive">{r.error.slice(0, 120)}</span>
                          ) : (
                            `gen ${r.generated} · ok ${r.accepted} · rej ${r.rejected}`
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PipelinePanel;
