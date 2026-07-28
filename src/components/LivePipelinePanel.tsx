// Live realtime feed of pipeline_events + pipeline_engine_runs for a case.
// Auto-opens while the case is processing, dockable side panel on desktop,
// bottom sheet on mobile.
//
// Two sections:
//   1. Pipeline Ledger (top) — one row per engine with the full audit trail
//      (status, duration, provider, tokens, findings, error). This is the
//      "trustworthy" view: it comes from pipeline_engine_runs, the single
//      source of truth for stage completion. Realtime-subscribed.
//   2. Event Stream (bottom) — chronological pipeline_events feed.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { engineLabelKey, statusLabelKey } from "@/lib/execution/mx-pipeline";
import {
  Activity,
  ChevronDown,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  MinusCircle,
  Clock,
} from "lucide-react";

type Event = {
  id: string;
  case_id: string;
  stage: string;
  level: "info" | "warn" | "error" | string;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type EngineRun = {
  id: string;
  engine: string;
  status: string;
  runtime_ms: number | null;
  generated: number | null;
  accepted: number | null;
  rejected: number | null;
  suppressed_ess: number | null;
  suppressed_validator: number | null;
  provider: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  retry_count: number | null;
  cost_usd: number | null;
  db_write_confirmed: boolean | null;
  rows_written: number | null;
  blocking_engines: string[] | null;
  error: string | null;
  skipped_reason: string | null;
  meta: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

// Stage/engine names are resolved through the Mexican pipeline profile
// (mx-pipeline.ts) + i18n, so the ledger and activity feed speak the user's
// language with terminology familiar to a Mexican attorney.


function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function fmtTokens(inn: number | null, out: number | null): string {
  const total = (inn ?? 0) + (out ?? 0);
  if (total === 0) return "—";
  if (total < 1000) return `${total}`;
  return `${(total / 1000).toFixed(1)}k`;
}

function statusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case "failed":
      return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    case "blocked":
      return <ShieldAlert className="h-3.5 w-3.5 text-orange-500" />;
    case "skipped":
      return <MinusCircle className="h-3.5 w-3.5 text-slate-400" />;
    case "queued":
      return <Clock className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />;
  }
}

