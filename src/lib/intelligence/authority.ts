// Supporting Authority — Motion Center's "litigation workbench" layer.
//
// Deliberately does NOT ask a model to invent a confidence score or
// generate new case law. Everything here is derived from data the
// pipeline already produced and already gates behind evidence
// verification: real CourtListener case law (case-law.server.ts),
// real evidence citations attached to each opportunity, and the
// severity the Opportunity engine already assigned. If a case has no
// matched authority, this says so — it never fabricates a number to
// make the meter look fuller.
import type { ReportLike } from "./canonical";
import { getLegalIssues } from "./canonical";

export type CaseLawEntry = {
  case_name: string;
  citation: string | null;
  court: string | null;
  date_filed: string | null;
  url: string;
  snippet: string;
};

export type EvidenceCitation = {
  doc_n?: number | null;
  document?: string | null;
  page?: number | null;
  quote?: string | null;
};

export type SupportingAuthority = {
  /** The legal-issue type this motion matched against (e.g. "Miranda"), or null if none matched. */
  primaryIssue: string | null;
  /** Why this issue matters — the deterministic rule's own text, not AI-generated. */
  significance: string | null;
  cases: CaseLawEntry[];
  evidence: EvidenceCitation[];
  /** 0-100. Computed from real counts + severity, never an invented "confidence." */
  strengthScore: number;
  /** 1-5, floor of strengthScore/20, minimum 1 so an empty state still renders a bar. */
  strengthStars: number;
  likelihood: "High" | "Medium" | "Low" | "Unknown";
};

const SEVERITY_POINTS: Record<string, number> = {
  critical: 40,
  high: 32,
  medium: 20,
  low: 10,
};

const SEVERITY_LIKELIHOOD: Record<string, SupportingAuthority["likelihood"]> = {
  critical: "High",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Matches free text (a motion title / opportunity description) against
 * the deterministic legal-issue vocabulary already detected server-side
 * (Miranda, Brady, Fourth Amendment, etc — see report-augment.server.ts's
 * ISSUE_RULES). Simple keyword containment, not fuzzy matching: the issue
 * names are short, specific legal terms of art, so false positives are
 * rare and a miss just means no authority renders — never a wrong one.
 *
 * IMPORTANT: ISSUE_RULES matches against raw SOURCE DOCUMENT text (police
 * reports, transcripts), which is a different corpus with different
 * phrasing than the AI-generated motion opportunity text this function
 * actually receives. A real "Motion to Suppress Statements" opportunity
 * commonly says "invokes right to counsel" and cites "Edwards v. Arizona"
 * directly — it may never say the literal word "Miranda". The synonym
 * list below exists specifically to bridge that gap; it was expanded
 * after exactly this case (Edwards-citing suppression motion) matched
 * nothing despite the report's own Legal Issues & Case Law section
 * already having real Miranda case law attached.
 */
function matchIssueType(text: string): string | null {
  const hay = text.toLowerCase();
  const candidates = [
    "fourth amendment",
    "miranda",
    "franks",
    "brady",
    "jencks",
    "chain of custody",
    "authentication",
    "expert admissibility",
  ];
  for (const c of candidates) {
    if (hay.includes(c)) return c;
  }
  // Fourth Amendment: search / seizure issues.
  if (/warrantless|probable cause|search warrant|unlawful search|illegal search|terry frisk|terry stop/.test(hay))
    return "fourth amendment";
  // Miranda / Fifth-Sixth Amendment right-to-counsel issues. Real motion
  // text overwhelmingly describes this fact pattern rather than naming
  // "Miranda" outright — hence the long synonym list.
  if (
    /custodial interrogation|confession|waiver of rights|right to counsel|invok(e|ed|es|ing)\s+(his |her |their )?(right\s+to\s+)?counsel|invocation of counsel|post-invocation|edwards v\.?\s*arizona|self[- ]incrimination|suppress(ion)? of statements?|interrogat/.test(
      hay,
    )
  )
    return "miranda";
  if (/exculpatory|witness deal|informant|brady v\.?\s*maryland|withheld evidence/.test(hay)) return "brady";
  if (/daubert|frye|expert methodology/.test(hay)) return "expert admissibility";
  return null;
}

export function buildSupportingAuthority(args: {
  report: ReportLike;
  motionTitle: string;
  opportunityDescription: string | null;
  opportunitySeverity: string | null;
  opportunityCitations: unknown[];
}): SupportingAuthority {
  const { report, motionTitle, opportunityDescription, opportunitySeverity, opportunityCitations } = args;

  const searchText = `${motionTitle} ${opportunityDescription ?? ""}`;
  const matchedType = matchIssueType(searchText);

  const legalIssues = getLegalIssues(report);
  const hit = matchedType
    ? legalIssues.find((h: any) => String(h?.issue ?? "").toLowerCase() === matchedType)
    : undefined;

  const cases: CaseLawEntry[] = Array.isArray(hit?.case_law) ? hit.case_law : [];
  const evidence: EvidenceCitation[] = Array.isArray(opportunityCitations) ? (opportunityCitations as any[]) : [];

  const severity = String(opportunitySeverity ?? "medium").toLowerCase();
  const basePoints = SEVERITY_POINTS[severity] ?? 20;
  const evidencePoints = Math.min(30, evidence.length * 8);
  const casePoints = Math.min(30, cases.length * 12);
  const strengthScore = Math.max(0, Math.min(100, basePoints + evidencePoints + casePoints));
  const strengthStars = Math.max(1, Math.min(5, Math.round(strengthScore / 20)));

  return {
    primaryIssue: hit?.issue ?? null,
    significance: hit?.significance ?? null,
    cases,
    evidence,
    strengthScore,
    strengthStars,
    likelihood: SEVERITY_LIKELIHOOD[severity] ?? "Unknown",
  };
}
