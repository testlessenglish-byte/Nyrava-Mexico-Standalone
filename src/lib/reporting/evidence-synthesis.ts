// =============================================================================
// DETERMINISTIC CROSS-DOCUMENT EVIDENCE SYNTHESIS (NYRAVA México)
//
// Síntesis Probatoria is built by COMPARING the facts extracted from each
// cited document's verbatim quotes — never by counting documents and never by
// invoking a model. Four deterministic layers:
//
//   1. Excerpt-level comparison  — which facts agree, which differ.
//   2. Cross-document graph      — shared sources, cumulative vs independent.
//   3. Complementary vs duplicate — copies of one source add no weight.
//   4. Evidentiary weight rule    — when sources disagree, which prevails and
//                                   why, under the Mexican reliability tiers.
//
// Every sentence emitted here is traceable to an extracted fact and its source
// document. When the quotes yield no comparable facts, the module says so
// plainly instead of asserting corroboration it cannot demonstrate.
// =============================================================================

import {
  resolveLegalContext,
  type JurisdictionSignals,
  type LegalContext,
} from "@/lib/legal/jurisdiction-resolver";
import { getApplicableAuthority } from "@/lib/legal/legal-validity";
import {
  extractFacts,
  FACT_KIND_LABEL,
  normalizeText,
  type ExtractedFact,
  type FactKind,
} from "./evidence-facts";
import { actAuthorityRefs, actLabel, resolveActLexicon, type ActKey, type ActLexicon } from "./legal-acts";


type Weight = { stars: number; glyphs: string; label: string };

export type SynthesisDoc = {
  name: string;
  weight: Weight;
  quotes: string[];
};

export type ResolvedDoc = SynthesisDoc & {
  facts: ExtractedFact[];
  /** Normalized stem used to detect copies of the same source. */
  stem: string;
  /** Documentary family (evidentiary tier label) used for independence. */
  family: string;
  /** True when another cited document is a copy of the same source. */
  duplicateOf?: string;
};

export type FactAgreement = {
  kind: FactKind;
  display: string;
  docs: string[];
  independent: boolean;
};

export type FactConflict = {
  kind: FactKind;
  entries: Array<{ doc: string; display: string; weight: Weight }>;
  /** Δ for amounts / days for dates, already formatted. */
  delta?: string;
  prevailing?: { doc: string; weight: Weight };
  tie: boolean;
};

/**
 * Authority-aware context attached to a synthesis. Purely descriptive: it
 * records which normative frame was considered and whether its temporal
 * validity could be checked. It never alters the synthesis reasoning.
 */
export type SynthesisLegalContext = {
  jurisdiction: LegalContext;
  authorities_considered: Array<{
    id: string;
    label: string;
    jurisdiction: string;
    authority_weight: number;
  }>;
  validity_checked: boolean;
  /** Authorities excluded for not being in force on the reference date. */
  authorities_excluded: string[];
  /** Non-fatal notes when authority metadata is incomplete. */
  uncertainty: string[];
};

export type EvidenceSynthesis = {
  docs: ResolvedDoc[];
  agreements: FactAgreement[];
  conflicts: FactConflict[];
  /** Ordered, attorney-facing statements. */
  lines: string[];
  /** Lead paragraph summarising the documentary relationship. */
  narrative: string;
  /** True when the cited quotes produced at least one comparable fact. */
  grounded: boolean;
  /** Optional authority/jurisdiction/time-validity metadata. */
  legal_context?: SynthesisLegalContext;
};


/** Cross-finding index: which findings rest on each source document. */
export type DocumentGraph = Map<string, { name: string; findings: string[] }>;

// ------------------------------------------------------------------ helpers

const COPY_NOISE =
  /\b(copia|certificada|certificado|simple|escaneado|escaneada|scan|firmado|firmada|final|rev|revision|version|v|borrador|anexo|parte|pag|pagina|pdf|docx?|jpe?g|png|tiff?)\b/g;

