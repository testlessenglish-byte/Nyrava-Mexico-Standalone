import { Link } from "@tanstack/react-router";
import { NyravaLogo } from "./NyravaLogo";
import { useSession } from "@/hooks/use-session";
import { useI18n } from "@/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { MobileNav } from "./MobileNav";

export function SiteHeader() {
  const { user } = useSession();
  const { t } = useI18n();

  const NAV = [
    { label: t("nav.product"), to: "/platform" as const },
    { label: t("nav.legalSources"), to: "/modules" as const },
    { label: t("nav.security"), to: "/security" as const },
    { label: t("nav.transparency"), to: "/ai-transparency" as const },
    { label: t("nav.helpShort"), to: "/help" as const },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/" className="flex min-w-0 items-center">

          <NyravaLogo size={38} withWordmark />
        </Link>
        <nav className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <LanguageSwitcher />
          {user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-primary-foreground transition hover:brightness-105"
              style={{ boxShadow: "var(--shadow-glow-cyan)" }}
            >
              {t("nav.openWorkspace")}
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className="hidden rounded-md border border-border px-3 py-2 text-[11px] font-semibold tracking-[0.16em] text-foreground transition hover:border-primary/50 hover:text-primary md:inline-flex md:items-center"
              >
                {t("nav.signIn")}
              </Link>
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-primary-foreground transition hover:brightness-105 sm:px-4"
                style={{ boxShadow: "var(--shadow-glow-cyan)" }}
              >
                {t("nav.openPlatform")}
              </Link>
            </>
          )}
          <MobileNav items={NAV}>
            {user ? (
              <Link
                to="/dashboard"
                className="rounded-md bg-primary px-3 py-2 text-center text-[11px] font-bold tracking-[0.14em] text-primary-foreground"
              >
                {t("nav.openWorkspace")}
              </Link>
            ) : (
              <>
                <Link
                  to="/auth"
                  className="rounded-md border border-border px-3 py-2 text-center text-[11px] font-semibold tracking-[0.14em] text-foreground"
                >
                  {t("nav.signIn")}
                </Link>
                <Link
                  to="/auth"
                  className="rounded-md bg-primary px-3 py-2 text-center text-[11px] font-bold tracking-[0.14em] text-primary-foreground"
                >
                  {t("nav.openPlatform")}
                </Link>
              </>
            )}
          </MobileNav>
        </div>

      </div>
    </header>
  );
}
