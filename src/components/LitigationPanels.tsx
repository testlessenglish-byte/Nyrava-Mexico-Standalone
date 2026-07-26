// Phase 2/3/4 UI surfaces: Perspectives, Evidence Intelligence, Strategy.
// Pure presentation — pulls from data already loaded via getCase.
import { useState } from "react";
import {
  Shield, Scale, Gavel, Users, ChevronRight, AlertTriangle, CheckCircle2,
  HelpCircle, Sparkles, FileQuestion, Link2, ShieldAlert, Clock, FileSearch,
} from "lucide-react";

type Confidence = "confirmed" | "likely" | "possible" | "unknown" | null | undefined;

const CONFIDENCE_STYLE: Record<NonNullable<Confidence>, string> = {
  confirmed: "bg-success/15 text-success border-success/30",
  likely: "bg-accent/15 text-accent border-accent/30",
  possible: "bg-warning/15 text-warning border-warning/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  const v = value ?? "unknown";
  const Icon = v === "confirmed" ? CheckCircle2 : v === "unknown" ? HelpCircle : Sparkles;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${CONFIDENCE_STYLE[v]}`}>
      <Icon className="h-3 w-3" />{v}
    </span>
  );
}

function ScoreRing({ label, value, tone }: { label: string; value: number | null | undefined; tone: "good" | "bad" }) {
  const v = typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;
  const color = tone === "good" ? "text-success" : "text-destructive";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <div className={`text-2xl font-semibold ${color}`}>{v == null ? "—" : v}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

// ============= PERSPECTIVES =============
type PerspectiveRow = {
  id: string;
  perspective: string;
  summary: string | null;
  confidence_label: Confidence;
  strength_score: number | null;
  risk_score: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strengths: any; weaknesses: any; opposing_arguments: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  counter_arguments: any; key_evidence: any; recommended_actions: any;
};

const PERSPECTIVE_ICON: Record<string, typeof Shield> = {
  defensa: Shield, ministerio_publico: Gavel, parte_actora: Scale, parte_demandada: Scale,
  quejoso: Scale, autoridad_responsable: Gavel, juzgador: Gavel, independiente: Scale,
  appellate: Scale, jury: Users, independent: FileSearch,
  judicial: Gavel, investigator: FileSearch,
};

export function PerspectivesPanel({ perspectives }: { perspectives: PerspectiveRow[] }) {
  const [active, setActive] = useState<string>(perspectives[0]?.perspective ?? "defense");
  const current = perspectives.find((p) => p.perspective === active) ?? perspectives[0];

  if (!perspectives || perspectives.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
        Run “Multi-Perspective Analysis” from the Intelligence Engines panel to see how the case looks from every side.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {perspectives.map((p) => {
          const Icon = PERSPECTIVE_ICON[p.perspective] ?? FileSearch;
          const isActive = active === p.perspective;
          return (
            <button
              key={p.id}
              onClick={() => setActive(p.perspective)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium capitalize ${isActive ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-secondary"}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.perspective}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold capitalize">{current.perspective} perspective</h3>
              <ConfidenceBadge value={current.confidence_label} />
            </div>
            {current.summary && <p className="text-sm text-muted-foreground">{current.summary}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ScoreRing label="Case strength" value={current.strength_score} tone="good" />
              <ScoreRing label="Risk" value={current.risk_score} tone="bad" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ListCard title="Strengths" icon={CheckCircle2} accent="success"
              items={asArr(current.strengths)} render={(s) => (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{s.title}</div>
                    {s.detail && <div className="mt-0.5 text-xs text-muted-foreground">{s.detail}</div>}
                  </div>
                  {s.confidence_label && <ConfidenceBadge value={s.confidence_label} />}
                </div>
              )} />
            <ListCard title="Weaknesses" icon={AlertTriangle} accent="destructive"
              items={asArr(current.weaknesses)} render={(s) => (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{s.title}</div>
                    {s.detail && <div className="mt-0.5 text-xs text-muted-foreground">{s.detail}</div>}
                  </div>
                  {s.confidence_label && <ConfidenceBadge value={s.confidence_label} />}
                </div>
              )} />
            <ListCard title="Opposing arguments" icon={ShieldAlert} accent="warning"
              items={asArr(current.opposing_arguments)} render={(s) => (
                <div>
                  <div className="text-sm">{s.argument}</div>
                  {s.strength && <span className="mt-1 inline-block text-[10px] uppercase tracking-wider text-muted-foreground">strength: {s.strength}</span>}
                </div>
              )} />
            <ListCard title="Counter-arguments" icon={Sparkles} accent="accent"
              items={asArr(current.counter_arguments)} render={(s) => (
                <div>
                  <div className="text-sm font-medium">{s.argument}</div>
                  {s.rationale && <div className="mt-0.5 text-xs text-muted-foreground">{s.rationale}</div>}
                </div>
              )} />
            <ListCard title="Key evidence" icon={Link2} accent="accent"
              items={asArr(current.key_evidence)} render={(s) => (
                <div>
                  <div className="text-sm font-medium">{s.item}</div>
                  {s.why_it_matters && <div className="mt-0.5 text-xs text-muted-foreground">{s.why_it_matters}</div>}
                </div>
              )} />
            <ListCard title="Recommended actions" icon={ChevronRight} accent="accent"
              items={asArr(current.recommended_actions)} render={(s) => (
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm">{s.action}</div>
                  {s.priority && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${priorityClass(s.priority)}`}>{s.priority}</span>
                  )}
                </div>
              )} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============= EVIDENCE INTELLIGENCE =============
