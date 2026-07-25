import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { getCurrentOrgId } from "@/lib/workspace";
import { listMatters } from "@/lib/matters";
import { Briefcase, Clock, FileText, ShieldCheck } from "lucide-react";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Panel · Nyrava México" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useI18n();
  const orgId = getCurrentOrgId();
  const q = useQuery({
    queryKey: ["matters", orgId],
    queryFn: () => listMatters(orgId!),
    enabled: !!orgId,
  });
  const matters = q.data ?? [];
  const active = matters.filter((m) => m.status === "active").length;
  const intake = matters.filter((m) => m.status === "intake").length;

  return (
    <AppShell title={t("dashboard.title")}>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Briefcase} label={t("dashboard.stat.total")} value={matters.length} />
        <Stat icon={Clock} label={t("dashboard.stat.intake")} value={intake} />
        <Stat icon={FileText} label={t("dashboard.stat.active")} value={active} />
        <Stat icon={ShieldCheck} label={t("dashboard.stat.security")} value="RLS ✓" small />
      </div>

      <div className="mt-8 panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{t("dashboard.recent.title")}</h2>
          <Link to="/matters" className="text-[11px] uppercase tracking-[0.18em] text-primary hover:brightness-110">
            {t("common.viewAll")} →
          </Link>
        </div>
        {matters.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border/70 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("dashboard.recent.empty")}</p>
            <Link to="/matters" className="mt-3 inline-flex rounded-md bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground hover:brightness-110">
              {t("dashboard.recent.createFirst")}
            </Link>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border/50">
            {matters.slice(0, 5).map((m) => (
              <Link key={m.id} to="/matters/$id" params={{ id: m.id }} className="flex items-center justify-between py-3 hover:bg-background/40">
                <div>
                  <div className="text-sm font-medium text-foreground">{m.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t(`matter.type.${m.matter_type}`)} · {m.client_name ?? t("dashboard.recent.noClient")}
                  </div>
                </div>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-primary">
                  {t(`matter.status.${m.status}`)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ icon: Icon, label, value, small }: { icon: any; label: string; value: string | number; small?: boolean }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {label}
      </div>
      <div className={`mt-2 font-display font-semibold text-foreground ${small ? "text-lg" : "text-3xl"}`}>{value}</div>
    </div>
  );
}