export function LivePipelinePanel({
  caseId,
  isProcessing,
  caseType,
}: {
  caseId: string;
  isProcessing: boolean;
  /** cases.case_type — drives Mexican materia-aware engine names. */
  caseType?: string | null;
}) {
  const { t } = useI18n();
  // Localized engine name; unknown engines fall back to their raw name.
  const engineName = (engine: string) => {
    const key = engineLabelKey(engine, caseType);
    return key ? t(key) : engine;
  };
  const statusText = (status: string) => {
    const label = t(statusLabelKey(status));
    return label === statusLabelKey(status) ? status : label;
  };
  const [events, setEvents] = useState<Event[]>([]);
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [open, setOpen] = useState<boolean>(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const userClosedRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const wasProcessingRef = useRef(false);
  const fetchLatestRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Auto-open when processing kicks off, unless user explicitly closed it.
  useEffect(() => {
    if (isProcessing && !userClosedRef.current) setOpen(true);
    if (!isProcessing) userClosedRef.current = false;
  }, [isProcessing]);

  // Same staleness bug as CommandCenterDashboard's activity feed: the
  // initial load below only fires once per caseId mount via its own
  // useEffect. Clicking Rerun on an already-open case page doesn't remount
  // this panel (same caseId), so nothing re-triggers that fetch — both the
  // Pipeline Ledger and Activity Feed kept showing the previous run's rows
  // indefinitely. Clear both the moment a new run starts.
  //
  // IMPORTANT: clearing alone isn't enough. The fetch effect below only
  // runs once per caseId mount, so after clearing here the panel used to
  // sit empty until a realtime INSERT/UPDATE happened to arrive — which
  // meant any false→true flicker of isProcessing (e.g. a status poll
  // briefly reporting "not processing" between engine stages) blanked the
  // panel until a full page refresh remounted it. Re-pull current state
  // from the DB immediately instead of waiting on realtime.
  useEffect(() => {
    if (isProcessing && !wasProcessingRef.current) {
      setEvents([]);
      setRuns([]);
      void fetchLatestRef.current?.();
    }
    wasProcessingRef.current = isProcessing;
  }, [isProcessing]);

  // Initial load + realtime subscription for events.
  useEffect(() => {
    let cancelled = false;

    const fetchLatest = async () => {
      const [{ data: ev }, { data: rn }] = await Promise.all([
        supabase
          .from("pipeline_events")
          .select("id,case_id,stage,level,message,meta,created_at")
          .eq("case_id", caseId)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("pipeline_engine_runs")
          .select(
            "id,engine,status,runtime_ms,generated,accepted,rejected,suppressed_ess,suppressed_validator,provider,model,tokens_in,tokens_out,retry_count,cost_usd,db_write_confirmed,rows_written,blocking_engines,error,skipped_reason,started_at,ended_at,created_at,meta",
          )
          .eq("case_id", caseId)
          .order("created_at", { ascending: true })
          .limit(500),
      ]);
      if (cancelled) return;
      if (ev) setEvents(ev as unknown as Event[]);
      if (rn) setRuns(rn as unknown as EngineRun[]);
    };
    fetchLatestRef.current = fetchLatest;

    void fetchLatest();

    const eventsChannel = supabase
      .channel(`pipeline_events:${caseId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pipeline_events", filter: `case_id=eq.${caseId}` },
        (payload) => {
          setEvents((prev) => [payload.new as unknown as Event, ...prev].slice(0, 500));
        },
      )
      .subscribe();

    const runsChannel = supabase
      .channel(`pipeline_engine_runs:${caseId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_engine_runs", filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id?: string } | undefined;
            if (!oldRow?.id) return;
            setRuns((prev) => prev.filter((r) => r.id !== oldRow.id));
            return;
          }
          setRuns((prev) => {
            const row = payload.new as unknown as EngineRun;
            if (!row?.id) return prev;
            const idx = prev.findIndex((r) => r.id === row.id);
            if (idx === -1) return [...prev, row];
            const next = prev.slice();
            next[idx] = row;
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (fetchLatestRef.current === fetchLatest) fetchLatestRef.current = undefined;
      supabase.removeChannel(eventsChannel);
      supabase.removeChannel(runsChannel);
    };
  }, [caseId]);

  // Auto-scroll to top (newest) on new event.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [events.length]);

  // Latest run per engine — pipeline_engine_runs is append-only, so pick the
  // most recent row per engine name.
  const latestRuns = useMemo(() => {
    const byEngine = new Map<string, EngineRun>();
    for (const r of runs) {
      const prev = byEngine.get(r.engine);
      if (!prev || new Date(r.created_at) >= new Date(prev.created_at)) {
        byEngine.set(r.engine, r);
      }
    }
    return Array.from(byEngine.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [runs]);

  const close = () => {
    userClosedRef.current = true;
    setOpen(false);
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed z-40 flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium shadow-lg",
          "bottom-4 right-4 md:bottom-6 md:right-6",
          isProcessing && "ring-2 ring-accent",
        )}
        aria-label="Live engine activity"
      >
        {isProcessing ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Activity className="h-4 w-4" />}
        <span>{isProcessing ? t("pipeline.launcher.running") : t("pipeline.launcher.idle")}</span>
        {latestRuns.length > 0 && (
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums">{latestRuns.length}</span>
        )}
      </button>

      {/* Backdrop on mobile only */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden" onClick={close} aria-hidden />
      )}

      {/* Panel: left dock on desktop, bottom sheet on mobile */}
      <aside
        className={cn(
          "fixed z-50 flex flex-col border border-border bg-background text-card-foreground shadow-2xl transition-transform",
          // Desktop: left side dock, wider to fit ledger columns
          "md:left-0 md:top-16 md:bottom-4 md:w-[560px] md:rounded-r-2xl md:border-l-0",
          // Mobile: bottom sheet
          "left-0 right-0 bottom-0 max-h-[85vh] rounded-t-2xl md:rounded-t-none",
          open ? "translate-y-0 md:translate-x-0" : "translate-y-full md:-translate-x-full md:translate-y-0",
        )}
        role="dialog"
        aria-label="Live pipeline activity"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : (
              <Activity className="h-4 w-4 text-muted-foreground" />
            )}
            <h2 className="text-sm font-semibold">{t("pipeline.ledger.title")}</h2>
          </div>
          <button onClick={close} className="rounded p-1 hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Ledger table */}
        <div className="border-b border-border">
          <div className="max-h-[45vh] overflow-y-auto">
            {latestRuns.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t("pipeline.ledger.empty")}</div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">{t("pipeline.col.engine")}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t("pipeline.col.status")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("pipeline.col.duration")}</th>
                    <th className="px-2 py-1.5 text-left font-medium">{t("pipeline.col.provider")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("pipeline.col.tokens")}</th>
                    <th className="px-2 py-1.5 text-right font-medium">{t("pipeline.col.findings")}</th>
                  </tr>
                </thead>
                <tbody>
                  {latestRuns.map((r) => {
                    const isExpanded = expandedRun === r.id;
                    const isFailure = r.status === "failed" || r.status === "blocked";
                    return (
                      <>
                        <tr
                          key={r.id}
                          className={cn(
                            "cursor-pointer border-t border-border/40 hover:bg-muted/40",
                            isFailure && "bg-destructive/5",
                          )}
                          onClick={() => setExpandedRun(isExpanded ? null : r.id)}
                        >
                          <td className="px-2 py-1.5 font-medium">{engineName(r.engine)}</td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center gap-1">
                              {statusIcon(r.status)}
                              <span className="text-[10px] uppercase tracking-wide">{statusText(r.status)}</span>
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                            {fmtDuration(r.runtime_ms)}
                          </td>
                          <td className="px-2 py-1.5 truncate text-muted-foreground">{r.provider ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                            {fmtTokens(r.tokens_in, r.tokens_out)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.generated ?? 0}</td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${r.id}-detail`} className="bg-muted/30">
                            <td colSpan={6} className="px-3 py-2 text-[11px]">
                              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                                {r.model && (
                                  <>
                                    <dt>Model</dt>
                                    <dd className="text-foreground">{r.model}</dd>
                                  </>
                                )}
                                {r.tokens_in != null && (
                                  <>
                                    <dt>Tokens in / out</dt>
                                    <dd className="text-foreground tabular-nums">
                                      {r.tokens_in} / {r.tokens_out ?? 0}
                                    </dd>
                                  </>
                                )}
                                {r.retry_count != null && r.retry_count > 0 && (
                                  <>
                                    <dt>Retries</dt>
                                    <dd className="text-foreground tabular-nums">{r.retry_count}</dd>
                                  </>
                                )}
                                {r.cost_usd != null && Number(r.cost_usd) > 0 && (
                                  <>
                                    <dt>Cost</dt>
                                    <dd className="text-foreground tabular-nums">${Number(r.cost_usd).toFixed(4)}</dd>
                                  </>
                                )}
                                {(r.accepted != null || r.rejected != null) && (
                                  <>
                                    <dt>Accepted / Rejected</dt>
                                    <dd className="text-foreground tabular-nums">
                                      {r.accepted ?? 0} / {r.rejected ?? 0}
                                    </dd>
                                  </>
                                )}
                                {r.suppressed_ess || r.suppressed_validator ? (
                                  <>
                                    <dt>Suppressed (ESS / validator)</dt>
                                    <dd className="text-foreground tabular-nums">
                                      {r.suppressed_ess ?? 0} / {r.suppressed_validator ?? 0}
                                    </dd>
                                  </>
                                ) : null}
                                {r.rows_written != null && (
                                  <>
                                    <dt>DB rows written</dt>
                                    <dd className="text-foreground tabular-nums">{r.rows_written}</dd>
                                  </>
                                )}
                                {r.db_write_confirmed != null && (
                                  <>
                                    <dt>DB write confirmed</dt>
                                    <dd
                                      className={
                                        r.db_write_confirmed
                                          ? "text-emerald-400"
                                          : "text-destructive"
                                      }
                                    >
                                      {r.db_write_confirmed ? "Yes" : "No"}
                                    </dd>
                                  </>
                                )}
                                {r.blocking_engines && r.blocking_engines.length > 0 && (
                                  <>
                                    <dt>Blocked by</dt>
                                    <dd className="text-orange-400">
                                      {r.blocking_engines.map(engineName).join(", ")}
                                    </dd>
                                  </>
                                )}
                                {r.started_at && (
                                  <>
                                    <dt>Started</dt>
                                    <dd className="text-foreground">{fmtTime(r.started_at)}</dd>
                                  </>
                                )}
                                {r.ended_at && (
                                  <>
                                    <dt>Ended</dt>
                                    <dd className="text-foreground">{fmtTime(r.ended_at)}</dd>
                                  </>
                                )}
                                {(() => {
                                  const t = (r as unknown as { meta?: { telemetry?: Record<string, unknown> } }).meta
                                    ?.telemetry;
                                  if (!t) return null;
                                  const ids = Array.isArray(t.provider_request_ids)
                                    ? (t.provider_request_ids as string[])
                                    : [];
                                  const fell = Array.isArray(t.fell_back_from) ? (t.fell_back_from as string[]) : [];
                                  return (
                                    <>
                                      {typeof t.total_calls === "number" && (
                                        <>
                                          <dt>Router calls</dt>
                                          <dd className="text-foreground tabular-nums">
                                            {String(t.total_calls)} ({String(t.success_calls ?? 0)} ok /{" "}
                                            {String(t.failed_calls ?? 0)} err)
                                          </dd>
                                        </>
                                      )}
                                      {typeof t.provider_latency_ms === "number" && (
                                        <>
                                          <dt>Provider latency</dt>
                                          <dd className="text-foreground tabular-nums">
                                            {fmtDuration(t.provider_latency_ms as number)}
                                          </dd>
                                        </>
                                      )}
                                      {ids.length > 0 && (
                                        <>
                                          <dt>Provider request ids</dt>
                                          <dd className="text-foreground font-mono truncate" title={ids.join(", ")}>
                                            {ids.slice(0, 2).join(", ")}
                                            {ids.length > 2 ? ` +${ids.length - 2}` : ""}
                                          </dd>
                                        </>
                                      )}
                                      {fell.length > 0 && (
                                        <>
                                          <dt>Fell back from</dt>
                                          <dd className="text-orange-400">{fell.join(", ")}</dd>
                                        </>
                                      )}
                                      {t.response_valid_json != null && (
                                        <>
                                          <dt>Response JSON valid</dt>
                                          <dd
                                            className={
                                              t.response_valid_json
                                                ? "text-emerald-400"
                                                : "text-destructive"
                                            }
                                          >
                                            {t.response_valid_json ? "Yes" : "No"}
                                          </dd>
                                        </>
                                      )}
                                      {typeof t.repair_attempts === "number" && (t.repair_attempts as number) > 0 && (
                                        <>
                                          <dt>JSON repair attempts</dt>
                                          <dd className="text-foreground tabular-nums">{String(t.repair_attempts)}</dd>
                                        </>
                                      )}
                                    </>
                                  );
                                })()}
                              </dl>

                              {r.error && (
                                <div className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
                                  {r.error}
                                </div>
                              )}
                              {r.skipped_reason && (
                                <div className="mt-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                                  {r.skipped_reason}
                                </div>
                              )}
                              {Array.isArray((r.meta as { gate_rejections?: unknown[] } | null)?.gate_rejections) &&
                                ((r.meta as { gate_rejections?: unknown[] }).gate_rejections ?? []).length > 0 && (
                                  <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px]">
                                    <div className="font-medium text-amber-300">
                                      Evidence gate rejections
                                    </div>
                                    <ul className="mt-1 space-y-1 text-muted-foreground">
                                      {(
                                        (r.meta as { gate_rejections?: Array<Record<string, unknown>> })
                                          .gate_rejections ?? []
                                      )
                                        .slice(0, 6)
                                        .map((g, i) => (
                                          <li key={i}>
                                            <span className="text-foreground">
                                              {String(g.title ?? `Opportunity ${i + 1}`)}
                                            </span>{" "}
                                            — {String(g.reason ?? "rejected")}: {String(g.detail ?? "No detail")}
                                          </li>
                                        ))}
                                    </ul>
                                  </div>
                                )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Event stream */}
        <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("pipeline.activity.title")}
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2">
          {events.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-xs text-muted-foreground">
              <Activity className="h-6 w-6 opacity-50" />
              <p>{t("pipeline.activity.empty")}</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li
                  key={e.id}
                  className={cn(
                    "rounded-md border border-border/60 px-2.5 py-2 text-[12px] leading-snug",
                    e.level === "error" && "border-destructive/40 bg-destructive/5",
                    e.level === "warn" && "border-amber-500/40 bg-amber-500/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="font-medium">{engineName(e.stage)}</span>
                    <span className="tabular-nums">{fmtTime(e.created_at)}</span>
                  </div>
                  <div className="mt-0.5 break-words text-foreground">{e.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground md:hidden">
          <button onClick={close} className="inline-flex items-center gap-1">
            <ChevronDown className="h-3 w-3" /> {t("pipeline.hide")}
          </button>
        </footer>
      </aside>
    </>
  );
}
