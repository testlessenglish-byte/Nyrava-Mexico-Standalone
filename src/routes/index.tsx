import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Brain, FileSearch, GitBranch, Layers, ScanLine, Scale, ShieldCheck, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { IntelligenceHeroPanel } from "@/components/IntelligenceHeroPanel";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Nyrava Intelligence México — Plataforma de Inteligencia Legal" },
      {
        name: "description",
        content:
          "La primera Plataforma de Inteligencia Legal diseñada para el sistema jurídico mexicano. Organiza, analiza y desarrolla asuntos legales de principio a fin.",
      },
      { property: "og:title", content: "Nyrava Intelligence México" },
      {
        property: "og:description",
        content:
          "Inteligencia legal integrada para abogados, despachos e instituciones en México. Federal, estatal, SCJN, jurisprudencia y evidencia en un solo entorno.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Nyrava Intelligence México" },
      {
        name: "twitter:description",
        content:
          "Plataforma de Inteligencia Legal para el sistema jurídico mexicano.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useI18n();

  const MODULES = [
    { icon: Scale, name: t("module.legal.name"), desc: t("module.legal.desc") },
    { icon: FileSearch, name: t("module.case.name"), desc: t("module.case.desc") },
    { icon: Layers, name: t("module.evidence.name"), desc: t("module.evidence.desc") },
    { icon: Users, name: t("module.witness.name"), desc: t("module.witness.desc") },
    { icon: GitBranch, name: t("module.timeline.name"), desc: t("module.timeline.desc") },
    { icon: Brain, name: t("module.litigation.name"), desc: t("module.litigation.desc") },
    { icon: ShieldCheck, name: t("module.contract.name"), desc: t("module.contract.desc") },
    { icon: ScanLine, name: t("module.research.name"), desc: t("module.research.desc") },
  ];

  const SOURCES = [
    t("source.federalLegislation"),
    t("source.stateLegislation"),
    t("source.scjn"),
    t("source.federalJudicial"),
    t("source.stateCourts"),
    t("source.adminRegs"),
    t("source.constReforms"),
    t("source.dof"),
    t("source.procCodes"),
  ];

  return (
    <div className="min-h-screen text-foreground">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 divider-grid opacity-[0.35]" aria-hidden />
        <div className="mx-auto grid max-w-7xl gap-14 px-6 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/50 px-3 py-1 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {t("landing.title.badge")}
              </span>
            </div>

            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-foreground md:text-6xl">
              {t("landing.title.line1")}
              <br />
              <span className="font-editorial text-primary">{t("landing.title.line2")}</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {t("landing.title.subtitle")}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-foreground shadow-[0_0_28px_oklch(0.82_0.13_195/0.35)] transition hover:brightness-110"
              >
                {t("landing.cta.request")} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/platform"
                className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-card/40 px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-foreground transition hover:border-primary/50"
              >
                {t("landing.cta.viewPlatform")}
              </Link>
            </div>

            <div className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-border/60 pt-6">
              {[
                { k: t("landing.stat.sources"), v: "40+" },
                { k: t("landing.stat.modules"), v: "8" },
                { k: t("landing.stat.jurisdictions"), v: t("landing.stat.jurisdictions.value") },
              ].map((s) => (
                <div key={s.k}>
                  <div className="font-display text-2xl font-bold text-foreground">{s.v}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{s.k}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <IntelligenceHeroPanel />
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="border-y border-border/60 bg-background/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-2">
          <div>
            <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {t("landing.problem.tag")}
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold leading-tight">{t("landing.problem.title")}</h2>
            <p className="mt-4 text-muted-foreground">{t("landing.problem.body")}</p>
          </div>
          <div>
            <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {t("landing.solution.tag")}
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold leading-tight">{t("landing.solution.title")}</h2>
            <p className="mt-4 text-muted-foreground">{t("landing.solution.body")}</p>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {t("landing.modules.tag")}
            </span>
            <h2 className="mt-3 font-display text-3xl font-bold leading-tight md:text-4xl">
              {t("landing.modules.title")}
            </h2>
          </div>
          <Link to="/modules" className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-primary hover:underline md:inline">
            {t("common.viewAll")} →
          </Link>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <div key={m.name} className="stat-tile group p-5">
              <m.icon className="h-5 w-5 text-primary transition group-hover:scale-110" />
              <h3 className="mt-4 font-display text-base font-semibold text-foreground">{m.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Sources */}
      <section className="border-t border-border/60 bg-background/40">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {t("landing.sources.tag")}
          </span>
          <h2 className="mt-3 font-display text-3xl font-bold leading-tight">{t("landing.sources.title")}</h2>
          <div className="mt-8 flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <span
                key={s}
                className="rounded-md border border-border/70 bg-card/40 px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] text-foreground/80"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <h2 className="font-display text-4xl font-bold leading-tight tracking-tight md:text-5xl">
          {t("landing.cta.big.line1")} <br />
          <span className="font-editorial text-primary">{t("landing.cta.big.line2")}</span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-muted-foreground">{t("landing.cta.big.body")}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-foreground transition hover:brightness-110"
          >
            {t("landing.cta.request")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
