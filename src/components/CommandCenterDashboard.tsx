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
import { engineLabelKey, isStageRelevantForCaseType, stageKeyForEngine, statusLabelKey } from "@/lib/execution/mx-pipeline";
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
      return "text-emerald-400 border-emerald-400/40 bg-emerald-400/10";
    case "running":
      return "text-cyan-300 border-cyan-300/40 bg-cyan-300/10";
    case "failed":
      return "text-red-400 border-red-400/40 bg-red-400/10";
    case "skipped":
      return "text-amber-300 border-amber-300/40 bg-amber-300/10";
    case "queued":
      return "text-slate-300 border-slate-400/30 bg-slate-400/10";
    default:
      return "text-slate-400 border-slate-500/20 bg-slate-500/5";
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
  onOpenChat,
  onOpenVoice,
}: Props) {
  const { runs: engineRows, latestByEngine, progress: execProgress, isRunning } = useCaseExecution(caseId);
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
  const scoreLabel =
    caseScore >= 80
      ? "Excellent"
      : caseScore >= 65
        ? "Strong"
        : caseScore >= 50
          ? "Moderate"
          : caseScore > 0
            ? "Developing"
            : "Pending";
  const scoreColor =
    caseScore >= 80
      ? "#34d399"
      : caseScore >= 65
        ? "#22d3ee"
        : caseScore >= 50
          ? "#fbbf24"
          : caseScore > 0
            ? "#fb923c"
            : "#64748b";

  const progressPct = engineRows.length > 0 ? execProgress.percent : Math.max(0, Math.min(100, progress ?? 0));
  const running =
    isRunning ||
    (!!status && ["extracting", "ocr", "analyzing", "running", "generating_report", "queued"].includes(status));

  const completedEngines = COMMAND_CENTER_ENGINES.filter(
    (engine) => latestByEngine.get(engine)?.status === "completed",
  ).length;
  const totalEngines = COMMAND_CENTER_ENGINES.length;

  // Node rotation positions (heptagon, 7 nodes).
  const nodePositions = NODES.map((_, i) => {
    const angle = -Math.PI / 2 + (i * (2 * Math.PI)) / NODES.length;
    return { x: 50 + 38 * Math.cos(angle), y: 50 + 38 * Math.sin(angle) };
  });

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes nyr-spin-slow { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes nyr-spin-rev  { from { transform: rotate(360deg); } to { transform: rotate(0); } }
        @keyframes nyr-pulse     { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes nyr-dash      { to { stroke-dashoffset: -200; } }
        @keyframes nyr-glow      { 0%,100% { box-shadow: 0 0 24px -4px rgba(34,211,238,.35); } 50% { box-shadow: 0 0 40px -2px rgba(34,211,238,.65); } }
        .nyr-ring1 { animation: nyr-spin-slow 28s linear infinite; transform-origin: center; transform-box: fill-box; }
        .nyr-ring2 { animation: nyr-spin-rev 38s linear infinite; transform-origin: center; transform-box: fill-box; }
        .nyr-ring3 { animation: nyr-spin-slow 60s linear infinite; transform-origin: center; transform-box: fill-box; }
        .nyr-pulse { animation: nyr-pulse 2.4s ease-in-out infinite; }
        .nyr-flow  { stroke-dasharray: 4 6; animation: nyr-dash 6s linear infinite; }
        .nyr-glow  { animation: nyr-glow 3.2s ease-in-out infinite; }
      `}</style>

      {/* ============ HEADER: Case Score + Status ============ */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="rounded-2xl border border-cyan-400/15 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{ background: "radial-gradient(800px 200px at 20% 0%, rgba(34,211,238,.18), transparent 60%)" }}
          />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">Case Intelligence</div>
              <h2 className="mt-1 truncate text-xl font-semibold text-white">{caseName}</h2>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${running ? "bg-cyan-300 animate-pulse" : "bg-emerald-400"}`}
                  />
                  {status ?? "idle"}
                </span>
                <span>·</span>
                <span>ESS {ess.level}</span>
                <span>·</span>
                <span className="font-mono text-[10px] text-slate-500">parity {parity.slice(0, 18)}…</span>
              </div>
            </div>
            <ScoreGauge value={caseScore} color={scoreColor} label={scoreLabel} />
          </div>
        </div>
      </div>

      {/* ============ INTELLIGENCE SUMMARY (5 tiles) ============ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryTile icon={FileText} label="Documents" value={documentsCount} tint="cyan" />
        <SummaryTile icon={ShieldAlert} label="Evidence" value={counts.evidence + counts.findings} tint="emerald" />
        <SummaryTile icon={Users} label="Witnesses" value={counts.witnesses} tint="violet" />
        <SummaryTile icon={AlertTriangle} label="Contradictions" value={counts.contradictions} tint="amber" />
        <SummaryTile icon={Target} label="Gaps" value={counts.missing_evidence} tint="rose" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniBadge icon={Scale} label="Disputed Issues" value={counts.disputed_issues} />
        <MiniBadge icon={Gauge} label="Opportunities" value={counts.opportunities} />
        <MiniBadge icon={Radar} label="Timeline Events" value={counts.timeline_events} />
        <MiniBadge icon={Activity} label="Constitutional" value={counts.constitutional} />
      </div>

      {/* ============ ANALYSIS COMMAND CENTER ============ */}
      <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Analysis Command Center</h3>
            <p className="text-xs text-cyan-300/70">
              Real-time intelligence build · {completedEngines}/{totalEngines} pipeline stages complete
              {agentSummary.loaded > 0 && (
                <>
                  {" "}
                  · {agentSummary.producingOutput}/{agentSummary.loaded} agents producing output
                </>
              )}
            </p>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-300">
            <Loader2 className={`h-3 w-3 ${running ? "animate-spin" : ""}`} /> {running ? "live" : "ready"}
          </span>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_minmax(260px,360px)_1fr] items-center">
          {/* LEFT chips */}
          <div className="hidden lg:flex flex-col gap-3">
            {NODES.slice(0, 3).map((n) => (
              <EngineChip
                key={n.key}
                node={n}
                status={rollupStatus(pickLatest(latestByEngine, n.matches))}
                align="left"
              />
            ))}
          </div>

          {/* CENTER radar */}
          <div className="relative mx-auto aspect-square w-full max-w-[360px]">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <defs>
                <radialGradient id="nyrCore" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.55" />
                  <stop offset="60%" stopColor="#0e7490" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#020617" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="nyrStroke" x1="0" x2="1">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
              </defs>

              {/* core glow */}
              <circle cx="50" cy="50" r="44" fill="url(#nyrCore)" />

              {/* rotating rings */}
              <g className="nyr-ring1">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="url(#nyrStroke)"
                  strokeWidth="0.4"
                  strokeDasharray="2 3"
                  opacity="0.7"
                />
              </g>
              <g className="nyr-ring2">
                <circle
                  cx="50"
                  cy="50"
                  r="34"
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="0.3"
                  strokeDasharray="1 4"
                  opacity="0.6"
                />
              </g>
              <g className="nyr-ring3">
                <circle
                  cx="50"
                  cy="50"
                  r="26"
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="0.25"
                  strokeDasharray="0.6 2"
                  opacity="0.45"
                />
              </g>

              {/* connection lines from center → each node */}
              {nodePositions.map((p, i) => {
                const st = rollupStatus(pickLatest(latestByEngine, NODES[i].matches));
                const stroke =
                  st === "completed"
                    ? "#34d399"
                    : st === "running"
                      ? "#22d3ee"
                      : st === "failed"
                        ? "#f87171"
                        : "#475569";
                return (
                  <line
                    key={i}
                    x1="50"
                    y1="50"
                    x2={p.x}
                    y2={p.y}
                    stroke={stroke}
                    strokeWidth="0.35"
                    opacity="0.55"
                    className={st === "running" ? "nyr-flow" : ""}
                  />
                );
              })}

              {/* node dots */}
              {nodePositions.map((p, i) => {
                const st = rollupStatus(pickLatest(latestByEngine, NODES[i].matches));
                const fill =
                  st === "completed"
                    ? "#34d399"
                    : st === "running"
                      ? "#22d3ee"
                      : st === "failed"
                        ? "#f87171"
                        : "#64748b";
                return (
                  <g key={i}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={st === "running" ? 1.8 : 1.2}
                      fill={fill}
                      className={st === "running" ? "nyr-pulse" : ""}
                    />
                    {st === "running" && (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="3"
                        fill="none"
                        stroke={fill}
                        strokeWidth="0.3"
                        opacity="0.5"
                        className="nyr-pulse"
                      />
                    )}
                  </g>
                );
              })}

              {/* center badge */}
              <g>
                <circle cx="50" cy="50" r="8" fill="#0f172a" stroke="url(#nyrStroke)" strokeWidth="0.4" />
                <text
                  x="50"
                  y="52.5"
                  textAnchor="middle"
                  fontSize="4.2"
                  fontWeight="700"
                  fill="#e0f2fe"
                  fontFamily="system-ui"
                >
                  N
                </text>
              </g>
            </svg>
          </div>

          {/* RIGHT chips */}
          <div className="hidden lg:flex flex-col gap-3">
            {NODES.slice(3, 6).map((n) => (
              <EngineChip
                key={n.key}
                node={n}
                status={rollupStatus(pickLatest(latestByEngine, n.matches))}
                align="right"
              />
            ))}
          </div>

          {/* Mobile chips */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:hidden col-span-full">
            {NODES.map((n) => (
              <EngineChip
                key={n.key}
                node={n}
                status={rollupStatus(pickLatest(latestByEngine, n.matches))}
                align="left"
              />
            ))}
          </div>
        </div>

        {/* Bottom evidence chip + overall progress */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <EngineChip
            node={NODES[6]}
            status={rollupStatus(pickLatest(latestByEngine, NODES[6].matches))}
            align="left"
            className="sm:w-auto"
          />
          <div className="flex-1">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-slate-400">
              <span>Overall Progress</span>
              <span className="tabular-nums text-cyan-300">{progressPct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-500 transition-all duration-700"
                style={{ width: `${progressPct}%`, boxShadow: "0 0 12px rgba(34,211,238,.6)" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ============ TALK TO THIS CASE ============ */}
      <button
        onClick={onOpenChat}
        className="nyr-glow group flex w-full items-center gap-4 rounded-2xl border border-cyan-400/30 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-5 text-left transition hover:border-cyan-300/60"
      >
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
          <MessageCircle className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">Talk to this case</div>
          <div className="text-xs text-cyan-300/70">
            Ask questions. Get Nyrava Intelligence answers with evidence citations.
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
            className="hidden sm:grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 transition hover:bg-cyan-400/20"
            title="Voice mode"
          >
            <Mic className="h-4 w-4" />
          </span>
        )}
        <ArrowRight className="h-5 w-5 text-cyan-300 transition group-hover:translate-x-1" />
      </button>

      {/* ============ RECENT ACTIVITY ============ */}
      <div className="rounded-2xl border border-slate-700/40 bg-slate-950/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t("pipeline.activity.recent")}</h3>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">live feed</span>
        </div>
        <ul className="mt-3 divide-y divide-slate-800/60">
          {events.length === 0 && (
            <li className="py-3 text-xs text-slate-500">{t("pipeline.activity.empty")}</li>
          )}
          {events.map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 py-2 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${
                  ev.level === "error" ? "bg-red-400" : ev.level === "warn" ? "bg-amber-300" : "bg-cyan-300"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-slate-200">{ev.message}</span>
              <span className="text-[11px] tabular-nums text-slate-500">{relTime(ev.created_at)}</span>
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

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------- Subcomponents ----------------
function ScoreGauge({ value, color, label }: { value: number; color: string; label: string }) {
  const R = 38;
  const C = 2 * Math.PI * R;
  const off = C * (1 - value / 100);
  return (
    <div className="relative grid place-items-center">
      <svg width="120" height="120" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#1e293b" strokeWidth="7" />
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
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Case Score</div>
          <div className="text-2xl font-bold tabular-nums text-white">
            {value}
            <span className="text-xs text-slate-400">/100</span>
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
  cyan: "from-cyan-500/20 to-cyan-500/0 border-cyan-400/30 text-cyan-200",
  emerald: "from-emerald-500/20 to-emerald-500/0 border-emerald-400/30 text-emerald-200",
  violet: "from-violet-500/20 to-violet-500/0 border-violet-400/30 text-violet-200",
  amber: "from-amber-500/20 to-amber-500/0 border-amber-400/30 text-amber-200",
  rose: "from-rose-500/20 to-rose-500/0 border-rose-400/30 text-rose-200",
};

function SummaryTile({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tint: keyof typeof TINTS;
}) {
  return (
    <div className={`rounded-xl border bg-gradient-to-br p-3 ${TINTS[tint]}`}>
      <Icon className="h-4 w-4 opacity-80" />
      <div className="mt-1 text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="text-[11px] uppercase tracking-wider opacity-80">{label}</div>
    </div>
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
    <div className="flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-cyan-300" />
      <span className="flex-1 text-xs text-slate-300">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-white">{value}</span>
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
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${statusColor(status)} ${align === "right" ? "flex-row-reverse text-right" : ""} ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight">
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
