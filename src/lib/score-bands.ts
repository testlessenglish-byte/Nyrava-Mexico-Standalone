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
