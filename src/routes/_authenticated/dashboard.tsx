import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { listCases } from "@/lib/cases.functions";
import { PipelineStatusGrid } from "@/components/PipelineStatusGrid";
import {
  FileText,
  FileSearch,
  Users,
  AlertTriangle,
  HelpCircle,
  ChevronRight,
  Mic,
  MessageSquare,
  Target,
  Bell,
  Plus,
  Activity,
  Sparkles,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Nyrava" }] }),
  component: DashboardPage,
});

const RUNNING = new Set(["extracting", "analyzing", "agents_running", "scoring", "reporting", "intelligence_running"]);

function DashboardPage() {
  const fetchCases = useServerFn(listCases);
  const { data, isLoading } = useQuery({
    queryKey: ["cases"],
    queryFn: () => fetchCases(),
    refetchInterval: 5000,
  });

  const cases = useMemo(() => (data ?? []).filter((c) => !c.archived_at), [data]);
  const featured = cases.find((c) => c.status === "complete") ?? cases[0];
  const activeCount = cases.filter((c) => RUNNING.has(c.status)).length;
  const completeCount = cases.filter((c) => c.status === "complete").length;
  // Previously this counted FAILED cases and mislabeled that as
  // "High-Priority Findings" — an entirely different concept. The real
  // number is the sum of critical/high case_findings across all cases,
  // now joined in by listCases().
  const highPriorityCount = useMemo(
    () => cases.reduce((sum, c) => sum + ((c as { high_priority_findings?: number }).high_priority_findings ?? 0), 0),
    [cases],
  );
  // Aggregate portfolio totals for the Intelligence Summary row. These
  // were previously hardcoded to the literal string "—" regardless of
  // how many cases had actually finished analysis — now summed from the
  // same joined data every other widget reads.
  const witnessTotal = useMemo(
    () => cases.reduce((sum, c) => sum + ((c as { witness_count?: number }).witness_count ?? 0), 0),
    [cases],
  );
  const contradictionTotal = useMemo(
    () => cases.reduce((sum, c) => sum + ((c as { contradiction_count?: number | null }).contradiction_count ?? 0), 0),
    [cases],
  );
  const discoveryGapTotal = useMemo(
    () => cases.reduce((sum, c) => sum + ((c as { discovery_gap_count?: number | null }).discovery_gap_count ?? 0), 0),
    [cases],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-8 md:py-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiChip icon={<FileText className="h-4 w-4" />} value={cases.length} label="Active Cases" tone="primary" />
        <KpiChip
          icon={<Activity className="h-4 w-4" />}
          value={completeCount}
          label="Analyses Complete"
          tone="success"
        />
        <KpiChip
          icon={<AlertTriangle className="h-4 w-4" />}
          value={highPriorityCount}
          label="High-Priority Findings"
          tone="danger"
        />
      </div>

      {/* Featured Case */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
          Loading your cases…
        </div>
      ) : featured ? (
        <FeaturedCaseCard caseRow={featured} />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card/60 p-10 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-lg font-semibold">Welcome to Nyrava</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your first case to unlock the intelligence pipeline.
          </p>
          <Link
            to="/new"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Analyze New Case
          </Link>
        </div>
      )}

      {/* Intelligence Summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile icon={<FileText className="h-5 w-5" />} value={cases.length} label="Cases" tone="primary" />
        <StatTile icon={<FileSearch className="h-5 w-5" />} value={completeCount} label="Analyzed" tone="success" />
        <StatTile icon={<Users className="h-5 w-5" />} value={witnessTotal} label="Witnesses" tone="accent" />
        <StatTile
          icon={<AlertTriangle className="h-5 w-5" />}
          value={contradictionTotal}
          label="Contradictions"
          tone="warning"
        />
        <StatTile
          icon={<HelpCircle className="h-5 w-5" />}
          value={discoveryGapTotal}
          label="Discovery Gaps"
          tone="accent"
        />
      </div>

      {/* Command Center + Talk + Activity */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          {featured ? (
            <div className="rounded-xl border border-border bg-card/60 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">Analysis Command Center</h2>
                  <p className="text-xs text-primary">Real-time intelligence build</p>
                </div>
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: featured.id }}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open case <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <PipelineStatusGrid caseRow={featured as any} />
            </div>
          ) : null}

          <Link
            to="/talk"
            className="block rounded-xl border border-primary/30 bg-primary/5 p-5 transition hover:bg-primary/10"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-primary">TALK TO YOUR CASES</div>
                  <div className="text-xs text-muted-foreground">
                    Ask questions. Get Nyrava Intelligence answers with evidence citations.
                  </div>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-primary" />
            </div>
          </Link>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card/60 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h2>
              <Link to="/cases" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
            {cases.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Activity will appear here as cases run.</p>
            ) : (
              <ul className="space-y-3">
                {cases.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 text-xs">
                    <Link
                      to="/cases/$caseId"
                      params={{ caseId: c.id }}
                      className="min-w-0 flex-1 truncate hover:text-primary"
                    >
                      <span className="font-medium text-foreground">{c.name}</span>
                      <span className="ml-2 text-muted-foreground">{c.status_message ?? c.status}</span>
                    </Link>
                    <span className="shrink-0 text-muted-foreground">
                      <Clock className="inline h-3 w-3" /> {timeAgo(c.completed_at ?? c.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {activeCount > 0 ? (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-warning" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-warning">
                    {activeCount} case{activeCount === 1 ? "" : "s"} processing
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Intelligence pipeline is running. Results unlock as each stage completes.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <QuickAction to="/new" icon={<Plus className="h-5 w-5" />} label="New Case" />
        <QuickAction to="/reports" icon={<FileText className="h-5 w-5" />} label="Reports" />
        <QuickAction to="/strategy" icon={<Target className="h-5 w-5" />} label="Strategy" />
        <QuickAction to="/alerts" icon={<Bell className="h-5 w-5" />} label="Alerts" />
      </div>
    </div>
  );
}

function KpiChip({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  tone: "primary" | "success" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "text-success bg-success/10 ring-success/30"
      : tone === "danger"
        ? "text-destructive bg-destructive/10 ring-destructive/30"
        : "text-primary bg-primary/10 ring-primary/30";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
      <span className={`grid h-10 w-10 place-items-center rounded-lg ring-1 ${toneCls}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-none">{value}</div>
        <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  tone: "primary" | "success" | "accent" | "warning";
}) {
  const toneCls =
    tone === "success"
      ? "text-success border-success/30"
      : tone === "warning"
        ? "text-warning border-warning/30"
        : tone === "accent"
          ? "text-accent border-accent/30"
          : "text-primary border-primary/30";
  return (
    <div className={`flex flex-col items-start gap-1 rounded-xl border bg-card/60 p-4 ${toneCls}`}>
      <span className="opacity-80">{icon}</span>
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function QuickAction({
  to,
  icon,
  label,
}: {
  to: "/new" | "/reports" | "/strategy" | "/alerts";
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 transition hover:border-primary/40 hover:bg-primary/5"
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

function FeaturedCaseCard({ caseRow }: { caseRow: NonNullable<ReturnType<typeof useMemoFeatured>> }) {
  const score = (caseRow as { score?: number | null }).score ?? null;
  const isComplete = caseRow.status === "complete";
  const tone =
    score == null
      ? "text-muted-foreground"
      : score >= 70
        ? "text-success"
        : score >= 40
          ? "text-warning"
          : "text-destructive";
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Featured Case</div>
          <h2 className="mt-1 truncate text-xl font-semibold md:text-2xl">{caseRow.name}</h2>
          <div className="mt-1 text-xs text-muted-foreground">{caseRow.status_message ?? caseRow.status}</div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Case Score</div>
            {!isComplete ? (
              // Never show a bare "—" while the pipeline is still running —
              // that reads as "nothing here" rather than "still working".
              <div className="text-sm font-medium text-muted-foreground">Calculating…</div>
            ) : (
              <>
                <div className={`text-4xl font-bold ${tone}`}>{score ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground">/ 100</div>
              </>
            )}
          </div>
          <Link
            to="/cases/$caseId"
            params={{ caseId: caseRow.id }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            View Case <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

// Type helper for FeaturedCaseCard prop inference
function useMemoFeatured() {
  return null as unknown as {
    id: string;
    name: string;
    status: string;
    status_message: string | null;
    score?: number | null;
  };
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
