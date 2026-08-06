import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { translateTexts } from "@/lib/cases.functions";
import { useI18n } from "@/i18n";

// Cheap, stable content hash for the react-query cache key — a batch of
// strings already translated this session is never re-sent to the model.
function hashTexts(texts: string[]): string {
  const s = texts.join("");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

/**
 * On-demand translation for AI-generated case content (finding titles,
 * opportunity descriptions, timeline events, witness profiles, etc.) shown
 * in the app UI — NOT for the formal Report (Reports page, the case
 * workspace's Report tab, PDF/DOCX/JSON export), which always renders in
 * the language it was generated in.
 *
 * `sourceLocale` is the language the content was actually generated in
 * (the case's report_language, defaulting to "es"). When the UI locale
 * matches it, this is a no-op that returns the originals untouched.
 */
export function useTranslatedTexts(
  texts: (string | null | undefined)[],
  sourceLocale: "es" | "en" = "es",
): { texts: string[]; isTranslating: boolean } {
  const { locale } = useI18n();
  const fetchTranslate = useServerFn(translateTexts);
  const clean = texts.map((t) => t ?? "");
  const needsTranslation = locale !== sourceLocale && clean.some((t) => t.trim().length > 0);

  const { data, isFetching } = useQuery({
    queryKey: ["ui-translate", locale, hashTexts(clean)],
    queryFn: () => fetchTranslate({ data: { texts: clean, targetLocale: locale } }),
    enabled: needsTranslation && clean.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });

  if (!needsTranslation) return { texts: clean, isTranslating: false };
  return { texts: data?.translations ?? clean, isTranslating: isFetching && !data };
}
