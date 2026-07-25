import { useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@/i18n";

type Props = {
  /** Fallback route when there is no browser history to go back to. */
  fallbackTo?: string;
  /** Overrides the localized default ("Back" / "Atrás"). */
  label?: string;
  className?: string;
};

/**
 * Universal Back button. Uses browser history first, and falls back to
 * the provided route (default `/dashboard`) when there is none.
 */
export function BackButton({ fallbackTo = "/dashboard", label, className = "" }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const text = label ?? t("common.back");

  const onClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    router.navigate({ to: fallbackTo });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={text}
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-card/60 px-2.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-card hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${className}`}
    >
      <ChevronLeft className="h-4 w-4" />
      <span>{text}</span>
    </button>
  );
}
