// Admin feedback inbox — everything users (mostly beta testers) send via the
// floating Comentarios button lands here, newest first.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Inbox, Loader2 } from "lucide-react";
import { adminListFeedback, adminUpdateFeedback, type FeedbackRow } from "@/lib/feedback.functions";

export const Route = createFileRoute("/_authenticated/admin/feedback")({
  head: () => ({
    meta: [
      { title: "Feedback — Admin" },
      { name: "description", content: "Comentarios enviados por usuarios y beta testers." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminFeedbackPage,
});

const STATUSES = ["new", "read", "in_progress", "resolved"] as const;

const STATUS_LABEL: Record<string, string> = {
  new: "Nuevo",
  read: "Leído",
  in_progress: "En curso",
  resolved: "Resuelto",
};

function fmt(s: string) {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdminFeedbackPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListFeedback);
  const updateFn = useServerFn(adminUpdateFeedback);
  const [filter, setFilter] = useState<string>("all");

  const q = useQuery({ queryKey: ["admin-feedback"], queryFn: () => listFn() });

  const updateM = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateFn({ data: { id: v.id, status: v.status as any } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-feedback"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "No fue posible actualizar."),
  });

  const rows: FeedbackRow[] = useMemo(() => {
    const all = q.data ?? [];
    return filter === "all" ? all : all.filter((r) => r.status === filter);
  }, [q.data, filter]);

  const newCount = (q.data ?? []).filter((r) => r.status === "new").length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Admin
      </Link>

      <h1 className="mt-3 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
        <Inbox className="h-5 w-5 text-primary" /> Feedback
        {newCount > 0 && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            {newCount} nuevo{newCount === 1 ? "" : "s"}
          </span>
        )}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Comentarios enviados desde el botón “Comentarios” dentro de la plataforma. Incluye la página
        exacta donde ocurrió el problema.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {["all", ...STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition ${
              filter === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "all" ? "Todos" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {q.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {!q.isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin comentarios todavía.</p>
        )}
        {rows.map((r) => (
          <div key={r.id} className="panel p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{r.email ?? r.user_id}</span>
              <span>{fmt(r.created_at)}</span>
              <span className="rounded border border-border/70 px-1.5 py-0.5">{r.category}</span>
              <span className="rounded border border-border/70 px-1.5 py-0.5">{r.severity}</span>
              {r.page_path && <span className="font-mono">{r.page_path}</span>}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{r.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={updateM.isPending || r.status === s}
                  onClick={() => updateM.mutate({ id: r.id, status: s })}
                  className={`rounded-md border px-2 py-1 text-[11px] transition disabled:opacity-60 ${
                    r.status === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
