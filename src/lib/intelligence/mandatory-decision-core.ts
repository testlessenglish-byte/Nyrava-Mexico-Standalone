import type {
  CaseDecisionReconstruction,
  EvidenceRef as ReconstructionEvidenceRef,
  ReconstructedProposition,
  Sourced,
} from "./decision-reconstruction";
import type {
  AdoptionStatus,
  AuditClassification,
  JudicialSpeakerRole,
  NewFinding,
  PropositionType,
} from "./types";

export type MandatoryDecisionKind =
  "COURT_HOLDING" | "REJECTED_HOLDING" | "DISPOSITION" | "REMEDY" | "CONTROLLING_ISSUE";

export type MandatoryDecisionCoreItem = {
  id: string;
  kind: MandatoryDecisionKind;
  text: string;
  speaker_role: string | null;
  proposition_type: string | null;
  adoption_status: string | null;
  source_refs: ReconstructionEvidenceRef[];
};

export type MandatoryDecisionCoreValidation = {
  required: number;
  represented: number;
  ok: boolean;
  missing: Array<{ id: string; kind: MandatoryDecisionKind; text: string }>;
};

const REMEDY_RE =
  /\b(devu[eé]lv|remit|rep[oó]ng|reposici[oó]n|nueva resoluci[oó]n|deje? sin efectos?|sin aplicar|dicte? otra|conced[ae] el amparo|efectos del amparo)\b/i;

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableId(kind: MandatoryDecisionKind, text: string): string {
  // FNV-1a: deterministic identity without a runtime crypto dependency.
  let hash = 0x811c9dc5;
  for (const ch of `${kind}:${normalized(text)}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `decision-core:${kind.toLowerCase()}:${(hash >>> 0).toString(16)}`;
}

function presentText(item: Sourced<string>): string | null {
  return item.status === "PRESENT" && typeof item.value === "string" && item.value.trim()
    ? item.value.trim()
    : null;
}

function propositionText(item: ReconstructedProposition): string | null {
  const text = item.value?.text;
  return item.status === "PRESENT" && typeof text === "string" && text.trim() ? text.trim() : null;
}

function pushUnique(out: MandatoryDecisionCoreItem[], item: MandatoryDecisionCoreItem): void {
  const key = `${item.kind}:${normalized(item.text)}`;
  if (!out.some((existing) => `${existing.kind}:${normalized(existing.text)}` === key)) {
    out.push(item);
  }
}

/**
 * Converts the independently grounded decision reconstruction into the
 * propositions a completed-case report is not allowed to omit. Party
 * arguments, background facts and ordinary evidence are intentionally absent:
 * this is the court's decision core, not a second general finding generator.
 */
export function buildMandatoryDecisionCore(
  reconstruction: CaseDecisionReconstruction | null | undefined,
): MandatoryDecisionCoreItem[] {
  if (!reconstruction) return [];
  const out: MandatoryDecisionCoreItem[] = [];

  for (const item of reconstruction.issues_presented ?? []) {
    const text = presentText(item);
    if (!text) continue;
    pushUnique(out, {
      id: stableId("CONTROLLING_ISSUE", text),
      kind: "CONTROLLING_ISSUE",
      text,
      speaker_role: null,
      proposition_type: "issue",
      adoption_status: "unresolved",
      source_refs: item.source_refs,
    });
  }

  for (const item of reconstruction.court_holding ?? []) {
    const text = propositionText(item);
    if (!text) continue;
    const rejected =
      item.value?.proposition_type === "rejected_holding" ||
      item.value?.adoption_status === "rejected" ||
      item.value?.adoption_status === "historical";
    const kind: MandatoryDecisionKind = rejected ? "REJECTED_HOLDING" : "COURT_HOLDING";
    pushUnique(out, {
      id: stableId(kind, text),
      kind,
      text,
      speaker_role: item.value?.speaker_role ?? null,
      proposition_type:
        item.value?.proposition_type ?? (rejected ? "rejected_holding" : "court_holding"),
      adoption_status: item.value?.adoption_status ?? (rejected ? "rejected" : "adopted"),
      source_refs: item.source_refs,
    });
  }

  const disposition = presentText(reconstruction.disposition_remedy);
  if (disposition) {
    pushUnique(out, {
      id: stableId("DISPOSITION", disposition),
      kind: "DISPOSITION",
      text: disposition,
      speaker_role: null,
      proposition_type: "procedural_fact",
      adoption_status: "adopted",
      source_refs: reconstruction.disposition_remedy.source_refs,
    });
    if (REMEDY_RE.test(disposition)) {
      pushUnique(out, {
        id: stableId("REMEDY", disposition),
        kind: "REMEDY",
        text: disposition,
        speaker_role: null,
        proposition_type: "court_holding",
        adoption_status: "adopted",
        source_refs: reconstruction.disposition_remedy.source_refs,
      });
    }
  }

  return out;
}

const STOP = new Set([
  "para",
  "como",
  "esta",
  "este",
  "esto",
  "esos",
  "esas",
  "dicha",
  "dicho",
  "desde",
  "hasta",
  "sobre",
  "entre",
  "porque",
  "cuando",
  "donde",
  "quien",
  "cual",
  "cada",
  "tambien",
  "mediante",
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "un",
  "una",
  "unos",
  "unas",
  "y",
  "o",
  "que",
  "se",
  "en",
  "por",
  "con",
  "sin",
  "al",
  "a",
  "su",
  "sus",
  "fue",
  "son",
  "the",
  "and",
  "that",
  "with",
]);

function terms(value: string): Set<string> {
  return new Set(
    normalized(value)
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOP.has(word))
      .map((word) => word.slice(0, 8)),
  );
}

function represented(item: MandatoryDecisionCoreItem, sections: string[]): boolean {
  const expected = terms(item.text);
  if (expected.size === 0) return false;
  return sections.some((section) => {
    const actual = terms(section);
    let overlap = 0;
    for (const term of expected) if (actual.has(term)) overlap += 1;
    const floor = expected.size <= 4 ? 2 : Math.min(5, Math.ceil(expected.size * 0.22));
    return overlap >= floor;
  });
}

/** Deterministic, fail-closed coverage check used by the final release gate. */
export function validateMandatoryDecisionCore(
  core: MandatoryDecisionCoreItem[],
  input: {
    executiveSummary?: string | null;
    findings?: Array<{ title?: string | null; description?: string | null }>;
  },
): MandatoryDecisionCoreValidation {
  const sections = [
    input.executiveSummary ?? "",
    ...(input.findings ?? []).map(
      (finding) => `${finding.title ?? ""}\n${finding.description ?? ""}`,
    ),
  ].filter(Boolean);
  const missing = core
    .filter((item) => !represented(item, sections))
    .map(({ id, kind, text }) => ({ id, kind, text }));
  return {
    required: core.length,
    represented: core.length - missing.length,
    ok: core.length > 0 && missing.length === 0,
    missing,
  };
}

function speaker(value: string | null): JudicialSpeakerRole | null {
  const allowed = new Set<string>([
    "quejoso",
    "tercero_interesado",
    "autoridad",
    "ministerio_publico",
    "fiscal",
    "defensa",
    "imputado",
    "acusado",
    "sentenciado",
    "victima",
    "ofendido",
    "testigo",
    "perito",
    "juez_control",
    "tribunal_enjuiciamiento",
    "tribunal_alzada",
    "tribunal_colegiado",
    "tribunal_local",
    "scjn",
  ]);
  return value && allowed.has(value) ? (value as JudicialSpeakerRole) : null;
}

/** Makes decision-core propositions first-class canonical findings. */
export function mandatoryDecisionCoreToFindings(args: {
  core: MandatoryDecisionCoreItem[];
  caseId: string;
  userId: string;
}): NewFinding[] {
  return args.core.map((item) => {
    const docIds = [
      ...new Set(item.source_refs.map((r) => r.doc_id ?? r.document_id).filter(Boolean)),
    ] as string[];
    const evidenceRefs = item.source_refs.map((ref) => ({
      doc_id: ref.doc_id ?? ref.document_id,
      quote: ref.quote,
      label: ref.label,
    }));
    const isHolding = item.kind === "COURT_HOLDING" || item.kind === "REJECTED_HOLDING";
    const audit: AuditClassification = isHolding ? "VERIFIED_COURT_HOLDING" : "VERIFIED_FACT";
    const proposition: PropositionType =
      item.kind === "REJECTED_HOLDING"
        ? "rejected_holding"
        : item.kind === "CONTROLLING_ISSUE"
          ? "issue"
          : item.kind === "DISPOSITION"
            ? "procedural_fact"
            : "court_holding";
    const adoption: AdoptionStatus =
      item.kind === "REJECTED_HOLDING"
        ? "rejected"
        : item.kind === "CONTROLLING_ISSUE"
          ? "unresolved"
          : "adopted";
    return {
      case_id: args.caseId,
      user_id: args.userId,
      source_module: "decision_core",
      category: item.kind.toLowerCase(),
      title: `${item.kind.replace(/_/g, " ")}: ${item.text.slice(0, 180)}`,
      description: item.text,
      severity: item.kind === "DISPOSITION" || item.kind === "REMEDY" ? "critical" : "high",
      confidence: 0.99,
      legal_significance:
        "Mandatory, source-verified proposition from the reconstructed judicial decision.",
      potential_impact:
        "Must be represented in the completed-case report; score-neutral unless separately classified.",
      affected_party: "neutral",
      benefited_party: "neutral",
      impact_direction: "neutral",
      authority_level: "court_record",
      score_dimension: null,
      reason_for_score_effect: "Reportable decision core is distinct from score-moving evidence.",
      strategic_significance: "mandatory_decision_core",
      priority: item.kind === "DISPOSITION" || item.kind === "REMEDY" ? 100 : 95,
      speaker_role: speaker(item.speaker_role),
      proposition_type: proposition,
      adoption_status: adoption,
      audit_classification: audit,
      evidence_relationship: isHolding || item.kind === "REMEDY" ? "SOURCE_HOLDING" : "SOURCE_FACT",
      source_quote: item.source_refs.find((r) => r.quote)?.quote ?? null,
      source_doc_ids: docIds,
      evidence_refs: evidenceRefs,
      metadata: {
        mandatory_decision_core: true,
        mandatory_decision_core_id: item.id,
        mandatory_decision_kind: item.kind,
        reportable: true,
        score_moving: false,
      },
    };
  });
}

