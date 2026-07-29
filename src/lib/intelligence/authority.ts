// Supporting Authority — Motion Center's "litigation workbench" layer.
//
// Deliberately does NOT ask a model to invent a confidence score or
// generate new case law. Everything here is derived from data the
// pipeline already produced and already gates behind evidence
// verification: real SCJN/CJF jurisprudencia (case-law.server.ts, backed
// by legal_authorities — see scjn.connector.ts), real evidence citations
// attached to each opportunity, and the severity the Opportunity engine
// already assigned. If a case has no matched authority, this says so —
// it never fabricates a number to make the meter look fuller.
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
 * (Cateo y Detención, Cadena de Custodia, etc — see
 * report-augment.server.ts's ISSUE_RULES, rebuilt 2026-07-29 around CNPP/
 * CPEUM). Simple keyword containment, not fuzzy matching: the issue
 * names are short, specific legal terms of art, so false positives are
 * rare and a miss just means no authority renders — never a wrong one.
 *
 * IMPORTANT: ISSUE_RULES matches against raw SOURCE DOCUMENT text
 * (informes policiales, entrevistas, carpeta de investigación), which is
 * a different corpus with different phrasing than the AI-generated
 * motion/incidente text this function actually receives. A real
 * "Incidente de Exclusión de Declaración" opportunity commonly says
 * "se invoca el derecho a guardar silencio" rather than the literal
 * issue label. The synonym lists below exist specifically to bridge that
 * gap, same rationale as the original English version of this function
 * (which bridged "invokes right to counsel" / "Edwards v. Arizona" text
 * to the "Miranda" issue key it detected).
 */
function matchIssueType(text: string): string | null {
  const hay = text.toLowerCase();
  const candidates = [
    "cateo y detención",
    "declaración del imputado sin garantías",
    "irregularidad en solicitud de cateo",
    "omisión en el deber de aportación probatoria",
    "declaraciones previas de testigo",
    "cadena de custodia",
    "fundamentación probatoria",
    "impugnación pericial",
  ];
  for (const c of candidates) {
    if (hay.includes(c)) return c;
  }
  // Cateo y Detención: allanamiento / detención / control judicial issues.
  if (
    /orden de cateo|cateo sin orden|detenci[oó]n sin orden|control de detenci[oó]n|flagrancia|caso urgente|aseguramiento de bienes/.test(
      hay,
    )
  )
    return "cateo y detención";
  // Declaración del Imputado: derecho a guardar silencio / asistencia de
  // defensor issues. Real motion text overwhelmingly describes this fact
  // pattern rather than naming the issue outright — hence the long
  // synonym list, mirroring the original Miranda-synonym rationale.
  if (
    /declaraci[oó]n sin defensor|asistencia de defensor|derecho a guardar silencio|renuncia al derecho|coacci[oó]n en declaraci[oó]n|entrevista sin abogado|autoincriminaci[oó]n|exclusi[oó]n de declaraci[oó]n|nulidad de declaraci[oó]n/.test(
      hay,
    )
  )
    return "declaración del imputado sin garantías";
  if (/datos falsos en cateo|omisi[oó]n sustancial en cateo|solicitud de cateo irregular/.test(hay))
    return "irregularidad en solicitud de cateo";
  if (
    /dato de prueba no revelado|ocultamiento de evidencia|omisi[oó]n probatoria|principio de objetividad|acuerdo de colaboraci[oó]n no revelado/.test(
      hay,
    )
  )
    return "omisión en el deber de aportación probatoria";
  if (/entrevista previa|declaraci[oó]n previa del testigo|contrainterrogatorio|declaraci[oó]n inconsistente/.test(hay))
    return "declaraciones previas de testigo";
  if (/registro de cadena de custodia|sello roto|manejo de indicios|laguna en custodia/.test(hay))
    return "cadena de custodia";
  if (/licitud de la prueba|incorporaci[oó]n de prueba|prueba superveniente/.test(hay))
    return "fundamentación probatoria";
  if (/dictamen pericial|metodolog[ií]a pericial|perito sin acreditaci[oó]n|error de laboratorio/.test(hay))
    return "impugnación pericial";
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
