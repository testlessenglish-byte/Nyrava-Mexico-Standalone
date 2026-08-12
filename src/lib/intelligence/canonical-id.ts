// ============================================================================
// CANONICAL ID + TAXONOMY GOVERNANCE LAYER
//
// Implements the "FINAL PATCH" structural invariants:
//   1. Global, closed taxonomy of claim types — engines MAY NOT introduce
//      new types. Unknown values are mapped through a fallback table or
//      rejected.
//   2. STRICT ID ordering:
//        normalize → claim_type → exact_match_id → exact dedup →
//        canonical_finding_id → registry merge
//      canonical_finding_id is computed ONLY on the deduplicated set so
//      pre-merge and post-merge representations cannot collide.
//   3. Provisional vs. authoritative separation: analyzer:* findings carry
//      `{ provisional: true, final: false }`; engine:* are authoritative.
//   4. Finalization barrier: callers must check `registry_state === "finalized"`
//      before scoring / exporting / responding "final".
//
// Pure functions — no DB, no I/O. Safe to import on both client and server.
// ============================================================================

import type { NewFinding } from "./types";

// ----------------------------------------------------------------------------
// GLOBAL CLAIM TAXONOMY
// ----------------------------------------------------------------------------
export const GLOBAL_CLAIM_TAXONOMY = [
  // Factual / forensic conflicts
  "suspect_height_discrepancy",
  "suspect_clothing_conflict",
  "suspect_identity_conflict",
  "escape_direction_conflict",
  "vehicle_description_conflict",
  "location_discrepancy",
  "time_discrepancy",
  // Forensic / physical evidence
  "dna_partial_match",
  "dna_exclusion",
  "fingerprint_conflict",
  "ballistics_conflict",
  "chain_of_custody_gap",
  "evidence_tampering_indicator",
  // Witness / testimony
  "witness_testimony_conflict",
  "witness_credibility_issue",
  "witness_bias_indicator",
  "witness_recantation",
  // Procedural / legal
  "discovery_violation",
  "brady_disclosure_gap",
  "constitutional_violation",
  "procedural_defect",
  "spoliation_claim",
  // Catch-alls (still inside taxonomy — never "unknown")
  "documentary_inconsistency",
  "missing_evidence",
  "corroboration_gap",
  "uncategorized_finding",
] as const;

export type ClaimType = (typeof GLOBAL_CLAIM_TAXONOMY)[number];

const TAXONOMY_SET: ReadonlySet<string> = new Set(GLOBAL_CLAIM_TAXONOMY);

export function isValidClaimType(v: unknown): v is ClaimType {
  return typeof v === "string" && TAXONOMY_SET.has(v);
}

