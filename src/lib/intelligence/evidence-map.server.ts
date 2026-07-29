// Deterministic, per-document Evidence Map.
// Every uploaded document is classified into one of:
//   prosecution | defense | neutral | contradictory | missing_evidence
//
// Classification is heuristic-only (filename + extracted text + which findings
// reference the document). No LLM call — this guarantees consistency between
// the rendered Evidence Map, the rendered findings, and the document list.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

// Canonical Mexican document taxonomy. Values are stable snake_case keys —
// the report table translates them through
// `reports.evidenceMap.docType.*` / `.role.*` / `.party.*`, so a report never
// renders a hardcoded English label. The previous taxonomy was U.S.-only
// ("Charging Document", "Grand Jury Transcript", "Plea Agreement / Proffer"),
// which have no counterpart in Mexican procedure.
export type DocumentType =
  | "carpeta_de_investigacion"
  | "escrito_inicial"
  | "contestacion"
  | "orden_judicial"
  | "dictamen_pericial"
  | "promocion_defensa"
  | "promocion_ministerio_publico"
  | "resolucion_judicial"
  | "acta_de_audiencia"
  | "declaracion_testimonial"
  | "declaracion_victima"
  | "declaracion_imputado"
  | "cadena_de_custodia"
  | "informe_policial_homologado"
  | "acuerdo_o_convenio"
  | "instrumento_notarial"
  | "registros_financieros"
  | "documentacion_laboral"
  | "comunicaciones"
  | "otro";

export type LitigationRole =
  | "acto_de_autoridad"
  | "prueba"
  | "opinion_pericial"
  | "planteamiento_defensa"
  | "testimonial"
  | "negociacion"
  | "contexto";

export type Party = "acusacion" | "defensa" | "neutral" | "organo_jurisdiccional";


export type EvidenceMapEntry = {
  document_id: string;
  filename: string;
  page_count: number;
  char_count: number;
  ocr_extracted: boolean;
  classification: "prosecution" | "defense" | "neutral" | "contradictory" | "missing_evidence";
  rationale: string;
  finding_count: number;
  contradiction_count: number;
  document_type: DocumentType;
  litigation_role: LitigationRole;
  party: Party;
};

export type EvidenceMap = {
  generated_at: string;
  documents: EvidenceMapEntry[];
  totals: {
    total: number;
    prosecution: number;
    defense: number;
    neutral: number;
    contradictory: number;
    missing_evidence: number;
    ocr_failed: number;
  };
};

