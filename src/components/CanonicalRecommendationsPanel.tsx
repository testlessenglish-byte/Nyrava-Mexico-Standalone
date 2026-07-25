import * as React from "react";

// ============================================================================
// CanonicalRecommendationsPanel
//
// Renders `full_report.canonical_recommendations` — the single deduplicated
// recommendation list produced by `mergeCanonicalRecommendations()` in
// `src/lib/intelligence/report-recommendations.ts`. This replaces the need
// to separately render narrative.recommendations, memo.next_actions,
// memo.recommended_motions, intelligence.next_actions,
// intelligence.strategy_recommendations, and intelligence.motion_opportunities
// as six different lists.
//
// This is a NEW, additive component — it does not remove or modify any
// existing panel. Existing components (LitigationPanels, LegalMemorandumPanel,
// the case detail route) continue to render the six raw fields exactly as
// they do today until those are deliberately migrated over, file by file,
// with the full context read first.
// ============================================================================

export type RecommendationPriority = "critical" | "high" | "medium" | "low";
export type RecommendationOwner = "narrative" | "memo" | "intelligence";

export interface CanonicalRecommendation {
  id: string;
  priority: RecommendationPriority;
  owner: RecommendationOwner;
  title: string;
  reason: string;
  supportingFindingIds: string[];
  supportingEvidence: string[];
  confidence: number | null;
  expectedImpact: string | null;
  mergedFrom: string[];
}

const PRIORITY_STYLES: Record<RecommendationPriority, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-800 border-red-300" },
  high: { label: "High", className: "bg-orange-100 text-orange-800 border-orange-300" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-800 border-amber-300" },
  low: { label: "Low", className: "bg-slate-100 text-slate-700 border-slate-300" },
};

const OWNER_LABEL: Record<RecommendationOwner, string> = {
  narrative: "Case Summary",
  memo: "Legal Memorandum",
  intelligence: "Structured Intelligence",
};

const PRIORITY_ORDER: RecommendationPriority[] = ["critical", "high", "medium", "low"];

function isCanonicalRecommendation(v: unknown): v is CanonicalRecommendation {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.title === "string" && typeof r.priority === "string";
}

/** Safely pulls `canonical_recommendations` out of a full_report-shaped object. */
export function getCanonicalRecommendations(fullReport: unknown): CanonicalRecommendation[] {
  if (!fullReport || typeof fullReport !== "object") return [];
  const raw = (fullReport as Record<string, unknown>).canonical_recommendations;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCanonicalRecommendation);
}

export interface CanonicalRecommendationsPanelProps {
  /** Pass either the full_report object directly, or the recommendations array itself. */
  fullReport?: unknown;
  recommendations?: CanonicalRecommendation[];
  /** Optional: called when the user clicks a recommendation, e.g. to scroll to a supporting finding. */
  onSelectFinding?: (findingId: string) => void;
  className?: string;
}

export const CanonicalRecommendationsPanel: React.FC<CanonicalRecommendationsPanelProps> = ({
  fullReport,
  recommendations,
  onSelectFinding,
  className,
}) => {
  const items = recommendations ?? getCanonicalRecommendations(fullReport);

  if (items.length === 0) {
    return (
      <div className={className ?? ""}>
        <p className="text-sm text-slate-500 italic">No recommendations available for this case yet.</p>
      </div>
    );
  }

  const grouped = PRIORITY_ORDER.map((p) => ({
    priority: p,
    items: items.filter((r) => r.priority === p),
  })).filter((g) => g.items.length > 0);

  return (
    <div className={className ?? "space-y-6"}>
      {grouped.map((group) => {
        const style = PRIORITY_STYLES[group.priority];
        return (
          <div key={group.priority}>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-2">
              {style.label} Priority
            </h3>
            <ul className="space-y-3">
              {group.items.map((rec) => (
                <li
                  key={rec.id}
                  className="rounded-lg border border-slate-200 p-3 bg-white shadow-sm"
                  data-recommendation-id={rec.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{rec.title}</p>
                    <span
                      className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${style.className}`}
                    >
                      {style.label}
                    </span>
                  </div>

                  {rec.reason && rec.reason !== rec.title && (
                    <p className="mt-1 text-sm text-slate-600">{rec.reason}</p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>Source: {OWNER_LABEL[rec.owner]}</span>
                    {rec.expectedImpact && <span>Impact: {rec.expectedImpact}</span>}
                    {rec.confidence != null && <span>Confidence: {Math.round(rec.confidence)}%</span>}
                    {rec.mergedFrom.length > 0 && (
                      <span title="This recommendation combines duplicate items from multiple report sections">
                        Consolidated from {rec.mergedFrom.length + 1} source{rec.mergedFrom.length > 0 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {rec.supportingFindingIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {rec.supportingFindingIds.map((fid) => (
                        <button
                          key={fid}
                          type="button"
                          onClick={() => onSelectFinding?.(fid)}
                          className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                        >
                          {fid}
                        </button>
                      ))}
                    </div>
                  )}

                  {rec.supportingEvidence.length > 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      Evidence: {rec.supportingEvidence.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
};

export default CanonicalRecommendationsPanel;
