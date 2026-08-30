// Header feedback button — sends a note straight to the unified admin
// inbox (/admin/messages). Rendered once in the authenticated layout so
// beta testers can report from wherever the problem happened; the current
// path travels with the message. Replies from the admin show up in the
// sender's own "Mensajes" page (see support.functions.ts) — this is a real
// two-way thread, not a one-way suggestion box.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus, X } from "lucide-react";
import { submitSupportMessage, SUPPORT_CATEGORIES } from "@/lib/support.functions";

const FEEDBACK_CATEGORIES = SUPPORT_CATEGORIES.filter((c) => c !== "support");

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Error / falla",
  wrong_result: "Resultado incorrecto",
  missing_feature: "Falta una función",
  usability: "Usabilidad",
  legal_accuracy: "Precisión jurídica",
  general: "Comentario general",
};

const SEVERITIES = [
  { value: "low", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
  { value: "blocking", label: "Me bloquea" },
] as const;

const inputCls =
  "mt-1 w-full rounded-md border border-border/70 bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none";

export function FeedbackButton({
  mobileTargetId,
  desktopTargetId,
}: {
  mobileTargetId: string;
  desktopTargetId: string;
}) {
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);

  // Keep one feedback instance and the existing dialog outside the blurred
  // headers; move only its trigger into the currently visible header.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const updateTarget = () =>
      setHeaderTarget(
        document.getElementById(desktop.matches ? desktopTargetId : mobileTargetId),
      );
    updateTarget();
    desktop.addEventListener("change", updateTarget);
    return () => desktop.removeEventListener("change", updateTarget);
  }, [mobileTargetId, desktopTargetId]);

  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sendFn = useServerFn(submitSupportMessage);

  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [severity, setSeverity] = useState<string>("normal");

  const send = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          body: message.trim(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: category as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          severity: severity as any,
          page_path: pathname,
        },
      }),
    onSuccess: () => {
      toast.success("Gracias — tu comentario llegó directo al equipo. Te avisaremos aquí cuando respondamos.");
      setMessage("");
      setCategory("general");
      setSeverity("normal");
      setOpen(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "No fue posible enviar el comentario."),
  });

  return (
    <>
      {headerTarget &&
        createPortal(
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Enviar comentarios"
            title="Enviar comentarios"
            className="inline-flex shrink-0 items-center gap-2 rounded-md p-1.5 text-sidebar-foreground/80 transition hover:bg-sidebar-accent md:rounded-lg md:border md:border-border md:bg-card/60 md:p-2 md:text-foreground md:hover:bg-card"
          >
            <MessageSquarePlus className="h-5 w-5 md:h-4 md:w-4" />
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.14em] 2xl:inline">
              Comentarios
            </span>
          </button>,
          headerTarget,
        )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="panel w-full max-w-lg p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Enviar comentarios
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Llega directo al equipo de Nyrava. Incluimos la página en la que estás
                  ({pathname}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-md p-1 text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Tipo
                  </span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={inputCls}
                  >
                    {FEEDBACK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c] ?? c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Prioridad
                  </span>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className={inputCls}
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Comentario
                </span>
                <textarea
                  required
                  minLength={5}
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="¿Qué esperabas que pasara y qué pasó?"
                  className={inputCls}
                />
              </label>

              <button
                type="submit"
                disabled={send.isPending || message.trim().length < 5}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
              >
                {send.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enviar
              </button>
            </form>

            <Link
              to="/messages"
              onClick={() => setOpen(false)}
              className="mt-3 block text-center text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Ver mis mensajes anteriores
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
