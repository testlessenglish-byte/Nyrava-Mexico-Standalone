import { Link } from "@tanstack/react-router";
import { NyravaLogo } from "./NyravaLogo";
import { useI18n } from "@/i18n";

export function SiteFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-24 border-t border-border/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <NyravaLogo size={42} withWordmark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("footer.about")}
          </p>
          <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            <span className="tag-bracket">{t("footer.version")}</span>
          </p>
        </div>
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {t("footer.section.platform")}
          </h4>
          <ul className="mt-4 space-y-2 text-sm text-foreground/80">
            <li><Link to="/platform" className="hover:text-primary">{t("footer.link.platform")}</Link></li>
            <li><Link to="/modules" className="hover:text-primary">{t("footer.link.modules")}</Link></li>
            <li><Link to="/security" className="hover:text-primary">{t("footer.link.security")}</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {t("footer.section.legal")}
          </h4>
          <ul className="mt-4 space-y-2 text-sm text-foreground/80">
            <li><a href="/privacy" className="hover:text-primary">{t("footer.link.privacy")}</a></li>
            <li><a href="/terms" className="hover:text-primary">{t("footer.link.terms")}</a></li>
            <li><Link to="/contact" className="hover:text-primary">{t("footer.link.contact")}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-6 py-6 text-xs text-muted-foreground md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} Nyrava Intelligence México. {t("footer.copyright")}</span>
          <span className="font-mono text-[10px] tracking-[0.16em]">{t("footer.location")}</span>
        </div>
      </div>
    </footer>
  );
}
