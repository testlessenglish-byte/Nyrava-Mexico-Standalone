import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, LayoutDashboard, LogOut, Scale, Settings, Users, FileText, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { NyravaLogo } from "@/components/NyravaLogo";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyMemberships, getCurrentOrgId, setCurrentOrgId } from "@/lib/workspace";
import { useSession } from "@/hooks/use-session";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; disabled?: boolean };
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { to: "/matters", label: "Asuntos", icon: Briefcase },
  { to: "/people", label: "Personas", icon: Users, disabled: true },
  { to: "/library", label: "Biblioteca", icon: FileText, disabled: true },
  { to: "/settings", label: "Ajustes", icon: Settings, disabled: true },
];

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { user } = useSession();
  const memberships = useQuery({ queryKey: ["memberships"], queryFn: fetchMyMemberships });

  useEffect(() => {
    if (!memberships.data) return;
    if (memberships.data.length === 0) {
      navigate({ to: "/onboarding" });
      return;
    }
    const current = getCurrentOrgId();
    if (!current || !memberships.data.some((m) => m.org_id === current)) {
      setCurrentOrgId(memberships.data[0].org_id);
    }
  }, [memberships.data, navigate]);

  const currentOrgId = getCurrentOrgId();
  const currentOrg = memberships.data?.find((m) => m.org_id === currentOrgId);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border/60 bg-card/40 lg:block">
        <div className="p-5">
          <Link to="/dashboard"><NyravaLogo size={34} withWordmark /></Link>
        </div>
        <div className="px-3 pb-2">
          <div className="rounded-md border border-border/60 bg-background/60 p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Organización</div>
            <select
              className="mt-1 w-full bg-transparent text-sm text-foreground focus:outline-none"
              value={currentOrgId ?? ""}
              onChange={(e) => { setCurrentOrgId(e.target.value); window.location.reload(); }}
            >
              {memberships.data?.map((m) => (
                <option key={m.org_id} value={m.org_id} className="bg-background">
                  {m.organizations.name}
                </option>
              ))}
            </select>
            {currentOrg && (
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-primary">
                {currentOrg.role_in_org}
              </div>
            )}
          </div>
        </div>
        <nav className="mt-2 flex flex-col gap-0.5 px-2">
          {NAV.map((n) => {
            const cls = `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
              n.disabled ? "cursor-not-allowed text-muted-foreground/40" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            }`;
            if (n.disabled) {
              return (
                <div key={n.to} className={cls}>
                  <n.icon className="h-4 w-4" /> {n.label}
                  <span className="ml-auto text-[9px] uppercase tracking-widest opacity-60">pronto</span>
                </div>
              );
            }
            return (
              <Link
                key={n.to}
                to={n.to}
                activeProps={{ className: "bg-primary/10 text-primary" }}
                className={cls}
              >
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto p-3">
          <div className="rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-primary" /> Sesión segura
            </div>
            <div className="mt-1 truncate text-xs text-foreground">{user?.email}</div>
            <button
              onClick={handleSignOut}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-border/60 py-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition hover:bg-background hover:text-foreground"
            >
              <LogOut className="h-3 w-3" /> Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1">
        <header className="flex items-center justify-between border-b border-border/60 bg-background/60 px-6 py-4 backdrop-blur-xl">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Nyrava · México · {currentOrg?.organizations.name ?? "—"}
            </div>
            {title && <h1 className="mt-1 font-display text-xl font-semibold tracking-tight">{title}</h1>}
          </div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Scale className="h-3.5 w-3.5" /> Legal Intelligence OS
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
