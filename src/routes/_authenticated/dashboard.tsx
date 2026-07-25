import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { getCurrentOrgId } from "@/lib/workspace";
import { listMatters, MATTER_TYPE_LABEL, MATTER_STATUS_LABEL } from "@/lib/matters";
import { Briefcase, Clock, FileText, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Panel · Nyrava México" }] }),
  component: DashboardPage,
});

function DashboardPage() {
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
    <AppShell title="Panel de inteligencia">
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={Briefcase} label="Asuntos totales" value={matters.length} />
        <Stat icon={Clock} label="En intake" value={intake} />
        <Stat icon={FileText} label="Activos" value={active} />
        <Stat icon={ShieldCheck} label="Seguridad" value="RLS ✓" small />
      </div>

      <div className="mt-8 panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Asuntos recientes</h2>
          <Link to="/matters" className="text-[11px] uppercase tracking-[0.18em] text-primary hover:brightness-110">Ver todos →</Link>
        </div>
        {matters.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-border/70 p-8 text-center">
            <p className="text-sm text-muted-foreground">Aún no hay asuntos registrados.</p>
            <Link to="/matters" className="mt-3 inline-flex rounded-md bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground hover:brightness-110">
              Crear el primer asunto
            </Link>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border/50">
            {matters.slice(0, 5).map((m) => (
              <Link key={m.id} to="/matters/$id" params={{ id: m.id }} className="flex items-center justify-between py-3 hover:bg-background/40">
                <div>
                  <div className="text-sm font-medium text-foreground">{m.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {MATTER_TYPE_LABEL[m.matter_type]} · {m.client_name ?? "sin cliente"}
                  </div>
                </div>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-primary">
                  {MATTER_STATUS_LABEL[m.status]}
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
