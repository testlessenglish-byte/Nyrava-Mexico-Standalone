import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ShieldCheck,
  KeyRound,
  Clock,
  Mail,
  UserCheck,
  Activity,
  AlertTriangle,
  FolderOpen,
  FileText,
  Fingerprint,
} from "lucide-react";
import { getSecurityOverview } from "@/lib/security-dashboard.functions";

export const Route = createFileRoute("/_authenticated/security-dashboard")({
  head: () => ({
    meta: [
      { title: "Security Dashboard — Nyrava" },
      {
        name: "description",
        content:
          "Visibility into your Nyrava workspace: sign-in status, MFA, API keys, and recent account activity.",
      },
    ],
  }),
  component: SecurityDashboardPage,
});

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "default",
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
  hint?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-2 text-[15px] font-semibold ${toneClass}`}>{value}</div>
      {hint ? (
        <div className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function SecurityDashboardPage() {
  const fetchOverview = useServerFn(getSecurityOverview);
  const q = useQuery({
    queryKey: ["security-overview"],
    queryFn: () => fetchOverview(),
  });

  if (q.isLoading) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Loading security overview…
      </div>
    );
  }
  if (q.error || !q.data) {
    return (
      <div className="p-10 text-center text-sm text-destructive">
        Failed to load security overview.
      </div>
    );
  }

  const { user, workspace, apiKeys, recentActivity } = q.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-primary">
          Security
        </div>
        <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
          Security Dashboard
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Everything Nyrava knows about your account's security posture. Data on
          this page is scoped to your user and enforced at the database layer.
          Nothing here reflects other workspaces.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Mail}
          label="Email"
          value={user.email ?? "—"}
          hint={
            user.emailConfirmedAt
              ? `Confirmed ${formatDate(user.emailConfirmedAt)}`
              : "Not confirmed"
          }
        />
        <Stat
          icon={Clock}
          label="Last sign-in"
          value={formatDate(user.lastSignInAt)}
        />
        <Stat
          icon={ShieldCheck}
          label="Multi-factor auth"
          value={user.mfaEnrolled ? "Enabled" : "Not enabled"}
          tone={user.mfaEnrolled ? "good" : "warn"}
          hint={
            user.mfaEnrolled
              ? `${user.mfaFactorCount} verified factor${user.mfaFactorCount === 1 ? "" : "s"}`
              : "Add MFA in Account settings for stronger protection."
          }
        />
        <Stat
          icon={UserCheck}
          label="Sign-in providers"
          value={user.providers.join(", ")}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat icon={FolderOpen} label="Cases in workspace" value={workspace.caseCount} />
        <Stat icon={FileText} label="Documents uploaded" value={workspace.documentCount} />
        <Stat
          icon={Fingerprint}
          label="Firm scope"
          value={workspace.firmId ? "Firm workspace" : "Individual"}
          hint={
            workspace.firmId
              ? "Firm admins in your firm can view firm-scoped cases."
              : "Only you can access your cases."
          }
        />
      </section>

      <MfaEnrollmentCard />



      <section className="rounded-lg border border-border/60 bg-card/40">
        <header className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
          <KeyRound className="h-4 w-4 text-primary" />
          <div className="text-[13.5px] font-semibold text-foreground">
            API keys (bring-your-own providers)
          </div>
        </header>
        <div className="p-4">
          {apiKeys.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No provider keys stored. Requests use Nyrava's managed inference.{" "}
              <Link to="/ai-keys" className="text-primary hover:underline">
                Add a key →
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {apiKeys.map((k) => (
                <li
                  key={`${k.provider}-${k.fingerprint}`}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="text-[13px] font-medium text-foreground">
                      {k.provider}
                      {k.label ? (
                        <span className="text-muted-foreground"> · {k.label}</span>
                      ) : null}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      Fingerprint {k.fingerprint.slice(0, 12)}… · added{" "}
                      {formatDate(k.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={
                        k.isActive
                          ? "rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-emerald-200"
                          : "rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground"
                      }
                    >
                      {k.isActive ? "Active" : "Disabled"}
                    </span>
                    <span className="text-muted-foreground">
                      Last used {formatDate(k.lastUsedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card/40">
        <header className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
          <Activity className="h-4 w-4 text-primary" />
          <div className="text-[13.5px] font-semibold text-foreground">
            Recent account activity
          </div>
        </header>
        <div className="p-4">
          {recentActivity.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No activity recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5">
                  {a.level === "error" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  ) : (
                    <Activity className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-foreground">
                      {a.action}
                      {a.stage ? (
                        <span className="text-muted-foreground"> · {a.stage}</span>
                      ) : null}
                    </div>
                    {a.message ? (
                      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        {a.message}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDate(a.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card/30 p-5 text-[12.5px] leading-relaxed text-muted-foreground">
        <div className="mb-2 flex items-center gap-2 text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-semibold">How this data is scoped</span>
        </div>
        <p>
          Every query on this page is executed as your signed-in user against
          policies enforced by the database (row-level security). Application
          code cannot bypass those policies. For our commitments about what
          Nyrava personnel can and cannot access, see the{" "}
          <Link to="/confidentiality" className="text-primary hover:underline">
            Attorney Confidentiality Commitment
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
