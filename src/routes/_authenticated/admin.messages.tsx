// Unified admin inbox — everything sent via the "Comentarios" button or
// "Help & Support" lands here as one thread type. Unlike the old
// /admin/feedback page (kept for its historical rows), replies here are
// visible to the sender inside the app, not just a private internal note.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Inbox, Loader2, Send } from "lucide-react";
import {
  adminListSupportThreads,
  adminGetSupportThread,
  adminReplyToSupportThread,
  adminSetSupportThreadStatus,
  type SupportThreadRow,
  type SupportMessageRow,
} from "@/lib/support.functions";

export const Route = createFileRoute("/_authenticated/admin/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Admin" },
      { name: "description", content: "Mensajes de soporte y comentarios enviados desde la plataforma." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminMessagesPage,
});

const CATEGORY_LABEL: Record<string, string> = {
  support: "Ayuda y soporte",
  bug: "Error / falla",
  wrong_result: "Resultado incorrecto",
  missing_feature: "Falta una función",
  usability: "Usabilidad",
  legal_accuracy: "Precisión jurídica",
  general: "Comentario general",
};

function fmt(s: string) {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdminMessagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListSupportThreads);
  const [filter, setFilter] = useState<"all" | "unread" | "open" | "resolved">("unread");
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["admin-support-threads"], queryFn: () => listFn(), refetchInterval: 20000 });

  const threads: SupportThreadRow[] = useMemo(() => {
    const all = q.data ?? [];
    if (filter === "all") return all;
    if (filter === "unread") return all.filter((t) => t.unread_by_admin);
    return all.filter((t) => t.status === filter);
  }, [q.data, filter]);

  const unreadCount = (q.data ?? []).filter((t) => t.unread_by_admin).length;

  if (openThreadId) {
    return (
      <ThreadView
        threadId={openThreadId}
        onBack={() => {
          setOpenThreadId(null);
          qc.invalidateQueries({ queryKey: ["admin-support-threads"] });
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Admin
      </Link>

      <h1 className="mt-3 flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
        <Inbox className="h-5 w-5 text-primary" /> Messages
        {unreadCount > 0 && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            {unreadCount} sin leer
          </span>
        )}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Mensajes enviados desde "Comentarios" y "Ayuda y soporte" dentro de la plataforma. Responde aquí — el
        remitente ve tu respuesta dentro de la app.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {(["unread", "all", "open", "resolved"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition ${
              filter === f
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/70 text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "Todos" : f === "unread" ? "Sin leer" : f === "open" ? "Abiertos" : "Resueltos"}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        {q.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {!q.isLoading && threads.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin mensajes en esta vista.</p>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenThreadId(t.id)}
            className="block w-full rounded-lg border border-border/70 bg-card p-4 text-left transition hover:border-primary/50"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {t.unread_by_admin && <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />}
              <span className="font-medium text-foreground">{t.email ?? t.user_id}</span>
              <span>{fmt(t.last_message_at)}</span>
              <span className="rounded border border-border/70 px-1.5 py-0.5">
                {CATEGORY_LABEL[t.category] ?? t.category}
              </span>
              <span className="rounded border border-border/70 px-1.5 py-0.5">{t.severity}</span>
              {t.status === "resolved" && (
                <span className="rounded border border-success/40 px-1.5 py-0.5 text-success">Resuelto</span>
              )}
              {t.page_path && <span className="font-mono">{t.page_path}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ThreadView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetSupportThread);
  const replyFn = useServerFn(adminReplyToSupportThread);
  const statusFn = useServerFn(adminSetSupportThreadStatus);
  const [reply, setReply] = useState("");

  const q = useQuery({
    queryKey: ["admin-support-thread", threadId],
    queryFn: () => getFn({ data: { threadId } }),
  });

  const replyMutation = useMutation({
    mutationFn: () => replyFn({ data: { threadId, body: reply.trim() } }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["admin-support-thread", threadId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "No fue posible enviar la respuesta."),
  });

  const statusMutation = useMutation({
    mutationFn: (status: "open" | "resolved") => statusFn({ data: { threadId, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-support-thread", threadId] }),
  });

  const thread = q.data?.thread;
  const messages: SupportMessageRow[] = q.data?.messages ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Messages
      </button>

      {q.isLoading || !thread ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium">{thread.email ?? thread.user_id}</span>
              <span className="ml-2 rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground">
                {CATEGORY_LABEL[thread.category] ?? thread.category}
              </span>
              {thread.page_path && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">{thread.page_path}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => statusMutation.mutate(thread.status === "resolved" ? "open" : "resolved")}
              disabled={statusMutation.isPending}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-60 ${
                thread.status === "resolved"
                  ? "border-success/40 text-success hover:bg-success/10"
                  : "border-border/70 text-muted-foreground hover:text-foreground"
              }`}
            >
              {thread.status === "resolved" ? "Resuelto — reabrir" : "Marcar como resuelto"}
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-lg border p-3 text-sm ${
                  m.sender === "admin"
                    ? "ml-auto border-primary/40 bg-primary/10"
                    : "border-border/70 bg-card"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {m.sender === "admin" ? "Tú" : "Remitente"} · {fmt(m.created_at)}
                </p>
              </div>
            ))}
          </div>

          <form
            className="mt-5 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim().length > 0) replyMutation.mutate();
            }}
          >
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Escribe tu respuesta…"
              rows={3}
              className="flex-1 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={replyMutation.isPending || reply.trim().length === 0}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            >
              {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar
            </button>
          </form>
        </>
      )}
    </div>
  );
}
