import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DocumentsTab } from "@/components/matter/DocumentsTab";
import { IntelligenceTab } from "@/components/matter/IntelligenceTab";
import { getMatter } from "@/lib/matters";
import { ArrowLeft } from "lucide-react";
import { useI18n, type Locale } from "@/i18n";


export const Route = createFileRoute("/_authenticated/matters/$id")({
  head: () => ({ meta: [{ title: "Asunto · Nyrava México" }] }),
  component: MatterDetail,
});

const TAB_KEYS = ["overview", "parties", "timeline", "documents", "notes", "tasks", "intelligence"] as const;
type TabKey = (typeof TAB_KEYS)[number];

function dateLocale(l: Locale) {
  return l === "en" ? "en-US" : "es-MX";
}

function MatterDetail() {
  const { id } = Route.useParams();
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<TabKey>("overview");
  const q = useQuery({ queryKey: ["matter", id], queryFn: () => getMatter(id) });
  const m = q.data;

  return (
    <AppShell title={m?.title ?? t("matter.default.title")}>
      <Link to="/matters" className="mb-4 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("matter.back")}
      </Link>

      {!m ? (
        <div className="panel p-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : (
        <>
          <div className="panel p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {t(`matter.type.${m.matter_type}`)} · {m.jurisdiction ?? t("matter.noJurisdiction")}
                </div>
                <h1 className="mt-1 font-display text-2xl font-semibold">{m.title}</h1>
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("matter.client")}: {m.client_name ?? t("common.dash")} · {t("matter.ref")}: {m.reference_code ?? t("common.dash")}
                </div>
              </div>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-primary">
                {t(`matter.status.${m.status}`)}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-1 border-b border-border/60">
            {TAB_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
                  tab === k ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`matter.tab.${k}`)}
              </button>
            ))}
          </div>

          <div className="mt-6 panel p-6">
            {tab === "overview" && (
              <div className="space-y-3 text-sm">
                <Row k={t("matter.row.type")} v={t(`matter.type.${m.matter_type}`)} />
                <Row k={t("matter.row.practiceArea")} v={m.practice_area ?? t("common.dash")} />
                <Row k={t("matter.row.jurisdiction")} v={m.jurisdiction ?? t("common.dash")} />
                <Row k={t("matter.row.court")} v={m.court ?? t("common.dash")} />
                <Row k={t("matter.row.docket")} v={m.docket_number ?? t("common.dash")} />
                <Row k={t("matter.row.opened")} v={new Date(m.opened_at).toLocaleDateString(dateLocale(locale))} />
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {t("matter.row.description")}
                  </div>
                  <p className="mt-1 text-foreground">{m.description ?? t("matter.noDescription")}</p>
                </div>
              </div>
            )}
            {tab === "documents" && <DocumentsTab matterId={m.id} orgId={m.org_id} />}
            {tab === "intelligence" && <IntelligenceTab matterId={m.id} />}
            {tab !== "overview" && tab !== "documents" && tab !== "intelligence" && (
              <EmptyState label={t(`matter.tab.${tab}`)} placeholder={t("matter.tab.placeholder")} />
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-border/40 py-2 last:border-0">
      <div className="w-40 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{k}</div>
      <div className="text-foreground">{v}</div>
    </div>
  );
}

function EmptyState({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div className="py-12 text-center">
      <div className="font-display text-lg font-semibold text-foreground">{label}</div>
      <p className="mt-2 text-sm text-muted-foreground">{placeholder}</p>
    </div>
  );
}
