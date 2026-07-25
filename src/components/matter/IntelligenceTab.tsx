/**
 * IntelligenceTab — run engines and view the matter knowledge base.
 *
 * Shows the structured intelligence layer (summary, facts, parties, timeline
 * events, evidence, authorities, contradictions, relationships) — not a chat
 * window. That is the whole point of Nyrava Intelligence.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listKnowledge,
  listRelationships,
  listRuns,
  runEngine,
} from "@/lib/engines.functions";
import { useI18n, type Locale } from "@/i18n";
import { Brain, Play, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

const ENGINES = [
  { code: "case", labelKey: "engine.case", descKey: "engine.case.desc" },
  { code: "legal", labelKey: "engine.legal", descKey: "engine.legal.desc" },
  { code: "evidence", labelKey: "engine.evidence", descKey: "engine.evidence.desc" },
] as const;

const KIND_ORDER = [
  "summary", "fact", "issue", "party", "entity", "date",
  "timeline_event", "evidence", "authority", "contradiction",
  "recommendation", "citation", "risk",
] as const;

function fmtDate(iso: string, l: Locale) {
  return new Date(iso).toLocaleString(l === "en" ? "en-US" : "es-MX");
}

export function IntelligenceTab({ matterId }: { matterId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const kFn = useServerFn(listKnowledge);
  const rFn = useServerFn(listRelationships);
  const runsFn = useServerFn(listRuns);
  const run = useServerFn(runEngine);
  const [error, setError] = useState<string | null>(null);

  const kQ = useQuery({ queryKey: ["matter-knowledge", matterId], queryFn: () => kFn({ data: { matterId } }) });
  const rQ = useQuery({ queryKey: ["matter-rels", matterId], queryFn: () => rFn({ data: { matterId } }) });
  const runsQ = useQuery({
    queryKey: ["matter-runs", matterId],
    queryFn: () => runsFn({ data: { matterId } }),
    refetchInterval: 4000,
  });

  const runMut = useMutation({
    mutationFn: (engine: "case" | "legal" | "evidence") =>
      run({ data: { matterId, engine, language: locale } }),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      if (!r.ok) setError(r.error ?? "Engine failed");
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["matter-knowledge", matterId] });
      qc.invalidateQueries({ queryKey: ["matter-rels", matterId] });
      qc.invalidateQueries({ queryKey: ["matter-runs", matterId] });
    },
  });

  const knowledge = kQ.data ?? [];
  const rels = rQ.data ?? [];
  const runs = runsQ.data ?? [];

  const grouped = useMemo(() => {
    const g = new Map<string, typeof knowledge>();
    for (const k of knowledge) {
      const arr = g.get(k.kind) ?? [];
      arr.push(k);
      g.set(k.kind, arr);
    }
    return g;
  }, [knowledge]);

  const kindById = useMemo(() => {
    const m = new Map<string, { title: string; kind: string }>();
    for (const k of knowledge) m.set(k.id, { title: k.title, kind: k.kind });
    return m;
  }, [knowledge]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Brain className="h-5 w-5 text-primary" /> {t("intel.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("intel.subtitle")}</p>
      </div>

      {/* Engine cards */}
      <div className="grid gap-3 md:grid-cols-3">
        {ENGINES.map((e) => (
          <div key={e.code} className="panel flex flex-col gap-3 p-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("intel.engine")}
              </div>
              <div className="mt-1 font-display text-base font-semibold">{t(e.labelKey)}</div>
              <p className="mt-1 text-xs text-muted-foreground">{t(e.descKey)}</p>
            </div>
            <button
              onClick={() => runMut.mutate(e.code)}
              disabled={runMut.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {runMut.isPending && runMut.variables === e.code ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {t("intel.run")}
            </button>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> {error}
        </div>
      )}

      {/* Knowledge base */}
      <div className="panel p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-base font-semibold">{t("intel.kb.title")}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {knowledge.length} {t("intel.kb.items")} · {rels.length} {t("intel.kb.relations")}
          </div>
        </div>

        {knowledge.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("intel.kb.empty")}</div>
        ) : (
          <div className="space-y-4">
            {KIND_ORDER.filter((k) => grouped.has(k)).map((k) => (
              <div key={k}>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                  {t(`kind.${k}`)}{" "}
                  <span className="text-muted-foreground">({grouped.get(k)!.length})</span>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {grouped.get(k)!.slice(0, 20).map((item) => (
                    <li key={item.id} className="rounded border border-border/40 bg-card/40 p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{item.title}</div>
                          {item.body && (
                            <div className="mt-0.5 text-xs text-muted-foreground">{item.body}</div>
                          )}
                        </div>
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">
                          {item.engine} · {item.confidence != null ? `${Math.round(Number(item.confidence) * 100)}%` : "—"}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Relationships */}
      {rels.length > 0 && (
        <div className="panel p-5">
          <div className="mb-2 font-display text-base font-semibold">{t("intel.graph.title")}</div>
          <ul className="space-y-1 text-xs">
            {rels.slice(0, 30).map((r) => {
              const s = kindById.get(r.subject_id);
              const o = kindById.get(r.object_id);
              if (!s || !o) return null;
              return (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="rounded bg-muted/60 px-1.5 py-0.5">{s.title}</span>
                  <span className="font-mono text-primary">— {r.relation} →</span>
                  <span className="rounded bg-muted/60 px-1.5 py-0.5">{o.title}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Run history */}
      <div className="panel p-5">
        <div className="mb-2 font-display text-base font-semibold">{t("intel.runs.title")}</div>
        {runs.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t("intel.runs.empty")}</div>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
                <div className="flex items-center gap-2">
                  {r.status === "completed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : r.status === "failed" ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  )}
                  <span className="font-mono uppercase">{r.engine}</span>
                  <span className="text-muted-foreground">· {r.model ?? "—"}</span>
                </div>
                <span className="text-muted-foreground">{fmtDate(r.created_at, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
