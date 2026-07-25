import { Globe } from "lucide-react";
import { useI18n, LOCALES, type Locale } from "@/i18n";

type Variant = "header" | "sidebar" | "inline";

export function LanguageSwitcher({ variant = "header" }: { variant?: Variant }) {
  const { locale, setLocale, t } = useI18n();

  const base =
    "inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition hover:text-foreground focus-within:border-primary/60";
  const sizing =
    variant === "sidebar" ? "px-2 py-1" : variant === "inline" ? "px-2 py-1" : "px-2.5 py-1.5";

  return (
    <label className={`${base} ${sizing}`} aria-label={t("common.language")}>
      <Globe className="h-3 w-3 text-primary" aria-hidden />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="cursor-pointer bg-transparent pr-1 uppercase focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="bg-background text-foreground">
            {l === "es" ? t("common.language.es") : t("common.language.en")}
          </option>
        ))}
      </select>
    </label>
  );
}
