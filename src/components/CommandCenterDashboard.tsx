// NYRAVA Intelligence Command Center
// ---------------------------------------------------------------
// Mission-control style dashboard rendered at the top of a case
// detail page. Every value is wired to live data — engine statuses
// come from `pipeline_engine_runs`, counts from the canonical report
// helpers.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  Loader2,
  MessageCircle,
  Mic,
  Radar,
  RotateCcw,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  getCanonicalCounts,
  getEssState,
  getScores,
  getAgentSummary,
  paritySignature,
  type ReportLike,
} from "@/lib/intelligence/canonical";
import { useI18n } from "@/i18n";
import { engineLabelKey, isStageRelevantForCaseType, resolveStageKeyLoose, statusLabelKey } from "@/lib/execution/mx-pipeline";
import { scoreBand } from "@/lib/score-bands";
import { useCaseExecution } from "@/hooks/useCaseExecution";
import { COMMAND_CENTER_ENGINES } from "@/lib/execution/canonical";
import { clearPipelineStuckState, resumeFullPipelineStep } from "@/lib/cases.functions";

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

type Props = {
  caseId: string;
  caseName: string;
  status: string | null | undefined;
  progress: number | null | undefined;
  documentsCount: number;
  report: ReportLike | null | undefined;
  caseRow?: Record<string, unknown> | null;
  /** Live case_scores row — preferred over the (possibly ESS-suppressed or
   *  stale) report snapshot for the header Case Score badge, same "live
   *  wins over stale snapshot" principle already used for the counts below. */
  score?: { overall_confidence: number | null; case_quality: number | null } | null;
  /** Live row counts from the case page; fall back to canonical report counts. */
  findingsCount?: number;
  witnessesCount?: number;
  evidenceCount?: number;
  opportunitiesCount?: number;
  /** Opens a workspace tab when a summary tile is clicked. */
  onOpenTab?: (tab: string) => void;
  onOpenChat: () => void;
  onOpenVoice?: () => void;
  /** Refetches the parent case row after a resume/clear-stuck action. */
  invalidate?: () => void;
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
  score,
  findingsCount,
  witnessesCount,
  evidenceCount,
  opportunitiesCount,
  onOpenTab,
  onOpenChat,
  onOpenVoice,
  invalidate,

}: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { runs: engineRows, latestByEngine, progress: execProgress, isRunning } = useCaseExecution(caseId);
  // Jurisdiction-aware radar: hide engines that aren't legally relevant for
  // this materia (e.g. witness intelligence in an amparo).
  const caseType = (caseRow?.case_type as string | undefined) ?? null;
  const visibleNodes = NODES.filter((n) => {
    const key = resolveStageKeyLoose(n.labelEngine);
    return !key || isStageRelevantForCaseType(caseType, key, caseName);
  });
  const bottomNode = visibleNodes.length > 6 ? visibleNodes[6] : null;

  // ---------------- derived metrics ----------------
  const counts = useMemo(() => getCanonicalCounts(report ?? null), [report]);
  // Live table rows win over the report snapshot: a case can have witness /
  // finding / evidence-intel / opportunity rows persisted before (or
  // without) a finished report — e.g. a case stuck in "needs revision"
  // never assembled a full report snapshot, but the underlying analysis
  // tables it read from are already populated and should still count.
  const findingsTotal = Math.max(findingsCount ?? 0, counts.findings);
  const witnessesTotal = Math.max(witnessesCount ?? 0, counts.witnesses);
  const evidenceTotal = Math.max(evidenceCount ?? 0, counts.evidence);
  const opportunitiesTotal = Math.max(opportunitiesCount ?? 0, counts.opportunities);

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

  // Case score: prefer the live case_scores row (same "live wins over stale
  // snapshot" principle already used above for findings/witnesses/evidence/
  // opportunities counts), then the report snapshot's case_strength_score,
  // then a risk-derived estimate; null only when none of those exist.
  //
  // FIX: the previous formula, `(scores.strength ?? 0) || 100 - (scores.risk
  // ?? 100)`, had two bugs. First, `-` binds tighter than `||`, so it
  // actually evaluated as `(scores.strength ?? 0) || (100 - (scores.risk ??
  // 100))`, not the `(x ?? 0) || y` the author likely intended visually.
  // Second, and the one that actually surfaced live: `||` treats 0 as falsy,
  // so ANY time scores.strength was null (ESS-suppressed report, or no
  // report yet) it collapsed to 0 via `?? 0`, which is falsy, which forced
  // the `100 - (scores.risk ?? 100)` fallback — and since scores.risk is
  // suppressed by the exact same ESS gate, THAT was also null, giving `100 -
  // 100 = 0`. Confirmed live: a case showed a real case_scores-derived 75,
  // then dropped to a flat 0 once the (ESS-suppressed, single-document)
  // report finished generating and this component started reading the now-
  // null report.case_strength_score instead.
  const liveScore = (score?.overall_confidence ?? score?.case_quality) ?? null;
  const reportScore = scores.strength ?? (scores.risk != null ? 100 - scores.risk : null);
  // ESS suppression is authoritative. A stale/live case_scores row must not
  // resurrect a numeric badge beside a report that explicitly withheld
  // quantitative scoring (the ADR5829 run showed 86 while its PDF said the
  // score was suppressed).
  const rawCaseScore = ess.scoresSuppressed ? null : liveScore ?? reportScore;
  const caseScore = rawCaseScore == null ? 0 : Math.max(0, Math.min(100, Math.round(rawCaseScore)));
  const caseBand = scoreBand(caseScore);
  const scoreLabel = rawCaseScore != null ? t(caseBand.labelKey) : t("score.pending");
  const scoreColor = rawCaseScore != null ? caseBand.hex : "#B0A8CC";

  const progressPct = engineRows.length > 0 ? execProgress.percent : Math.max(0, Math.min(100, progress ?? 0));
  const running =
    isRunning ||
    (!!status && ["extracting", "ocr", "analyzing", "running", "generating_report", "queued"].includes(status));

  // A worker holds a time-boxed lease while actively processing a stage; if
  // the lease expired while the case is still incomplete, the run died
  // without finishing (crashed worker, deploy, etc.) rather than just being
  // slow. That's the "stuck" case Resume/Clear-stuck exist for — surfaced
  // directly here instead of buried behind the pipeline detail toggle.
  const leaseUntil = caseRow?.worker_lease_until as string | null | undefined;
  const leaseActive = !!leaseUntil && new Date(leaseUntil).getTime() > Date.now();
  const activelyRunning = running && leaseActive;
  const incomplete = engineRows.length > 0 && execProgress.completedStages < execProgress.totalStages;

  const [resuming, setResuming] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function handleResume() {
    setResuming(true);
    try {
      const res = (await resumeFullPipelineStep({ data: { caseId } })) as {
        alreadyComplete?: boolean;
        ok?: boolean;
        alreadyRunning?: boolean;
        done?: boolean;
        status?: string | null;
      };
      if (res?.alreadyComplete) {
        toast.info(t("pipeline.toast.alreadyComplete"));
      } else if (res?.ok === false && res?.alreadyRunning) {
        toast.info(t("pipeline.panel.running"));
      } else if (res?.ok === false && res?.done) {
        toast.info(t("pipeline.toast.alreadyComplete"));
      } else {
        toast.success(t("pipeline.toast.resumed"));
      }
      invalidate?.();
      queryClient.invalidateQueries({ queryKey: ["case-execution", caseId] });
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
      invalidate?.();
      queryClient.invalidateQueries({ queryKey: ["case-execution", caseId] });
    } finally {
      setResuming(false);
    }
  }

  async function handleClearStuck() {
    setClearing(true);
    try {
      const res = (await clearPipelineStuckState({ data: { caseId } })) as {
        ok?: boolean;
        alreadyRunning?: boolean;
        resumeKey?: string | null;
      };
      if (res?.alreadyRunning) {
        toast.info(t("pipeline.panel.running"));
      } else {
        toast.success(t("pipeline.toast.cleared"));
      }
      invalidate?.();
      queryClient.invalidateQueries({ queryKey: ["case-execution", caseId] });
    } catch (err) {
      toast.error(String((err as Error)?.message ?? err));
      invalidate?.();
      queryClient.invalidateQueries({ queryKey: ["case-execution", caseId] });
    } finally {
      setClearing(false);
    }
  }

  const completedEngines = COMMAND_CENTER_ENGINES.filter(
    (engine) => latestByEngine.get(engine)?.status === "completed",
  ).length;
  const totalEngines = COMMAND_CENTER_ENGINES.length;
  const hasReport = !!caseRow?.report_at || !!report;
  const reportReleased = hasReport && status === "released";
  const reportBlocked = hasReport && status === "needs_revision";

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

      {/* ============ RESUME / CLEAR STUCK ============ */}
      {incomplete && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${
            activelyRunning ? "border-primary/30 bg-primary/5" : "border-warning/40 bg-warning/10"
          }`}
        >
          {activelyRunning ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
          )}
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold ${activelyRunning ? "text-primary" : "text-warning"}`}>
              {activelyRunning ? t("cc.stuck.runningTitle") : t("cc.stuck.title")}
            </div>
            <p className="text-xs text-muted-foreground">
              {activelyRunning ? t("cc.stuck.runningSubtitle") : t("cc.stuck.subtitle")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={resuming || activelyRunning}
              onClick={handleResume}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {resuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              {t("pipeline.panel.resume")}
            </button>
            {!activelyRunning && (
              <button
                type="button"
                disabled={clearing}
                onClick={handleClearStuck}
                className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20 disabled:opacity-50"
              >
                {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {t("pipeline.panel.clearStuck")}
              </button>
            )}
          </div>
        </div>
      )}

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
          value={evidenceTotal + findingsTotal}
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
        <MiniBadge icon={Gauge} label={t("cc.tile.opportunities")} value={opportunitiesTotal} />
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

      {/* ============ REPORT READY ============ */}
      {hasReport && (
        <div className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${reportReleased ? "border-success/30 bg-success/10" : "border-warning/40 bg-warning/10"}`}>
          {reportReleased
            ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            : <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />}
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold ${reportReleased ? "text-success" : "text-warning"}`}>
              {reportReleased ? t("cc.reportReady.title") : t("cases.status.needs_revision")}
            </div>
            <p className="text-xs text-muted-foreground">
              {reportReleased
                ? t("cc.reportReady.subtitle")
                : String(caseRow?.status_message ?? (reportBlocked ? "Final release review blocked this draft." : "Final release review is pending."))}
            </p>
          </div>
          {onOpenTab && (
            <button
              type="button"
              onClick={() => onOpenTab("report")}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${reportReleased ? "border-success/40 bg-success/10 text-success hover:bg-success/20" : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"}`}
            >
              {t("cc.reportReady.view")} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

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
