// Usage Dashboard — every user's single place to see exactly how much of
// their monthly AI allowance remains, when it resets, and what to do next
// if they run out (upgrade, buy more, connect BYOK, or wait for reset).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Gauge,
  MessageSquareText,
  FileText,
  FolderOpen,
  HardDrive,
  Users,
  KeyRound,
  Loader2,
  CalendarClock,
  Sparkles,
} from "lucide-react";
import { getMyUsageDashboard } from "@/lib/usage.functions";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/usage")({
  head: () => ({
    meta: [
      { title: "Usage Dashboard — Nyrava Intelligence México" },
      {
        name: "description",
        content:
          "Track your monthly AI request and Talk-to-Case allowance, storage, and active cases.",
      },
    ],
  }),
  component: UsagePage,
});

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(1)} MB`;
}

function pct(used: number, limit: number | null): number {
  if (limit == null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function UsageMeter({
  icon,
  label,
  used,
  limit,
  remaining,
  unlimitedLabel,
}: {
  icon: React.ReactNode;
  label: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimitedLabel: string;
}) {
  const isUnlimited = limit == null;
  const percent = pct(used, limit);
  const nearLimit = !isUnlimited && percent >= 80;
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {label}
      </div>
      {isUnlimited ? (
        <div className="mt-3 text-2xl font-semibold text-foreground">{unlimitedLabel}</div>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-foreground">{used}</span>
            <span className="text-sm text-muted-foreground">/ {limit} this month</span>
          </div>
          <Progress value={percent} className={`mt-3 ${nearLimit ? "bg-destructive/20" : ""}`} />
          <div
            className={`mt-2 text-xs ${nearLimit ? "text-destructive" : "text-muted-foreground"}`}
          >
            {remaining} remaining
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function UsagePage() {
  const { t } = useI18n();
  const fn = useServerFn(getMyUsageDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["usage-dashboard"],
    queryFn: () => fn(),
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
          <Gauge className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            {t("usage.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("usage.subtitle")}</p>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <>
          <section className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-card/60 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("usage.currentPlan")}
            </div>
            <div className="text-lg font-semibold text-foreground">{data.planLabel}</div>
            {data.source === "free" && (
              <span className="rounded-full border border-border/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                {t("usage.freeTrial")}
              </span>
            )}
            {data.source === "unlimited" && (
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                {t("usage.unlimitedAccess")}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {t("usage.nextReset")}: {new Date(data.nextResetDate).toLocaleDateString()}
            </div>
          </section>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <UsageMeter
              icon={<Sparkles className="h-4 w-4 text-primary" />}
              label={t("usage.aiRequests")}
              used={data.aiRequests.used}
              limit={data.aiRequests.limit}
              remaining={data.aiRequests.remaining}
              unlimitedLabel={t("usage.unlimited")}
            />
            <UsageMeter
              icon={<MessageSquareText className="h-4 w-4 text-primary" />}
              label={t("usage.talkToCase")}
              used={data.talkToCase.used}
              limit={data.talkToCase.limit}
              remaining={data.talkToCase.remaining}
              unlimitedLabel={t("usage.unlimited")}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<FileText className="h-3.5 w-3.5" />}
              label={t("usage.reportsGenerated")}
              value={String(data.reportsGenerated)}
            />
            <StatCard
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label={t("usage.activeCases")}
              value={
                data.caseLimit == null
                  ? String(data.activeCases)
                  : `${data.activeCases} / ${data.caseLimit}`
              }
            />
            <StatCard
              icon={<HardDrive className="h-3.5 w-3.5" />}
              label={t("usage.storageUsed")}
              value={formatBytes(data.storageUsedBytes)}
              sub={
                data.storageGbLimit != null
                  ? `${t("usage.of")} ${data.storageGbLimit} GB`
                  : undefined
              }
            />
            <StatCard
              icon={<Users className="h-3.5 w-3.5" />}
              label={t("usage.teamSeats")}
              value={
                data.teamMemberLimit == null ? t("usage.unlimited") : String(data.teamMemberLimit)
              }
            />
          </div>

          <section className="mt-6 rounded-lg border border-border/60 bg-card/40 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-primary" />
              {t("usage.byok.heading")}
            </div>
            {data.byokConnectedProviders.length > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("usage.byok.connected")}: {data.byokConnectedProviders.join(", ")}.{" "}
                {t("usage.byok.connectedNote")}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t("usage.byok.none")}</p>
            )}
            <Link
              to="/ai-keys"
              className="mt-3 inline-flex items-center gap-2 rounded border border-border/60 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/40"
            >
              <KeyRound className="h-4 w-4" /> {t("usage.byok.manage")}
            </Link>
          </section>

          {(data.aiRequests.remaining === 0 || data.talkToCase.remaining === 0) && (
            <section className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-5">
              <div className="text-sm font-semibold text-destructive">
                {t("usage.exhausted.heading")}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("usage.exhausted.body")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/billing"
                  className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  {t("usage.exhausted.upgrade")}
                </Link>
                <Link
                  to="/ai-keys"
                  className="inline-flex items-center gap-2 rounded border border-border/60 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/40"
                >
                  {t("usage.exhausted.connectByok")}
                </Link>
              </div>
            </section>
          )}

          <p className="mt-6 text-xs text-muted-foreground">{t("usage.footnote")}</p>
        </>
      )}
    </div>
  );
}
