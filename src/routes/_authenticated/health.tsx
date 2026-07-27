import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAiHealth, runFailoverTest, listAiCooldowns, clearAiCooldowns, getAiErrorLog } from "@/lib/cases.functions";
import { CheckCircle2, XCircle, RefreshCw, Activity, Database, Cpu, PlayCircle, AlertTriangle, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/health")({
  component: HealthPage,
  head: () => ({ meta: [{ title: "System Health · Nyrava" }] }),
});

function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
    : <XCircle className="h-5 w-5 text-red-500" />;
}

function fmtTs(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

/** RFC4180-safe CSV cell. */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>, headers?: string[]) {
  const cols = headers ?? (rows.length ? Object.keys(rows[0]) : []);
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function HealthPage() {
  const router = useRouter();
  const fetchHealth = useServerFn(getAiHealth);
  const runTest = useServerFn(runFailoverTest);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["ai-health"],
    queryFn: () => fetchHealth(),
    refetchInterval: 30_000,
    retry: false,
  });
  const probe = useMutation({
    mutationFn: (provider?: string) => runTest({ data: { provider: provider ?? null } }),
  });

  const fetchErrorLog = useServerFn(getAiErrorLog);
  const errorLog = useMutation({
    mutationFn: (opts: { days: number; onlyFailures: boolean }) =>
      fetchErrorLog({ data: { days: opts.days, onlyFailures: opts.onlyFailures, limit: 5000 } }),
    onSuccess: (res) => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      downloadCsv(
        `nyrava-ai-${res.onlyFailures ? "failures" : "activity"}-${res.days}d-${stamp}.csv`,
        res.rows,
        ["created_at", "provider", "model", "operation", "success", "reason", "error", "latency_ms", "input_tokens", "output_tokens", "total_tokens", "case_id"],
      );
    },
  });

  const fetchCooldowns = useServerFn(listAiCooldowns);
  const clearCooldownsFn = useServerFn(clearAiCooldowns);
  const cooldowns = useQuery({
    queryKey: ["ai-cooldowns"],
    queryFn: () => fetchCooldowns(),
    refetchInterval: 15_000,
    retry: false,
  });
  const clearCooldowns = useMutation({
    mutationFn: (model?: string) => clearCooldownsFn({ data: { model: model ?? null } }),
    onSuccess: () => cooldowns.refetch(),
  });


  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <Activity className="h-7 w-7 text-accent" /> System Health
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI requests run through <strong>Groq only</strong>. Rate limits enter cooldown and resume later; no fallback provider is used. Auto-refreshes every 30s.
          </p>
        </div>
        <button
          onClick={() => { refetch(); router.invalidate(); }}
          className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-8 rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-600">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5" />
            <div>
              <div className="font-semibold">Couldn't load provider health</div>
              <div className="mt-1 text-xs break-all">
                {error instanceof Error ? error.message : String(error)}
              </div>
              <div className="mt-2 text-xs text-red-600/80">
                The System Health page requires administrator access. If you've just been granted admin, click Refresh.
              </div>
            </div>
          </div>
        </div>
      ) : isLoading || !data ? (
        <div className="mt-8 text-sm text-muted-foreground">Checking providers…</div>
      ) : (

        <>
          {!data.env.ok && (
            <div className="mt-6 rounded-xl border border-red-500/50 bg-red-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-red-600">
                    Environment misconfigured
                  </div>
                  <div className="mt-1 text-xs text-red-600/90">
                    Missing required server variables: {data.env.missing.join(", ")}.
                    The Intelligence Engine cannot operate until these are configured.
                  </div>
                </div>
              </div>
            </div>
          )}

          <section className="mt-8 grid gap-4 md:grid-cols-2">
            <ProviderCard
              name="Groq only" icon={<Cpu className="h-4 w-4" />}
              configured={data.providers.groq.configured}
              ok={data.providers.groq.ok} latencyMs={data.providers.groq.latencyMs}
              error={data.providers.groq.error}
              note={`gpt-oss-120b · ${data.providers.groq.totalOk ?? 0} ok / ${data.providers.groq.totalErr ?? 0} err`}
            />
            <ProviderCard
              name="Backend" icon={<Database className="h-4 w-4" />}
              configured={true}
              ok={data.backend.ok} latencyMs={data.backend.latencyMs}
              error={data.backend.error}
              note="Database & auth"
            />
          </section>

          <section className="mt-8 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              AI activity
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <Stat label="Mode" value={data.active ?? "none"} />
              <Stat label="Total calls" value={data.totalCalls ?? 0} />
              <Stat label="Failovers" value={data.failovers ?? 0} />
              <Stat label="Cache hits" value={data.cacheHits ?? 0} />
              <Stat label="Cache size" value={data.cacheSize ?? 0} />
              <Stat label="Last success" value={fmtTs(data.lastSuccess?.ts)} />
              <Stat label="Last failure" value={fmtTs(data.lastError?.ts)} />
              <Stat label="Last model" value={data.lastSuccess?.model ?? "—"} />
              <Stat label="Tokens (in/out)" value={
                data.lastSuccess
                  ? `${data.lastSuccess.inputTokens ?? "—"} / ${data.lastSuccess.outputTokens ?? "—"}`
                  : "—"
              } />
              <Stat label="Last latency" value={data.lastSuccess ? `${data.lastSuccess.latencyMs} ms` : "—"} />
            </div>
            {data.lastError?.error && (
              <div className="mt-3 text-xs text-red-600 break-all">
                Last error: {data.lastError.error}
              </div>
            )}
          </section>

          <section className="mt-8 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Active AI cooldowns
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  In-memory router circuit breakers. When set, all Groq requests for that (model, org) are refused with <code>retry_after_ms</code> until it expires. Clearing releases the block immediately.
                </p>
              </div>
              <button
                onClick={() => clearCooldowns.mutate(undefined)}
                disabled={clearCooldowns.isPending || (cooldowns.data?.cooldowns.length ?? 0) === 0}
                className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${clearCooldowns.isPending ? "animate-spin" : ""}`} />
                Clear all
              </button>
            </div>
            {cooldowns.data && cooldowns.data.cooldowns.length === 0 ? (
              <div className="mt-4 text-sm text-emerald-600">No active cooldowns.</div>
            ) : cooldowns.data ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-2 py-2 text-left">Model</th>
                      <th className="px-2 py-2 text-left">Org</th>
                      <th className="px-2 py-2 text-right">Retry after</th>
                      <th className="px-2 py-2 text-left">Expires</th>
                      <th className="px-2 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cooldowns.data.cooldowns.map((c) => (
                      <tr key={`${c.model}::${c.org}`} className="border-b border-border/60">
                        <td className="px-2 py-2 font-mono text-xs">{c.model}</td>
                        <td className="px-2 py-2 font-mono text-xs">{c.org}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{Math.round(c.retryAfterMs / 1000)}s</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">{new Date(c.until).toLocaleTimeString()}</td>
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={() => clearCooldowns.mutate(c.model)}
                            disabled={clearCooldowns.isPending}
                            className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                          >
                            Clear
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 text-xs text-muted-foreground">Loading…</div>
            )}
            {clearCooldowns.data && (
              <div className="mt-3 text-xs text-emerald-600">
                Cleared {clearCooldowns.data.cleared} entrie(s){clearCooldowns.data.model ? ` for ${clearCooldowns.data.model}` : ""}.
              </div>
            )}
          </section>

          <section className="mt-8 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Live provider probe
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sends a real prompt through Groq and records latency, tokens, model, and output.
                </p>
              </div>
              <button
                onClick={() => probe.mutate()}
                disabled={probe.isPending}
                className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                <PlayCircle className={`h-4 w-4 ${probe.isPending ? "animate-pulse" : ""}`} />
                {probe.isPending ? "Running…" : "Run probe"}
              </button>
            </div>
            {probe.data && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-2 py-2 text-left">Provider</th>
                      <th className="px-2 py-2 text-left">Status</th>
                      <th className="px-2 py-2 text-left">Model</th>
                      <th className="px-2 py-2 text-right">Latency</th>
                      <th className="px-2 py-2 text-right">In / Out tok</th>
                      <th className="px-2 py-2 text-left">Output / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {probe.data.results.map((r) => (
                      <tr key={r.provider} className="border-b border-border/60 align-top">
                        <td className="px-2 py-2 font-medium">{r.provider}</td>
                        <td className="px-2 py-2">
                          <span className={r.ok ? "text-emerald-600" : "text-red-600"}>
                            {r.ok ? "ok" : "fail"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">
                          {"model" in r ? r.model : "—"}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {"latencyMs" in r ? `${r.latencyMs} ms` : "—"}
                        </td>
                        <td className="px-2 py-2 text-right text-xs">
                          {"inputTokens" in r ? `${r.inputTokens ?? "—"} / ${r.outputTokens ?? "—"}` : "—"}
                        </td>
                        <td className="px-2 py-2 text-xs max-w-[28rem]">
                          {r.ok
                            ? <span className="text-foreground">{(r as { output: string }).output}</span>
                            : <span className="text-red-600 break-all">{(r as { error: string }).error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  Run at {new Date(probe.data.ts).toLocaleString()}.
                </p>
              </div>
            )}
            {probe.error && (
              <div className="mt-3 text-xs text-red-600">
                {probe.error instanceof Error ? probe.error.message : String(probe.error)}
              </div>
            )}
          </section>

          <section className="mt-8 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent AI requests
            </h2>
            {data.recent.length === 0 ? (
              <div className="mt-4 text-sm text-muted-foreground">No AI requests yet this session.</div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-2 py-2 text-left">Time</th>
                      <th className="px-2 py-2 text-left">Provider</th>
                      <th className="px-2 py-2 text-left">Model</th>
                      <th className="px-2 py-2 text-left">Status</th>
                      <th className="px-2 py-2 text-right">Latency</th>
                      <th className="px-2 py-2 text-right">In / Out tok</th>
                      <th className="px-2 py-2 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.recent].reverse().map((r, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="px-2 py-2">{new Date(r.ts).toLocaleTimeString()}</td>
                        <td className="px-2 py-2 font-medium">{r.provider}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">{r.model}</td>
                        <td className="px-2 py-2">
                          <span className={r.ok ? "text-emerald-600" : "text-red-600"}>
                            {r.ok ? "ok" : "fail"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">{r.latencyMs} ms</td>
                        <td className="px-2 py-2 text-right text-xs">
                          {r.inputTokens ?? "—"} / {r.outputTokens ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-xs text-red-600 max-w-[20rem] truncate" title={r.error}>
                          {r.error ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="mt-6 text-xs text-muted-foreground">
            Provider policy: <strong>Groq only</strong>. Rate limits enter cooldown and resume later;
            requests are not retried through another provider. Identical prompts are served from an in-memory cache.
          </p>
        </>
      )}
    </div>
  );
}

function ProviderCard({
  name, icon, configured, ok, latencyMs, error, note,
}: {
  name: string; icon: React.ReactNode; configured: boolean;
  ok: boolean; latencyMs: number; error?: string; note?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {icon}{name}
          </div>
          {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
        </div>
        <StatusDot ok={configured && ok} />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>{configured ? "configured" : "not configured"}</span>
        <span>{ok ? `${latencyMs} ms` : "unreachable"}</span>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-600 break-all">{error}</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