// Doc-type detection from filename + heading text. First matching rule wins.
// Patterns are Mexican (accent-insensitive) — Mexican filings are filed in
// Spanish, so matching on "indictment"/"deposition" classified virtually every
// real MX document as "Other".
const DOC_TYPE_RULES: Array<{ match: RegExp; type: DocumentType; role: LitigationRole; party: Party }> = [
  { match: /\b(carpeta\s+de\s+investigaci[oó]n|acuerdo\s+de\s+inicio|denuncia|querella)\b/i,                              type: "carpeta_de_investigacion",        role: "acto_de_autoridad",     party: "acusacion" },
  { match: /\b(informe\s+policial\s+homologado|\bIPH\b|parte\s+informativo|puesta\s+a\s+disposici[oó]n)\b/i,               type: "informe_policial_homologado",     role: "prueba",                party: "acusacion" },
  { match: /\b(registro\s+de\s+cadena\s+de\s+custodia|cadena\s+de\s+custodia)\b/i,                                        type: "cadena_de_custodia",              role: "prueba",                party: "acusacion" },
  { match: /\b(orden\s+de\s+(aprehensi[oó]n|cateo|arresto)|autorizaci[oó]n\s+judicial|mandamiento\s+judicial)\b/i,        type: "orden_judicial",                  role: "acto_de_autoridad",     party: "organo_jurisdiccional" },
  { match: /\b(dictamen\s+pericial|peritaje|dictamen\s+(m[eé]dico|psicol[oó]gico|contable|dactilosc[oó]pico)|necropsia)\b/i, type: "dictamen_pericial",             role: "opinion_pericial",      party: "neutral" },
  { match: /\b(escrito\s+(inicial\s+)?de\s+demanda|demanda\s+(civil|laboral|mercantil|familiar|de\s+amparo)|escrito\s+inicial)\b/i, type: "escrito_inicial",         role: "planteamiento_defensa", party: "acusacion" },
  { match: /\b(contestaci[oó]n\s+(de|a\s+la)\s+demanda|excepciones\s+y\s+defensas|reconvenci[oó]n)\b/i,                    type: "contestacion",                    role: "planteamiento_defensa", party: "defensa" },
  { match: /\b(escrito\s+de\s+la\s+defensa|solicitud\s+de\s+exclusi[oó]n\s+de\s+prueba|promoci[oó]n\s+de\s+la\s+defensa|alegatos\s+de\s+la\s+defensa)\b/i, type: "promocion_defensa", role: "planteamiento_defensa", party: "defensa" },
  { match: /\b(solicitud\s+del\s+ministerio\s+p[uú]blico|escrito\s+del\s+ministerio\s+p[uú]blico|solicitud\s+de\s+vinculaci[oó]n|descubrimiento\s+probatorio\s+del\s+MP)\b/i, type: "promocion_ministerio_publico", role: "prueba", party: "acusacion" },
  { match: /\b(auto\s+de\s+(vinculaci[oó]n|apertura|radicaci[oó]n)|sentencia|resoluci[oó]n|laudo|acuerdo\s+judicial|informe\s+justificado)\b/i, type: "resolucion_judicial",  role: "acto_de_autoridad",     party: "organo_jurisdiccional" },
  { match: /\b(acta\s+de\s+audiencia|audiencia\s+(inicial|intermedia|de\s+juicio|de\s+pruebas)|videograbaci[oó]n\s+de\s+audiencia)\b/i, type: "acta_de_audiencia",       role: "acto_de_autoridad",     party: "organo_jurisdiccional" },
  { match: /\b(declaraci[oó]n\s+de\s+la\s+v[ií]ctima|entrevista\s+(a\s+la\s+)?v[ií]ctima|declaraci[oó]n\s+del\s+ofendido)\b/i, type: "declaracion_victima",         role: "testimonial",           party: "acusacion" },
  { match: /\b(declaraci[oó]n\s+del\s+imputado|entrevista\s+al\s+imputado|confesi[oó]n)\b/i,                               type: "declaracion_imputado",            role: "testimonial",           party: "defensa" },
  { match: /\b(testimonial|declaraci[oó]n\s+(de|del|de\s+la)\s+testigo|entrevista\s+a\s+testigo|comparecencia)\b/i,        type: "declaracion_testimonial",         role: "testimonial",           party: "neutral" },
  { match: /\b(convenio|acuerdo\s+reparatorio|constancia\s+de\s+conciliaci[oó]n|transacci[oó]n|criterio\s+de\s+oportunidad)\b/i, type: "acuerdo_o_convenio",          role: "negociacion",           party: "neutral" },
  { match: /\b(escritura\s+p[uú]blica|instrumento\s+notarial|poder\s+notarial|certificado\s+de\s+libertad\s+de\s+gravamen|folio\s+real)\b/i, type: "instrumento_notarial",  role: "prueba",                party: "neutral" },
  { match: /\b(estado\s+de\s+cuenta|transferencia|p[oó]liza|factura|cfdi|pagar[eé]|declaraci[oó]n\s+anual|contabilidad)\b/i, type: "registros_financieros",         role: "prueba",                party: "neutral" },
  { match: /\b(recibo\s+de\s+n[oó]mina|contrato\s+individual\s+de\s+trabajo|constancia\s+laboral|aviso\s+de\s+rescisi[oó]n|registros\s+de\s+asistencia)\b/i, type: "documentacion_laboral", role: "prueba",              party: "neutral" },
  { match: /\b(correo\s+electr[oó]nico|oficio|carta|mensajes?\s+de\s+(texto|whatsapp)|memor[aá]ndum|comunicaci[oó]n)\b/i,   type: "comunicaciones",                  role: "contexto",              party: "neutral" },
];

