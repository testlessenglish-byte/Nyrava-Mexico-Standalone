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
        <span className="w-[70px] shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{time}</span>
        <span
          className={cn(
            "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
            statusTone(row.status),
          )}
        >
          {row.phase}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{row.step}</span>
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

export function PipelineTracePanel({ caseId, isProcessing }: { caseId: string; isProcessing?: boolean }) {
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
          data: { caseId, ...(incremental && sinceId.current ? { sinceId: sinceId.current } : {}), limit: 300 },
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
        <Activity className={cn("h-4 w-4", live && isProcessing ? "animate-pulse text-primary" : "text-muted-foreground")} />
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
          <Button size="sm" variant={errorsOnly ? "default" : "outline"} onClick={() => setErrorsOnly((v) => !v)}>
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

      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={() => setPhase("all")}
          className={cn(
            "rounded border px-2 py-0.5 font-mono text-[10px] uppercase",
            phase === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
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
                phase === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground",
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
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">{t("trace.hint")}</p>
    </Card>
  );
}
