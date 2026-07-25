import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, AlertTriangle, CheckCircle2, Activity, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useAlerts } from "@/hooks/useAlerts";
import { ModuleHeader, ModuleEmpty } from "@/components/modules/SuppressedNotice";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({ meta: [{ title: "Alerts & Briefings — Nyrava" }] }),
  component: AlertsPage,
});

const PAGE_SIZE = 10;

function AlertsPage() {
  const { t } = useI18n();
  const { alerts, isLoading, read, unread, markRead, markAllRead, dismiss, dismissAll, restore } = useAlerts();
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(alerts.length / PAGE_SIZE));
  // Clamp page in render (rather than an effect) so deleting the last item
  // on the last page snaps back to a valid page immediately, no flash of
  // an empty page.
  const safePage = Math.min(page, pageCount);
  const pageAlerts = useMemo(() => alerts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [alerts, safePage]);

  function handleDismiss(key: string, title: string) {
    dismiss(key);
    toast(t("alerts.toast.dismissed", { title }), {
      action: {
        label: t("common.undo"),
        onClick: () => restore(key),
      },
    });
  }

  function handleDismissAll() {
    if (alerts.length === 0) return;
    const message =
      alerts.length === 1
        ? t("alerts.confirmClear.singular", { count: alerts.length })
        : t("alerts.confirmClear.plural", { count: alerts.length });
    if (!confirm(message)) {
      return;
    }
    dismissAll();
    toast.success(t("alerts.toast.cleared"));
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<Bell className="h-5 w-5" />}
        title={t("alerts.title")}
        subtitle={t("alerts.subtitle")}
      />
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("alerts.unreadOf", { unread: unread.length, total: alerts.length })}
        </p>
        {alerts.length > 0 ? (
          <div className="flex items-center gap-4">
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">
              {t("alerts.markAllRead")}
            </button>
            <button
              onClick={handleDismissAll}
              className="text-xs text-muted-foreground hover:text-destructive hover:underline"
            >
              {t("alerts.clearAll")}
            </button>
          </div>
        ) : null}
      </div>
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
          {t("alerts.loading")}
        </div>
      ) : alerts.length === 0 ? (
        <ModuleEmpty title={t("alerts.empty.title")} hint={t("alerts.empty.hint")} />
      ) : (
        <>
          <div className="space-y-2">
            {pageAlerts.map((a) => {
              const isRead = read.has(a.key);
              const Icon = a.level === "critical" ? AlertTriangle : a.level === "warning" ? Activity : CheckCircle2;
              const color =
                a.level === "critical" ? "text-red-400" : a.level === "warning" ? "text-amber-400" : "text-primary";
              return (
                <div
                  key={a.key}
                  className={`group relative rounded-xl border transition hover:bg-card ${isRead ? "border-border/60 bg-card/30 opacity-70" : "border-border bg-card/60"}`}
                >
                  <Link
                    to="/cases/$caseId"
                    params={{ caseId: a.caseId }}
                    onClick={() => markRead(a.key)}
                    className="block p-4 pr-12"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-medium">{a.title}</p>
                          <span className="text-xs text-muted-foreground">{a.caseName}</span>
                        </div>
                        {a.detail ? (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.detail}</p>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDismiss(a.key, a.title);
                    }}
                    title={t("alerts.dismiss")}
                    aria-label={t("alerts.dismiss")}
                    className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                {t("alerts.pager.page", { page: safePage, total: pageCount })}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t("common.pager.prev")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  // Keep the pager compact: current page, its immediate
                  // neighbors, and the first/last page. Everything else
                  // collapses to "…".
                  .filter((n) => n === 1 || n === pageCount || Math.abs(n - safePage) <= 1)
                  .reduce<number[]>((acc, n) => {
                    if (acc.length > 0 && n - acc[acc.length - 1] > 1) acc.push(-1); // -1 = ellipsis marker
                    acc.push(n);
                    return acc;
                  }, [])
                  .map((n, i) =>
                    n === -1 ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">
                        …
                      </span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n)}
                        className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-medium transition ${
                          n === safePage
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-secondary"
                        }`}
                      >
                        {n}
                      </button>
                    ),
                  )}
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={t("common.pager.next")}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