// ----------------------------------------------------------------------------
// FALLBACK MAPPING — keyword heuristics route non-canonical labels to the
// nearest canonical type. The mapping table is the ONLY way an engine may
// introduce variance; everything else collapses to `uncategorized_finding`.
// ----------------------------------------------------------------------------
const FALLBACK_RULES: Array<[RegExp, ClaimType]> = [
  [/\bheight\b/i, "suspect_height_discrepancy"],
  [/\bclothing|attire|wearing\b/i, "suspect_clothing_conflict"],
  [/\bidentit(y|ies)|suspect\s+id\b/i, "suspect_identity_conflict"],
  [/\bescape|fled|direction\s+of\s+flight\b/i, "escape_direction_conflict"],
  [/\bvehicle|car|truck|license\s+plate\b/i, "vehicle_description_conflict"],
  [/\blocation|address|scene\b/i, "location_discrepancy"],
  [/\btimeline|timestamp|time\s+of\b/i, "time_discrepancy"],
  [/\bdna\b.*\b(partial|inconclusive)\b/i, "dna_partial_match"],
  [/\bdna\b.*\b(exclude|exclusion|not\s+match)\b/i, "dna_exclusion"],
  [/\bfingerprint|latent\s+print\b/i, "fingerprint_conflict"],
  [/\bballistic|firearm|cartridge|casing\b/i, "ballistics_conflict"],
  [/\bchain[\s-]of[\s-]custody|coc\b/i, "chain_of_custody_gap"],
  [/\btamper|altered\s+evidence|broken\s+seal\b/i, "evidence_tampering_indicator"],
  [/\bwitness.*(contradict|conflict|inconsistent)\b/i, "witness_testimony_conflict"],
  [/\bcredibilit(y|ies)|impeach\b/i, "witness_credibility_issue"],
  [/\bbias|motive\s+to\s+lie\b/i, "witness_bias_indicator"],
  [/\brecant|withdrew\s+statement\b/i, "witness_recantation"],
  [/\bdiscovery\s+(violation|abuse|misconduct)\b/i, "discovery_violation"],
  [/\bbrady|giglio|exculpatory.*disclos\b/i, "brady_disclosure_gap"],
  [/\bconstitutional\b|fourth\s+amendment|fifth\s+amendment|sixth\s+amendment\b/i, "constitutional_violation"],
  // `\bprocedural\b` (not just a leading `\bprocedural`) — audit P0-3: the
  // unbounded form matched as a mere PREFIX with no trailing anchor, so it
  // matched inside `category: "procedural_violations"` too (underscore is a
  // `\w` character, so "procedural_violations" has no `\b` between "l" and
  // "_" — this trailing `\b` correctly excludes it). Every finding whose
  // *category* happened to be "procedural_violations" was collapsing to the
  // single generic `procedural_defect` claim_type regardless of its actual
  // title/description, which then made computeCanonicalFindingId() (category
  // + claim_type + source_doc_ids) treat two genuinely different findings
  // that merely shared a category and a document as the same claim —
  // silently destroying one. See dedup-canonical-issue.test.ts.
  [/\bprocedural\b|miranda|due\s+process\b/i, "procedural_defect"],
  [/\bspoliat|destruction\s+of\s+evidence\b/i, "spoliation_claim"],
  [/\bmissing\s+(evidence|document|record)\b/i, "missing_evidence"],
  [/\bcorroborat\b/i, "corroboration_gap"],
  [/\bcontradict|inconsistent|conflict\b/i, "documentary_inconsistency"],
];

/**
 * Resolve a free-form category/title into a canonical ClaimType.
 * Returns `null` ONLY when no signal at all is available (caller should
 * reject the finding and send to the error queue).
 */
export function resolveClaimType(args: {
  raw?: unknown;
  category?: unknown;
  title?: unknown;
  description?: unknown;
}): ClaimType | null {
  const { raw, category, title, description } = args;
  if (isValidClaimType(raw)) return raw;
  const candidates = [raw, category].filter((x) => typeof x === "string") as string[];
  for (const c of candidates) {
    const norm = c
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_");
    if (TAXONOMY_SET.has(norm)) return norm as ClaimType;
  }
  const blob = [category, title, description].filter((x) => typeof x === "string").join(" ");
  if (!blob.trim()) return null;
  for (const rule of FALLBACK_RULES) {
    if (rule[0].test(blob)) return rule[1];
  }
  return "uncategorized_finding";
}

// ----------------------------------------------------------------------------
// DETERMINISTIC HASHES — FNV-1a 64-bit (no Node crypto required).
// ----------------------------------------------------------------------------
function fnv1a(input: string): string {
  // 64-bit FNV-1a using BigInt for determinism across runtimes.
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

function normalizeWhitespace(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function sortedDocIds(ids: readonly string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter((x) => typeof x === "string"))).sort();
}

/**
 * exact_match_id — collapses byte-identical findings (same claim_type, same
 * sources, same normalized title+description). Computed BEFORE dedup.
 */
export function computeExactMatchId(args: {
  claim_type: ClaimType;
  source_doc_ids: readonly string[] | undefined;
  title: string;
  description: string;
}): string {
  const key = [
    args.claim_type,
    sortedDocIds(args.source_doc_ids).join("|"),
    normalizeWhitespace(args.title),
    normalizeWhitespace(args.description),
  ].join("\x1f");
  return `em_${fnv1a(key)}`;
}

