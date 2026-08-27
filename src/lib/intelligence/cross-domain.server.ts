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
import { normalizePracticeArea, resolvePracticeAreaOrNull, type PracticeArea } from "./practice-areas";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

type Db = SupabaseClient<Database>;

export type ActivationSource = "user" | "hybrid" | "evidence" | "charging_docs";

export type DomainActivation = {
  domain: PracticeArea;
  source: ActivationSource;
  trigger_id: string | null;
  reason: string;
  evidence_finding_ids: string[];
};

/** Materias that are unequivocally non-penal: a penal document attached as
 * background (e.g. una carpeta de investigación ofrecida como prueba en un
 * juicio familiar o laboral) must NOT unlock the penal track for them.
 *
 * `fiscal` is deliberately NOT in this set. Un asunto fiscal nace en la vía
 * administrativa (facultades de comprobación, recurso de revocación, juicio
 * de nulidad) pero la misma materia cubre la defraudación fiscal (Arts. 108
 * y 109 CFF). Dejar `fiscal` fuera permite que el disparador de documentos
 * de imputación haga su trabajo: en cuanto aparece una carpeta de
 * investigación o un auto de vinculación a proceso, el caso recibe el
 * tratamiento penal completo (cadena de custodia, debido proceso, control
 * constitucional) sin reclasificación manual. */
const EXPLICITLY_NON_PENAL: ReadonlySet<PracticeArea> = new Set([
  "civil",
  "familiar",
  "laboral",
  "mercantil",
  "administrativo",
  "agrario",
  "electoral",
]);

/** Patrones que identifican de manera confiable un documento de imputación
 * penal mexicano (CNPP). NOTA: "denuncia" y "querella" NO aparecen solas,
 * porque cualquier escrito civil o laboral puede mencionarlas como
 * antecedente; sólo cuentan cuando van acompañadas de la actuación
 * ministerial o jurisdiccional correspondiente. */
const CHARGING_DOC_RE =
  /(carpeta[\s_-]?de[\s_-]?investigaci[oó]n|formulaci[oó]n[\s_-]?de[\s_-]?imputaci[oó]n|auto[\s_-]?de[\s_-]?vinculaci[oó]n[\s_-]?a[\s_-]?proceso|orden[\s_-]?de[\s_-]?aprehensi[oó]n|orden[\s_-]?de[\s_-]?cateo|acusaci[oó]n[\s_-]?del[\s_-]?ministerio[\s_-]?p[uú]blico|auto[\s_-]?de[\s_-]?apertura[\s_-]?a[\s_-]?juicio[\s_-]?oral|informe[\s_-]?policial[\s_-]?homologado)/i;

function isChargingDoc(filename: string, extractedText: string | null | undefined): boolean {
  if (CHARGING_DOC_RE.test(filename)) return true;
  const head = String(extractedText ?? "").slice(0, 2000);
  return CHARGING_DOC_RE.test(head);
}

