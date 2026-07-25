// Admin beta testers — grant a user full billing access (no Stripe
// subscription, no free-case limit) by email. Beta testers automatically
// use the platform AI key (see ai-key-router.server.ts fallback) unless
// they add their own, so there's nothing else to configure for them.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, FlaskConical, Loader2, Mail, UserPlus, X } from "lucide-react";
import {
  adminListUsersWithSubscriptions,
  adminAddBetaTester,
  adminRemoveBetaTester,
  adminListPendingBetaInvites,
  adminCancelBetaInvite,
} from "@/lib/billing.functions";

export const Route = createFileRoute("/_app/admin/beta")({
  head: () => ({ meta: [{ title: "Beta testers — Admin" }] }),
  component: AdminBetaPage,
});

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function AdminBetaPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListUsersWithSubscriptions);
  const addFn = useServerFn(adminAddBetaTester);
  const removeFn = useServerFn(adminRemoveBetaTester);
  const invitesFn = useServerFn(adminListPendingBetaInvites);
  const cancelInviteFn = useServerFn(adminCancelBetaInvite);

  const usersQ = useQuery({ queryKey: ["admin-users-subscriptions"], queryFn: () => listFn() });
  const invitesQ = useQuery({ queryKey: ["admin-pending-beta-invites"], queryFn: () => invitesFn() });

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const addM = useMutation({
    mutationFn: () => addFn({ data: { email: email.trim(), note: note.trim() || undefined } }),
    onSuccess: (res) => {
      if (res.pending) {
        toast.success(`Invite queued for ${email.trim()} — access activates the moment they sign up.`);
      } else {
        toast.success(`${email.trim()} now has beta access`);
      }
      setEmail("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin-users-subscriptions"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-beta-invites"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to add beta tester"),
  });

  const removeM = useMutation({
    mutationFn: (userId: string) => removeFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("Beta access revoked");
      qc.invalidateQueries({ queryKey: ["admin-users-subscriptions"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to revoke"),
  });

  const cancelInviteM = useMutation({
    mutationFn: (inviteEmail: string) => cancelInviteFn({ data: { email: inviteEmail } }),
    onSuccess: () => {
      toast.success("Invite cancelled");
      qc.invalidateQueries({ queryKey: ["admin-pending-beta-invites"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to cancel invite"),
  });

  const rows = useMemo(() => usersQ.data ?? [], [usersQ.data]);
  const betaTesters = useMemo(() => rows.filter((r) => r.is_beta_tester), [rows]);
  const pendingInvites = useMemo(() => invitesQ.data ?? [], [invitesQ.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.email ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-10">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" /> Admin
        </Link>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-accent" /> Beta testers
        </h1>
      </div>

      <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
        A beta tester gets full access — no Stripe subscription, no one-time-free-case limit — the moment they log in.
        They don't need an API key of their own: if they haven't added one under "API Keys", their requests automatically
        use the platform key. Add an email below any time — if they already have an account it's granted instantly; if
        not, it's queued as an invite and activates automatically the moment they sign up at{" "}
        <Link to="/auth" className="underline">
          /auth
        </Link>{" "}
        with that email. No second step needed on your end.
      </p>

      <div className="rounded-xl border border-border bg-card p-5 mb-8">
        <h2 className="font-semibold mb-3">Grant beta access</h2>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="email"
            placeholder="attorney@lawfirm.com"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="text"
            placeholder="Note (optional — e.g. 'Smith & Associates, litigation beta')"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            onClick={() => addM.mutate()}
            disabled={addM.isPending || !email.trim()}
            className="rounded-md bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-black px-4 py-2 text-sm flex items-center gap-2 justify-center"
          >
            {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Grant access
          </button>
        </div>
        {addM.isError && (
          <p className="mt-2 text-xs text-destructive">
            {addM.error instanceof Error ? addM.error.message : "Failed to add beta tester"}
          </p>
        )}
      </div>

      <h2 className="font-semibold mb-3">
        Pending invites <span className="text-muted-foreground font-normal">({pendingInvites.length})</span>
      </h2>
      <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
        Added before the person signed up. Activates automatically the moment they create an account with this email —
        no need to come back and re-add them.
      </p>
      {invitesQ.isLoading && <div className="text-sm text-muted-foreground mb-6">Loading…</div>}
      {pendingInvites.length === 0 && !invitesQ.isLoading && (
        <div className="text-sm text-muted-foreground mb-8">No pending invites.</div>
      )}
      {pendingInvites.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Note</th>
                <th className="text-left px-4 py-2">Invited</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.email} className="border-t border-border">
                  <td className="px-4 py-2 flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    {inv.email}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{inv.note ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(inv.invited_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Cancel the pending invite for ${inv.email}?`)) cancelInviteM.mutate(inv.email);
                      }}
                      disabled={cancelInviteM.isPending && cancelInviteM.variables === inv.email}
                      className="rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 px-2.5 py-1 text-xs inline-flex items-center gap-1"
                    >
                      {cancelInviteM.isPending && cancelInviteM.variables === inv.email ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="font-semibold mb-3">
        Current beta testers <span className="text-muted-foreground font-normal">({betaTesters.length})</span>
      </h2>
      {usersQ.isLoading && <div className="text-sm text-muted-foreground mb-6">Loading…</div>}
      {betaTesters.length === 0 && !usersQ.isLoading && (
        <div className="text-sm text-muted-foreground mb-8">No beta testers yet.</div>
      )}
      {betaTesters.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Note</th>
                <th className="text-left px-4 py-2">Granted</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {betaTesters.map((r) => (
                <tr key={r.user_id} className="border-t border-border">
                  <td className="px-4 py-2">{r.email ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.beta_note ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(r.beta_granted_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Revoke beta access for ${r.email}?`)) removeM.mutate(r.user_id);
                      }}
                      disabled={removeM.isPending && removeM.variables === r.user_id}
                      className="rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 px-2.5 py-1 text-xs inline-flex items-center gap-1"
                    >
                      {removeM.isPending && removeM.variables === r.user_id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">All users</h2>
        <input
          type="text"
          placeholder="Search by email…"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Email</th>
              <th className="text-left px-4 py-2">Signed up</th>
              <th className="text-left px-4 py-2">Plan</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-right px-4 py-2">Beta</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 50).map((r) => (
              <tr key={r.user_id} className="border-t border-border">
                <td className="px-4 py-2">{r.email ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDate(r.user_created_at)}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.plan ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.status}</td>
                <td className="px-4 py-2 text-right">
                  {r.is_beta_tester ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-teal-500/20 text-teal-400">Beta</span>
                  ) : (
                    <button
                      onClick={() => {
                        setEmail(r.email ?? "");
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      Add
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 50 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
            Showing 50 of {filtered.length} — narrow with search.
          </div>
        )}
      </div>
    </div>
  );
}
