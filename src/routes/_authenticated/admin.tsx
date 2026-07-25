import { createFileRoute, Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminStats, checkIsAdmin, deleteAuditLogEntries } from "@/lib/cases.functions";
import { listFixtureCorpora, seedFixtureCorpus } from "@/lib/seed-fixture.functions";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/StatusBadge";
import { CaseActionsMenu } from "@/components/CaseActionsMenu";
import { UserActionsMenu } from "@/components/UserActionsMenu";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users,
  FolderOpen,
  FileText,
  Activity,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Trash2,
  UserPlus,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Nyrava" }] }),
  component: AdminPage,
});

const ADMIN_PAGE_SIZE = 8;
const RUNNING_CASE_STATUSES = new Set([
  "queued",
  "running",
  "extracting",
  "analyzing",
  "agents_running",
  "ocr",
  "scoring",
  "reporting",
  "generating_report",
  "intelligence_running",
]);

function AdminPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/admin") return <Outlet />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const fetchAdminStats = useServerFn(adminStats);
  const fetchIsAdmin = useServerFn(checkIsAdmin);
  const [casePage, setCasePage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const [usagePage, setUsagePage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["adminStats"],
    queryFn: () => fetchAdminStats(),
    refetchInterval: 10000,
  });
  const { data: gate } = useQuery({ queryKey: ["isAdmin"], queryFn: () => fetchIsAdmin() });
  const { data: currentUserId } = useQuery({
    queryKey: ["authUserId"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (error)
    return (
      <div className="mx-auto max-w-2xl p-10">
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
          <h2 className="text-lg font-semibold text-destructive">Couldn't load admin console</h2>
          <p className="mt-2 text-sm text-destructive/90">{(error as Error).message}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            If you're the project owner and have never been granted admin, go to Settings → "Claim owner / admin role".
          </p>
        </div>
      </div>
    );
  if (!data) return null;

  const failed = data.cases.filter((c) => c.status === "failed").length;
  const complete = data.cases.filter((c) => c.status === "complete").length;
  const inProg = data.cases.length - failed - complete;
  const totalTokens = data.usage.reduce((s, u) => s + (u.total_tokens ?? 0), 0);
  const failedAi = data.usage.filter((u) => !u.success).length;
  const casePager = pageWindow(data.cases, casePage);
  const userPager = pageWindow(data.users, userPage);
  const usagePager = pageWindow(data.usage, usagePage);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-10">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-accent" />
          <h1 className="min-w-0 text-3xl font-semibold">Administrator console</h1>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to="/admin/pipeline-ledger"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            Pipeline Ledger →
          </Link>
          <Link to="/admin/users" className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted">
            Users & Roles →
          </Link>
          <Link
            to="/admin/team"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted flex items-center gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" /> Team & Seats →
          </Link>
          <Link
            to="/admin/ai-providers"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            AI Providers →
          </Link>
          <Link
            to="/admin/billing"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
          >
            Billing Plans →
          </Link>
          <Link
            to="/admin/beta"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted flex items-center gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" /> Beta Testers →
          </Link>
          <Link
            to="/admin/demo-cases"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted flex items-center gap-1.5"
          >
            <FlaskConical className="h-3.5 w-3.5" /> Demo Cases →
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <Stat icon={Users} label="Users" value={data.users.length} />
        <Stat icon={FolderOpen} label="Cases" value={data.cases.length} />
        <Stat icon={FileText} label="Reports" value={data.reports.length} />
        <Stat icon={Activity} label="AI calls" value={data.usage.length} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Stat label="In progress" value={inProg} tone="warning" />
        <Stat label="Complete" value={complete} tone="success" />
        <Stat label="Failed" value={failed} tone="destructive" />
      </div>

      <Section title="System health">
        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <Row k="Total tokens used" v={totalTokens.toLocaleString()} />
          <Row k="Failed AI calls" v={String(failedAi)} />
          <Row
            k="Avg latency"
            v={`${Math.round(data.usage.reduce((s, u) => s + (u.latency_ms ?? 0), 0) / Math.max(1, data.usage.length))} ms`}
          />
        </div>
      </Section>

      <FixtureSeederPanel onSeeded={() => void refetch()} />

      <Section
        title="Cases"
        action={
          <Pager
            page={casePager.page}
            totalPages={casePager.totalPages}
            totalItems={data.cases.length}
            onPage={setCasePage}
          />
        }
      >
        <Table cols={["Name", "Status", "User", "Created", ""]}>
          {casePager.items.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="max-w-[220px] px-4 py-2 font-medium">
                <div className="truncate">{c.name}</div>
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={c.status} progress={100} />
              </td>
              <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.user_id.slice(0, 8)}…</td>
              <td className="px-4 py-2 text-muted-foreground">{new Date(c.created_at).toLocaleString()}</td>
              <td className="px-4 py-2 text-right">
                <CaseActionsMenu
                  caseId={c.id}
                  name={c.name}
                  running={RUNNING_CASE_STATUSES.has(c.status)}
                  onAfter={() => void refetch()}
                />
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="Users"
        action={
          <Pager
            page={userPager.page}
            totalPages={userPager.totalPages}
            totalItems={data.users.length}
            onPage={setUserPage}
          />
        }
      >
        <Table cols={["Email", "Name", "Joined", "Status", ""]}>
          {userPager.items.map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td className="px-4 py-2">{u.email}</td>
              <td className="px-4 py-2">{u.full_name}</td>
              <td className="px-4 py-2 text-muted-foreground">{new Date(u.created_at).toLocaleString()}</td>
              <td className="px-4 py-2">
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
              <td className="px-4 py-2 text-right">
                <UserActionsMenu
                  userId={u.id}
                  email={u.email}
                  blocked={u.is_blocked}
                  canRemove={Boolean(gate?.isSuperAdmin)}
                  isSelf={Boolean(currentUserId) && currentUserId === u.id}
                  onAfter={() => void refetch()}
                />
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        title="AI usage (latest)"
        action={
          <Pager
            page={usagePager.page}
            totalPages={usagePager.totalPages}
            totalItems={data.usage.length}
            onPage={setUsagePage}
          />
        }
      >
        <Table cols={["When", "Op", "Model", "Tokens", "Latency", "OK"]}>
          {usagePager.items.map((u, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-4 py-2 text-muted-foreground">{new Date(u.created_at).toLocaleString()}</td>
              <td className="px-4 py-2">{u.operation}</td>
              <td className="px-4 py-2 font-mono text-xs">{u.model}</td>
              <td className="px-4 py-2 tabular-nums">{u.total_tokens ?? "—"}</td>
              <td className="px-4 py-2 tabular-nums">{u.latency_ms} ms</td>
              <td className="px-4 py-2">{u.success ? "✓" : <span className="text-destructive">✗</span>}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <AuditLogSection audit={data.audit ?? []} onChanged={() => void refetch()} />
    </div>
  );
}

const AUDIT_PAGE_SIZE = 15;

function AuditLogSection({
  audit,
  onChanged,
}: {
  audit: Array<{
    id: string;
    action: string;
    actor_id: string | null;
    target: string | null;
    meta: unknown;
    created_at: string;
  }>;
  onChanged: () => void;
}) {
  const deleteEntries = useServerFn(deleteAuditLogEntries);
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState<"selected" | "all" | null>(null);

  const actions = Array.from(new Set(audit.map((a) => a.action))).sort();
  const filtered = filter === "all" ? audit : audit.filter((a) => a.action === filter);
  const pager = pageWindow(filtered, page, AUDIT_PAGE_SIZE);
  const pageIds = pager.items.map((a) => a.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const deleteM = useMutation({
    mutationFn: (vars: { ids?: string[]; deleteAll?: boolean; action?: string }) => deleteEntries({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.deleteAll
          ? "Audit entries deleted"
          : `Deleted ${vars.ids?.length ?? 0} entr${(vars.ids?.length ?? 0) === 1 ? "y" : "ies"}`,
      );
      setSelected(new Set());
      setConfirmBulk(null);
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllOnPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  return (
    <Section
      title="Admin audit log"
      action={<Pager page={pager.page} totalPages={pager.totalPages} totalItems={filtered.length} onPage={setPage} />}
    >
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs">
          <label className="text-muted-foreground">Filter:</label>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="all">All actions ({audit.length})</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a} ({audit.filter((x) => x.action === a).length})
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {selected.size > 0 && (
              <>
                <span className="text-muted-foreground">{selected.size} selected</span>
                <button
                  onClick={() => setConfirmBulk("selected")}
                  disabled={deleteM.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete selected
                </button>
              </>
            )}
            {filtered.length > 0 && (
              <button
                onClick={() => setConfirmBulk("all")}
                disabled={deleteM.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete {filter === "all" ? "all" : `all "${filter}"`}
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleAllOnPage}
                    aria-label="Select all entries on this page"
                  />
                </th>
                <th className="px-4 py-2 text-left font-medium">When</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Actor</th>
                <th className="px-4 py-2 text-left font-medium">Target</th>
                <th className="px-4 py-2 text-left font-medium">Details</th>
                <th className="px-4 py-2 text-right font-medium">Delete</th>
              </tr>
            </thead>
            <tbody>
              {pager.items.map((a) => (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleOne(a.id)}
                      aria-label="Select entry"
                    />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-medium">{a.action}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {a.actor_id ? `${a.actor_id.slice(0, 8)}…` : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {a.target ? `${a.target.slice(0, 12)}…` : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground max-w-md truncate">
                    {a.meta ? JSON.stringify(a.meta) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => deleteM.mutate({ ids: [a.id] })}
                      disabled={deleteM.isPending}
                      className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      aria-label="Delete entry"
                      title="Delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground text-sm">
                    No audit entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog open={confirmBulk !== null} onOpenChange={(open) => !open && setConfirmBulk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmBulk === "selected"
                ? `Delete ${selected.size} audit entr${selected.size === 1 ? "y" : "ies"}?`
                : `Delete ${filter === "all" ? "the entire" : `all "${filter}"`} audit log?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes these audit records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmBulk === "selected") deleteM.mutate({ ids: Array.from(selected) });
                else deleteM.mutate({ deleteAll: true, action: filter === "all" ? undefined : filter });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function FixtureSeederPanel({ onSeeded }: { onSeeded: () => void }) {
  const fetchList = useServerFn(listFixtureCorpora);
  const seedFn = useServerFn(seedFixtureCorpus);
  const navigate = useNavigate();
  const { data: corpora, isLoading } = useQuery({
    queryKey: ["fixtureCorpora"],
    queryFn: () => fetchList(),
  });
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ caseId: string; documentCount: number; extractedChars: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seed = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await seedFn({ data: { practiceArea: selected } });
      setResult({ caseId: r.caseId, documentCount: r.documentCount, extractedChars: r.extractedChars });
      onSeeded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Fixture corpora (diagnostics)">
      <div className="rounded-xl border border-border bg-card p-5 text-sm">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 text-accent shrink-0" />
          <div className="flex-1 space-y-3">
            <p className="text-muted-foreground">
              Create a fresh case seeded with the substantive evidence corpus bundled at
              <span className="font-mono"> tests/fixtures/corpora/&lt;area&gt;/</span>. Use this to verify witness,
              opportunity, trial-prep, and discovery engines against real named-individual content instead of the
              one-line routing-benchmark stubs.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={isLoading || busy}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">{isLoading ? "Loading corpora…" : "Select a practice area…"}</option>
                {(corpora ?? []).map((c) => (
                  <option key={c.practiceArea} value={c.practiceArea}>
                    {c.practiceArea} ({c.fileCount} files)
                  </option>
                ))}
              </select>
              <button
                onClick={seed}
                disabled={!selected || busy}
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
              >
                {busy ? "Seeding & extracting…" : "Seed new case"}
              </button>
              {result && (
                <button
                  onClick={() => navigate({ to: "/cases/$caseId", params: { caseId: result.caseId } })}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
                >
                  Open case →
                </button>
              )}
            </div>
            {result && (
              <div className="rounded-md border border-success/40 bg-success/10 p-3 text-xs">
                <div className="font-medium text-success">
                  Uploaded {result.documentCount} documents · {result.extractedChars.toLocaleString()} bytes total.
                </div>
                <div className="mt-1 font-mono text-muted-foreground">case_id: {result.caseId}</div>
                <div className="mt-1 text-muted-foreground">
                  Open the case and click <span className="font-medium">Run Case</span> to extract + analyze against
                  substantive evidence.
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

function pageWindow<T>(items: T[], requestedPage: number, pageSize: number = ADMIN_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { page, totalPages, items: items.slice(start, start + pageSize) };
}

function Pager({
  page,
  totalPages,
  totalItems,
  onPage,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return <span className="text-xs text-muted-foreground">{totalItems} total</span>;
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-muted disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {page}/{totalPages}
      </span>
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm hover:bg-muted disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon?: typeof Users;
  label: string;
  value: number;
  tone?: "success" | "warning" | "destructive";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-4 w-4" />}
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="min-w-0 text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border py-2 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium tabular-nums">{v}</span>
    </div>
  );
}

function Table({ cols, children }: { cols: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            {cols.map((c) => (
              <th key={c} className="px-4 py-2 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
