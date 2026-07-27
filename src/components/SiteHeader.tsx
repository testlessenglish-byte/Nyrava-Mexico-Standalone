import { Link } from "@tanstack/react-router";
import { NyravaLogo } from "./NyravaLogo";
import { useSession } from "@/hooks/use-session";
import { useI18n } from "@/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function SiteHeader() {
  const { user } = useSession();
  const { t } = useI18n();

  const NAV = [
    { label: t("nav.platform"), to: "/platform" as const },
    { label: t("nav.modules"), to: "/modules" as const },
    { label: t("nav.security"), to: "/security" as const },
    { label: t("nav.contact"), to: "/contact" as const },
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
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-primary transition hover:bg-primary/20"
            >
              {t("nav.openWorkspace")}
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                className="hidden text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition hover:text-foreground md:inline"
              >
                {t("nav.signIn")}
              </Link>
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-primary transition hover:bg-primary/20"
              >
                {t("nav.requestAccess")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
