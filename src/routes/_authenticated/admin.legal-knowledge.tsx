import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getNlknStats, testConnectorSync, type TestConnectorSyncResult } from "@/lib/legal-knowledge-admin.functions";
import { BookOpen, Database, ShieldCheck, ShieldAlert, RefreshCw, Clock, AlertTriangle, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/legal-knowledge")({
  head: () => ({ meta: [{ title: "Legal Knowledge Network — Nyrava" }] }),
  component: LegalKnowledgePage,
});

const CONNECTOR_STATUS_COLOR: Record<string, string> = {
  active: "text-success bg-success/10 border-success/30",
  planned: "text-muted-foreground bg-muted border-border",
  paused: "text-warning bg-warning/10 border-warning/30",
  error: "text-destructive bg-destructive/10 border-destructive/30",
};

function LegalKnowledgePage() {
  const fetchStats = useServerFn(getNlknStats);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["nlkn-stats"],
    queryFn: () => fetchStats(),
  });

  const testFn = useServerFn(testConnectorSync);
  const [testResults, setTestResults] = useState<Record<string, TestConnectorSyncResult | { errors: string[] }>>({});
  const testSync = useMutation({
    mutationFn: (code: string) => testFn({ data: code }),
    onSuccess: (result, code) => {
      setTestResults((prev) => ({ ...prev, [code]: result }));
      refetch(); // pick up any new authorities/runs the test actually stored
    },
    onError: (err, code) => {
      setTestResults((prev) => ({ ...prev, [code]: { errors: [err instanceof Error ? err.message : String(err)] } }));
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-semibold">Nyrava Legal Knowledge Network</h1>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Cargando…
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No data.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Entity counts */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <CountTile label="Autoridades" value={data.counts.authorities} icon={<Database className="h-5 w-5" />} />
            <CountTile label="Artículos" value={data.counts.articles} icon={<BookOpen className="h-5 w-5" />} />
            <CountTile label="Precedentes" value={data.counts.precedents} icon={<ShieldCheck className="h-5 w-5" />} />
            <CountTile label="Jurisprudencia" value={data.counts.jurisprudencia} icon={<ShieldCheck className="h-5 w-5" />} />
            <CountTile label="Tesis" value={data.counts.theses} icon={<BookOpen className="h-5 w-5" />} />
            <CountTile label="Reglamentos" value={data.counts.regulations} icon={<Database className="h-5 w-5" />} />
          </div>

          {/* Verification breakdown */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Estado de verificación
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <VerifTile label="Verificado" value={data.verification.verified} tone="success" />
              <VerifTile label="Pendiente" value={data.verification.pending} tone="muted" />
              <VerifTile label="Obsoleto" value={data.verification.deprecated} tone="warning" />
              <VerifTile label="Reemplazado" value={data.verification.superseded} tone="warning" />
              <VerifTile label="Verificación fallida" value={data.verification.failed_verification} tone="danger" />
            </div>
            {data.failedJobsLast7Days > 0 && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {data.failedJobsLast7Days} trabajo(s) de ingesta fallidos en los últimos 7 días.
              </div>
            )}
          </div>

          {/* Connectors */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Conectores ({data.connectors.length})
            </h2>
            <div className="space-y-2">
              {data.connectors.map((c) => {
                const result = testResults[c.code];
                const isTesting = testSync.isPending && testSync.variables === c.code;
                return (
                  <div key={c.code} className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">({c.code})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {c.lastSyncAt && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" /> {new Date(c.lastSyncAt).toLocaleString()}
                          </span>
                        )}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${CONNECTOR_STATUS_COLOR[c.status] ?? CONNECTOR_STATUS_COLOR.planned}`}
                        >
                          {c.status}
                        </span>
                        <button
                          onClick={() => testSync.mutate(c.code)}
                          disabled={isTesting}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          <PlayCircle className={`h-3.5 w-3.5 ${isTesting ? "animate-pulse" : ""}`} />
                          {isTesting ? "Probando…" : "Probar"}
                        </button>
                      </div>
                    </div>
                    {result && (
                      <div
                        className={`mt-2 rounded border px-2 py-1.5 text-xs ${
                          "errors" in result && result.errors.length > 0 && !("documentsStored" in result && result.documentsStored > 0)
                            ? "border-destructive/40 bg-destructive/5 text-destructive"
                            : "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                        }`}
                      >
                        {"documentsFetched" in result ? (
                          <>
                            {result.status}: {result.documentsFetched} obtenidos · {result.documentsStored} guardados ·{" "}
                            {result.documentsVersioned} nuevas versiones · {result.entitiesProjected} entidades
                            {result.errors.length > 0 && (
                              <div className="mt-1">{result.errors.slice(0, 3).join(" | ")}</div>
                            )}
                          </>
                        ) : (
                          result.errors.join(" | ")
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent ingestion runs */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Historial de ingesta reciente
            </h2>
            {data.recentRuns.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Aún no se ha ejecutado ninguna ingesta. Los conectores están registrados pero ninguno está activo
                todavía.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-2">Conector</th>
                      <th className="p-2">Inicio</th>
                      <th className="p-2">Estado</th>
                      <th className="p-2 text-right">Obtenidos</th>
                      <th className="p-2 text-right">Guardados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRuns.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2 font-medium">{r.connectorCode}</td>
                        <td className="p-2 text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</td>
                        <td className="p-2">
                          <span
                            className={
                              r.status === "completed"
                                ? "text-success"
                                : r.status === "failed"
                                  ? "text-destructive"
                                  : "text-warning"
                            }
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="p-2 text-right">{r.documentsFetched}</td>
                        <td className="p-2 text-right">{r.documentsStored}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CountTile({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-xl border border-border bg-card p-4">
      <span className="text-primary opacity-80">{icon}</span>
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function VerifTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  const cls =
    tone === "success"
      ? "text-success border-success/30"
      : tone === "warning"
        ? "text-warning border-warning/30"
        : tone === "danger"
          ? "text-destructive border-destructive/30"
          : "text-muted-foreground border-border";
  return (
    <div className={`rounded-lg border bg-background/40 p-3 text-center ${cls}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  );
}