/** Formally supported hybrid case types. */
const HYBRID_TYPES: Record<string, PracticeArea[]> = {
  penal_constitucional: ["penal", "constitucional"],
  "penal+constitucional": ["penal", "constitucional"],
  penal_amparo: ["penal", "amparo"],
  laboral_amparo: ["laboral", "amparo"],
  administrativo_amparo: ["administrativo", "amparo"],
  fiscal_penal: ["fiscal", "penal"],
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
    id: "constitucional_en_penal",
    unlocks: "constitucional",
    modulePrefixes: ["debido_proceso", "defensa_adecuada", "presuncion_de_inocencia", "derechos_humanos", "tortura"],
    minFindings: 2,
    reason:
      "Hallazgos verificados acreditan una posible violación a derechos fundamentales que exige análisis de control constitucional.",
  },
  {
    id: "amparo_en_ordinario",
    unlocks: "amparo",
    modulePrefixes: ["acto_de_autoridad", "suspension", "acto_reclamado", "violacion_procesal"],
    minFindings: 2,
    reason: "Hallazgos verificados identifican un acto de autoridad impugnable por la vía del juicio de amparo.",
  },
  {
    id: "laboral_en_civil",
    unlocks: "laboral",
    modulePrefixes: ["relacion_laboral", "despido", "salario", "jornada", "imss"],
    minFindings: 2,
    reason: "Hallazgos verificados sobre una relación de trabajo justifican el análisis en materia laboral.",
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
  if (!seen.has("penal") && !EXPLICITLY_NON_PENAL.has(base) && args.documents?.length) {
    const chargingDocs = args.documents.filter((d) => isChargingDoc(d.filename ?? "", d.extracted_text));
    if (chargingDocs.length > 0) {
      seen.add("penal");
      out.push({
        domain: "penal",
        source: "charging_docs",
        trigger_id: "charging_doc_present",
        reason: `Charging document(s) detected (${chargingDocs
          .slice(0, 3)
          .map((d) => d.filename)
          .join(", ")}${chargingDocs.length > 3 ? ", …" : ""}); se habilitan los motores de materia penal.`,
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
  // VERIFIED CASE IDENTITY — never a raw cases.case_type read. This
  // function already had "no silent default" behavior (returns empty
  // activations when materia is unresolved) — that principle is preserved,
  // just fed from the verified/attorney-locked/declared identity instead
  // of the raw column so the two "no default" checks never fall out of
  // sync with each other.
  const { resolveCaseIdentity } = await import("./case-classification.server");
  const activationsIdentity = await resolveCaseIdentity(db, caseId);
  const resolvedCt = resolvePracticeAreaOrNull(activationsIdentity.caseType);
  if (!resolvedCt) return { activeDomains: new Set<string>(), activations: [] };
  const ct = resolvedCt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const additional = Array.isArray((caseRow as any)?.additional_domains)
    ? ((caseRow as any).additional_domains as string[])
    : [];

  const [{ data: findings }, { data: documents }] = await Promise.all([
    db
      .from("case_findings")
      .select("id,source_module")
      .eq("case_id", caseId)
      .not("source_module", "like", PROJECTION_LIKE),
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
      // 2026-07-31: this insert previously never checked Supabase's `error`
      // return. The release-gate's cross_domain_no_audit check re-queries
      // this exact table fresh, later in the same run — so a silently
      // failed insert here means the manifest (built from the in-memory
      // `activations` this function returns) says N cross-domain engines
      // are active, while the DB the release gate reads says zero
      // activation rows exist, and the ENTIRE report gets blocked on that
      // mismatch. Confirmed against a real case (ambiental + penal
      // cross-domain) where exactly this happened. Throwing here surfaces
      // the real cause immediately instead of a confusing downstream
      // "no activation audit rows were recorded" three pipeline stages
      // later.
      const { error: activationInsertError } = await db.from("case_domain_activations").insert(
        fresh.map((a) => ({
          case_id: caseId,
          domain: a.domain,
          source: a.source,
          trigger_id: a.trigger_id,
          reason: a.reason,
          evidence_finding_ids: a.evidence_finding_ids,
        })),
      );
      if (activationInsertError) {
        throw new Error(
          `case_domain_activations insert failed for case ${caseId} (${fresh.length} row(s)): ${activationInsertError.message}`,
        );
      }
    }
  }

  const activeDomains = new Set<string>([normalizePracticeArea(ct), ...activations.map((a) => a.domain)]);
  return { activeDomains, activations };
}

/**
 * True if the case should receive penal-track treatment (cadena de custodia,
 * debido proceso, control constitucional, métricas de vinculación a proceso)
 * — either because its materia IS `penal`, or because `penal` was
 * cross-domain-activated (e.g. un asunto fiscal en el que se detectó una
 * carpeta de investigación en el corpus).
 */
export function isCriminalEffective(caseType: string | undefined | null, activeDomains?: Iterable<string>): boolean {
  const base = resolvePracticeAreaOrNull(caseType);
  if (base === "penal") return true;
  if (!activeDomains) return false;
  for (const d of activeDomains) if (resolvePracticeAreaOrNull(d) === "penal") return true;
  return false;
}

/** Lightweight read: union of base case_type + persisted activation domains. */
export async function getActiveDomains(db: Db, caseId: string): Promise<Set<string>> {
  // VERIFIED CASE IDENTITY — never a raw cases.case_type read. High-traffic
  // (called from nearly every pipeline stage), so this benefits directly
  // from resolveCaseIdentity's per-(db,caseId) memoization — many callers
  // within one pipeline run share the same resolved identity instead of
  // each re-querying cases.
  const { resolveCaseIdentity } = await import("./case-classification.server");
  const domainsIdentity = await resolveCaseIdentity(db, caseId);
  const base = resolvePracticeAreaOrNull(domainsIdentity.caseType);
  const out = new Set<string>(base ? [base] : []);
  // The outer vehicle (notably Amparo) must not erase the substantive
  // materia. Including the verified underlying materia makes every existing
  // effective-domain consumer route Penal-origin Amparo through Penal gates
  // without globally treating ordinary Amparo as Penal.
  const underlying = resolvePracticeAreaOrNull(domainsIdentity.underlyingMateria);
  if (underlying) out.add(underlying);
  const { data: rows } = await db.from("case_domain_activations").select("domain").eq("case_id", caseId);
  for (const r of rows ?? []) {
    const d = resolvePracticeAreaOrNull(r.domain);
    if (d) out.add(d);
  }
  return out;
}

