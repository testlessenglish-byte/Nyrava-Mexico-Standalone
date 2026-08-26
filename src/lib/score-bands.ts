// Shared 0-100 score → qualitative band mapping. Single source of truth so
// every score display (case score gauge, dashboard metric tiles, score
// cards) uses the same thresholds instead of each component inventing its
// own — which is what existed before this file (three different threshold
// schemes across three components).
//
// Thresholds are fixed by product spec, not tunable per-caller:
//   90-100  Excelente   (green)
//   70-89   Sólido/Fuerte (blue/green)
//   50-69   Moderado/En Riesgo (yellow/amber)
//   <50     Crítico     (red)
export type ScoreBandId = "excellent" | "solid" | "moderate" | "critical";

export type ScoreBand = {
  id: ScoreBandId;
  /** i18n key for the qualitative label — see score.band.* in the locale files. */
  labelKey: string;
  /** Hex color for direct use in inline styles (SVG strokes, etc.). */
  hex: string;
  /** Tailwind text-color utility class, for components already using className-based color. */
  textClass: string;
  /** Tailwind badge background/border classes for a pill/chip presentation. */
  badgeClass: string;
};

const BANDS: Record<ScoreBandId, ScoreBand> = {
  excellent: {
    id: "excellent",
    labelKey: "score.band.excellent",
    hex: "#34d399",
    textClass: "text-emerald-600",
    badgeClass: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  },
  solid: {
    id: "solid",
    labelKey: "score.band.solid",
    hex: "#38bdf8",
    textClass: "text-sky-600",
    badgeClass: "bg-sky-500/15 text-sky-700 border-sky-500/30",
  },
  moderate: {
    id: "moderate",
    labelKey: "score.band.moderate",
    hex: "#fbbf24",
    textClass: "text-amber-600",
    badgeClass: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  },
  critical: {
    id: "critical",
    labelKey: "score.band.critical",
    hex: "#ef4444",
    textClass: "text-red-600",
    badgeClass: "bg-red-500/15 text-red-700 border-red-500/30",
  },
};

/** A polarity of "risk" inverts which end of the scale is good — e.g. a
 * risk_score of 95 is CRITICAL (very risky), not excellent. Defaults to
 * "strength" (higher = better), which is the common case for case-strength/
 * confidence/evidence-quality type scores. */
export function scoreBand(value: number, polarity: "strength" | "risk" = "strength"): ScoreBand {
  const v = polarity === "risk" ? 100 - value : value;
  if (v >= 90) return BANDS.excellent;
  if (v >= 70) return BANDS.solid;
  if (v >= 50) return BANDS.moderate;
  return BANDS.critical;
}


export type RiskBandId = "low" | "low_moderate" | "moderate" | "high" | "critical";

export type DeterministicRiskBand = {
  id: RiskBandId;
  label_es: string;
  label_en: string;
  min: number;
  max: number;
};

export function deterministicRiskBand(value: number): DeterministicRiskBand {
  const score = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if (score <= 19) return { id: "low", label_es: "bajo", label_en: "low", min: 0, max: 19 };
  if (score <= 39) {
    return {
      id: "low_moderate",
      label_es: "bajo-moderado",
      label_en: "low-moderate",
      min: 20,
      max: 39,
    };
  }
  if (score <= 59) {
    return { id: "moderate", label_es: "moderado", label_en: "moderate", min: 40, max: 59 };
  }
  if (score <= 79) return { id: "high", label_es: "alto", label_en: "high", min: 60, max: 79 };
  return { id: "critical", label_es: "crítico", label_en: "critical", min: 80, max: 100 };
}

const RISK_LANGUAGE: Record<RiskBandId, RegExp> = {
  low: /\b(bajo|low)\b/i,
  low_moderate: /\b(bajo[ -]moderado|low[ -]moderate)\b/i,
  moderate: /\b(moderado|moderate)\b/i,
  high: /\b(alto|high|significativo|considerable)\b/i,
  critical: /\b(cr[ií]tico|critical|extremo|severo)\b/i,
};

export function riskNarrativeContradictsScore(score: number, narrative: string): boolean {
  const expected = deterministicRiskBand(score);
  let text = String(narrative ?? "");
  const mentioned = new Set<RiskBandId>();

  // Compound labels must be consumed first. Otherwise "bajo-moderado" is
  // incorrectly detected as both "bajo" and "moderado".
  text = text.replace(
    /\b(bajo[ -]moderado|low[ -]moderate)\b/gi,
    (match) => {
      mentioned.add("low_moderate");
      return " ".repeat(match.length);
    },
  );
  for (const id of ["critical", "high", "moderate", "low"] as const) {
    if (RISK_LANGUAGE[id].test(text)) mentioned.add(id);
  }
  return mentioned.size > 0 && Array.from(mentioned).some((id) => id !== expected.id);
}

export function enforceRiskNarrative(
  score: number,
  narrative: string,
  locale: "es" | "en" = "es",
): { text: string; rewritten: boolean; band: DeterministicRiskBand } {
  const band = deterministicRiskBand(score);
  const label = locale === "en" ? band.label_en : band.label_es;
  const heading =
    locale === "en"
      ? `Overall risk: ${label} (${Math.round(score)}/100).`
      : `Riesgo global: ${label} (${Math.round(score)}/100).`;
  const rewritten = riskNarrativeContradictsScore(score, narrative);
  return {
    text: rewritten ? heading : `${heading}${narrative ? ` ${narrative}` : ""}`,
    rewritten,
    band,
  };
}
