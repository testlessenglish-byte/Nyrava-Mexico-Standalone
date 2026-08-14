import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { NyravaLogo } from "./NyravaLogo";
import { SiteFooter } from "./SiteFooter";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useI18n } from "@/i18n";

type Props = {
  eyebrow?: string;
  title: string;
  updated?: string;
  intro?: ReactNode;
  children: ReactNode;
};

/**
 * Shared shell for public legal / policy / support pages.
 * Uses the same dark visual language as the landing page.
 */
export function LegalPage({ eyebrow, title, updated, intro, children }: Props) {
  const { t } = useI18n();
  return (
    <div className="min-h-screen text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2" aria-label="Nyrava home">
            <NyravaLogo size={36} withWordmark />
          </Link>
          <nav className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              to="/auth"
              className="rounded-md border border-border bg-card/60 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-foreground hover:bg-card"
            >
              {t("nav.signIn")}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        {eyebrow && (
          <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-primary">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-3xl font-semibold leading-tight md:text-4xl">
          {title}
        </h1>
        {updated && (
          <div className="mt-2 text-[12px] text-muted-foreground">{t("legal.lastUpdated")} {updated}</div>
        )}
        {intro && (
          <div className="mt-6 text-[14px] leading-relaxed text-muted-foreground">{intro}</div>
        )}
        <div className="legal-prose mt-8 space-y-8">{children}</div>
      </main>

      <SiteFooter />
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