/**
 * canonical_finding_id — stable post-merge identity. Same category +
 * source_doc_ids + claim_type collapse to the same canonical id regardless
 * of wording, confidence, or engine origin. MUST be computed only AFTER
 * exact deduplication to prevent pre-merge/post-merge collision.
 *
 * `source_doc_ids` is the intended discriminator. It was previously never
 * populated by any engine (they set the singular `source_document_id`
 * instead, which never reached this function), so EVERY finding sharing a
 * category + claim_type — e.g. every witness in a case, since they all
 * classify as `witness_credibility_issue` — collapsed to the identical
 * canonical id and got merged as if they were the same claim, silently
 * destroying all but one of them. Engines now populate source_doc_ids (see
 * `gatedSourceDocIds` in engines.server.ts), but two safeguards remain here:
 *
 * 1. When source_doc_ids is empty (any caller that still doesn't populate
 *    it, or a finding with no resolvable citation), fall back to the
 *    finding's own normalized title as the discriminator.
 * 2. Entity-scoped categories — currently just "witness" — always key on
 *    title, never on shared documents. A witness profile identifies one
 *    person, and it's routine for multiple distinct witnesses to be cited
 *    from the very same document (e.g. two people both named in the
 *    Complaint); doc-based collapsing is correct for claim-type findings
 *    (contradictions, missing evidence) but would wrongly merge unrelated
 *    people for entity-type findings.
 * 3. `uncategorized_finding` — the claim_type catch-all `resolveClaimType`
 *    returns when nothing in the closed taxonomy matches — always keys on
 *    title too (audit P0-3). It carries no discriminating meaning by
 *    definition, so doc-based collapsing under it silently destroyed
 *    findings that shared nothing but a category and one cited document:
 *    confirmed on a real pair ("Falta de notificación oportuna del acuerdo
 *    de admisión" vs. "Omisión de fundamentación y motivación de la
 *    resolución impugnada", both category "procedural_violations", both
 *    citing doc-1) that resolveClaimType correctly refuses to classify
 *    into any specific taxonomy entry — see dedup-canonical-issue.test.ts.
 *    A *specific* claim_type (e.g. "chain_of_custody_gap") is a real
 *    corroborating signal that same-doc same-type findings are the same
 *    fact restated; the absence of one is not.
 *
 * Everything else keeps colliding on category+claim_type+docs exactly as
 * before, so genuine reworded-duplicate collapsing across engines (the
 * original purpose of this function) is unaffected.
 */
const ENTITY_SCOPED_CATEGORIES: ReadonlySet<string> = new Set(["witness"]);

export function computeCanonicalFindingId(args: {
  category: string;
  claim_type: ClaimType;
  source_doc_ids: readonly string[] | undefined;
  title?: string;
}): string {
  const category = String(args.category ?? "misc")
    .toLowerCase()
    .trim();
  const docIds = sortedDocIds(args.source_doc_ids);
  const useTitleKey =
    docIds.length === 0 ||
    ENTITY_SCOPED_CATEGORIES.has(category) ||
    args.claim_type === "uncategorized_finding";
  const key = [
    category,
    args.claim_type,
    useTitleKey ? `title:${normalizeWhitespace(String(args.title ?? ""))}` : docIds.join("|"),
  ].join("\x1f");
  return `cf_${fnv1a(key)}`;
}

/**
 * mergeConfidence — combine the confidence of a surviving finding with that
 * of a duplicate being merged into it.
 *
 * Baseline is the higher of the two confidences (a duplicate should never
 * pull a finding's confidence down). When the merge also brought genuinely
 * new, independent evidence (`corroborated = true`), the result is nudged
 * upward to reflect corroboration — but the boost shrinks as confidence
 * approaches 1 so a merge alone can never manufacture certainty.
 */
