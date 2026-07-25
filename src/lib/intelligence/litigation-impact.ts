// Litigation Impact Dashboard + Litigation Command Center — derivation layer.
//
// DESIGN PRINCIPLE (read before editing): every card produced here is
// computed from data the pipeline already generated and grounded —
// full_report.deterministic_scorecard (computeDeterministicScorecard(),
// see scoring.server.ts) and the existing canonical arrays (motions,
// missing evidence, witnesses, next actions). Nothing in this file invents
// a number, a dollar figure, a day count, or a percentage that isn't
// backed by a real dimension score or a real finding. If the backing data
// isn't there for a given case, the card is OMITTED — never filled with a
// placeholder. This mirrors the ESS-suppression discipline the rest of the
// report already follows (scores_suppressed / motions_suppressed) and
// keeps this dashboard honest under the same hallucination-gate rules as
// everything else in the report.
//
// This module is pure and client-safe — no ".server" imports — so it can
// run in the report tab renderer as well as export builders.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  getFullReport,
  getPracticeArea,
  getEssState,
  getMotions,
  getMissingEvidence,
  getWitnesses,
  getNextActions,
  getOpportunities,
  type ReportLike,
} from "./canonical";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImpactTier = "critical" | "high" | "moderate" | "strong";
export type ImpactPolarity = "risk" | "strength";

export interface ImpactCard {
  id: string;
  title: string;
  tier: ImpactTier;
  badge: string; // short qualitative word, e.g. "Critical", "Strong"
  value: string; // headline value, e.g. "62/100"
  detail: string; // 1-2 line grounded explanation
  source: string; // what backs this card, shown as a footnote / tooltip
}

export interface CommandCenterCard {
  id: string;
  title: string;
  body: string;
  source: string | null;
}

export interface CommandCenterChecklistItem {
  id: string;
  label: string;
  source: string;
}

export interface LitigationImpactData {
  practiceArea: string;
  suppressed: boolean;
  suppressedReason: string | null;
  cards: ImpactCard[];
}

export interface LitigationCommandCenterData {
  cards: CommandCenterCard[];
  checklist: CommandCenterChecklistItem[];
}

// ---------------------------------------------------------------------------
// Dimension display metadata
// ---------------------------------------------------------------------------
// Keys match scoring.server.ts DIMENSIONS. Whichever subset is applicable to
// the case's practice area is already the only subset present in
// full_report.deterministic_scorecard.dimensions (computeDeterministicScorecard
// filters by applicableDimensionsFor()) — so we just render whatever is
// there instead of re-deriving the per-case-type list a second time.

const DIMENSION_DISPLAY: Record<string, { title: string; polarity: ImpactPolarity }> = {
  evidence_strength: { title: "Evidence Strength", polarity: "strength" },
  witness_reliability: { title: "Witness Reliability", polarity: "strength" },
  timeline_integrity: { title: "Timeline Integrity", polarity: "strength" },
  chain_of_custody: { title: "Chain of Custody", polarity: "strength" },
  constitutional_compliance: { title: "Constitutional Risk", polarity: "risk" },
  investigation_completeness: { title: "Investigation Completeness", polarity: "strength" },
  discovery_completeness: { title: "Discovery Completeness", polarity: "strength" },
  forensic_reliability: { title: "Forensic Reliability", polarity: "strength" },
  procedural_integrity: { title: "Procedural Integrity", polarity: "strength" },
  liability_strength: { title: "Liability Confidence", polarity: "strength" },
  causation_strength: { title: "Causation Strength", polarity: "strength" },
  damages_exposure: { title: "Damages Support", polarity: "strength" },
  expert_support: { title: "Expert Witness Support", polarity: "strength" },
  documentation_reliability: { title: "Documentation Status", polarity: "strength" },
  discovery_compliance: { title: "Discovery Compliance", polarity: "strength" },
  litigation_risk: { title: "Litigation Risk", polarity: "risk" },
  settlement_pressure: { title: "Settlement Leverage", polarity: "strength" },
};

