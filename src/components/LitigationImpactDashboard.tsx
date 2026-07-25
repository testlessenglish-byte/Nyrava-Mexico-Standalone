// Litigation Impact Dashboard + Litigation Command Center.
// Pure presentation — all data comes from litigation-impact.ts, which reads
// only already-grounded pipeline output (deterministic scorecard, motions,
// missing evidence, witnesses, next actions). This component never fetches
// or invents anything on its own.
import {
  AlertTriangle,
  CheckCircle2,
  Gavel,
  Info,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  UserX,
} from "lucide-react";
import type { ReportLike } from "@/lib/intelligence/canonical";
import {
  buildLitigationImpactDashboard,
  buildLitigationCommandCenter,
  type ImpactCard,
  type ImpactTier,
} from "@/lib/intelligence/litigation-impact";

const TIER_STYLE: Record<ImpactTier, string> = {
  critical: "border-red-600/30 bg-red-600/10",
  high: "border-orange-500/30 bg-orange-500/10",
  moderate: "border-amber-500/30 bg-amber-500/10",
  strong: "border-emerald-500/30 bg-emerald-500/10",
};

const TIER_BADGE_STYLE: Record<ImpactTier, string> = {
  critical: "bg-red-600/15 text-red-700 border-red-600/30",
  high: "bg-orange-500/15 text-orange-700 border-orange-500/30",
  moderate: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  strong: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
};

const TIER_ICON: Record<ImpactTier, typeof AlertTriangle> = {
  critical: AlertTriangle,
  high: ShieldAlert,
  moderate: Target,
  strong: CheckCircle2,
};

// Shared disclaimer: this dashboard is a starting point, not a finished
// answer. It surfaces what the deterministic scorecard and existing
// findings already show — it does not replace verifying disputed points
// with Case AI, pulling controlling authority in Case Law, or drafting the
// actual motion before anyone relies on this.
function VerifyNote() {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-border bg-background/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Starting point, not a finished answer. Verify anything you plan to rely on with <strong>Case AI</strong>, pull
        controlling authority in <strong>Case Law</strong>, and confirm the actual filing through{" "}
        <strong>Motion Drafting</strong> before treating this as ready.
      </span>
    </div>
  );
}

function ImpactCardTile({ card }: { card: ImpactCard }) {
  const Icon = TIER_ICON[card.tier];
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${TIER_STYLE[card.tier]}`} title={card.source}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-foreground/80">{card.title}</div>
        <Icon className="h-4 w-4 shrink-0 opacity-70" />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground">{card.value}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${TIER_BADGE_STYLE[card.tier]}`}
        >
          {card.badge}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{card.detail}</p>
    </div>
  );
}

export function LitigationImpactDashboardSection({ report }: { report: ReportLike }) {
  const data = buildLitigationImpactDashboard(report);

  if (data.suppressed) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-5 text-center text-sm text-muted-foreground">
        <div className="mb-1 font-semibold text-foreground/80">Litigation Impact Dashboard</div>
        {data.suppressedReason}
      </div>
    );
  }

  if (data.cards.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="text-lg font-semibold">Litigation Impact Dashboard</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Every card is computed from the deterministic scorecard and grounded findings below — hover a card to see what
        it's based on.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.cards.map((c) => (
          <ImpactCardTile key={c.id} card={c} />
        ))}
      </div>
      <VerifyNote />
    </div>
  );
}

function CommandCard({
  icon: Icon,
  title,
  body,
  source,
}: {
  icon: typeof AlertTriangle;
  title: string;
  body: string;
  source: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4" title={source ?? undefined}>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{body}</p>
      {source && <div className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">{source}</div>}
    </div>
  );
}

const CARD_ICON: Record<string, typeof AlertTriangle> = {
  what_wins: TrendingUp,
  what_loses: TrendingDown,
  trial_risk: Gavel,
  settlement_leverage: Target,
  dangerous_witness: UserX,
  evidentiary_gap: AlertTriangle,
};

export function LitigationCommandCenterSection({ report }: { report: ReportLike }) {
  const data = buildLitigationCommandCenter(report);
  if (data.cards.length === 0 && data.checklist.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="mb-1 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-accent" />
        <h3 className="text-lg font-semibold">Litigation Command Center</h3>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Practical answers derived from this case's grounded findings — not a second summary of the facts.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.cards.map((c) => (
          <CommandCard key={c.id} icon={CARD_ICON[c.id] ?? Target} title={c.title} body={c.body} source={c.source} />
        ))}
      </div>
      {data.checklist.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" />
            What Should Counsel Do This Week?
          </div>
          <ul className="space-y-1.5">
            {data.checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border border-border" aria-hidden />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      <VerifyNote />
    </div>
  );
}