export function mergeConfidence(current: number, other: number, corroborated: boolean): number {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  const base = Math.max(clamp(current), clamp(other));
  if (!corroborated) return base;
  const boost = (1 - base) * 0.25;
  return clamp(base + boost);
}

// ----------------------------------------------------------------------------
// FINALIZATION PIPELINE — runs the strict ID order on a batch of findings.
// ----------------------------------------------------------------------------

export type FinalizationError = {
  title: string;
  reason: "invalid_claim_type";
  detail: string;
};

export type FinalizationResult = {
  finalized: NewFinding[];
  errors: FinalizationError[];
  stats: {
    input: number;
    exact_collapsed: number;
    canonical_merged: number;
    final: number;
    invalid: number;
  };
};

/**
 * Run the canonical ID pipeline:
 *   normalize → claim_type → exact_match_id → exact dedup →
 *   canonical_finding_id → metadata-merge.
 *
 * Returns finalized rows with `metadata.claim_type`, `metadata.exact_match_id`,
 * `metadata.canonical_finding_id`, `metadata.merged_from` (when applicable),
 * and `metadata.final = true` set. Invalid rows are routed to the error queue.
 */
export function finalizeFindings(rows: NewFinding[]): FinalizationResult {
  const errors: FinalizationError[] = [];
  const stats = { input: rows.length, exact_collapsed: 0, canonical_merged: 0, final: 0, invalid: 0 };

  // Step 1+2: normalize + assign validated claim_type.
  type Enriched = NewFinding & { __claim: ClaimType; __exact: string };
  const enriched: Enriched[] = [];
  for (const r of rows) {
    const existing = (r.metadata as Record<string, unknown> | undefined)?.["claim_type"];
    const ct = resolveClaimType({
      raw: existing,
      category: r.category,
      title: r.title,
      description: r.description,
    });
    if (!ct) {
      errors.push({ title: r.title, reason: "invalid_claim_type", detail: "no taxonomy match and no signal" });
      stats.invalid += 1;
      continue;
    }
    const exact = computeExactMatchId({
      claim_type: ct,
      source_doc_ids: r.source_doc_ids,
      title: r.title,
      description: r.description,
    });
    enriched.push({ ...r, __claim: ct, __exact: exact });
  }

  // Step 3+4: exact dedup. Authoritative (engine:*) entries replace
  // provisional (analyzer:*) duplicates so a later authoritative finding
  // promotes the registry instead of being silently dropped.
  const byExact = new Map<string, Enriched>();
  for (const e of enriched) {
    const prior = byExact.get(e.__exact);
    if (prior) {
      stats.exact_collapsed += 1;
      const priorAnalyzer = String(prior.source_module ?? "").startsWith("analyzer:");
      const nextAnalyzer = String(e.source_module ?? "").startsWith("analyzer:");
      if (priorAnalyzer && !nextAnalyzer) byExact.set(e.__exact, e);
      continue;
    }
    byExact.set(e.__exact, e);
  }
  const deduped = Array.from(byExact.values());

  // Step 5+6: canonical merge — same category + claim_type + source_doc_ids
  // collapse into a single canonical record. Metadata is APPENDED, not
  // replaced (provenance preserved).
  const byCanonical = new Map<string, NewFinding>();
  const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  for (const e of deduped) {
    const canonical = computeCanonicalFindingId({
      category: e.category,
      claim_type: e.__claim,
      source_doc_ids: e.source_doc_ids,
      title: e.title,
    });
    const isAnalyzer = String(e.source_module ?? "").startsWith("analyzer:");
    const base: NewFinding = {
      ...e,
      metadata: {
        ...(e.metadata ?? {}),
        claim_type: e.__claim,
        exact_match_id: e.__exact,
        canonical_finding_id: canonical,
        provisional: isAnalyzer,
        final: !isAnalyzer,
      },
    };
    const prev = byCanonical.get(canonical);
    if (!prev) {
      byCanonical.set(canonical, base);
      continue;
    }
    stats.canonical_merged += 1;
    // Winner = higher severity; loser metadata is appended.
    const prevSev = sevRank[String(prev.severity)] ?? 9;
    const newSev = sevRank[String(base.severity)] ?? 9;
    const winner = newSev < prevSev ? base : prev;
    const loser = winner === prev ? base : prev;
    const prevMeta = (winner.metadata ?? {}) as Record<string, unknown>;
    const prevMergedFrom = Array.isArray(prevMeta["merged_from"]) ? (prevMeta["merged_from"] as unknown[]) : [];
    const merged: NewFinding = {
      ...winner,
      evidence_refs: [
        ...((winner.evidence_refs ?? []) as unknown[]),
        ...((loser.evidence_refs ?? []) as unknown[]),
      ] as NewFinding["evidence_refs"],
      metadata: {
        ...prevMeta,
        // Provisional only if BOTH are analyzer-only.
        provisional:
          Boolean(prevMeta.provisional) &&
          Boolean((loser.metadata as Record<string, unknown> | undefined)?.provisional),
        final: !(
          Boolean(prevMeta.provisional) && Boolean((loser.metadata as Record<string, unknown> | undefined)?.provisional)
        ),
        merged_from: [
          ...prevMergedFrom,
          {
            title: loser.title,
            source_module: loser.source_module,
            confidence: loser.confidence,
            engine_origin: loser.source_module,
          },
        ],
      },
    };
    byCanonical.set(canonical, merged);
  }

  const finalized = Array.from(byCanonical.values());
  stats.final = finalized.length;
  return { finalized, errors, stats };
}

