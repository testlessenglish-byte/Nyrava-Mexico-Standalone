// Continuous Legal Intelligence directive, §9: a controlled capability
// registry the About Us page renders from, instead of hardcoded marketing
// cards. Deliberately code-edited, not a DB table or admin UI — the same
// human-review discipline this codebase already applies everywhere else
// ("AI may propose, never self-authorize" — see proposals.server.ts) means
// nothing here should be freely rewritable by an LLM either. Every entry
// must correspond to a REAL, verified mechanism — do not add one without
// tracing it to actual code.
//
// status:
//   ACTIVE       — production-ready, safe to present as available today.
//   BETA         — real, working, but with a caveat worth surfacing
//                  (e.g. backend-only, no UI yet) — never hidden, always
//                  labeled.
//   COMING_SOON  — not yet built. Never rendered as currently available.
//   INTERNAL     — never shown on a public page.
//
// titleKey/descriptionKey point into the about.capability.* i18n namespace
// (src/i18n/locales/en.json / es.json) — every card renders through the
// existing translation system, never a hardcoded string.
export type CapabilityStatus = "ACTIVE" | "BETA" | "COMING_SOON" | "INTERNAL";

export type Capability = {
  id: string;
  category: "case" | "evidence" | "legal" | "reports" | "chat" | "strategy" | "intelligence";
  status: CapabilityStatus;
  /** A real route this capability lives at, or null when it doesn't have
   *  its own dedicated page (e.g. it's woven into the case workspace). */
  route: string | null;
  titleKey: string;
  descriptionKey: string;
};

export const CAPABILITIES: Capability[] = [
  {
    id: "analyze_case",
    category: "case",
    status: "ACTIVE",
    route: "/cases",
    titleKey: "about.capability.analyzeCase.title",
    descriptionKey: "about.capability.analyzeCase.description",
  },
  {
    id: "document_intelligence",
    category: "evidence",
    status: "ACTIVE",
    route: "/evidence",
    titleKey: "about.capability.documentIntelligence.title",
    descriptionKey: "about.capability.documentIntelligence.description",
  },
  {
    id: "timeline_intelligence",
    category: "evidence",
    status: "ACTIVE",
    route: "/timeline",
    titleKey: "about.capability.timelineIntelligence.title",
    descriptionKey: "about.capability.timelineIntelligence.description",
  },
  {
    id: "witness_intelligence",
    category: "evidence",
    status: "ACTIVE",
    route: "/witness",
    titleKey: "about.capability.witnessIntelligence.title",
    descriptionKey: "about.capability.witnessIntelligence.description",
  },
  {
    id: "legal_research",
    category: "legal",
    status: "ACTIVE",
    route: null,
    titleKey: "about.capability.legalResearch.title",
    descriptionKey: "about.capability.legalResearch.description",
  },
  {
    id: "report_generation",
    category: "reports",
    status: "ACTIVE",
    route: "/reports",
    titleKey: "about.capability.reportGeneration.title",
    descriptionKey: "about.capability.reportGeneration.description",
  },
  {
    id: "talk_to_case",
    category: "chat",
    status: "ACTIVE",
    route: "/talk",
    titleKey: "about.capability.talkToCase.title",
    descriptionKey: "about.capability.talkToCase.description",
  },
  {
    id: "corrections",
    category: "chat",
    status: "ACTIVE",
    route: "/talk",
    titleKey: "about.capability.corrections.title",
    descriptionKey: "about.capability.corrections.description",
  },
  {
    id: "motion_intelligence",
    category: "strategy",
    status: "ACTIVE",
    route: "/motion",
    titleKey: "about.capability.motionIntelligence.title",
    descriptionKey: "about.capability.motionIntelligence.description",
  },
  {
    id: "strategy_center",
    category: "strategy",
    status: "ACTIVE",
    route: "/strategy",
    titleKey: "about.capability.strategyCenter.title",
    descriptionKey: "about.capability.strategyCenter.description",
  },
  {
    id: "alerts_briefings",
    category: "case",
    status: "ACTIVE",
    route: "/alerts",
    titleKey: "about.capability.alertsBriefings.title",
    descriptionKey: "about.capability.alertsBriefings.description",
  },
  {
    id: "continuous_intelligence",
    category: "intelligence",
    status: "BETA",
    route: null,
    titleKey: "about.capability.continuousIntelligence.title",
    descriptionKey: "about.capability.continuousIntelligence.description",
  },
];

/** Capabilities safe to render on a public page today — never COMING_SOON, never INTERNAL. */
export function publicCapabilities(): Capability[] {
  return CAPABILITIES.filter((c) => c.status === "ACTIVE" || c.status === "BETA");
}
