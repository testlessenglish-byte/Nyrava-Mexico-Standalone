// "My Messages" — where a user sees replies to whatever they sent via
// "Comentarios" or "Ayuda y soporte". Replaces the dead "Help & Support"
// link that used to point at /settings.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Inbox, Loader2, Send, MessageSquarePlus } from "lucide-react";
import {
  listMySupportThreads,
  getMySupportThread,
  submitSupportMessage,
  SUPPORT_CATEGORIES,
  type SupportThreadRow,
  type SupportMessageRow,
} from "@/lib/support.functions";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [
      { title: "Mensajes — Nyrava" },
      { name: "description", content: "Tus mensajes de soporte y comentarios enviados al equipo de Nyrava." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MessagesPage,
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

function MessagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMySupportThreads);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const q = useQuery({ queryKey: ["my-support-threads"], queryFn: () => listFn(), refetchInterval: 30000 });
  const threads: SupportThreadRow[] = q.data ?? [];

  if (openThreadId) {
    return (
      <ThreadView
        threadId={openThreadId}
        onBack={() => {
          setOpenThreadId(null);
          qc.invalidateQueries({ queryKey: ["my-support-threads"] });
        }}
      />
    );
  }

  if (composing) {
    return (
      <NewThreadForm
        onDone={(threadId) => {
          setComposing(false);
          qc.invalidateQueries({ queryKey: ["my-support-threads"] });
          if (threadId) setOpenThreadId(threadId);
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <Inbox className="h-5 w-5 text-primary" /> Mensajes
        </h1>
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
        >
          <MessageSquarePlus className="h-4 w-4" /> Nuevo mensaje
        </button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Aquí llegan las respuestas del equipo de Nyrava a lo que envíes por "Comentarios" o "Ayuda y soporte".
      </p>

      <div className="mt-6 space-y-2">
        {q.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {!q.isLoading && threads.length === 0 && (
          <p className="text-sm text-muted-foreground">Aún no has enviado ningún mensaje.</p>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOpenThreadId(t.id)}
            className="block w-full rounded-lg border border-border/70 bg-card p-4 text-left transition hover:border-primary/50"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {t.unread_by_user && <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />}
              <span className="rounded border border-border/70 px-1.5 py-0.5">
                {CATEGORY_LABEL[t.category] ?? t.category}
              </span>
              <span>{fmt(t.last_message_at)}</span>
              {t.status === "resolved" && (
                <span className="rounded border border-success/40 px-1.5 py-0.5 text-success">Resuelto</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NewThreadForm({ onDone }: { onDone: (threadId?: string) => void }) {
  const submitFn = useServerFn(submitSupportMessage);
  const [category, setCategory] = useState<string>("support");
  const [body, setBody] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          body: body.trim(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: category as any,
        },
      }),
    onSuccess: (res) => {
      toast.success("Mensaje enviado.");
      onDone(res.thread_id);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "No fue posible enviar el mensaje."),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <button
        type="button"
        onClick={() => onDone()}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Mensajes
      </button>
      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">Nuevo mensaje</h1>

      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Tipo</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            {SUPPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c] ?? c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Mensaje</span>
          <textarea
            required
            minLength={1}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="¿En qué te podemos ayudar?"
            className="mt-1 w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={submit.isPending || body.trim().length === 0}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
        >
          {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Enviar
        </button>
      </form>
    </div>
  );
}

function ThreadView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getMySupportThread);
  const submitFn = useServerFn(submitSupportMessage);
  const [reply, setReply] = useState("");

  const q = useQuery({
    queryKey: ["my-support-thread", threadId],
    queryFn: () => getFn({ data: { threadId } }),
  });

  const replyMutation = useMutation({
    mutationFn: () => submitFn({ data: { thread_id: threadId, body: reply.trim() } }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["my-support-thread", threadId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "No fue posible enviar el mensaje."),
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
        <ChevronLeft className="h-3.5 w-3.5" /> Mensajes
      </button>

      {q.isLoading || !thread ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          <div className="mt-3 text-sm">
            <span className="rounded border border-border/70 px-1.5 py-0.5 text-xs text-muted-foreground">
              {CATEGORY_LABEL[thread.category] ?? thread.category}
            </span>
            {thread.status === "resolved" && (
              <span className="ml-2 rounded border border-success/40 px-1.5 py-0.5 text-xs text-success">
                Resuelto
              </span>
            )}
          </div>

          <div className="mt-5 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-lg border p-3 text-sm ${
                  m.sender === "user" ? "ml-auto border-primary/40 bg-primary/10" : "border-border/70 bg-card"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {m.sender === "user" ? "Tú" : "Equipo Nyrava"} · {fmt(m.created_at)}
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