function classifyDocument(filename: string, headText: string): { type: DocumentType; role: LitigationRole; party: Party } {
  const blob = `${filename}\n${headText.slice(0, 2000)}`;
  for (const r of DOC_TYPE_RULES) if (r.match.test(blob)) return { type: r.type, role: r.role, party: r.party };
  return { type: "otro", role: "contexto", party: "neutral" };
}


// Side-classification heuristics, in Mexican vocabulary. "prosecution"/"defense"
// remain the persisted classification keys (the report layer translates them to
// acusación/defensa) so existing reports keep rendering.
const RE_PROSECUTION = /(carpeta[_ ]de[_ ]investigacion|ministerio[_ ]publico|fiscal[ií]a|detenci[oó]n|orden[_ ]de[_ ](aprehension|cateo)|lugar[_ ]de[_ ]los[_ ]hechos|pericial|dictamen|declaraci[oó]n[_ ]de[_ ]la[_ ]v[ií]ctima|informe[_ ]policial|acusaci[oó]n|imputaci[oó]n|puesta[_ ]a[_ ]disposici[oó]n)/i;
const RE_DEFENSE = /(defensa|defensor|imputad[oa]|coartada|exclusi[oó]n[_ ]de[_ ]prueba|excluyente|contestaci[oó]n|excepciones|reconvenci[oó]n|descargo|prueba[_ ]de[_ ]descargo)/i;
const RE_CIVIL_PLAINTIFF = /(actor|actora|promovente|quejos[oa]|demanda|escrito[_ ]inicial|expediente[_ ]cl[ií]nico|nota[_ ]m[eé]dica|estado[_ ]de[_ ]cuenta|factura|contrato|correo[_ ]electr[oó]nico|inspecci[oó]n|avaluo|aval[uú]o)/i;

