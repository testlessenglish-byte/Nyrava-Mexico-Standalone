// Controlled cross-domain activation.
// A case's selected `case_type` is the base practice area. An "additional
// domain" only becomes active through one of three audited paths:
//
//   1. user      — the user explicitly added the domain via `cases.additional_domains`.
//   2. hybrid    — the case is registered as a formally supported hybrid case type.
//   3. evidence  — a deterministic rule matched against extracted facts /
//                  persisted findings (NOT raw keywords). Each rule declares
//                  a minimum-evidence threshold and the domain it unlocks.
//
// Every activation is written to `case_domain_activations` so the audit
// trail records WHY a normally-forbidden module ran. Activations are pure
// functions of the inputs — same inputs always produce the same activations.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizePracticeArea, type PracticeArea } from "./practice-areas";

type Db = SupabaseClient<Database>;

export type ActivationSource = "user" | "hybrid" | "evidence" | "charging_docs";

export type DomainActivation = {
  domain: PracticeArea;
  source: ActivationSource;
  trigger_id: string | null;
  reason: string;
  evidence_finding_ids: string[];
};

/** Practice areas that are EXPLICITLY civil — a charging doc should not
 * override into criminal for these (e.g., a PI case with a criminal exhibit
 * for background context does NOT need constitutional/chain-of-custody
 * agents). `general_civil` is intentionally NOT here: it's the ambiguous
 * default and a charging doc there strongly implies criminal/hybrid work.
 *
 * `tax_law` is ALSO intentionally NOT here. A tax case starts civil (audit,
 * deficiency notice, Tax Court petition) but the same case_type covers
 * criminal tax fraud prosecutions (26 U.S.C. §§ 7201, 7206). Leaving tax_law
 * out of this set means the charging-doc trigger below does its job
 * automatically: the moment an indictment, criminal information, or arrest/
 * search warrant appears in the corpus, the case gets full criminal
 * treatment (Miranda, chain of custody, constitutional_compliance,
 * conviction/acquittal jury metrics) with no manual reclassification. */
const EXPLICITLY_CIVIL: ReadonlySet<PracticeArea> = new Set([
  "personal_injury",
  "medical_malpractice",
  "employment",
  "family",
  "corporate",
  "commercial",
]);

/** Filename patterns that reliably identify a criminal charging document.
 * NOTE: "complaint" and "information" must NEVER appear bare in this list.
 * Every civil lawsuit is initiated by a document literally called "the
 * Complaint" — interrogatories, RFPs, and motions constantly reference "the
 * Complaint filed by Plaintiff" as routine civil boilerplate. A bare
 * `complaint` alternative here previously matched that boilerplate and
 * mis-triggered the criminal domain on ordinary civil cases. Same issue for
 * bare `information`, which is just a common English word. Both must be
 * qualified with `criminal` so they only match the actual legal terms of
 * art ("criminal complaint", "criminal information" — the charging
 * instrument used in states without grand jury indictment). */
const CHARGING_DOC_RE =
  /\b(indictment|criminal[\s_-]?information|search[\s_-]?warrant|arrest[\s_-]?warrant|criminal[\s_-]?complaint|grand[\s_-]?jury)\b/i;

function isChargingDoc(filename: string, extractedText: string | null | undefined): boolean {
  if (CHARGING_DOC_RE.test(filename)) return true;
  const head = String(extractedText ?? "").slice(0, 2000);
  return CHARGING_DOC_RE.test(head);
}

/** Formally supported hybrid case types. */
const HYBRID_TYPES: Record<string, PracticeArea[]> = {
  criminal_civil_rights: ["criminal", "civil_rights"],
  "criminal+civil_rights": ["criminal", "civil_rights"],
  employment_civil_rights: ["employment", "civil_rights"],
};

/** Evidence-trigger rules — deterministic, threshold-based. */
type EvidenceTrigger = {
  id: string;
  unlocks: PracticeArea;
  // Module prefix (matched against `source_module`) that the rule depends on.
  modulePrefixes: string[];
  // Minimum verified findings (with citation) required to fire.
  minFindings: number;
  reason: string;
};

const EVIDENCE_TRIGGERS: EvidenceTrigger[] = [
  {
    id: "civil_rights_in_criminal",
    unlocks: "civil_rights",
    modulePrefixes: ["section_1983", "qualified_immunity", "excessive_force", "monell"],
    minFindings: 2,
    reason: "Multiple verified findings establish a parallel § 1983 / civil-rights theory.",
  },
  {
    id: "employment_in_civil_rights",
    unlocks: "employment",
    modulePrefixes: ["eeoc", "title_vii", "wrongful_termination", "discrimination"],
    minFindings: 2,
    reason: "Verified employment-claim findings warrant employment-law analysis.",
  },
  {
    id: "personal_injury_in_civil",
    unlocks: "personal_injury",
    modulePrefixes: ["bodily_injury", "medical_treatment", "lost_wages"],
    minFindings: 2,
    reason: "Verified injury-related findings warrant personal-injury analysis.",
  },
];

function modulePrefixMatches(sourceModule: string, prefixes: string[]): boolean {
  const m = String(sourceModule ?? "").toLowerCase();
  return prefixes.some((p) => m.includes(p));
}

/**
 * Pure computation: derive the set of activations from the inputs. Does NOT
 * read or write the database — callers pass already-fetched findings.
 */
