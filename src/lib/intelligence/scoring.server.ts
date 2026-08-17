// Deterministic, rule-based scoring derived from verified findings.
//
// Replaces opaque LLM scores with a transparent calculation: every score
// reports its inputs, weights, formula, and per-finding contributors.
//
// Severity weights, confidence multipliers, and category-to-dimension mappings
// live here as plain constants so an external reviewer can audit and tune
// them. The LLM is no longer asked to "feel" a number.
//
// CHANGE (saturation fix): the original formula summed
// severity_weight * confidence * polarity across EVERY matching finding with
// no decay. Since "critical" = 25 points and most dimension baselines sit at
// 60-80, any case with more than ~3-4 critical findings mapped to the same
// dimension floors (or ceilings) it instantly — after that point, adding a
// 5th or 10th critical finding to the same dimension changes nothing, and
// the scorecard can no longer distinguish "bad" from "catastrophic" on that
// dimension. This is not specific to any one case's content — it happens
// whenever a case (of any type) has enough findings clustered on one
// dimension, which becomes more likely as corpus size and finding count
// grow. Fix: apply diminishing returns — findings are ranked by raw weight
// within each dimension/polarity, and each additional contributor beyond
// the first counts for progressively less (geometric decay), so heavily
// corroborated dimensions still trend toward the extremes without
// instantly saturating and losing all resolution. The per-contributor
// `signed_weight` shown in the report stays the RAW, undecayed value for
// audit transparency; only the aggregate used to compute the dimension
// score applies decay. This generalizes to every case type and every
// dimension — no case-specific tuning.

import type { Finding } from "./types";
import { dimensionTag, type DimensionKey } from "./dimension-map.server";
import { excludeRejectedFromScoring } from "./judicial-hierarchy";

export type ScoreContributor = {
  finding_id: string;
  title: string;
  category: string;
  severity: Finding["severity"];
  confidence: number;
  affected_party: Finding["affected_party"];
  signed_weight: number; // positive = strengthens dimension, negative = weakens (RAW, undecayed)
};

export type DimensionScore = {
  dimension: string;
  score: number; // 0-100
  baseline: number;
  raw_delta: number;
  decayed_delta: number;
  positive_weight_total: number;
  negative_weight_total: number;
  contributor_count: number;
  positives: ScoreContributor[];
  negatives: ScoreContributor[];
  reasoning: string;
  formula: string;
};

export type DeterministicScorecard = {
  methodology: string;
  generated_at: string;
  finding_count: number;
  dimensions: Record<string, DimensionScore>;
  overall_confidence: number;
  formula_notes: string[];
};

const SEVERITY_WEIGHT: Record<Finding["severity"], number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 1,
};

// Diminishing-returns decay applied per additional contributor on the same
// side (positive or negative) of the same dimension, ranked by raw weight
// descending. The first (largest) contributor always counts at full
// strength; each subsequent one counts for DECAY_RATE as much as the one
// before it. 0.6 means the 2nd contributor counts 60%, the 3rd counts 36%,
// the 4th counts ~22%, etc. — corroboration still matters and still trends
// the score toward the extreme, it just can't instantly max out on its own.
const DECAY_RATE = 0.6;

function decayedSum(weights: number[]): number {
  // weights are RAW signed_weight values (all same sign within a call).
  const sorted = [...weights].sort((a, b) => Math.abs(b) - Math.abs(a));
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i] * Math.pow(DECAY_RATE, i);
  }
  return sum;
}

// Each dimension declares which categories raise (positive) and which lower
// (negative) the score. Categories not listed are ignored for that dimension.
const DIMENSIONS: Record<
  string,
  {
    baseline: number;
    positive: { categories: string[]; modules?: string[] };
    negative: { categories: string[]; modules?: string[] };
    label: string;
  }