export async function buildEvidenceMap(db: Db, caseId: string): Promise<EvidenceMap> {
  const [{ data: docs }, { data: findings }, { data: contradictions }] = await Promise.all([
    db.from("documents")
      .select("id,filename,extracted_text,status")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    db.from("case_findings")
      .select("source_document_id,source_doc_ids,affected_party,category")
      .eq("case_id", caseId),
    // Contradictions are stored inside reports.contradictions_struct; fall back
    // gracefully if absent.
    db.from("reports")
      .select("contradictions_struct")
      .eq("case_id", caseId)
      .maybeSingle(),
  ]);

  const pageCounts = new Map<string, number>();
  {
    const { data: pages } = await db
      .from("document_pages")
      .select("document_id,page")
      .eq("case_id", caseId);
    for (const p of pages ?? []) {
      pageCounts.set(p.document_id as string, Math.max(pageCounts.get(p.document_id as string) ?? 0, (p as { page: number }).page));
    }
  }

  // Index finding references by document_id.
  const findingsByDoc = new Map<string, { count: number; prosecution: number; defense: number }>();
  for (const f of findings ?? []) {
    const ids = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd = (f as any).source_document_id;
    if (typeof sd === "string") ids.add(sd);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (f as any).source_doc_ids;
    if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") ids.add(x);
    for (const id of ids) {
      const cur = findingsByDoc.get(id) ?? { count: 0, prosecution: 0, defense: 0 };
      cur.count += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const party = String((f as any).affected_party ?? "").toLowerCase();
      if (party === "prosecution") cur.prosecution += 1;
      else if (party === "defense") cur.defense += 1;
      findingsByDoc.set(id, cur);
    }
  }

  // Count contradictions per document.
  const contraByDoc = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cstruct = (contradictions as any)?.contradictions_struct;
  if (Array.isArray(cstruct)) {
    for (const c of cstruct) {
      const ids: string[] = [];
      if (Array.isArray(c?.sources)) for (const s of c.sources) {
        if (typeof s?.document_id === "string") ids.push(s.document_id);
      }
      if (typeof c?.document_id === "string") ids.push(c.document_id);
      for (const id of ids) contraByDoc.set(id, (contraByDoc.get(id) ?? 0) + 1);
    }
  }

  const entries: EvidenceMapEntry[] = (docs ?? []).map((d) => {
    const id = d.id as string;
    const filename = String(d.filename ?? "Untitled");
    const text = String(d.extracted_text ?? "");
    const pages = pageCounts.get(id) ?? 0;
    const ocrOk = d.status === "extracted" && text.trim().length >= 100;
    const fcounts = findingsByDoc.get(id) ?? { count: 0, prosecution: 0, defense: 0 };
    const contraN = contraByDoc.get(id) ?? 0;

    let cls: EvidenceMapEntry["classification"];
    let why: string;

    if (!ocrOk) {
      cls = "missing_evidence";
      why = d.status === "extracted"
        ? "Documento cargado pero el texto extraído está vacío o es ilegible — se trata como prueba faltante."
        : `Documento sin extracción (estado=${d.status ?? "desconocido"}).`;
    } else if (contraN > 0) {
      cls = "contradictory";
      why = `Citado en ${contraN} contradicción${contraN === 1 ? "" : "es"} del expediente.`;
    } else if (fcounts.prosecution > fcounts.defense && fcounts.prosecution > 0) {
      cls = "prosecution";
      why = `Sustenta ${fcounts.prosecution} hallazgo${fcounts.prosecution === 1 ? "" : "s"} de la parte acusadora/actora.`;
    } else if (fcounts.defense > fcounts.prosecution && fcounts.defense > 0) {
      cls = "defense";
      why = `Sustenta ${fcounts.defense} hallazgo${fcounts.defense === 1 ? "" : "s"} de la defensa/parte demandada.`;
    } else if (fcounts.count > 0) {
      cls = "neutral";
      why = `Citado en ${fcounts.count} hallazgo${fcounts.count === 1 ? "" : "s"} sin inclinación clara hacia una parte.`;
    } else {
      // Heuristic from filename and content if no engine cited it.
      const blob = `${filename} ${text.slice(0, 2000)}`;
      if (RE_PROSECUTION.test(blob)) { cls = "prosecution"; why = "El nombre o contenido corresponde a documentación de la parte acusadora (carpeta de investigación, informe policial homologado, dictamen pericial)."; }
      else if (RE_DEFENSE.test(blob)) { cls = "defense"; why = "El nombre o contenido corresponde a documentación de la defensa (contestación, excepciones, prueba de descargo)."; }
      else if (RE_CIVIL_PLAINTIFF.test(blob)) { cls = "prosecution"; why = "El nombre o contenido corresponde a documentación de la parte actora (escrito inicial, contrato, estado de cuenta, expediente clínico)."; }
      else { cls = "neutral"; why = "Ningún motor citó este documento y no hay palabras clave direccionales en el nombre o contenido."; }
    }


    const docCls = classifyDocument(filename, text);
    return {
      document_id: id,
      filename,
      page_count: pages,
      char_count: text.length,
      ocr_extracted: ocrOk,
      classification: cls,
      rationale: why,
      finding_count: fcounts.count,
      contradiction_count: contraN,
      document_type: docCls.type,
      litigation_role: docCls.role,
      party: docCls.party,
    };
  });

  const totals = entries.reduce(
    (acc, e) => {
      acc.total += 1;
      acc[e.classification] += 1;
      if (!e.ocr_extracted) acc.ocr_failed += 1;
      return acc;
    },
    { total: 0, prosecution: 0, defense: 0, neutral: 0, contradictory: 0, missing_evidence: 0, ocr_failed: 0 },
  );

  return { generated_at: new Date().toISOString(), documents: entries, totals };
}