// ----------------------------------------------------------------------------
// REGISTRY STATE — finalization barrier.
// ----------------------------------------------------------------------------
export type RegistryState = "draft" | "finalizing" | "finalized" | "failed";

export type RegistrySnapshot = {
  state: RegistryState;
  finalized_at: string | null;
  pipeline_warnings: string[];
  invariants: {
    findings_count: number;
    canonical_ids_unique: boolean;
    taxonomy_violations: number;
    analyzer_leakage: number;
  };
};

/**
 * Assert that a registry snapshot is safe to consume as "final truth".
 * Throws if not — callers (scoring, report generation, export, public API)
 * MUST gate themselves on this.
 */
export function assertFinalized(snapshot: RegistrySnapshot, context: string): void {
  if (snapshot.state !== "finalized") {
    throw new Error(
      `[finalization-barrier] ${context}: registry state is "${snapshot.state}", refusing to proceed. ` +
        `No analyzer or intermediate output may be consumed as final truth.`,
    );
  }
  if (snapshot.invariants.taxonomy_violations > 0) {
    throw new Error(
      `[finalization-barrier] ${context}: ${snapshot.invariants.taxonomy_violations} taxonomy violations present.`,
    );
  }
  if (!snapshot.invariants.canonical_ids_unique) {
    throw new Error(`[finalization-barrier] ${context}: duplicate canonical_finding_id detected.`);
  }
}

/**
 * Build a registry snapshot from the finalized rows + accumulated warnings.
 */
export function buildRegistrySnapshot(args: {
  finalized: NewFinding[];
  invalid: number;
  warnings: string[];
}): RegistrySnapshot {
  const ids = new Set<string>();
  let dup = false;
  let leak = 0;
  for (const r of args.finalized) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const id = meta.canonical_finding_id;
    if (typeof id === "string") {
      if (ids.has(id)) dup = true;
      ids.add(id);
    }
    if (meta.provisional === true && meta.final === true) leak += 1;
  }
  return {
    state: "finalized",
    finalized_at: new Date().toISOString(),
    pipeline_warnings: args.warnings,
    invariants: {
      findings_count: args.finalized.length,
      canonical_ids_unique: !dup,
      taxonomy_violations: args.invalid,
      analyzer_leakage: leak,
    },
  };
}
