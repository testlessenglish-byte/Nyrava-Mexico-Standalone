import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getNlknStats,
  testConnectorSync,
  listPendingAuthorities,
  markAuthorityVerified,
  searchVerifiedAuthorities,
  markAuthoritySuperseded,
  type TestConnectorSyncResult,
  type AuthoritySearchResult,
} from "@/lib/legal-knowledge-admin.functions";
import { BookOpen, Database, ShieldCheck, ShieldAlert, RefreshCw, Clock, AlertTriangle, PlayCircle, Check, X, ExternalLink } from "lucide-react";

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

const HEALTH_DOT: Record<string, string> = {
  ok: "bg-success",
  stale: "bg-warning",
  failing: "bg-destructive",
  never_run: "bg-muted-foreground",
};

const HEALTH_LABEL: Record<string, string> = {
  ok: "Recibiendo datos",
  stale: "Sin datos nuevos",
  failing: "Última corrida falló",
  never_run: "Nunca ejecutado",
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
            <CountTile
              label="Relaciones (citas)"
              value={data.counts.citations}
              icon={<ExternalLink className="h-5 w-5" />}
            />
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

          {/* Pending-authority review — the missing verification workflow.
              Only jurisprudencia/court_decision rows show up here: those
              are the only kinds case-law grounding actually cites, and
              nothing is citable until a human explicitly approves it here. */}
          <PendingAuthoritiesReview />

          {/* Authority supersession — deliberately human-reviewed, not
              automated: see markAuthoritySuperseded's own doc comment for
              why. The reviewer picks both authorities explicitly. */}
          <SupersessionReview />

          {/* Connectors */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Conectores ({data.connectors.length})
              </h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                <Clock className="h-3 w-3" /> {data.schedule.description}
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Cada fuente se sincroniza sola todos los días. El indicador muestra si realmente está trayendo
              información; «Probar» sigue disponible para una ejecución manual.
            </p>
            <div className="space-y-2">
              {data.connectors.map((c) => {
                const result = testResults[c.code];
                const isTesting = testSync.isPending && testSync.variables === c.code;
                return (
                  <div key={c.code} className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[c.health]}`} title={HEALTH_LABEL[c.health]} />
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">({c.code})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[11px] ${c.health === "ok" ? "text-success" : c.health === "failing" ? "text-destructive" : "text-warning"}`}>
                          {HEALTH_LABEL[c.health]}
                          {c.lastProductiveAt
                            ? ` · último dato ${new Date(c.lastProductiveAt).toLocaleDateString()}`
                            : ""}
                        </span>
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
                            {result.documentsVersioned} nuevas versiones · {result.entitiesProjected} entidades ·{" "}
                            {result.citationsExtracted} citas ({result.citationsResolved} resueltas)
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

function PendingAuthoritiesReview() {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 10;

  const fetchPending = useServerFn(listPendingAuthorities);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["nlkn-pending-authorities", offset],
    queryFn: () => fetchPending({ data: { limit, offset } }),
  });

  const reviewFn = useServerFn(markAuthorityVerified);
  const review = useMutation({
    mutationFn: (vars: { authorityId: string; decision: "verified" | "failed_verification" }) =>
      reviewFn({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nlkn-pending-authorities"] });
      queryClient.invalidateQueries({ queryKey: ["nlkn-stats"] });
    },
  });

  const total = data?.total ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Revisión de autoridades pendientes {total > 0 ? `(${total})` : ""}
        </h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Ninguna jurisprudencia o resolución judicial se cita en un reporte hasta que se revisa y aprueba aquí — la
        ingesta automática solo indica que el texto se descargó de la fuente, no que ya fue verificado.
      </p>

      {isLoading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Cargando…</div>
      ) : total === 0 ? (
        <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-4 text-center text-xs text-success">
          No hay jurisprudencia ni resoluciones pendientes de revisión.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {data!.rows.map((a) => {
              const isOpen = expanded === a.id;
              const isReviewing = review.isPending && review.variables?.authorityId === a.id;
              return (
                <div key={a.id} className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <button
                      className="flex-1 text-left"
                      onClick={() => setExpanded(isOpen ? null : a.id)}
                    >
                      <div className="font-medium">{a.shortTitle ?? a.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.issuer ?? "Emisor desconocido"}
                        {a.citation ? ` · ${a.citation}` : ""}
                        {a.publishedAt ? ` · ${new Date(a.publishedAt).toLocaleDateString()}` : ""}
                        {" · "}
                        {a.kind}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {a.sourceUrl && (
                        <a
                          href={a.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                        >
                          <ExternalLink className="h-3 w-3" /> Fuente
                        </a>
                      )}
                      <button
                        onClick={() => review.mutate({ authorityId: a.id, decision: "verified" })}
                        disabled={isReviewing}
                        className="flex items-center gap-1 rounded-md border border-success/40 px-2 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> Verificar
                      </button>
                      <button
                        onClick={() => review.mutate({ authorityId: a.id, decision: "failed_verification" })}
                        disabled={isReviewing}
                        className="flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Rechazar
                      </button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded border border-border bg-muted/30 p-2 text-xs leading-relaxed text-foreground/90">
                      {a.bodyPreview || "Sin texto extraído."}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {offset + 1}–{Math.min(offset + limit, total)} de {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0 || isFetching}
                className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total || isFetching}
                className="rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Simple two-picker search — search a verified authority, click a result
 * to select it. No autocomplete/debounce library; matches the rest of this
 * dashboard's plain, functional style.
 */
function AuthorityPicker({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: AuthoritySearchResult | null;
  onSelect: (a: AuthoritySearchResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const searchFn = useServerFn(searchVerifiedAuthorities);
  const search = useMutation({ mutationFn: (q: string) => searchFn({ data: { query: q } }) });

  if (selected) {
    return (
      <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium">{selected.shortTitle ?? selected.title}</div>
            <div className="text-xs text-muted-foreground">{selected.citation ?? selected.kind}</div>
          </div>
          <button
            onClick={() => onSelect(null)}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && query.trim().length >= 3 && search.mutate(query.trim())}
          placeholder="Buscar por título o registro (mín. 3 caracteres)…"
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
        <button
          onClick={() => query.trim().length >= 3 && search.mutate(query.trim())}
          disabled={query.trim().length < 3 || search.isPending}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
        >
          Buscar
        </button>
      </div>
      {search.data && (
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {search.data.rows.length === 0 ? (
            <div className="px-1 py-1 text-xs text-muted-foreground">Sin resultados.</div>
          ) : (
            search.data.rows.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect(a)}
                className="block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
              >
                <div className="font-medium">{a.shortTitle ?? a.title}</div>
                <div className="text-muted-foreground">{a.citation ?? a.kind}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SupersessionReview() {
  const queryClient = useQueryClient();
  const [outgoing, setOutgoing] = useState<AuthoritySearchResult | null>(null);
  const [incoming, setIncoming] = useState<AuthoritySearchResult | null>(null);

  const markFn = useServerFn(markAuthoritySuperseded);
  const mark = useMutation({
    mutationFn: () =>
      markFn({ data: { authorityId: outgoing!.id, supersededByAuthorityId: incoming!.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nlkn-stats"] });
      setOutgoing(null);
      setIncoming(null);
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Marcar autoridad como superada
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Acción explícita, revisada por un humano — el sistema nunca detecta esto automáticamente. Selecciona la
        autoridad que dejó de ser vigente y la que la reemplaza.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <AuthorityPicker label="Autoridad superada" selected={outgoing} onSelect={setOutgoing} />
        <AuthorityPicker label="Autoridad que la sustituye" selected={incoming} onSelect={setIncoming} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => mark.mutate()}
          disabled={!outgoing || !incoming || mark.isPending}
          className="rounded-md border border-warning/40 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/10 disabled:opacity-40"
        >
          {mark.isPending ? "Guardando…" : "Confirmar supersesión"}
        </button>
        {mark.isError && (
          <span className="text-xs text-destructive">
            {mark.error instanceof Error ? mark.error.message : String(mark.error)}
          </span>
        )}
        {mark.isSuccess && <span className="text-xs text-success">Guardado.</span>}
      </div>
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
