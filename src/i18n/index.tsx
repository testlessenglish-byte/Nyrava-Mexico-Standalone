/**
 * Nyrava Intelligence México — Bilingual Localization System
 *
 * Free, self-hosted i18n. No paid translation APIs.
 * All user-facing strings live in src/i18n/locales/{es,en}.json.
 *
 * Usage:
 *   const { t, locale, setLocale } = useI18n();
 *   <h1>{t("landing.title.line1")}</h1>
 *
 * Preference persists to localStorage under NYRAVA_LOCALE_KEY and, when
 * the user is signed in, is synced to profiles.preferred_language (best-effort).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import es from "./locales/es.json";
import en from "./locales/en.json";
import { LEGAL_TERMS } from "./legal-terms";

export type Locale = "es" | "en";
export const LOCALES: Locale[] = ["es", "en"];
export const DEFAULT_LOCALE: Locale = "es";
export const NYRAVA_LOCALE_KEY = "nyrava:locale";

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { es: es as Dict, en: en as Dict };

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(NYRAVA_LOCALE_KEY);
  if (stored === "es" || stored === "en") return stored;
  const nav = window.navigator?.language?.slice(0, 2).toLowerCase();
  return nav === "en" ? "en" : DEFAULT_LOCALE;
}

/** Substitute {name} placeholders. */
function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}

/**
 * Dev-only missing-key diagnostics. Warns once per key/locale pair so the
 * console stays readable. The production fallback chain is untouched.
 */
const warnedKeys = new Set<string>();
function warnMissingKey(key: string, locale: Locale, hasFallback: boolean) {
  const id = `${locale}:${key}`;
  if (warnedKeys.has(id)) return;
  warnedKeys.add(id);
  console.warn(
    `[i18n] Missing "${locale}" translation for key "${key}"` +
      (hasFallback ? ` — falling back to "${DEFAULT_LOCALE}".` : " — no fallback, rendering the raw key."),
  );
}


type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Split a pipe-delimited value (features list, etc.) after translation. */
  tList: (key: string) => string[];
};

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Hydrate after mount to avoid SSR mismatch.
  useEffect(() => {
    setLocaleState(readInitialLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(NYRAVA_LOCALE_KEY, l);
      // Reflect on the <html lang> attribute for accessibility & SEO.
      document.documentElement.lang = l;
    }
    // Best-effort sync to profiles.preferred_language (silent on failure).
    void syncPreferredLanguage(l);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      // Legal terminology is locked and shared across locales.
      if (LEGAL_TERMS[key] != null) return LEGAL_TERMS[key];
      const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
      const own = dict[key];
      const fallback = DICTS[DEFAULT_LOCALE][key];
      // Dev-only diagnostics. The English/Spanish fallback chain below is
      // intentionally preserved in production — showing a translated string
      // from the other locale beats showing a raw key to a user.
      if (import.meta.env.DEV && own == null) {
        warnMissingKey(key, locale, fallback != null);
      }
      const value = own ?? fallback ?? key;
      return format(value, params);
    },
    [locale],
  );


  const tList = useCallback(
    (key: string) => t(key).split("|").map((s) => s.trim()).filter(Boolean),
    [t],
  );

  const value = useMemo(() => ({ locale, setLocale, t, tList }), [locale, setLocale, t, tList]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** Alias — matches the naming most React devs expect. */
export function useTranslation() {
  return useI18n();
}

/**
 * Best-effort sync of the chosen locale to profiles.preferred_language.
 * Fails silently if the user is signed out or the column doesn't exist yet.
 */
async function syncPreferredLanguage(locale: Locale) {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    await supabase.from("profiles").update({ preferred_language: locale }).eq("id", uid);
  } catch {
    /* silent */
  }
}
