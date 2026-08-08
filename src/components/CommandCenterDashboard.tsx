// NYRAVA Intelligence Command Center
// ---------------------------------------------------------------
// Mission-control style dashboard rendered at the top of a case
// detail page. Every value is wired to live data — engine statuses
// come from `pipeline_engine_runs`, the activity feed from
// `pipeline_events`, and counts from the canonical report helpers.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  FileText,
  Gauge,
  Loader2,
  MessageCircle,
  Mic,
  Radar,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getCanonicalCounts,
  getEssState,
  getScores,
  getAgentSummary,
  paritySignature,
  type ReportLike,
} from "@/lib/intelligence/canonical";
import { useI18n } from "@/i18n";
import { localizeActivityMessage } from "@/lib/activity-i18n";
import { engineLabelKey, isStageRelevantForCaseType, resolveStageKeyLoose, statusLabelKey } from "@/lib/execution/mx-pipeline";
import { scoreBand } from "@/lib/score-bands";
import { useCaseExecution } from "@/hooks/useCaseExecution";
import { COMMAND_CENTER_ENGINES } from "@/lib/execution/canonical";

type EngineStatus = "queued" | "running" | "completed" | "failed" | "skipped";

type EngineRow = {
  id: string;
  engine: string;
  status: EngineStatus;
  runtime_ms: number | null;
  generated: number;
  accepted: number;
  rejected: number;
  suppressed_ess: number;
  suppressed_validator: number;
  created_at?: string | null;
  started_at: string | null;
  ended_at: string | null;
};

type EventRow = {
  id: string;
  stage: string;
  level: string;
  message: string;
  created_at: string;
};

type Props = {
  caseId: string;
  caseName: string;
  status: string | null | undefined;
  progress: number | null | undefined;
  documentsCount: number;
  report: ReportLike | null | undefined;
  caseRow?: Record<string, unknown> | null;
  /** Live row counts from the case page; fall back to canonical report counts. */
  findingsCount?: number;
  witnessesCount?: number;
  /** Opens a workspace tab when a summary tile is clicked. */
  onOpenTab?: (tab: string) => void;
  onOpenChat: () => void;
  onOpenVoice?: () => void;
};


// ---------------------------------------------------------------
// Node configuration for the central radar. Each node maps to one
// engine row (or aggregates several) and is positioned on a circle.
type NodeDef = {
  key: string;
  /** Canonical engine name used to resolve the localized, materia-aware label. */
  labelEngine: string;
  icon: React.ComponentType<{ className?: string }>;
  matches: string[]; // engine keys to merge for status display
};

const NODES: NodeDef[] = [
  { key: "extraction", labelEngine: "extraction", icon: FileText, matches: ["extraction", "ocr"] },
  { key: "analyzers", labelEngine: "analyzers", icon: Brain, matches: ["analyzers"] },
  { key: "agents", labelEngine: "agents", icon: Sparkles, matches: ["agents"] },
  { key: "contradict", labelEngine: "contradictions", icon: AlertTriangle, matches: ["contradictions"] },
  { key: "witness", labelEngine: "witness_intelligence", icon: Users, matches: ["witness_intelligence"] },
  { key: "discovery", labelEngine: "discovery_gaps", icon: Target, matches: ["discovery_gaps"] },
  { key: "evidence", labelEngine: "evidence_intelligence", icon: ShieldAlert, matches: ["evidence_intelligence"] },
];

function rollupStatus(row: { status: string } | undefined): EngineStatus | "idle" {
  if (!row) return "idle";
  return row.status as EngineStatus;
}

function statusColor(s: EngineStatus | "idle"): string {
  switch (s) {
    case "completed":
      return "text-success border-success/30";
    case "running":
      return "text-primary border-primary/40";
    case "failed":
      return "text-destructive border-destructive/30";
    case "skipped":
      return "text-warning border-warning/30";
    case "queued":
      return "text-foreground/80 border-border/30";
    default:
      return "text-muted-foreground border-border/20";
  }
}

function statusDot(s: EngineStatus | "idle") {
  if (s === "running") return <Loader2 className="h-3 w-3 animate-spin" />;
  if (s === "completed") return <CheckCircle2 className="h-3 w-3" />;
  if (s === "failed") return <AlertTriangle className="h-3 w-3" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-current" />;
}

