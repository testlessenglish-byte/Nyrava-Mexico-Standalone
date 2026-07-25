import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Play, ArrowRight } from "lucide-react";
import { NyravaLogo } from "@/components/NyravaLogo";
import { HeroOSDashboard } from "@/components/HeroOSDashboard";
import { TrustStrip } from "@/components/TrustStrip";
import { SiteFooter } from "@/components/SiteFooter";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/i18n";
import { listPublishedDemoCases } from "@/lib/demo-cases.functions";

const SITE_URL = "https://nyrava.com";
const LOGO_URL = `${SITE_URL}/nyrava-shield.png`;

const ORGANIZATION_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Nyrava",
  url: SITE_URL,
  logo: LOGO_URL,
  description:
    "The most advanced Legal Intelligence Operating System. Built for attorneys, investigators, and organizations that demand truth, precision, and results.",
});

const WEBSITE_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Nyrava Intelligence OS",
  url: SITE_URL,
  description: "Legal Intelligence beyond human analysis.",
  publisher: {
    "@type": "Organization",
    name: "Nyrava",
    url: SITE_URL,
    logo: LOGO_URL,
  },
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Nyrava Intelligence OS — Legal Intelligence Operating System" },
      { property: "og:url", content: "https://nyrava.com/" },
      { name: "twitter:url", content: "https://nyrava.com/" },
      {
        name: "description",
        content:
          "The most advanced Legal Intelligence Operating System. Built for attorneys, investigators, and organizations that demand truth, precision, and results.",
      },
      { property: "og:title", content: "Nyrava Intelligence OS" },
      { property: "og:description", content: "Legal Intelligence beyond human analysis." },
    ],
    scripts: [
      { type: "application/ld+json", children: ORGANIZATION_JSON_LD },
      { type: "application/ld+json", children: WEBSITE_JSON_LD },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/cases" });
  },
  component: Landing,
});

const NAV = [
  { key: "home.nav.product", href: "#product" },
  { key: "home.nav.security", to: "/security" },
  { key: "home.nav.transparency", to: "/ai-transparency" },
  { key: "home.nav.help", to: "/help" },
] as const;

function Landing() {
  const { t } = useI18n();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  const fetchDemoCases = useServerFn(listPublishedDemoCases);
  const { data: demoCases, isLoading: demosLoading } = useQuery({
    queryKey: ["published-demo-cases"],
    queryFn: () => fetchDemoCases(),
  });

  return (
    <div className="min-h-screen text-foreground">
      {/* Top nav */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <NyravaLogo size={42} withWordmark />
          <nav className="hidden items-center gap-8 lg:flex">
            {NAV.map((n) =>
              "to" in n ? (
                <Link
                  key={n.key}
                  to={n.to}
                  className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
                >
                  {t(n.key)}
                </Link>
              ) : (
                <a
                  key={n.key}
                  href={n.href}
                  className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
                >
                  {t(n.key)}
                </a>
              ),
            )}
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              to="/auth"
              className="rounded-md border border-border bg-card/60 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-foreground hover:bg-card"
            >
              {t("home.cta.signIn")}
            </Link>
            <Link
              to="/auth"
              className="rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-primary hover:bg-primary/25"
              style={{ boxShadow: "var(--shadow-glow-cyan)" }}
            >
              {t("home.cta.launchPlatform")}
            </Link>
          </div>
        </div>

      </header>

      <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-20">
          <div>
            <div className="mb-6 text-[11px] font-semibold tracking-[0.28em] tag-bracket text-amber">
              <span className="text-amber">{t("home.hero.badge")}</span>
            </div>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              {t("home.hero.line1")}
              <br />
              <span className="font-editorial text-primary">{t("home.hero.line2")}</span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-muted-foreground">
              {t("home.hero.subtitle")}
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-primary transition hover:bg-primary/25"
                style={{ boxShadow: "var(--shadow-glow-cyan)" }}
              >
                {t("home.cta.launchCommand")} <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#product"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card/60 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-foreground transition hover:bg-card"
              >
                {t("home.cta.watchDemo")} <Play className="h-3.5 w-3.5" />
              </a>
            </div>

          </div>
          <div className="flex justify-center lg:pl-4">
            <HeroOSDashboard />
          </div>
        </div>
      </section>

      {/* Experience Nyrava — live case demos */}
      <section id="product" className="mx-auto max-w-7xl px-6 py-12 lg:py-16">

        <div className="mb-3 text-[11px] font-semibold tracking-[0.28em] tag-bracket text-amber">EXPERIENCE NYRAVA</div>
        <h2 className="mb-8 max-w-2xl font-display text-2xl font-semibold leading-tight md:text-3xl">
          See a complete case analysis before you upload a single document.
        </h2>

        {demosLoading && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="panel h-40 animate-pulse" />
            ))}
          </div>
        )}

        {!demosLoading && (!demoCases || demoCases.length === 0) && (
          <div className="panel p-8 text-sm text-muted-foreground">Demo cases are coming soon.</div>
        )}

        {!demosLoading && demoCases && demoCases.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {demoCases.map((c) => (
              <Link
                key={c.id}
                to="/demo/$slug"
                params={{ slug: c.slug }}
                className="panel group flex flex-col gap-4 p-5 transition hover:-translate-y-0.5"
              >
                <div className="grid h-12 w-12 place-items-center rounded-md border border-border bg-card/60 p-1">
                  <img src="/nyrava-shield.png" alt="Nyrava" className="h-full w-full object-contain" />
                </div>

                <div>
                  <div className="text-[10.5px] font-semibold tracking-[0.2em] text-amber">
                    {c.case_type_label.toUpperCase()}
                  </div>
                  <h3 className="mt-1 font-display text-base font-semibold leading-tight">{c.name}</h3>
                  {c.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{c.summary}</p>}
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.22em] text-primary transition group-hover:gap-2">
                  RUN DEMO <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <TrustStrip />
      </main>
      <SiteFooter />
    </div>
  );
}
