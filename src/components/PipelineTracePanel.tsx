import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPipelineTrace, type PipelineTraceEntry } from "@/lib/pipeline-trace.functions";
import { useI18n } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Copy,
  Pause,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Live Debug Mode — streams `pipeline_trace` rows for one case so an operator
 * can watch upload → queue → worker → stage → engine → AI → DB writes in real
 * time and see exactly which step failed, with the provider, model, timing and
 * database error attached.
 */

const PHASES = ["upload", "queue", "worker", "pipeline", "stage", "engine", "ai", "db"] as const;

type TraceDetail = Record<string, unknown>;

function parseDetail(row: PipelineTraceEntry): TraceDetail {
  if (!row.detail || row.detail === "{}") return {};
  try {
    const parsed = JSON.parse(row.detail);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function includes429(row: PipelineTraceEntry): boolean {
  return /HTTP 429|too many requests|rate.?limit|quota/i.test(`${row.error ?? ""} ${row.detail ?? ""}`);
}

function statusTone(status: string): string {
  switch (status) {
    case "error":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "warn":
      return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    case "ok":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "start":
      return "border-primary/40 bg-primary/10 text-primary";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function TraceRow({ row }: { row: PipelineTraceEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!row.detail && row.detail !== "{}";
  const time = new Date(row.created_at).toLocaleTimeString();
  let pretty = row.detail ?? "";
  if (hasDetail) {
    try {
      pretty = JSON.stringify(JSON.parse(row.detail as string), null, 2);
    } catch {
      /* keep raw */
    }
  }
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        {hasDetail || row.error ? (
          open ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span className="w-[70px] shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {time}
        </span>
        <span
          className={cn(
            "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
            statusTone(row.status),
          )}
        >
          {row.phase}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {row.step}
        </span>
        {row.provider && (
          <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
            {row.provider}
            {row.model ? `/${row.model}` : ""}
          </span>
        )}
        {row.duration_ms != null && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {fmtMs(row.duration_ms)}
          </span>
        )}
      </button>
      {open && (hasDetail || row.error) && (
        <div className="space-y-2 bg-muted/30 px-3 pb-3 pl-10">
          {row.error && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-destructive/40 bg-destructive/5 p-2 font-mono text-[11px] text-destructive">
              {row.error}
            </pre>
          )}
          {hasDetail && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px] text-muted-foreground">
              {pretty}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function AuditReport({ rows }: { rows: PipelineTraceEntry[] }) {
  const { t } = useI18n();
  const audit = useMemo(() => {
    const providerRows = rows.filter((r) => r.phase === "ai" && r.step === "provider.request");
    const starts = providerRows.filter((r) => r.status === "start");
    const terminal = providerRows.filter((r) => r.status === "ok" || r.status === "error");
    const byEngine = new Map<string, number>();
    const byProvider = new Map<string, number>();
    const callHashes = new Map<string, number>();
    let retries = 0;
    let responses429 = 0;
    for (const row of starts) {
      const detail = parseDetail(row);
      const engine = typeof detail.engine === "string" && detail.engine ? detail.engine : t("trace.audit.unknown");
      const provider = row.provider ?? t("trace.audit.unknown");
      byEngine.set(engine, (byEngine.get(engine) ?? 0) + 1);
      byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
      const hash = typeof detail.prompt_sha256 === "string" ? detail.prompt_sha256 : null;
      if (hash) callHashes.set(`${provider}:${row.model ?? ""}:${hash}`, (callHashes.get(`${provider}:${row.model ?? ""}:${hash}`) ?? 0) + 1);
    }
    for (const row of terminal) {
      if (includes429(row)) responses429++;
    }
    for (const row of rows) {
      const detail = parseDetail(row);
      const n = typeof detail.retries === "number" ? detail.retries : 0;
      retries += n;
    }
    const duplicateRequests = Array.from(callHashes.values()).reduce((sum, n) => sum + Math.max(0, n - 1), 0);
    let maxConcurrent = 0;
    let active = 0;
    for (const row of providerRows.slice().sort((a, b) => a.id - b.id)) {
      if (row.status === "start") active++;
      if (row.status === "ok" || row.status === "error") active = Math.max(0, active - 1);
      maxConcurrent = Math.max(maxConcurrent, active);
    }
    const engineRows = Array.from(byEngine.entries()).sort((a, b) => b[1] - a[1]);
    const providerRowsSummary = Array.from(byProvider.entries()).sort((a, b) => b[1] - a[1]);
    return { total: starts.length, engineRows, providerRowsSummary, maxConcurrent, retries, duplicateRequests, responses429 };
  }, [rows, t]);

  return (
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        <BarChart3 className="h-3.5 w-3.5 text-primary" />
        {t("trace.audit.title")}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          [t("trace.audit.total"), audit.total],
          [t("trace.audit.concurrent"), audit.maxConcurrent],
          [t("trace.audit.retries"), audit.retries],
          [t("trace.audit.duplicates"), audit.duplicateRequests],
          [t("trace.audit.rateLimits"), audit.responses429],
          [t("trace.audit.providers"), audit.providerRowsSummary.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded border border-border bg-background px-2 py-1.5">
            <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
            <div className="font-mono text-sm font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-border bg-background p-2">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">{t("trace.audit.byEngine")}</div>
          {audit.engineRows.length ? audit.engineRows.slice(0, 8).map(([engine, count]) => (
            <div key={engine} className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]">
              <span className="truncate text-foreground">{engine}</span>
              <span className="text-muted-foreground">{count}</span>
            </div>
          )) : <div className="text-[11px] text-muted-foreground">{t("trace.audit.none")}</div>}
        </div>
        <div className="rounded border border-border bg-background p-2">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">{t("trace.audit.byProvider")}</div>
          {audit.providerRowsSummary.length ? audit.providerRowsSummary.map(([provider, count]) => (
            <div key={provider} className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]">
              <span className="truncate text-foreground">{provider}</span>
              <span className="text-muted-foreground">{count}</span>
            </div>
          )) : <div className="text-[11px] text-muted-foreground">{t("trace.audit.none")}</div>}
        </div>
      </div>
    </div>
  );
}

export function PipelineTracePanel({
  caseId,
  isProcessing,
}: {
  caseId: string;
  isProcessing?: boolean;
}) {
  const { t } = useI18n();
  const fetchTrace = useServerFn(getPipelineTrace);
  const [rows, setRows] = useState<PipelineTraceEntry[]>([]);
  const [live, setLive] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [phase, setPhase] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sinceId = useRef(0);
  const seen = useRef<Set<number>>(new Set());

  const load = useCallback(
    async (incremental: boolean) => {
      setLoading(true);
      try {
        const res = await fetchTrace({
          data: {
            caseId,
            ...(incremental && sinceId.current ? { sinceId: sinceId.current } : {}),
            limit: 300,
          },
        });
        const incoming = (res.rows ?? []) as PipelineTraceEntry[];
        if (!incremental) {
          seen.current = new Set(incoming.map((r) => r.id));
          setRows(incoming);
        } else if (incoming.length) {
          const fresh = incoming.filter((r) => !seen.current.has(r.id));
          fresh.forEach((r) => seen.current.add(r.id));
          if (fresh.length) setRows((prev) => [...prev, ...fresh].slice(-1000));
        }
        if (incoming.length) sinceId.current = Math.max(sinceId.current, res.maxId ?? 0);
      } catch (e) {
        console.warn("[trace] fetch failed", e);
      } finally {
        setLoading(false);
      }
    },
    [caseId, fetchTrace],
  );

  useEffect(() => {
    sinceId.current = 0;
    seen.current = new Set();
    setRows([]);
    void load(false);
  }, [caseId, load]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void load(true), isProcessing ? 2000 : 6000);
    return () => clearInterval(id);
  }, [live, isProcessing, load]);

  const filtered = useMemo(() => {
    let out = rows;
    if (phase !== "all") out = out.filter((r) => r.phase === phase);
    if (errorsOnly) out = out.filter((r) => r.status === "error" || r.status === "warn");
    return out;
  }, [rows, phase, errorsOnly]);

  const errorCount = rows.filter((r) => r.status === "error").length;
  const warnCount = rows.filter((r) => r.status === "warn").length;
  const visible = expanded ? filtered : filtered.slice(-40);

  const copyAll = () => {
    const text = rows
      .map(
        (r) =>
          `${r.created_at} [${r.phase}/${r.status}] ${r.step}` +
          (r.provider ? ` provider=${r.provider}${r.model ? `/${r.model}` : ""}` : "") +
          (r.duration_ms != null ? ` ms=${r.duration_ms}` : "") +
          (r.error ? `\n  ERROR: ${r.error}` : "") +
          (r.detail && r.detail !== "{}" ? `\n  ${r.detail}` : ""),
      )
      .join("\n");
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("trace.copied")),
      () => toast.error(t("trace.copyFailed")),
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Activity
          className={cn(
            "h-4 w-4",
            live && isProcessing ? "animate-pulse text-primary" : "text-muted-foreground",
          )}
        />
        <h3 className="text-sm font-semibold">{t("trace.title")}</h3>
        <Badge variant="outline" className="font-mono text-[10px]">
          {rows.length}
        </Badge>
        {errorCount > 0 && (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <XCircle className="h-3 w-3" />
            {errorCount}
          </Badge>
        )}
        {warnCount > 0 && (
          <Badge variant="outline" className="gap-1 border-amber-500/40 text-[10px] text-amber-500">
            <AlertTriangle className="h-3 w-3" />
            {warnCount}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={errorsOnly ? "default" : "outline"}
            onClick={() => setErrorsOnly((v) => !v)}
          >
            {t("trace.errorsOnly")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLive((v) => !v)}>
            {live ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
            {live ? t("trace.pause") : t("trace.resume")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load(false)} disabled={loading}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} />
            {t("trace.refresh")}
          </Button>
          <Button size="sm" variant="outline" onClick={copyAll} disabled={rows.length === 0}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            {t("trace.copy")}
          </Button>
        </div>
      </div>

      <AuditReport rows={rows} />

      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={() => setPhase("all")}
          className={cn(
            "rounded border px-2 py-0.5 font-mono text-[10px] uppercase",
            phase === "all"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground",
          )}
        >
          {t("trace.all")}
        </button>
        {PHASES.map((p) => {
          const n = rows.filter((r) => r.phase === p).length;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPhase(p)}
              className={cn(
                "rounded border px-2 py-0.5 font-mono text-[10px] uppercase",
                phase === p
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground",
                n === 0 && "opacity-40",
              )}
            >
              {t(`trace.phase.${p}`)} {n > 0 ? n : ""}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("trace.empty")}</p>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {filtered.length > visible.length && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full border-b border-border px-3 py-2 text-center text-[11px] text-muted-foreground hover:bg-muted/40"
            >
              {t("trace.showAll")} ({filtered.length})
            </button>
          )}
          {visible.map((r) => (
            <TraceRow key={r.id} row={r} />
          ))}
        </div>
      )}
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {t("trace.hint")}
      </p>
    </Card>
  );
}