export function CommandCenterDashboard({
  caseId,
  caseName,
  status,
  progress,
  documentsCount,
  report,
  caseRow,
  findingsCount,
  witnessesCount,
  onOpenTab,
  onOpenChat,
  onOpenVoice,

}: Props) {
  const { t, locale } = useI18n();
  const { runs: engineRows, latestByEngine, progress: execProgress, isRunning } = useCaseExecution(caseId);
  // Jurisdiction-aware radar: hide engines that aren't legally relevant for
  // this materia (e.g. witness intelligence in an amparo).
  const caseType = (caseRow?.case_type as string | undefined) ?? null;
  const visibleNodes = NODES.filter((n) => {
    const key = resolveStageKeyLoose(n.labelEngine);
    return !key || isStageRelevantForCaseType(caseType, key);
  });
  const bottomNode = visibleNodes.length > 6 ? visibleNodes[6] : null;
  const [events, setEvents] = useState<EventRow[]>([]);
  const wasRunningRef = useRef(false);

  // The initial `load()` below only fires once per caseId mount, then the
  // feed is driven purely by realtime INSERTs on top of it. Clicking
  // Run/Rerun on an already-mounted case page doesn't remount this
  // component (same caseId), so nothing re-triggered that initial fetch —
  // the panel just kept showing the previous run's last 12 events,
  // unchanged, until a full page refresh forced a remount. Detect the
  // idle -> running transition here and clear immediately so the feed
  // reflects "this run hasn't produced events yet" instead of stale
  // history from the run before it.
  useEffect(() => {
    if (isRunning && !wasRunningRef.current) {
      setEvents([]);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  // -------- realtime: activity events --------
  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const { data } = await supabase
        .from("pipeline_events")
        .select("id,stage,level,message,created_at")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false })
        .limit(12);
      if (!cancel) setEvents((data ?? []) as unknown as EventRow[]);
    };
    load();
    const ch = supabase
      .channel(`cmdctr-events-${caseId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pipeline_events", filter: `case_id=eq.${caseId}` },
        (p) => setEvents((prev) => [p.new as EventRow, ...prev].slice(0, 12)),
      )
      .subscribe();
    return () => {
      cancel = true;
      supabase.removeChannel(ch);
    };
  }, [caseId]);

  // ---------------- derived metrics ----------------
  const counts = useMemo(() => getCanonicalCounts(report ?? null), [report]);
  // Live table rows win over the report snapshot: a case can have witness /
  // finding rows persisted before (or without) a finished report.
  const findingsTotal = Math.max(findingsCount ?? 0, counts.findings);
  const witnessesTotal = Math.max(witnessesCount ?? 0, counts.witnesses);

  const ess = useMemo(() => getEssState(report ?? null), [report]);
  const scores = useMemo(() => getScores(report ?? null), [report]);
  const parity = useMemo(() => paritySignature(report ?? null), [report]);
  // Sourced from full_report.agent_statistics via canonical.ts — the SAME
  // helper the PDF/DOCX exports use (src/lib/export.ts). Intentionally a
  // different number from completedEngines/totalEngines below: engines are
  // pipeline *stages* (live, from pipeline_engine_runs), agents are the 13
  // analysis agents (finalized, from the report row). Previously these two
  // different concepts were conflated in a single "engines complete" label,
  // which is what produced the mismatch against the PDF's agent count.
  const agentSummary = useMemo(() => getAgentSummary(report ?? null), [report]);

  // Case score: prefer overall confidence; fall back to derived quality.
  const caseScore = Math.max(0, Math.min(100, Math.round((scores.strength ?? 0) || 100 - (scores.risk ?? 100))));
  const caseBand = scoreBand(caseScore);
  const scoreLabel = caseScore > 0 ? t(caseBand.labelKey) : t("score.pending");
  const scoreColor = caseScore > 0 ? caseBand.hex : "#B0A8CC";

  const progressPct = engineRows.length > 0 ? execProgress.percent : Math.max(0, Math.min(100, progress ?? 0));
  const running =
    isRunning ||
    (!!status && ["extracting", "ocr", "analyzing", "running", "generating_report", "queued"].includes(status));

  const completedEngines = COMMAND_CENTER_ENGINES.filter(
    (engine) => latestByEngine.get(engine)?.status === "completed",
  ).length;
  const totalEngines = COMMAND_CENTER_ENGINES.length;

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes nyr-glow { 0%,100% { box-shadow: 0 0 24px -4px rgba(124,58,237,.35); } 50% { box-shadow: 0 0 40px -2px rgba(124,58,237,.65); } }
        .nyr-glow  { animation: nyr-glow 3.2s ease-in-out infinite; }
      `}</style>

      {/* ============ HEADER: Case Score + Status ============ */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-background via-card to-background p-5 relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{ background: "radial-gradient(800px 200px at 20% 0%, rgba(124,58,237,.14), transparent 60%)" }}
          />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-primary/80">{t("cc.caseIntelligence")}</div>
              <h2 className="mt-1 truncate text-xl font-semibold text-foreground">{caseName}</h2>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${running ? "bg-primary animate-pulse" : "bg-success"}`}
                  />
                  {status ? t(`cases.status.${status}`) : t("cases.status.idle")}
                </span>
                <span>·</span>
                <span>{t("cc.ess")} {t(`cc.ess.${ess.level}`)}</span>
                <span>·</span>
                <span className="font-mono text-[10px] text-muted-foreground/70">{t("cc.parity")} {parity.slice(0, 18)}…</span>
              </div>
            </div>
            <ScoreGauge value={caseScore} color={scoreColor} label={scoreLabel} />
          </div>
        </div>
      </div>

      {/* ============ INTELLIGENCE SUMMARY ============ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryTile
          icon={FileText}
          label={t("cc.tile.documents")}
          value={documentsCount}
          tint="cyan"
          onClick={onOpenTab ? () => onOpenTab("intel") : undefined}
        />
        <SummaryTile
          icon={Sparkles}
          label={t("cc.tile.findings")}
          value={findingsTotal}
          tint="amber"
          onClick={onOpenTab ? () => onOpenTab("findings") : undefined}
        />
        <SummaryTile
          icon={ShieldAlert}
          label={t("cc.tile.evidence")}
          value={counts.evidence + counts.findings}
          tint="emerald"
          onClick={onOpenTab ? () => onOpenTab("evidence") : undefined}
        />
        <SummaryTile
          icon={Users}
          label={t("cc.tile.witnesses")}
          value={witnessesTotal}
          tint="violet"
          onClick={onOpenTab ? () => onOpenTab("witnesses") : undefined}
        />
        <SummaryTile
          icon={AlertTriangle}
          label={t("cc.tile.contradictions")}
          value={counts.contradictions}
          tint="amber"
          onClick={onOpenTab ? () => onOpenTab("analyzers") : undefined}
        />
        <SummaryTile
          icon={Target}
          label={t("cc.tile.gaps")}
          value={counts.missing_evidence}
          tint="rose"
          onClick={onOpenTab ? () => onOpenTab("analyzers") : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniBadge icon={Scale} label={t("cc.tile.disputed")} value={counts.disputed_issues} />
        <MiniBadge icon={Gauge} label={t("cc.tile.opportunities")} value={counts.opportunities} />
        <MiniBadge icon={Radar} label={t("cc.tile.timeline")} value={counts.timeline_events} />
        <MiniBadge icon={Activity} label={t("cc.tile.constitutional")} value={counts.constitutional} />
      </div>


      {/* ============ ANALYSIS COMMAND CENTER ============ */}
      <div className="rounded-2xl border border-primary/15 bg-background/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("pipeline.panel.title")}</h3>
            <p className="text-xs text-primary/70">
              {t("cc.subtitle", { done: String(completedEngines), total: String(totalEngines) })}
              {agentSummary.loaded > 0 && (
                <>
                  {" "}
                  ·{" "}
                  {t("cc.subtitle.agents", {
                    done: String(agentSummary.producingOutput),
                    total: String(agentSummary.loaded),
                  })}
                </>
              )}
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            <Loader2 className={`h-3 w-3 ${running ? "animate-spin" : ""}`} /> {running ? t("cc.live") : t("cc.ready")}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleNodes.slice(0, 6).map((n) => (
            <EngineChip
              key={n.key}
              node={n}
              status={rollupStatus(pickLatest(latestByEngine, n.matches))}
              caseType={caseType}
              align="left"
            />
          ))}
        </div>

        {/* Bottom evidence chip + overall progress */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          {bottomNode && (
            <EngineChip
              node={bottomNode}
              status={rollupStatus(pickLatest(latestByEngine, bottomNode.matches))}
              align="left"
              className="sm:w-auto"
              caseType={caseType}
            />
          )}
          <div className="flex-1">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{t("pipeline.overallProgress")}</span>
              <span className="tabular-nums text-primary">{progressPct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%`, background: "var(--gradient-primary)", boxShadow: "0 0 12px rgba(124,58,237,.45)" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ============ TALK TO THIS CASE ============ */}
      <button
        onClick={onOpenChat}
        className="nyr-glow group flex w-full items-center gap-4 rounded-2xl border border-primary/30 bg-gradient-to-r from-background via-card to-background p-5 text-left transition hover:border-primary/60"
      >
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-primary/40 bg-primary/10 text-primary">
          <MessageCircle className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{t("caseWorkspace.talk.title")}</div>
          <div className="text-xs text-primary/70">
            {t("caseWorkspace.talk.subtitle")}
          </div>
        </div>
        {onOpenVoice && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onOpenVoice();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onOpenVoice();
              }
            }}
            className="hidden sm:grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary transition hover:bg-primary/20"
            title={t("caseWorkspace.voiceMode")}
          >
            <Mic className="h-4 w-4" />
          </span>
        )}
        <ArrowRight className="h-5 w-5 text-primary transition group-hover:translate-x-1" />
      </button>

      {/* ============ RECENT ACTIVITY ============ */}
      <div className="rounded-2xl border border-border/40 bg-background/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{t("pipeline.activity.recent")}</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{t("pipeline.activity.liveFeed")}</span>
        </div>
        <ul className="mt-3 divide-y divide-border/60">
          {events.length === 0 && (
            <li className="py-3 text-xs text-muted-foreground/70">{t("pipeline.activity.empty")}</li>
          )}
          {events.map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 py-2 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${
                  ev.level === "error" ? "bg-destructive" : ev.level === "warn" ? "bg-warning" : "bg-primary"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                {localizeActivityMessage(ev.message, ev.stage, caseType, t, locale)}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground/70">{relTime(ev.created_at, t)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------- Helpers ----------------
function pickLatest<T extends { status: string }>(map: Map<string, T>, keys: string[]): T | undefined {
  let best: T | undefined;
  for (const k of keys) {
    const r = map.get(k);
    if (!r) continue;
    if (!best) {
      best = r;
      continue;
    }
    const rank = (s: string) => (s === "completed" ? 3 : s === "running" ? 2 : s === "failed" ? 1 : 0);
    if (rank(r.status) > rank(best.status)) best = r;
  }
  return best;
}

function relTime(iso: string, t: (k: string, v?: Record<string, string>) => string): string {
  const ms = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return t("time.secondsAgo", { n: String(s) });
  const m = Math.floor(s / 60);
  if (m < 60) return t("time.minutesAgo", { n: String(m) });
  const h = Math.floor(m / 60);
  if (h < 24) return t("time.hoursAgo", { n: String(h) });
  return t("time.daysAgo", { n: String(Math.floor(h / 24)) });
}

// ---------------- Subcomponents ----------------
function ScoreGauge({ value, color, label }: { value: number; color: string; label: string }) {
  const { t } = useI18n();
  const R = 38;
  const C = 2 * Math.PI * R;
  const off = C * (1 - value / 100);
  return (
    <div className="relative grid place-items-center">
      <svg width="120" height="120" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#EDE9FE" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={off}
          transform="rotate(-90 50 50)"
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("cc.caseScore")}</div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {value}
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <div className="text-[10px] font-semibold" style={{ color }}>
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

const TINTS: Record<string, string> = {
  cyan: "from-primary/20 to-primary/0 border-primary/30 text-primary",
  emerald: "from-success/20 to-success/0 border-success/30 text-success",
  violet: "from-teal/20 to-teal/0 border-teal/30 text-teal",
  amber: "from-warning/20 to-warning/0 border-warning/30 text-warning",
  rose: "from-destructive/20 to-destructive/0 border-destructive/30 text-destructive",
};

function SummaryTile({
  icon: Icon,
  label,
  value,
  tint,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tint: keyof typeof TINTS;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <Icon className="h-4 w-4 opacity-80" />
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] uppercase tracking-wider opacity-80">{label}</div>
    </>
  );
  const base = `rounded-xl border bg-gradient-to-br p-3 ${TINTS[tint]}`;
  if (!onClick) return <div className={base}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} w-full text-left transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
    >
      {inner}
    </button>
  );
}


function MiniBadge({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="flex-1 text-xs text-foreground/80">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function EngineChip({
  node,
  status,
  align,
  className = "",
  caseType,
}: {
  node: NodeDef;
  status: EngineStatus | "idle";
  align: "left" | "right";
  className?: string;
  caseType?: string | null;
}) {
  const { t } = useI18n();
  const Icon = node.icon;
  const labelKey = engineLabelKey(node.labelEngine, caseType);
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 ${statusColor(status)} ${align === "right" ? "flex-row-reverse text-right" : ""} ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight text-foreground">
          {labelKey ? t(labelKey) : node.labelEngine}
        </div>
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
          {statusDot(status)} <span>{t(statusLabelKey(status === "idle" ? "pending" : status))}</span>
        </div>
      </div>
    </div>
  );
}

export default CommandCenterDashboard;
