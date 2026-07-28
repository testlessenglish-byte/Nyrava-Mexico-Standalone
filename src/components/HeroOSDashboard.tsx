import { Scale, BookOpen, Gavel, GraduationCap, Landmark, FileText } from "lucide-react";
import { NyravaLogo } from "./NyravaLogo";
import { useI18n } from "@/i18n";

/**
 * Homepage hero visual — three-column layout: left source cards, centered
 * Trust Badge, right source cards. Mirrors the Nyrava México reference
 * design: Jurisprudencia / Legislación MX / Criterios Aislados on the
 * left, Doctrina / Precedentes / Reportes on the right.
 */

type SourceCard = {
  icon: React.ComponentType<{ className?: string }>;
  titleKey: string;
  subtitleKey: string;
  tagKey: string;
};

const LEFT: SourceCard[] = [
  { icon: Scale, titleKey: "home.grid.jurisprudencia.title", subtitleKey: "home.grid.jurisprudencia.subtitle", tagKey: "home.grid.jurisprudencia.tag" },
  { icon: BookOpen, titleKey: "home.grid.legislacion.title", subtitleKey: "home.grid.legislacion.subtitle", tagKey: "home.grid.legislacion.tag" },
  { icon: Gavel, titleKey: "home.grid.criterios.title", subtitleKey: "home.grid.criterios.subtitle", tagKey: "home.grid.criterios.tag" },
];

const RIGHT: SourceCard[] = [
  { icon: GraduationCap, titleKey: "home.grid.doctrina.title", subtitleKey: "home.grid.doctrina.subtitle", tagKey: "home.grid.doctrina.tag" },
  { icon: Landmark, titleKey: "home.grid.precedentes.title", subtitleKey: "home.grid.precedentes.subtitle", tagKey: "home.grid.precedentes.tag" },
  { icon: FileText, titleKey: "home.grid.reportes.title", subtitleKey: "home.grid.reportes.subtitle", tagKey: "home.grid.reportes.tag" },
];

function SourceCardTile({ card }: { card: SourceCard }) {
  const { t } = useI18n();
  const Icon = card.icon;
  return (
    <div
      className="panel flex h-[86px] items-center gap-3 rounded-[18px] px-4 py-3 backdrop-blur transition hover:-translate-y-[3px]"
      style={{ boxShadow: "var(--shadow-panel), 0 0 24px rgba(216,179,106,0.08)" }}
    >
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-card/70">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-bold tracking-[0.02em] text-foreground">
          {t(card.titleKey)}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{t(card.subtitleKey)}</div>
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-[2px] text-[8.5px] font-bold uppercase tracking-[0.14em] text-success">
          <span className="h-1 w-1 rounded-full bg-current" /> {t(card.tagKey)}
        </span>
      </div>
    </div>
  );
}

export function HeroOSDashboard() {
  const { t } = useI18n();
  return (
    <div className="relative mx-auto w-full max-w-[880px] py-6">
      {/* Ambient background wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 55% at 50% 50%, rgba(216,179,106,0.14), transparent 70%)",
        }}
      />

      {/* Desktop: symmetric 3-column grid */}
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] lg:items-center lg:gap-8">
        <div className="flex flex-col gap-3">
          {LEFT.map((c) => (
            <SourceCardTile key={c.titleKey} card={c} />
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
              stroke="rgba(216,179,106,0.18)"
              strokeWidth="0.6"
              strokeDasharray="2 6"
            />
            <circle
              cx="100"
              cy="100"
              r="70"
              fill="none"
              stroke="rgba(216,179,106,0.12)"
              strokeWidth="0.6"
            />
          </svg>
          <NyravaLogo size={140} glow />
          <div className="mt-3 text-center text-[9.5px] font-bold uppercase tracking-[0.28em] text-foreground">
            {t("home.badge.name")}
          </div>
          <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-primary">
            {t("home.badge.subtitle")}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[8.5px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            <span className="h-px w-4 bg-border" /> {t("home.badge.origin")} <span className="h-px w-4 bg-border" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {RIGHT.map((c) => (
            <SourceCardTile key={c.titleKey} card={c} />
          ))}
        </div>
      </div>

      {/* Mobile / tablet — badge on top, cards stacked below */}
      <div className="flex flex-col items-center lg:hidden">
        <NyravaLogo size={140} glow />
        <div className="mt-3 text-center text-[9.5px] font-bold uppercase tracking-[0.28em] text-foreground">
          {t("home.badge.name")}
        </div>
        <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-primary">
          {t("home.badge.subtitle")}
        </div>
        <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {[...LEFT, ...RIGHT].map((c) => (
            <SourceCardTile key={c.titleKey} card={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
