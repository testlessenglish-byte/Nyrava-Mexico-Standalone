import {
  Search,
  Users,
  Clock,
  Scale,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { TrustBadge } from "./TrustBadge";

/**
 * Homepage hero visual — three-column layout: left cards, centered
 * Trust Badge, right cards. Cards share a single visual style so the
 * grid reads as one system.
 */

type Metric = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  status: "live" | "complete" | "detected" | "ready";
};

const LEFT: Metric[] = [
  { icon: Search, label: "Evidence Intelligence", value: "97 findings", status: "live" },
  { icon: Clock, label: "Timeline Intelligence", value: "Reconstructed", status: "complete" },
  { icon: Users, label: "Witness Intelligence", value: "14 witnesses", status: "complete" },
];

const RIGHT: Metric[] = [
  { icon: Scale, label: "Constitutional Review", value: "3 issues", status: "detected" },
  { icon: FileText, label: "Motion Intelligence", value: "5 drafts ready", status: "ready" },
  { icon: ShieldCheck, label: "Report Intelligence", value: "Complete", status: "ready" },
];

const STATUS_STYLES: Record<Metric["status"], string> = {
  live: "bg-primary/15 text-primary border-primary/40",
  complete: "bg-emerald-400/10 text-emerald-200 border-emerald-400/30",
  detected: "bg-amber-400/10 text-amber-200 border-amber-400/30",
  ready: "bg-primary/15 text-primary border-primary/40",
};

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  return (
    <div
      className="panel flex h-[76px] items-center gap-3 px-4 py-3 backdrop-blur transition hover:-translate-y-0.5"
      style={{ boxShadow: "var(--shadow-panel), 0 0 24px oklch(0.82 0.13 195 / 0.08)" }}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-card/70">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[9.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {metric.label}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
          <span className="truncate">{metric.value}</span>
          <span
            className={`hidden shrink-0 rounded-full border px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-[0.16em] sm:inline ${STATUS_STYLES[metric.status]}`}
          >
            {metric.status}
          </span>
        </div>
      </div>
    </div>
  );
}

export function HeroOSDashboard() {
  return (
    <div className="relative mx-auto w-full max-w-[880px] py-6">
      {/* Ambient background wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 55% at 50% 50%, oklch(0.82 0.13 195 / 0.14), transparent 70%)",
        }}
      />

      {/* Desktop: symmetric 3-column grid */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] lg:items-center lg:gap-8">
        <div className="flex flex-col gap-3">
          {LEFT.map((m) => (
            <MetricCard key={m.label} metric={m} />
          ))}
        </div>

        <div className="relative grid place-items-center">
          <svg
            aria-hidden
            viewBox="0 0 200 200"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <circle
              cx="100"
              cy="100"
              r="92"
              fill="none"
              stroke="oklch(0.82 0.13 195 / 0.18)"
              strokeWidth="0.6"
              strokeDasharray="2 6"
            />
            <circle
              cx="100"
              cy="100"
              r="70"
              fill="none"
              stroke="oklch(0.82 0.13 195 / 0.12)"
              strokeWidth="0.6"
            />
          </svg>
          <TrustBadge size={140} glow />
          <div className="mt-3 text-[9.5px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
            Nyrava Trust Badge
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {RIGHT.map((m) => (
            <MetricCard key={m.label} metric={m} />
          ))}
        </div>
      </div>

      {/* Mobile / tablet — badge on top, cards stacked below */}
      <div className="flex flex-col items-center lg:hidden">
        <TrustBadge size={140} glow />
        <div className="mt-3 text-[9.5px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
          Nyrava Trust Badge
        </div>
        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {[...LEFT, ...RIGHT].map((m) => (
            <MetricCard key={m.label} metric={m} />
          ))}
        </div>
      </div>
    </div>
  );
}