type EvidenceRow = {
  id: string;
  classification: string;
  title: string;
  description: string | null;
  severity: string | null;
  confidence_label: Confidence;
  affected_party: string | null;
  document_id: string | null;
};

const CLASS_LABEL: Record<string, { label: string; icon: typeof Link2; tone: string }> = {
  corroborating: { label: "Corroborating", icon: CheckCircle2, tone: "text-success" },
  contradictory: { label: "Contradictory", icon: AlertTriangle, tone: "text-destructive" },
  weak: { label: "Weak", icon: HelpCircle, tone: "text-warning" },
  missing: { label: "Missing", icon: FileQuestion, tone: "text-warning" },
  undisclosed: { label: "Undisclosed", icon: ShieldAlert, tone: "text-destructive" },
  brady: { label: "Brady Risk", icon: ShieldAlert, tone: "text-destructive" },
  chain_of_custody: { label: "Chain-of-Custody", icon: Link2, tone: "text-warning" },
  timeline_inconsistency: { label: "Timeline Issue", icon: Clock, tone: "text-warning" },
};

export function EvidenceIntelPanel({
  evidence, documents,
}: {
  evidence: EvidenceRow[];
  documents: { id: string; filename: string }[];
}) {
  const [filter, setFilter] = useState<string>("all");
  const docMap = new Map(documents.map((d) => [d.id, d.filename]));

  if (!evidence || evidence.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
        Run “Evidence Intelligence” to classify every piece of evidence and detect what's missing.
      </div>
    );
  }

  const categories = ["all", ...Array.from(new Set(evidence.map((e) => e.classification)))];
  const visible = filter === "all" ? evidence : evidence.filter((e) => e.classification === filter);
  const counts = Object.fromEntries(
    Object.keys(CLASS_LABEL).map((k) => [k, evidence.filter((e) => e.classification === k).length]),
  );

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
        {Object.entries(CLASS_LABEL).map(([k, v]) => {
          const c = counts[k] ?? 0;
          if (c === 0) return null;
          const Icon = v.icon;
          return (
            <div key={k} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <Icon className={`h-5 w-5 ${v.tone}`} />
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{v.label}</div>
                <div className="text-lg font-semibold">{c}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`rounded-full border px-3 py-1 text-xs capitalize ${filter === c ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-secondary"}`}
          >
            {c === "all" ? "All" : (CLASS_LABEL[c]?.label ?? c)}
          </button>
        ))}
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {visible.map((e) => {
          const meta = CLASS_LABEL[e.classification] ?? { label: e.classification, icon: Link2, tone: "text-muted-foreground" };
          const Icon = meta.icon;
          return (
            <div key={e.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.tone}`} />
                  <div>
                    <div className="text-sm font-medium">{e.title}</div>
                    {e.description && <div className="mt-1 text-xs text-muted-foreground">{e.description}</div>}
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span className={`rounded-full px-2 py-0.5 ${meta.tone} bg-secondary/60`}>{meta.label}</span>
                      {e.severity && <span className="rounded-full bg-secondary/60 px-2 py-0.5">{e.severity}</span>}
                      {e.affected_party && <span className="rounded-full bg-secondary/60 px-2 py-0.5">{e.affected_party}</span>}
                      {e.document_id && docMap.get(e.document_id) && (
                        <span className="rounded-full bg-secondary/60 px-2 py-0.5">{docMap.get(e.document_id)}</span>
                      )}
                    </div>
                    {(() => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const ex = e as any;
                      const sup = Array.isArray(ex.supports_finding_ids) ? ex.supports_finding_ids : [];
                      const con = Array.isArray(ex.contradicts_finding_ids) ? ex.contradicts_finding_ids : [];
                      const wit = Array.isArray(ex.linked_witness_ids) ? ex.linked_witness_ids : [];
                      const tl = Array.isArray(ex.linked_timeline_event_ids) ? ex.linked_timeline_event_ids : [];
                      const any = sup.length + con.length + wit.length + tl.length;
                      if (!any) return null;
                      const setTab = (t: string) => { try { window.dispatchEvent(new CustomEvent("nyrava:set-tab", { detail: t })); } catch { /* noop */ } };
                      const chip = (label: string, n: number, tab: string, tone: string) => n > 0 && (
                        <button key={label} onClick={() => setTab(tab)} className={`rounded-full px-2 py-0.5 text-[10px] ${tone} hover:brightness-110`}>
                          {label}: {n}
                        </button>
                      );
                      return (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {chip("Supports", sup.length, "findings", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}
                          {chip("Contradicts", con.length, "findings", "bg-red-500/15 text-red-700 dark:text-red-300")}
                          {chip("Witnesses", wit.length, "witnesses", "bg-blue-500/15 text-blue-700 dark:text-blue-300")}
                          {chip("Timeline", tl.length, "trial", "bg-amber-500/15 text-amber-700 dark:text-amber-300")}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <ConfidenceBadge value={e.confidence_label} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============= STRATEGY =============
type StrategyRow = {
  id: string;
  perspective: string;
  summary: string | null;
  case_strength_score: number | null;
  risk_score: number | null;
  confidence_label: Confidence;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  motion_rankings: any; anticipated_opposing: any; counter_arguments: any; next_actions: any;
};

export function StrategyPanel({
  strategy, onRun, running,
}: {
  strategy: StrategyRow[];
  onRun: (perspective: string) => void;
  running: boolean;
}) {
  const allP = ["independiente","juzgador","ministerio_publico","defensa","parte_actora","parte_demandada","quejoso","autoridad_responsable"] as const;
  const existing = new Set(strategy.map((s) => s.perspective));
  const [active, setActive] = useState<string>(strategy[0]?.perspective ?? "independent");
  const current = strategy.find((s) => s.perspective === active);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {allP.map((p) => (
          <button
            key={p}
            onClick={() => setActive(p)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium capitalize ${active === p ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-secondary"}`}
          >
            {p}{existing.has(p) ? "" : " ·"}
          </button>
        ))}
        <button
          onClick={() => onRun(active)}
          disabled={running}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {existing.has(active) ? `Re-run for ${active}` : `Generate for ${active}`}
        </button>
      </div>

      {!current ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
          No strategy generated for “{active}” yet. Click the button above to synthesize one.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold capitalize">Strategy · {current.perspective}</h3>
              <ConfidenceBadge value={current.confidence_label} />
            </div>
            {current.summary && <p className="text-sm text-muted-foreground">{current.summary}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ScoreRing label="Case strength" value={current.case_strength_score} tone="good" />
              <ScoreRing label="Risk" value={current.risk_score} tone="bad" />
            </div>
          </div>

          <ListCard title="Motion rankings" icon={Gavel} accent="accent"
            items={asArr(current.motion_rankings)} render={(m) => (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{m.motion}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${strengthClass(m.strength)}`}>{m.strength ?? "—"}</span>
                </div>
                {m.rationale && <div className="mt-1 text-xs text-muted-foreground">{m.rationale}</div>}
                {asArr(m.draft_outline).length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-foreground/80">
                    {asArr(m.draft_outline).map((o, i) => <li key={i}>{String(o)}</li>)}
                  </ul>
                )}
              </div>
            )} />

          <ListCard title="Anticipated opposing arguments" icon={ShieldAlert} accent="warning"
            items={asArr(current.anticipated_opposing)} render={(m) => (
              <div>
                <div className="text-sm">{m.argument}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  likelihood {m.likelihood ?? "?"} · impact {m.impact ?? "?"}
                </div>
              </div>
            )} />

          <ListCard title="Counter-arguments" icon={Sparkles} accent="accent"
            items={asArr(current.counter_arguments)} render={(m) => (
              <div>
                <div className="text-sm font-medium">vs. “{m.for_argument}”</div>
                {m.counter && <div className="mt-1 text-xs text-muted-foreground">{m.counter}</div>}
              </div>
            )} />

          <ListCard title="Recommended next actions" icon={ChevronRight} accent="accent"
            items={asArr(current.next_actions)} render={(m) => (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm">
                    {m.step ? `${m.step}. ` : ""}{m.action}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {m.owner ?? "—"} · {m.due_window ?? "—"}
                  </div>
                </div>
                {m.priority && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${priorityClass(m.priority)}`}>{m.priority}</span>
                )}
              </div>
            )} />
        </div>
      )}
    </div>
  );
}

// ============= helpers =============
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asArr(v: any): any[] { return Array.isArray(v) ? v : []; }

function priorityClass(p?: string) {
  if (p === "high") return "bg-destructive/15 text-destructive";
  if (p === "medium") return "bg-warning/15 text-warning";
  return "bg-secondary text-muted-foreground";
}
function strengthClass(s?: string) {
  if (s === "high") return "bg-success/15 text-success";
  if (s === "moderate") return "bg-warning/15 text-warning";
  if (s === "low") return "bg-destructive/15 text-destructive";
  return "bg-secondary text-muted-foreground";
}

function ListCard<T>({
  title, icon: Icon, accent, items, render,
}: {
  title: string;
  icon: typeof Shield;
  accent: "success" | "destructive" | "warning" | "accent";
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  const accentClass = {
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning",
    accent: "text-accent",
  }[accent];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accentClass}`} />
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No items.</div>
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={i} className="rounded-lg bg-secondary/40 p-3">{render(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