export function deriveActivations(args: {
  baseArea: string;
  caseType: string;
  additionalDomains: string[];
  findings: Array<{ id: string; source_module: string | null }>;
  documents?: Array<{ id: string; filename: string; extracted_text?: string | null }>;
}): DomainActivation[] {
  const base = normalizePracticeArea(args.baseArea);
  const seen = new Set<PracticeArea>([base]);
  const out: DomainActivation[] = [];

  // 1. user opt-in
  for (const d of args.additionalDomains ?? []) {
    const dom = normalizePracticeArea(d);
    if (seen.has(dom)) continue;
    seen.add(dom);
    out.push({
      domain: dom,
      source: "user",
      trigger_id: null,
      reason: "User explicitly enabled this legal domain on the case.",
      evidence_finding_ids: [],
    });
  }

  // 2. hybrid case type
  const hybrid = HYBRID_TYPES[String(args.caseType ?? "").toLowerCase()];
  if (hybrid) {
    for (const dom of hybrid) {
      if (seen.has(dom)) continue;
      seen.add(dom);
      out.push({
        domain: dom,
        source: "hybrid",
        trigger_id: String(args.caseType ?? "").toLowerCase(),
        reason: `Case is registered as a hybrid type that includes ${dom}.`,
        evidence_finding_ids: [],
      });
    }
  }

  // 3. charging-doc override → unlocks `criminal` when the corpus contains a
  //    charging document AND the base area is NOT explicitly civil. Guard
  //    against the false positive of a civil case (PI / employment / family
  //    / malpractice) that merely attaches a criminal document as background.
  if (!seen.has("criminal") && !EXPLICITLY_CIVIL.has(base) && args.documents?.length) {
    const chargingDocs = args.documents.filter((d) => isChargingDoc(d.filename ?? "", d.extracted_text));
    if (chargingDocs.length > 0) {
      seen.add("criminal");
      out.push({
        domain: "criminal",
        source: "charging_docs",
        trigger_id: "charging_doc_present",
        reason: `Charging document(s) detected (${chargingDocs
          .slice(0, 3)
          .map((d) => d.filename)
          .join(", ")}${chargingDocs.length > 3 ? ", …" : ""}); unlocking criminal-law agents.`,
        evidence_finding_ids: chargingDocs.slice(0, 10).map((d) => d.id),
      });
    }
  }

  // 4. evidence triggers
  for (const trig of EVIDENCE_TRIGGERS) {
    if (seen.has(trig.unlocks)) continue;
    const matched = args.findings.filter((f) => modulePrefixMatches(f.source_module ?? "", trig.modulePrefixes));
    if (matched.length < trig.minFindings) continue;
    seen.add(trig.unlocks);
    out.push({
      domain: trig.unlocks,
      source: "evidence",
      trigger_id: trig.id,
      reason: trig.reason,
      evidence_finding_ids: matched.slice(0, 10).map((f) => f.id),
    });
  }

  return out;
}

/** Read inputs from DB, derive activations, and persist new rows idempotently. */
export async function resolveActivations(
  db: Db,
  caseId: string,
): Promise<{ activeDomains: Set<string>; activations: DomainActivation[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await db
    .from("cases")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("case_type,additional_domains" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ct = String((caseRow as any)?.case_type ?? "general_civil");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const additional = Array.isArray((caseRow as any)?.additional_domains)
    ? ((caseRow as any).additional_domains as string[])
    : [];

  const [{ data: findings }, { data: documents }] = await Promise.all([
    db.from("case_findings").select("id,source_module").eq("case_id", caseId),
    db.from("documents").select("id,filename,extracted_text").eq("case_id", caseId),
  ]);

  const activations = deriveActivations({
    baseArea: ct,
    caseType: ct,
    additionalDomains: additional,
    findings: (findings ?? []) as Array<{ id: string; source_module: string | null }>,
    documents: (documents ?? []) as Array<{ id: string; filename: string; extracted_text?: string | null }>,
  });

  // Persist (idempotent by domain+source+trigger_id).
  if (activations.length) {
    const { data: existing } = await db
      .from("case_domain_activations")
      .select("domain,source,trigger_id")
      .eq("case_id", caseId);
    const seen = new Set((existing ?? []).map((r) => `${r.domain}::${r.source}::${r.trigger_id ?? ""}`));
    const fresh = activations.filter((a) => !seen.has(`${a.domain}::${a.source}::${a.trigger_id ?? ""}`));
    if (fresh.length) {
      await db.from("case_domain_activations").insert(
        fresh.map((a) => ({
          case_id: caseId,
          domain: a.domain,
          source: a.source,
          trigger_id: a.trigger_id,
          reason: a.reason,
          evidence_finding_ids: a.evidence_finding_ids,
        })),
      );
    }
  }

  const activeDomains = new Set<string>([normalizePracticeArea(ct), ...activations.map((a) => a.domain)]);
  return { activeDomains, activations };
}

/**
 * True if the case should receive criminal-track treatment (Miranda,
 * chain of custody, constitutional_compliance, conviction/acquittal jury
 * metrics) — either because its base case_type IS criminal/civil_rights,
 * or because "criminal" has been cross-domain-activated (e.g. a tax_law
 * case where a charging document was detected in the corpus).
 */
export function isCriminalEffective(caseType: string | undefined | null, activeDomains?: Iterable<string>): boolean {
  const base = normalizePracticeArea(caseType);
  if (base === "criminal" || base === "civil_rights") return true;
  if (!activeDomains) return false;
  for (const d of activeDomains) if (normalizePracticeArea(d) === "criminal") return true;
  return false;
}

/** Lightweight read: union of base case_type + persisted activation domains. */
export async function getActiveDomains(db: Db, caseId: string): Promise<Set<string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await db
    .from("cases")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("case_type" as any)
    .eq("id", caseId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = normalizePracticeArea((caseRow as any)?.case_type);
  const out = new Set<string>([base]);
  const { data: rows } = await db.from("case_domain_activations").select("domain").eq("case_id", caseId);
  for (const r of rows ?? []) out.add(normalizePracticeArea(r.domain));
  return out;
}
