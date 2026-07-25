// Admin → Users & Roles. Super-admin only. Manage tiered access.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listUsersWithRoles, setUserRole, checkIsAdmin } from "@/lib/cases.functions";
import { supabase } from "@/integrations/supabase/client";
import { UserActionsMenu } from "@/components/UserActionsMenu";
import { ShieldCheck, ChevronLeft, Loader2, Crown, Building2, Briefcase, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Nyrava" }] }),
  component: AdminUsersPage,
});

type RoleKey = "super_admin" | "admin" | "firm_admin" | "case_manager" | "user";
const TIERS: { key: RoleKey; label: string; icon: typeof Crown; desc: string }[] = [
  { key: "super_admin", label: "Super Admin", icon: Crown, desc: "Unrestricted control of the platform" },
  { key: "admin", label: "Admin", icon: ShieldCheck, desc: "Manage cases, users, providers" },
  { key: "firm_admin", label: "Firm Admin", icon: Building2, desc: "Firm-level access and configuration" },
  { key: "case_manager", label: "Case Manager", icon: Briefcase, desc: "Create and manage cases" },
  { key: "user", label: "Standard User", icon: UserIcon, desc: "Default access" },
];

function AdminUsersPage() {
  const fetchAdmin = useServerFn(checkIsAdmin);
  const fetchUsers = useServerFn(listUsersWithRoles);
  const mutateRole = useServerFn(setUserRole);
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const { data: gate } = useQuery({ queryKey: ["isAdmin"], queryFn: () => fetchAdmin() });
  const {
    data: users,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["adminUsersWithRoles"],
    queryFn: () => fetchUsers(),
    enabled: Boolean(gate?.isSuperAdmin || gate?.isAdmin),
  });
  const { data: currentUserId } = useQuery({
    queryKey: ["authUserId"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  const toggle = useMutation({
    mutationFn: (vars: { targetUserId: string; role: RoleKey; grant: boolean }) => mutateRole({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["adminUsersWithRoles"] });
      toast.success("Role updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!gate?.isSuperAdmin && !gate?.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-10">
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
          <h2 className="text-lg font-semibold text-destructive">Super Admin required</h2>
          <p className="mt-2 text-sm">Only Super Admins can manage user roles.</p>
        </div>
      </div>
    );
  }

  const filtered = (users ?? []).filter((u) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (u.email ?? "").toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Admin
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-2xl font-semibold">Users & Roles</h1>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by email or name…"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {TIERS.map((t) => (
          <div key={t.key} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <t.icon className="h-4 w-4 text-accent" />
              {t.label}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t.desc}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="p-10 text-muted-foreground">Loading users…</div>
      ) : error ? (
        <div className="p-6 text-destructive">{(error as Error).message}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-center">Status</th>
                {TIERS.map((t) => (
                  <th key={t.key} className="px-3 py-2 text-center">
                    {t.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.is_blocked ? (
                      <span className="inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                        Blocked
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        Active
                      </span>
                    )}
                  </td>
                  {TIERS.map((t) => {
                    const has = u.roles.includes(t.key);
                    const pending =
                      toggle.isPending && toggle.variables?.targetUserId === u.id && toggle.variables?.role === t.key;
                    return (
                      <td key={t.key} className="px-3 py-2 text-center">
                        <button
                          disabled={pending}
                          onClick={() => toggle.mutate({ targetUserId: u.id, role: t.key, grant: !has })}
                          className={`inline-flex h-7 min-w-[3.25rem] items-center justify-center rounded-full border px-3 text-xs font-medium transition ${
                            has
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "border-border bg-background text-muted-foreground hover:border-accent/40"
                          }`}
                          title={has ? `Remove ${t.label}` : `Grant ${t.label}`}
                        >
                          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : has ? "Yes" : "No"}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <UserActionsMenu
                      userId={u.id}
                      email={u.email}
                      blocked={u.is_blocked}
                      canRemove={Boolean(gate?.isSuperAdmin)}
                      isSelf={Boolean(currentUserId) && currentUserId === u.id}
                      onAfter={() => void qc.invalidateQueries({ queryKey: ["adminUsersWithRoles"] })}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={TIERS.length + 2} className="p-6 text-center text-muted-foreground">
                    No users match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Roles are stored in <code>user_roles</code> with RLS enforced by <code>has_role()</code>. Removing your own last
        Super Admin role is blocked.
      </p>
    </div>
  );
}