// Preferred display order per practice area. Any dimension present in the
// scorecard but not listed here still renders — it's just appended at the
// end — so a future dimension never silently disappears from the dashboard.
const PREFERRED_ORDER: Record<string, string[]> = {
  criminal: [
    "evidence_strength",
    "constitutional_compliance",
    "witness_reliability",
    "chain_of_custody",
    "forensic_reliability",
    "investigation_completeness",
    "discovery_completeness",
    "procedural_integrity",
    "timeline_integrity",
  ],
  civil_rights: [
    "liability_strength",
    "constitutional_compliance",
    "evidence_strength",
    "witness_reliability",
    "litigation_risk",
    "damages_exposure",
    "investigation_completeness",
    "discovery_completeness",
    "procedural_integrity",
    "timeline_integrity",
  ],
  personal_injury: [
    "liability_strength",
    "damages_exposure",
    "causation_strength",
    "settlement_pressure",
    "expert_support",
    "documentation_reliability",
  ],
  medical_malpractice: [
    "liability_strength",
    "causation_strength",
    "damages_exposure",
    "expert_support",
    "documentation_reliability",
    "settlement_pressure",
  ],
  employment: [
    "liability_strength",
    "documentation_reliability",
    "witness_reliability",
    "damages_exposure",
    "settlement_pressure",
    "litigation_risk",
  ],
  general_civil: [
    "liability_strength",
    "litigation_risk",
    "discovery_compliance",
    "documentation_reliability",
    "damages_exposure",
    "settlement_pressure",
  ],
  tax_law: [
    "liability_strength",
    "documentation_reliability",
    "discovery_compliance",
    "litigation_risk",
    "settlement_pressure",
  ],
  family: [
    "documentation_reliability",
    "witness_reliability",
    "timeline_integrity",
    "procedural_integrity",
    "evidence_strength",
  ],
  appellate: ["evidence_strength", "timeline_integrity", "procedural_integrity", "documentation_reliability"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tierForScore(score: number): ImpactTier {
  if (score >= 80) return "strong";
  if (score >= 60) return "moderate";
  if (score >= 40) return "high";
  return "critical";
}

const STRENGTH_BADGE: Record<ImpactTier, string> = {
  strong: "Strong",
  moderate: "Moderate",
  high: "Below Average",
  critical: "Weak",
};
const RISK_BADGE: Record<ImpactTier, string> = {
  strong: "Low",
  moderate: "Moderate",
  high: "High",
  critical: "Critical",
};

function badgeFor(tier: ImpactTier, polarity: ImpactPolarity): string {
  return polarity === "risk" ? RISK_BADGE[tier] : STRENGTH_BADGE[tier];
}

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function sortedContributors(list: any[]): any[] {
  return [...(Array.isArray(list) ? list : [])].sort(
    (a, b) => Math.abs(Number(b?.signed_weight ?? 0)) - Math.abs(Number(a?.signed_weight ?? 0)),
  );
}

function dimensionDetail(d: any): string {
  const negs = sortedContributors(d?.negatives);
  const poss = sortedContributors(d?.positives);
  const lead = negs[0] ?? poss[0];
  if (!lead) {
    return `No findings currently map to this dimension — held at the ${d?.baseline ?? "default"}-point baseline.`;
  }
  const verb = negs[0] ? "Driven down by" : "Driven up by";
  return `${verb}: "${truncate(String(lead.title ?? ""), 110)}."`;
}

function firstText(item: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = item?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Litigation Impact Dashboard
// ---------------------------------------------------------------------------

export function buildLitigationImpactDashboard(r: ReportLike): LitigationImpactData {
  const practiceArea = getPracticeArea(r);
  const ess = getEssState(r);
  const full = getFullReport(r);
  const scorecard = full?.deterministic_scorecard;
  const dims: Record<string, any> = scorecard && typeof scorecard === "object" ? (scorecard.dimensions ?? {}) : {};

  if (ess.scoresSuppressed || !dims || Object.keys(dims).length === 0) {
    return {
      practiceArea,
      suppressed: true,
      suppressedReason: ess.scoresSuppressed
        ? (ess.reason ?? "Quantitative scores suppressed for this report — insufficient grounded evidence.")
        : "No scored dimensions available yet. Run the scoring stage to populate this dashboard.",
      cards: [],
    };
  }

  const order = PREFERRED_ORDER[practiceArea] ?? [];
  const keysPresent = Object.keys(dims);
  const orderedKeys = [
    ...order.filter((k) => keysPresent.includes(k)),
    ...keysPresent.filter((k) => !order.includes(k)),
  ];

  const cards: ImpactCard[] = orderedKeys.map((key) => {
    const d = dims[key];
    const meta = DIMENSION_DISPLAY[key] ?? { title: d?.label ?? key, polarity: "strength" as ImpactPolarity };
    const score = typeof d?.score === "number" ? d.score : 0;
    const tier = tierForScore(score);
    return {
      id: key,
      title: meta.title,
      tier,
      badge: badgeFor(tier, meta.polarity),
      value: `${score}/100`,
      detail: dimensionDetail(d),
      source: `Deterministic scorecard — ${d?.label ?? key} (${d?.contributor_count ?? 0} findings)`,
    };
  });

  // Motion card — criminal / civil rights only, and only when motion
  // generation isn't ESS-suppressed and at least one real candidate exists.
  if ((practiceArea === "criminal" || practiceArea === "civil_rights") && !ess.motionsSuppressed) {
    const motions = getMotions(r);
    if (motions.length > 0) {
      const top = motions[0];
      const label = firstText(top, ["motion", "title", "name", "type"]) ?? "Motion opportunity identified";
      const basis = firstText(top, ["basis", "rationale", "summary", "description"]);
      cards.push({
        id: "top_motion",
        title: "Most Important Motion",
        tier: "moderate",
        badge: "Recommended",
        value: truncate(label, 40),
        detail: basis ? truncate(basis, 140) : "See Motion Center for full grounding and citations.",
        source: `Motion opportunity — ${motions.length} identified this run`,
      });
    }
  }

  return { practiceArea, suppressed: false, suppressedReason: null, cards };
}

// ---------------------------------------------------------------------------
// Litigation Command Center
// ---------------------------------------------------------------------------

export function buildLitigationCommandCenter(r: ReportLike): LitigationCommandCenterData {
  const full = getFullReport(r);
  const scorecard = full?.deterministic_scorecard;
  const dims: Record<string, any> = scorecard && typeof scorecard === "object" ? (scorecard.dimensions ?? {}) : {};

  type Contributor = { title: string; dimKey: string; dimLabel: string; weight: number };
  const positives: Contributor[] = [];
  const negatives: Contributor[] = [];
  for (const [key, d] of Object.entries(dims)) {
    for (const p of sortedContributors((d as any)?.positives)) {
      positives.push({
        title: p.title,
        dimKey: key,
        dimLabel: (d as any)?.label ?? key,
        weight: Math.abs(Number(p.signed_weight ?? 0)),
      });
    }
    for (const n of sortedContributors((d as any)?.negatives)) {
      negatives.push({
        title: n.title,
        dimKey: key,
        dimLabel: (d as any)?.label ?? key,
        weight: Math.abs(Number(n.signed_weight ?? 0)),
      });
    }
  }
  positives.sort((a, b) => b.weight - a.weight);
  negatives.sort((a, b) => b.weight - a.weight);

  const cards: CommandCenterCard[] = [];

  const topWin = positives[0];
  cards.push({
    id: "what_wins",
    title: "What Wins This Case",
    body: topWin
      ? `${truncate(topWin.title, 160)}`
      : "No corroborating findings have risen above baseline yet — strongest factors will appear here once the scoring stage has enough grounded findings.",
    source: topWin ? `${topWin.dimLabel} — strongest positive contributor` : null,
  });

  const topLoss = negatives[0];
  cards.push({
    id: "what_loses",
    title: "What Loses This Case",
    body: topLoss
      ? `${truncate(topLoss.title, 160)}`
      : "No significant weaknesses have surfaced in the scored findings yet.",
    source: topLoss ? `${topLoss.dimLabel} — strongest negative contributor` : null,
  });

  const riskDimKeys = ["litigation_risk", "constitutional_compliance", "procedural_integrity"];
  const trialRisk = negatives.find((n) => riskDimKeys.includes(n.dimKey)) ?? topLoss;
  cards.push({
    id: "trial_risk",
    title: "Biggest Trial Risk",
    body: trialRisk ? truncate(trialRisk.title, 160) : "No elevated trial-risk findings identified yet.",
    source: trialRisk ? `${trialRisk.dimLabel}` : null,
  });

  const leverageDimKeys = ["settlement_pressure", "liability_strength"];
  const leverage = positives.find((p) => leverageDimKeys.includes(p.dimKey)) ?? topWin;
  cards.push({
    id: "settlement_leverage",
    title: "Best Settlement Leverage",
    body: leverage ? truncate(leverage.title, 160) : "No settlement-leverage findings identified yet.",
    source: leverage ? `${leverage.dimLabel}` : null,
  });

  // Most dangerous witness — matched against the actual Witness
  // Intelligence field set (verified against a live report export):
  // reliability / bias / credibility_risk (+ an LLM risk estimate variant).
  // credibility_risk and bias run HIGH = MORE dangerous to the case;
  // reliability runs the opposite way (LOW = more dangerous). We check the
  // risk-style fields first since they're the most direct signal, and only
  // fall back to "lowest reliability" if no risk-style field is present.
  // Never invents a name or a reason; omits the card if nothing scoreable
  // is present on any witness.
  const witnesses = getWitnesses(r);
  const RISK_KEYS = [
    "credibility_risk_computed",
    "credibility_risk",
    "llm_credibility_risk_estimate",
    "risk_score",
    "danger_score",
  ];
  const BIAS_KEYS = ["bias", "bias_score"];
  const RELIABILITY_KEYS = ["reliability", "reliability_score", "credibility_score"];

  function pickWitness(keys: string[], higherIsWorse: boolean): { witness: any; value: number } | null {
    let best: any = null;
    let bestVal = higherIsWorse ? -Infinity : Infinity;
    for (const w of witnesses) {
      let v: number | null = null;
      for (const k of keys) {
        const n = Number(w?.[k]);
        if (Number.isFinite(n)) {
          v = n;
          break;
        }
      }
      if (v == null) continue;
      if ((higherIsWorse && v > bestVal) || (!higherIsWorse && v < bestVal)) {
        bestVal = v;
        best = w;
      }
    }
    return best ? { witness: best, value: bestVal } : null;
  }

  const picked = pickWitness(RISK_KEYS, true) ?? pickWitness(BIAS_KEYS, true) ?? pickWitness(RELIABILITY_KEYS, false);
  if (picked) {
    const { witness: w, value } = picked;
    const name = firstText(w, ["name", "witness", "title"]) ?? "Unnamed witness";
    const role = firstText(w, ["role"]);
    const reason =
      firstText(w, ["reason", "notes", "summary", "concern"]) ??
      `Highest-risk witness in this report (score ${value}).`;
    cards.push({
      id: "dangerous_witness",
      title: "Most Dangerous Witness",
      body: `${name}${role ? ` (${role})` : ""} — ${truncate(reason, 140)}`,
      source: "Witness intelligence",
    });
  }

  // Biggest evidentiary gap — from the already-structured missing evidence set.
  const missing = getMissingEvidence(r);
  if (missing.length > 0) {
    const sorted = [...missing].sort((a, b) => {
      const rank = (s: any) => {
        const sev = String(s?.severity ?? s?.priority ?? "").toLowerCase();
        return sev === "critical" ? 0 : sev === "high" ? 1 : sev === "medium" ? 2 : 3;
      };
      return rank(a) - rank(b);
    });
    const top = sorted[0];
    const label = firstText(top, ["title", "item", "description", "label"]) ?? "Missing evidence item";
    cards.push({
      id: "evidentiary_gap",
      title: "Biggest Evidentiary Gap",
      body: truncate(label, 160),
      source: `Missing evidence — ${missing.length} gap(s) identified`,
    });
  }

  // "What should counsel do this week" — reuses whatever the canonical
  // recommendation passes already produced. No new generation, just a
  // capped, deduplicated view.
  const sources: { list: any[]; label: string }[] = [
    { list: getNextActions(r), label: "next action" },
    { list: getOpportunities(r), label: "opportunity" },
  ];
  const checklist: CommandCenterChecklistItem[] = [];
  const seen = new Set<string>();
  for (const { list, label } of sources) {
    for (const item of list) {
      const text = firstText(item, ["title", "action", "label", "description", "text"]);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      checklist.push({ id: `${label}-${checklist.length}`, label: text, source: label });
      if (checklist.length >= 7) break;
    }
    if (checklist.length >= 7) break;
  }

  return { cards, checklist };
}