> = {
  // NEUTRAL INTEGRITY DIMENSIONS — higher = healthier evidentiary record,
  // regardless of side. Defects can ONLY lower a dimension; affirmative
  // matchers are intentionally narrow so a "missing chain of custody"
  // finding cannot accidentally strengthen Evidence Reliability.
  evidence_strength: {
    baseline: 60,
    label: "Confiabilidad de la evidencia",
    positive: { categories: ["corroborating_evidence", "evidence_corroborated", "physical_evidence_intact"] },
    negative: {
      categories: [
        "weak_evidence",
        "evidence_contradiction",
        "inadmissible",
        "evidence_unreliable",
        "evidence_missing",
      ],
    },
  },
  witness_reliability: {
    baseline: 60,
    label: "Confiabilidad de testigos",
    positive: { categories: ["witness_corroborated"] },
    negative: {
      categories: [
        "witness_bias",
        "witness_contradiction",
        "credibility",
        "witness_inconsistency",
        "informant_unreliable",
      ],
    },
  },
  timeline_integrity: {
    baseline: 70,
    label: "Integridad cronológica",
    positive: { categories: ["timeline_consistent"] },
    negative: { categories: ["timeline_inconsistency", "timeline_gap", "timeline_conflict", "alibi_conflict"] },
  },
  chain_of_custody: {
    baseline: 80,
    label: "Integridad de la cadena de custodia",
    positive: { categories: ["custody_intact"] },
    negative: { categories: ["chain_of_custody", "custody_break", "custody_gap", "evidence_tampering"] },
  },
  constitutional_compliance: {
    baseline: 80,
    label: "Cumplimiento constitucional",
    positive: { categories: ["constitutional_compliant"] },
    negative: {
      // FIX (2026-07-29): legacy fallback tokens rebuilt to match
      // classify.server.ts's actual category_key output — the old tokens
      // ("miranda", "fourth_amendment", "warrant_defect", "franks") could
      // never match a real Mexican finding's category_key.
      categories: [
        "constitutional",
        "confession_issue",
        "diligencia_investigacion",
        "carpeta_investigacion",
        "control_detencion",
      ],
    },
  },
  investigation_completeness: {
    baseline: 60,
    label: "Integridad de la investigación",
    positive: { categories: ["investigation_thorough"] },
    negative: {
      categories: ["missing_evidence", "investigation_gap", "unresolved_lead", "missing_interview", "missing_record"],
    },
  },
  discovery_completeness: {
    baseline: 60,
    label: "Integridad de la investigación (aportación probatoria)",
    positive: { categories: ["discovery_compliant", "production_complete"] },
    negative: { categories: ["violacion_procesal", "missing_evidence", "discovery_gap", "discovery_violation"] },
  },
  forensic_reliability: {
    baseline: 70,
    label: "Confiabilidad pericial/forense",
    positive: { categories: ["forensic_corroborated"] },
    negative: { categories: ["expert_challenge", "forensic_unreliable", "dna_degradation", "mixed_dna", "lab_error"] },
  },
  procedural_integrity: {
    baseline: 70,
    label: "Integridad procesal",
    positive: { categories: ["procedural_compliant"] },
    negative: { categories: ["violacion_procesal", "procedural", "discovery_violation"] },
  },
  // ── Civil-only dimensions ─────────────────────────────────────────────────
  liability_strength: {
    baseline: 50,
    label: "Fortaleza de la responsabilidad",
    positive: { categories: ["liability", "duty", "breach", "standard_of_care", "negligence_established"] },
    negative: { categories: ["no_duty", "liability_defense", "comparative_fault", "assumption_of_risk"] },
  },
  causation_strength: {
    baseline: 50,
    label: "Fortaleza del nexo causal",
    positive: { categories: ["causation", "proximate_cause", "but_for"] },
    negative: { categories: ["causation_gap", "intervening_cause", "superseding_cause"] },
  },
  damages_exposure: {
    baseline: 50,
    label: "Exposición por daños",
    positive: { categories: ["damages", "injury", "loss", "economic_damages", "noneconomic_damages"] },
    negative: { categories: ["mitigation", "speculative_damages", "damages_cap"] },
  },
  expert_support: {
    baseline: 50,
    label: "Apoyo pericial",
    positive: { categories: ["expert", "expert_opinion", "expert_corroboration"] },
    negative: { categories: ["expert_gap", "expert_contradiction", "expert_challenge"] },
  },
  documentation_reliability: {
    baseline: 60,
    label: "Confiabilidad documental",
    positive: { categories: ["documentation", "records_complete", "document_integrity"] },
    negative: {
      categories: [
        "documentation_gap",
        "record_alteration",
        "record_inconsistency",
        "records_missing",
        "documentation_discrepancy",
      ],
    },
  },
  discovery_compliance: {
    baseline: 60,
    label: "Cumplimiento probatorio",
    positive: { categories: ["discovery_compliant", "production_complete"] },
    negative: { categories: ["violacion_procesal", "discovery_gap", "discovery_violation", "missing_evidence"] },
  },
  litigation_risk: {
    baseline: 50,
    label: "Riesgo litigioso",
    positive: { categories: ["defense_strong", "case_strong"] },
    negative: { categories: ["adverse_ruling", "litigation_risk", "exposure", "trial_risk"] },
  },
  settlement_pressure: {
    baseline: 50,
    label: "Presión para conciliar",
    positive: { categories: ["settlement_leverage", "settlement_pressure"] },
    negative: { categories: ["weak_settlement_position"] },
  },
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function signedWeight(f: Finding, polarity: 1 | -1): number {
  const sev = SEVERITY_WEIGHT[f.severity] ?? 5;
  const conf = Math.max(0, Math.min(1, f.confidence ?? 0.5));
  return polarity * sev * conf;
}

// Normalizes both sides to bare lowercase tokens before comparing, so
// "Chain of Custody" (display) and "chain_of_custody" (slug) are treated
// as equal. This is a defense-in-depth fallback ONLY — the primary path is
// the exact tag lookup below. Any finding written after the dimension-map
// patch lands already carries an explicit "dimension:<key>" tag and never
// needs this fallback at all.
function normTok(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

function matchesLegacyCategory(f: Finding, cats: string[], mods?: string[]): boolean {
  const cat = normTok(f.category ?? "");
  if (cats.some((c) => cat.includes(normTok(c)))) return true;
  if (mods && mods.some((m) => (f.source_module ?? "").includes(m))) return true;
  return false;
}

function matches(f: Finding, dimensionKey: string, cats: string[], mods?: string[]): boolean {
  // Primary path: explicit, content-derived dimension tag written at
  // persistence time. Exact match, no guessing.
  const tags = (f as unknown as { tags?: string[] }).tags ?? [];
  if (tags.includes(dimensionTag(dimensionKey as DimensionKey))) return true;
  // Fallback for rows written before the dimension-map patch (or any row
  // that for some reason never got tagged) — normalized substring match
  // instead of the old raw-string match, so "Chain of Custody" still
  // matches "chain_of_custody".
  return matchesLegacyCategory(f, cats, mods);
}

const CIVIL_DIMENSIONS = [
  "liability_strength",
  "causation_strength",
  "damages_exposure",
  "witness_reliability",
  "expert_support",
  "timeline_integrity",
  "documentation_reliability",
  "discovery_compliance",
  "litigation_risk",
  "settlement_pressure",
  "procedural_integrity",
  "evidence_strength",
];

// Case-type → which dimensions apply. Dimensions not listed here are
// suppressed entirely from the scorecard so the report cannot drag
// penal-only metrics (chain_of_custody, constitutional_compliance) into
// civil / mercantil / laboral matters.
//
// FIX (2026-07-29): this only had retired English keys ("criminal",
// "civil_rights", "medical_malpractice", "personal_injury", "employment",
// "family", "general_civil", "tax_law") — never the actual Mexican
// taxonomy ("penal", "civil", "mercantil", "laboral", "familiar", "fiscal",
// etc.). Since no real case_type value could ever match a key here, EVERY
// Mexican case fell through to the old fallback, `Object.keys(DIMENSIONS)`
// — literally every dimension, penal and civil combined, on every
// scorecard regardless of materia. Rebuilt with the real 13 MX_CASE_TYPES
// keys and dimension sets appropriate to each materia's actual procedure,
// plus the retired English keys kept alongside for any pre-migration data
// still carrying them. The fallback is now a safe, generic minimal set —
// never "all dimensions at once" — for any materia not yet mapped here.
const CASE_TYPE_DIMENSIONS: Record<string, string[]> = {
  penal: [
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "chain_of_custody",
    "constitutional_compliance",
    "investigation_completeness",
    "discovery_completeness",
    "forensic_reliability",
    "procedural_integrity",
  ],
  constitucional: [
    "evidence_strength",
    "witness_reliability",
    "constitutional_compliance",
    "investigation_completeness",
    "discovery_completeness",
    "procedural_integrity",
    "documentation_reliability",
  ],
  amparo: [
    "evidence_strength",
    "timeline_integrity",
    "constitutional_compliance",
    "procedural_integrity",
    "documentation_reliability",
  ],
  civil: CIVIL_DIMENSIONS,
  mercantil: CIVIL_DIMENSIONS,
  familiar: [
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "documentation_reliability",
    "procedural_integrity",
  ],
  laboral: [
    "evidence_strength",
    "witness_reliability",
    "liability_strength",
    "damages_exposure",
    "documentation_reliability",
    "procedural_integrity",
    "litigation_risk",
  ],
  fiscal: ["evidence_strength", "documentation_reliability", "procedural_integrity", "litigation_risk"],
  administrativo: ["evidence_strength", "documentation_reliability", "procedural_integrity", "litigation_risk"],
  electoral: ["evidence_strength", "documentation_reliability", "procedural_integrity"],
  agrario: [
    "evidence_strength",
    "witness_reliability",
    "liability_strength",
    "documentation_reliability",
    "procedural_integrity",
  ],
  ambiental: [
    "evidence_strength",
    "documentation_reliability",
    "procedural_integrity",
    "litigation_risk",
    "expert_support",
  ],
  inmobiliario: ["evidence_strength", "documentation_reliability"],
  apelacion: ["evidence_strength", "timeline_integrity", "procedural_integrity", "documentation_reliability"],
  // Retired English keys — kept for any case rows written before the
  // Mexican-taxonomy migration; new cases never carry these.
  criminal: [
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "chain_of_custody",
    "constitutional_compliance",
    "investigation_completeness",
    "discovery_completeness",
    "forensic_reliability",
    "procedural_integrity",
  ],
  civil_rights: [
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "constitutional_compliance",
    "investigation_completeness",
    "discovery_completeness",
    "procedural_integrity",
    "liability_strength",
    "damages_exposure",
    "litigation_risk",
  ],
  medical_malpractice: CIVIL_DIMENSIONS,
  personal_injury: CIVIL_DIMENSIONS,
  employment: CIVIL_DIMENSIONS,
  family: [
    "evidence_strength",
    "witness_reliability",
    "timeline_integrity",
    "documentation_reliability",
    "procedural_integrity",
  ],
  appellate: ["evidence_strength", "timeline_integrity", "procedural_integrity", "documentation_reliability"],
  general_civil: CIVIL_DIMENSIONS,
  tax_law: CIVIL_DIMENSIONS,
};

// Safe, generic fallback for any case_type not mapped above — the
// dimensions relevant to essentially every materia. Deliberately NOT
// "every dimension" (that was the bug): a mercantil case should never see
// chain_of_custody, and a penal case should never see settlement_pressure.
const DEFAULT_DIMENSIONS: string[] = [
  "evidence_strength",
  "witness_reliability",
  "timeline_integrity",
  "documentation_reliability",
  "procedural_integrity",
];

export function applicableDimensionsFor(caseType: string | undefined): string[] {
  return CASE_TYPE_DIMENSIONS[caseType ?? "general_civil"] ?? DEFAULT_DIMENSIONS;
}

/**
 * Gates a scalar dimension value (case_scores column) by applicability to
 * this case's materia. A dimension not in `applicable` must never persist a
 * value at all — including a raw, ungated LLM-invented number — the same
 * way chain_of_custody/constitutional_compliance are already suppressed to
 * null on non-criminal cases.
 *
 * FIX (2026-08-17): witness_reliability, timeline_integrity, and
 * investigation_completeness were being persisted unconditionally via
 * `detNum(key)` (pipeline.server.ts), which falls back to the raw LLM
 * reading whenever computeDeterministicScorecard has no entry for that
 * dimension — i.e. exactly when the dimension is NOT applicable to this
 * materia (applicableDimensionsFor omits it). Confirmed live: a pure-law
 * amparo directo en revisión case with zero witnesses still persisted
 * witness_reliability: 70, an arbitrary LLM number for a dimension that
 * "amparo" doesn't even include (witness_reliability is absent from several
 * materias' applicable sets — amparo, fiscal, administrativo, electoral,
 * inmobiliario, ambiental, apelacion; timeline_integrity is likewise absent
 * from constitucional/laboral/fiscal/administrativo/electoral/agrario/
 * ambiental/inmobiliario; investigation_completeness is applicable only to
 * penal/constitucional).
 */
export function gateDimensionForCaseType(
  key: string,
  applicable: ReadonlySet<string>,
  value: number | null,
): number | null {
  return applicable.has(key) ? value : null;
}

/**
 * Filters a raw LLM positive_contributors/negative_contributors array before
 * it can be persisted on case_scores. Two independent gates:
 *   1. off-domain label scrub (e.g. "Conviction Risk" on a civil case) —
 *      pre-existing behavior, unchanged.
 *   2. finding_id must be present AND belong to one of this case's own
 *      persisted findings.
 * Gate 2 is the fix: this function is only ever reached as a FALLBACK, when
 * the deterministic scorecard (computeDeterministicScorecard) found zero
 * contributors across every dimension — a thin/sparse case. The
 * deterministic path never needs this check: its contributors are built
 * from `f.id` on real, already-persisted Finding rows, so a null/orphan
 * finding_id can never reach the report through it. But the LLM's own JSON
 * schema for these fields explicitly allows finding_id: string|null, and
 * without this gate a labeled, weighted contributor with finding_id: null —
 * or one referencing a finding_id that doesn't even exist for this case —
 * rendered in the report indistinguishable from a real, evidence-backed
 * one. Extracted so the gating decision is directly unit-testable without
 * mocking the whole runScoring pipeline (callGroq, buildContext, upserts).
 */
export function scrubScoringContributors(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arr: any[],
  opts: { criminalLike: boolean; validFindingIds: ReadonlySet<string> },
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
any[] {
  const offDomainLabel =
    /(conviction|appeal|chain of custody|miranda|4th amendment|5th amendment|6th amendment|search and seizure|grand jury|indictment|brady|giglio)/i;
  return arr.filter(
    (c) =>
      (opts.criminalLike || !offDomainLabel.test(String(c?.label ?? ""))) &&
      typeof c?.finding_id === "string" &&
      opts.validFindingIds.has(c.finding_id),
  );
}

export function computeDeterministicScorecard(rawFindings: Finding[], caseType?: string): DeterministicScorecard {
  // A lower instance's holding a higher instance rejected or superseded
  // (see judicial-hierarchy.ts — e.g. a Tribunal Colegiado position the
  // SCJN's ejecutoria revoked) must never contribute to a dimension score:
  // scoring runs strictly after every analyzer/agent stage has persisted
  // its findings (assertPipelineOrder), so this is the attribution-aware
  // recompute point. A no-op for findings the extraction pass never
  // attributed — i.e. every non-precedent-review materia is unaffected.
  const findings = excludeRejectedFromScoring(rawFindings);
  const applicable = new Set(applicableDimensionsFor(caseType));
  const dims: Record<string, DimensionScore> = {};
  for (const [key, def] of Object.entries(DIMENSIONS)) {
    if (!applicable.has(key)) continue;
    const positives: ScoreContributor[] = [];
    const negatives: ScoreContributor[] = [];
    for (const f of findings) {
      const pos = matches(f, key, def.positive.categories, def.positive.modules);
      const neg = matches(f, key, def.negative.categories, def.negative.modules);
      // Neutral-scoring safety: classification overrides category matching.
      // A finding whose impact_direction is "weakens" can ONLY lower a
      // dimension; one tagged "strengthens" can ONLY raise it. This blocks
      // bugs like "missing chain of custody" strengthening evidence reliability.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const impact = String((f as any).impact_direction ?? "").toLowerCase();
      const canStrengthen = impact !== "weakens";
      const canWeaken = impact !== "strengthens";
      if (pos && !neg && canStrengthen) {
        positives.push({
          finding_id: f.id,
          title: f.title,
          category: f.category,
          severity: f.severity,
          confidence: f.confidence,
          affected_party: f.affected_party,
          signed_weight: signedWeight(f, 1),
        });
      } else if ((neg || (pos && !canStrengthen)) && canWeaken) {
        negatives.push({
          finding_id: f.id,
          title: f.title,
          category: f.category,
          severity: f.severity,
          confidence: f.confidence,
          affected_party: f.affected_party,
          signed_weight: signedWeight(f, -1),
        });
      }
    }
    // Raw totals (undecayed) — kept for display/audit so the per-contributor
    // breakdown still shows each finding's true independent weight.
    const posTotal = positives.reduce((a, c) => a + c.signed_weight, 0);
    const negTotal = negatives.reduce((a, c) => a + c.signed_weight, 0);
    const rawDelta = posTotal + negTotal;

    // Decayed totals — what actually drives the score, so a dimension with
    // 10 corroborating critical findings trends strongly toward 0/100 but
    // doesn't hit the wall after the 4th one and lose all further signal.
    const posDecayed = decayedSum(positives.map((c) => c.signed_weight));
    const negDecayed = decayedSum(negatives.map((c) => c.signed_weight));
    const decayedDelta = posDecayed + negDecayed;

    const score = clamp(Math.round(def.baseline + decayedDelta));
    dims[key] = {
      dimension: def.label,
      score,
      baseline: def.baseline,
      raw_delta: Math.round(rawDelta * 100) / 100,
      decayed_delta: Math.round(decayedDelta * 100) / 100,
      positive_weight_total: Math.round(posTotal * 100) / 100,
      negative_weight_total: Math.round(negTotal * 100) / 100,
      contributor_count: positives.length + negatives.length,
      positives: positives.sort((a, b) => b.signed_weight - a.signed_weight).slice(0, 10),
      negatives: negatives.sort((a, b) => a.signed_weight - b.signed_weight).slice(0, 10),
      reasoning:
        positives.length + negatives.length === 0
          ? `No findings mapped to ${def.label}. Score held at baseline ${def.baseline}.`
          : `baseline(${def.baseline}) + decayed_positive_total(${posDecayed.toFixed(1)}) + decayed_negative_total(${negDecayed.toFixed(1)}) = clamp(${(def.baseline + decayedDelta).toFixed(1)}, 0, 100) = ${score}. Raw (undecayed) contributor sum was ${rawDelta.toFixed(1)} — diminishing returns applied per additional same-side contributor so heavy corroboration trends the score without instantly saturating it.`,
      formula: `score = clamp(baseline + Σ(rank_i: severity_weight * confidence * polarity * ${DECAY_RATE}^i), 0, 100); severity_weights={critical:25, high:15, medium:8, low:3, info:1}; contributors ranked by |weight| descending within each polarity, i is 0-based rank`,
    };
  }
  const totalFindings = findings.length || 1;
  const avgConf = findings.reduce((a, f) => a + (f.confidence ?? 0.5), 0) / totalFindings;
  return {
    methodology: `Deterministic rule-based scoring (case_type=${caseType ?? "general_civil"}). Each applicable dimension starts from a fixed baseline and is adjusted by every finding mapped to that dimension, with diminishing returns applied per additional same-side contributor (decay rate ${DECAY_RATE}) so heavily-corroborated dimensions trend toward the extremes without instantly saturating. Dimensions not applicable to this case type are omitted, not zeroed.`,
    generated_at: new Date().toISOString(),
    finding_count: findings.length,
    dimensions: dims,
    overall_confidence: Number(avgConf.toFixed(2)),
    formula_notes: [
      `score = clamp(baseline + Σ(rank_i: severity_weight * confidence * polarity * ${DECAY_RATE}^i), 0, 100)`,
      "severity weights: critical=25, high=15, medium=8, low=3, info=1",
      "polarity: +1 for findings that strengthen the dimension, -1 for findings that weaken it",
      `diminishing returns: contributors on each side ranked by raw weight descending; the i-th ranked contributor (0-based) counts for ${DECAY_RATE}^i of its raw weight, so corroboration still moves the score but cannot alone force an instant floor/ceiling`,
      "dimensions with no mapped findings remain at their baseline value",
      `applicable dimensions for ${caseType ?? "general_civil"}: ${[...applicable].join(", ")}`,
    ],
  };
}

/** Map a 0..1 confidence value (or 0..100) to a High/Medium/Low label. */
export function confidenceLabel(value: number | null | undefined): "High" | "Medium" | "Low" | "Unknown" {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  const v = value > 1 ? value / 100 : value;
  if (v >= 0.75) return "High";
  if (v >= 0.45) return "Medium";
  return "Low";
}

/**
 * Likelihood label without precise percentages — used wherever the system
 * would previously have invented a conviction/acquittal percentage.
 */
export function likelihoodFromScores(strength: number, risk: number): "Low" | "Moderate" | "High" {
  const net = strength - risk; // -100..100
  if (net >= 20) return "High";
  if (net <= -20) return "Low";
  return "Moderate";
}