function stemOf(name: string): string {
  return normalizeText(name)
    .replace(/\.[a-z0-9]{2,4}$/, "")
    .replace(/[_\-()[\]]+/g, " ")
    .replace(COPY_NOISE, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function pesos(n: number): string {
  return `$${n.toLocaleString("es-MX", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Comparable fact kinds: two documents asserting DIFFERENT values of these
 * kinds within the same finding is a genuine discrepancy worth reporting.
 * Parties, locations and acts are additive, not mutually exclusive, so their
 * divergence is reported as complementarity rather than conflict.
 */
const CONFLICTING_KINDS: FactKind[] = ["amount", "date", "identifier"];

// --------------------------------------------------------- document graph

/**
 * Builds the cross-finding document index from the findings already verified
 * by the pipeline. Pure: same findings → same graph.
 */
export function buildDocumentGraph(
  findings: Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
): DocumentGraph {
  const graph: DocumentGraph = new Map();
  for (const f of findings) {
    const title = String(f?.title ?? "").trim();
    const refs = Array.isArray(f?.evidence_refs) ? f.evidence_refs : [];
    const names = new Set<string>();
    for (const r of refs) {
      const label = String(r?.filename ?? r?.label ?? r?.document_title ?? "").trim();
      if (label) names.add(label);
    }
    for (const name of names) {
      const key = stemOf(name) || normalizeText(name);
      const entry = graph.get(key) ?? { name, findings: [] };
      if (title && !entry.findings.includes(title)) entry.findings.push(title);
      graph.set(key, entry);
    }
  }
  return graph;
}

// -------------------------------------------------------------- resolution

function resolveDocs(docs: SynthesisDoc[], caseType?: string | null): ResolvedDoc[] {
  const resolved: ResolvedDoc[] = docs.map((d) => ({
    ...d,
    facts: extractFacts(d.quotes, caseType),
    stem: stemOf(d.name),
    family: d.weight.label,
  }));
  const firstByStem = new Map<string, string>();
  for (const d of resolved) {
    if (!d.stem) continue;
    const first = firstByStem.get(d.stem);
    if (first && first !== d.name) d.duplicateOf = first;
    else firstByStem.set(d.stem, d.name);
  }
  return resolved;
}

/** Independent = asserted by documents of different evidentiary families and not copies. */
function isIndependent(docs: ResolvedDoc[]): boolean {
  const originals = docs.filter((d) => !d.duplicateOf);
  if (originals.length < 2) return false;
  return new Set(originals.map((d) => d.family)).size >= 2;
}

function compareFacts(docs: ResolvedDoc[]): {
  agreements: FactAgreement[];
  conflicts: FactConflict[];
} {
  // fact key → docs asserting it
  const byKey = new Map<string, { fact: ExtractedFact; docs: ResolvedDoc[] }>();
  for (const d of docs) {
    for (const fact of d.facts) {
      const k = `${fact.kind}|${fact.key}`;
      const entry = byKey.get(k) ?? { fact, docs: [] };
      if (!entry.docs.includes(d)) entry.docs.push(d);
      byKey.set(k, entry);
    }
  }

  const agreements: FactAgreement[] = [];
  for (const { fact, docs: holders } of byKey.values()) {
    if (holders.length < 2) continue;
    agreements.push({
      kind: fact.kind,
      display: fact.display,
      docs: holders.map((d) => d.name),
      independent: isIndependent(holders),
    });
  }
  agreements.sort(
    (a, b) => Number(b.independent) - Number(a.independent) || b.docs.length - a.docs.length,
  );

  // Conflicts: same kind, different values, asserted by different documents.
  const conflicts: FactConflict[] = [];
  for (const kind of CONFLICTING_KINDS) {
    // Group by identifier label so "Folio X" is not compared against "CFDI Y".
    const groups = new Map<string, Array<{ doc: ResolvedDoc; fact: ExtractedFact }>>();
    for (const d of docs) {
      for (const fact of d.facts) {
        if (fact.kind !== kind) continue;
        const groupKey =
          kind === "identifier"
            ? fact.key.split(":")[0]
            : kind === "amount"
              ? fact.key.split(":")[0]
              : "date";
        const arr = groups.get(groupKey) ?? [];
        arr.push({ doc: d, fact });
        groups.set(groupKey, arr);
      }
    }
    for (const arr of groups.values()) {
      const distinctValues = new Set(arr.map((a) => a.fact.key));
      const distinctDocs = new Set(arr.map((a) => a.doc.name));
      if (distinctValues.size < 2 || distinctDocs.size < 2) continue;

      // One representative per value, preferring the highest-weight document.
      const best = new Map<string, { doc: ResolvedDoc; fact: ExtractedFact }>();
      for (const a of arr) {
        const cur = best.get(a.fact.key);
        if (!cur || a.doc.weight.stars > cur.doc.weight.stars) best.set(a.fact.key, a);
      }
      const entries = [...best.values()].sort((a, b) => b.doc.weight.stars - a.doc.weight.stars);
      if (new Set(entries.map((e) => e.doc.name)).size < 2) continue;

      let delta: string | undefined;
      if (kind === "amount") {
        const nums = entries.map((e) => e.fact.numeric ?? 0);
        delta = `diferencia de ${pesos(Math.abs(Math.max(...nums) - Math.min(...nums)))}`;
      } else if (kind === "date") {
        const nums = entries.map((e) => e.fact.numeric ?? 0);
        const days = Math.abs(Math.max(...nums) - Math.min(...nums));
        delta = `separación de ${days} día(s)`;
      }

      const top = entries[0];
      const tie = entries.length > 1 && entries[1].doc.weight.stars === top.doc.weight.stars;
      conflicts.push({
        kind,
        entries: entries.map((e) => ({
          doc: e.doc.name,
          display: e.fact.display,
          weight: e.doc.weight,
        })),
        delta,
        prevailing: tie ? undefined : { doc: top.doc.name, weight: top.doc.weight },
        tie,
      });
    }
  }

  return { agreements, conflicts };
}

// --------------------------------------------------------- act relationships

function actLines(docs: ResolvedDoc[], lexicon: ActLexicon): string[] {
  const lines: string[] = [];
  const actDocs = new Map<ActKey, string[]>();
  for (const d of docs) {
    for (const f of d.facts) {
      if (f.kind !== "act" || !f.act) continue;
      const arr = actDocs.get(f.act) ?? [];
      if (!arr.includes(d.name)) arr.push(d.name);
      actDocs.set(f.act, arr);
    }
  }
  if (!actDocs.size) return lines;

  // Complementarity: antecedent act in one document, consequent in another.
  for (const seq of lexicon.sequences) {
    const from = actDocs.get(seq.from);
    const to = actDocs.get(seq.to);
    if (!from?.length || !to?.length) continue;
    const differentDocs = from.some((a) => !to.includes(a)) || to.some((b) => !from.includes(b));
    if (!differentDocs) continue;
    lines.push(
      `Documentos complementarios: ${fmtList(from)} acredita${from.length > 1 ? "n" : ""} ` +
        `${actLabel(seq.from)} y ${fmtList(to)} acredita${to.length > 1 ? "n" : ""} ` +
        `${actLabel(seq.to)}; se documenta ${seq.relation}, por lo que no son duplicados sino ` +
        "eslabones distintos de la misma secuencia.",
    );
  }

  // Same act corroborated by several documents.
  for (const [act, names] of actDocs) {
    if (names.length < 2) continue;
    lines.push(
      `El hecho jurídico «${actLabel(act)}» aparece acreditado en ${names.length} documentos citados: ${fmtList(names)}.`,
    );
  }

  // Antecedent act with no consequent act anywhere in the cited corpus.
  for (const gap of lexicon.gaps) {
    if (!actDocs.has(gap.act)) continue;
    if (gap.needs.some((n) => actDocs.has(n))) continue;
    lines.push(gap.gap);
  }

  return lines.slice(0, 6);
}

// ----------------------------------------------------------------- assembly

export function synthesizeEvidence(
  docsIn: SynthesisDoc[],
  opts: {
    graph?: DocumentGraph;
    findingTitle?: string;
    caseType?: string | null;
    /** Optional jurisdiction signals; absent → universal fallback. */
    jurisdiction?: JurisdictionSignals;
    /** Reference date used only for temporal validity of authority. */
    referenceDate?: string | Date | null;
  } = {},
): EvidenceSynthesis | null {

  if (!docsIn.length) return null;
  const lexicon = resolveActLexicon(opts.caseType);
  const docs = resolveDocs(docsIn, opts.caseType);
  const { agreements, conflicts } = compareFacts(docs);
  const lines: string[] = [];

  // ---- 1. Conflicts first: attorneys need the discrepancy up front.
  for (const c of conflicts.slice(0, 4)) {
    const kindLabel = FACT_KIND_LABEL[c.kind];
    const parts = c.entries.map((e) => `${e.doc} registra ${e.display}`);
    let line = `Discrepancia de ${kindLabel}: ${fmtList(parts)}`;
    line += c.delta ? ` (${c.delta}).` : ".";
    line +=
      " No obra entre los documentos citados constancia que explique la diferencia entre ambos registros.";
    if (c.prevailing) {
      line +=
        ` Conforme a la jerarquía probatoria aplicada, ${c.prevailing.doc} ` +
        `(${c.prevailing.weight.label} ${c.prevailing.weight.glyphs}) tiene mayor valor probatorio que ` +
        `${c.entries.filter((e) => e.doc !== c.prevailing!.doc).map((e) => `${e.doc} (${e.weight.label} ${e.weight.glyphs})`)[0]}, ` +
        "por su naturaleza documental y no por el contenido de la discrepancia.";
    } else if (c.tie) {
      line +=
        ` Ambas fuentes pertenecen al mismo nivel probatorio (${c.entries[0].weight.label} ${c.entries[0].weight.glyphs}), ` +
        "por lo que la contradicción no se resuelve por jerarquía documental y requiere determinación del abogado.";
    }
    lines.push(line);
  }

  // ---- 2. Corroboration, distinguishing independent from cumulative.
  for (const a of agreements.slice(0, 5)) {
    const kindLabel = FACT_KIND_LABEL[a.kind];
    lines.push(
      `${a.independent ? "Corroboración independiente" : "Coincidencia acumulativa"} de ${kindLabel}: ` +
        `«${a.display}» consta de forma coincidente en ${fmtList(a.docs)}. ` +
        (a.independent
          ? "Se trata de documentos de distinta naturaleza probatoria, por lo que se corroboran entre sí."
          : "Los documentos provienen del mismo tipo de fuente, por lo que constituyen soporte acumulativo y no corroboración independiente."),
    );
  }

  // ---- 3. Legal-act relationships (complementarity and sequence gaps).
  lines.push(...actLines(docs, lexicon));

  // ---- 4. Duplicate copies never increase evidentiary strength.
  const dupes = docs.filter((d) => d.duplicateOf);
  if (dupes.length) {
    lines.push(
      `Evidencia duplicada: ${fmtList(dupes.map((d) => `${d.name} (copia de ${d.duplicateOf})`))}. ` +
        "Las reproducciones de una misma fuente no incrementan la fuerza probatoria del hallazgo.",
    );
  }

  // ---- 5. Cross-finding dependency on the same source document.
  if (opts.graph) {
    for (const d of docs.slice(0, 3)) {
      const entry = opts.graph.get(d.stem || normalizeText(d.name));
      const others = (entry?.findings ?? []).filter((t) => t && t !== opts.findingTitle);
      if (others.length >= 1) {
        lines.push(
          `Dependencia documental: ${d.name} también sustenta ${others.length} hallazgo(s) adicional(es) ` +
            `(${fmtList(others.slice(0, 3))}${others.length > 3 ? ", entre otros" : ""}); ` +
            "cualquier objeción a este documento repercute en todos ellos.",
        );
      }
    }
  }

  // ---- Lead paragraph: describes the documentary relationship, not the count.
  const originals = docs.filter((d) => !d.duplicateOf);
  const families = new Set(originals.map((d) => d.family));
  const grounded = lines.length > 0;
  let narrative: string;
  if (docs.length === 1) {
    narrative =
      `El hallazgo descansa en una sola fuente documental (${docs[0].name} — ${docs[0].weight.label} ${docs[0].weight.glyphs}). ` +
      "No existe dentro de los documentos citados otra fuente contra la cual contrastar los datos que contiene.";
  } else if (conflicts.length) {
    narrative =
      `Los ${docs.length} documentos citados no son consistentes entre sí: se detectaron ${conflicts.length} ` +
      "divergencia(s) de datos concretos entre sus textos. A continuación se identifica en qué coinciden, en qué difieren y qué fuente tiene mayor valor probatorio.";
  } else if (agreements.length) {
    narrative =
      `Los ${originals.length} documento(s) originales citados, pertenecientes a ${families.size} ` +
      `tipo(s) de fuente documental, coinciden en ${agreements.length} dato(s) verificable(s) extraído(s) de sus propios textos. ` +
      "No se detectó divergencia entre los datos comparados.";
  } else {
    narrative =
      `Los ${docs.length} documentos citados no contienen datos concretos comparables entre sí ` +
      "(fechas, cantidades, identificadores, partes o hechos jurídicos coincidentes) dentro de los pasajes citados, " +
      "por lo que no puede afirmarse que se corroboren ni que se contradigan con base en el texto extraído.";
  }

  return { docs, agreements, conflicts, lines, narrative, grounded };
}