// ---------------------------------------------------------------------------
// OCR coverage report — purely derived from documents + document_pages.
// ---------------------------------------------------------------------------
export type OcrCoverage = {
  total_documents: number;
  extracted: number;
  failed: number;
  pending: number;
  coverage_pct: number;          // extracted / total
  avg_chars_per_doc: number;
  total_pages: number;
  docs_with_pages: number;
};

export async function buildOcrCoverage(db: Db, caseId: string): Promise<OcrCoverage> {
  const [{ data: docs }, { data: pages }] = await Promise.all([
    db.from("documents").select("id,status,extracted_text").eq("case_id", caseId),
    db.from("document_pages").select("document_id").eq("case_id", caseId),
  ]);
  const list = docs ?? [];
  const total = list.length;
  let extracted = 0; let failed = 0; let pending = 0; let chars = 0;
  for (const d of list) {
    const status = String(d.status ?? "");
    if (status === "extracted") { extracted += 1; chars += String(d.extracted_text ?? "").length; }
    else if (status === "failed") failed += 1;
    else pending += 1;
  }
  const pageDocSet = new Set<string>();
  for (const p of pages ?? []) pageDocSet.add(p.document_id as string);
  return {
    total_documents: total,
    extracted, failed, pending,
    coverage_pct: total > 0 ? Math.round((extracted / total) * 1000) / 10 : 0,
    avg_chars_per_doc: extracted > 0 ? Math.round(chars / extracted) : 0,
    total_pages: (pages ?? []).length,
    docs_with_pages: pageDocSet.size,
  };
}

// ---------------------------------------------------------------------------
// Report Quality audit — every finding must have document number + page +
// citation + supporting evidence. Returns counters used in validation block.
// ---------------------------------------------------------------------------
export type ReportQualityAudit = {
  total_findings: number;
  with_document: number;
  with_page: number;
  with_quote: number;
  with_evidence_refs: number;
  fully_cited: number;            // doc + (page OR refs) + quote
  fully_cited_pct: number;
  missing_citation: number;
  missing_citation_titles: string[];
};

export async function buildReportQualityAudit(db: Db, caseId: string): Promise<ReportQualityAudit> {
  const { data } = await db
    .from("case_findings")
    .select("title,source_document_id,source_page,source_quote,evidence_refs")
    .eq("case_id", caseId);
  const rows = data ?? [];
  const audit: ReportQualityAudit = {
    total_findings: rows.length,
    with_document: 0, with_page: 0, with_quote: 0, with_evidence_refs: 0,
    fully_cited: 0, fully_cited_pct: 0,
    missing_citation: 0, missing_citation_titles: [],
  };
  for (const r of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = r as any;
    const hasDoc = typeof x.source_document_id === "string" && x.source_document_id.length > 0;
    const hasPage = typeof x.source_page === "number" && x.source_page > 0;
    const hasQuote = typeof x.source_quote === "string" && x.source_quote.trim().length > 0;
    const refs = Array.isArray(x.evidence_refs) ? x.evidence_refs : [];
    const hasRefs = refs.length > 0;
    if (hasDoc) audit.with_document += 1;
    if (hasPage) audit.with_page += 1;
    if (hasQuote) audit.with_quote += 1;
    if (hasRefs) audit.with_evidence_refs += 1;
    if (hasDoc && hasQuote && (hasPage || hasRefs)) audit.fully_cited += 1;
    else {
      audit.missing_citation += 1;
      if (audit.missing_citation_titles.length < 25) audit.missing_citation_titles.push(String(x.title ?? "Untitled"));
    }
  }
  audit.fully_cited_pct = audit.total_findings > 0
    ? Math.round((audit.fully_cited / audit.total_findings) * 1000) / 10
    : 0;
  return audit;
}
