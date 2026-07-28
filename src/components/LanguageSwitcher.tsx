import { ChevronDown } from "lucide-react";
import { useI18n, LOCALES, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";

type Variant = "header" | "sidebar" | "inline";

const FLAG: Record<Locale, string> = { es: "🇲🇽", en: "🇺🇸" };

export function LanguageSwitcher({
  variant = "header",
  className = "",
}: {
  variant?: Variant;
  className?: string;
}) {
  const { locale, setLocale, t } = useI18n();

  const sizing =
    variant === "sidebar" ? "px-2 py-1" : variant === "inline" ? "px-2 py-1" : "px-2.5 py-2";

  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent text-[11px] font-semibold tracking-[0.14em] text-foreground transition hover:border-primary/50 focus-within:border-primary/60",
        sizing,
        className,
      )}
      aria-label={t("common.language")}
    >
      <span aria-hidden className="text-[13px] leading-none">
        {FLAG[locale]}
      </span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="cursor-pointer appearance-none bg-transparent pr-4 uppercase focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="bg-background text-foreground">
            {l === "es" ? t("common.language.es") : t("common.language.en")}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3" aria-hidden />
    </label>
  );
}
