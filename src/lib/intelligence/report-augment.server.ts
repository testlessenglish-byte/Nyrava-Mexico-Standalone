// Deterministic report augmentation: witness profiles + legal issue spotting.
// Pure heuristics over documents + findings + case_witnesses. No LLM call.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

type Db = SupabaseClient<Database>;

export type WitnessProfile = {
  name: string;
  role: string;
  key_statements: string[];
  credibility_supports: string[];
  credibility_risks: string[];
  bias_indicators: string[];
  impeachment_opportunities: string[];
  direct_questions: string[];
  cross_questions: string[];
  sources: string[];
};

const WITNESS_TITLE_RE =
  /\b(?:Policía de Investigación|Agente del Ministerio Público|Fiscal|Perito|Dr\.|Doctor|Doctora|Dra\.|Profesor|Profesora|Prof\.|Custodio)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’.-]+){0,2}\b/g;
const PROPER_NAME_RE = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})?)\b/g;

const NON_PERSON_NAME_PHRASES = new Set(
  [
    "Amparo Directo",
    "Amparo Indirecto",
    "Primera Sala",
    "Segunda Sala",
    "Tribunal Colegiado",
    "Tribunal Unitario",
    "Tribunal Electoral",
    "Suprema Corte",
    "Poder Judicial",
    "Semanario Judicial",
    "Diario Oficial",
    "Ministerio Público",
    "Código Civil",
    "Código Penal",
    "Código Nacional",
    "Procedimientos Penales",
    "Estados Unidos",
    "Ley Federal",
    "Ley General",
    "Derechos Humanos",
  ].map((s) => s.toLowerCase()),
);

// A generic capitalized phrase is NOT enough to create a witness. This is the
// invariant that prevents "Procedimientos Penales", "Estados Unidos", court
// names and doctrinal phrases from becoming people with fabricated cross-
// examination questions.
const NON_PERSON_TOKEN_RX =
  /\b(?:amparo|sala|tribunal|juzgado|suprema|corte|poder|judicial|semanario|diario|ministerio|público|publico|código|codigo|ley|procedimientos?|penales?|estados|unidos|constitución|constitucion|nacional|federal|derechos|humanos|artículo|articulo|fracción|fraccion|recurso|sentencia|jurisprudencia)\b/i;
const TESTIMONIAL_CONTEXT_RX =
  /\b(?:testigo|testimonial|declar[oó]|declaraci[oó]n|compareci[oó]|comparecencia|entrevista(?:do|da)?|manifest[oó]|deponente|perito|dictamen|polic[ií]a|agente|fiscal|custodio|v[ií]ctima|ofendido|denunciante)\b/i;

export function isLikelyWitnessPersonName(name: string, context = ""): boolean {
  const clean = name.trim();
  if (!clean || clean.length < 5 || clean.length > 90) return false;
  if (NON_PERSON_NAME_PHRASES.has(clean.toLowerCase())) return false;
  if (NON_PERSON_TOKEN_RX.test(clean)) return false;
  // Names extracted from generic capitalization require nearby testimonial
  // language; explicit titled-witness matches and database-seeded witnesses
  // bypass this check at their call sites.
  return TESTIMONIAL_CONTEXT_RX.test(context);
}

function contextsAround(text: string, name: string, radius = 180): string[] {
  const lower = text.toLowerCase();
  const needle = name.toLowerCase();
  const out: string[] = [];
  let from = 0;
  while (out.length < 8) {
    const i = lower.indexOf(needle, from);
    if (i < 0) break;
    out.push(text.slice(Math.max(0, i - radius), Math.min(text.length, i + name.length + radius)));
    from = i + Math.max(1, name.length);
  }
  return out;
}

function roleFor(name: string, context: string): string {
  const n = name.toLowerCase();
  const t = context.toLowerCase();
  if (/^cw-\d+/i.test(name)) return "testigo colaborador";
  if (/(v[ií]ctima|ofendido|denunciante)/.test(t) && t.includes(n)) return "víctima";
  if (/(polic[ií]a de investigaci[oó]n|agente del ministerio p[uú]blico|fiscal|custodio)/.test(t)) return "investigador";
  if (/(doctor|dr\.|doctora|dra\.|profesor|profesora|prof\.|perito)/i.test(t)) return "perito";
  if (/(imputado|acusado)/.test(t) && t.includes(n)) return "imputado";
  return "testigo";
}

function pickStatements(text: string, name: string, max = 4): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length < 420 && s.length > 30);
  const hits: string[] = [];
  for (const s of sentences) {
    if (s.toLowerCase().includes(name.toLowerCase())) {
      hits.push(s.trim());
      if (hits.length >= max) break;
    }
  }
  return hits;
}

export async function buildWitnessProfiles(db: Db, caseId: string): Promise<WitnessProfile[]> {
  const [{ data: docs }, { data: findings }, { data: witnessRows }] = await Promise.all([
    db.from("documents").select("id,filename,extracted_text,status").eq("case_id", caseId),
    db
      .from("case_findings")
      .select("title,description,category,source_quote,source_document_id")
      .eq("case_id", caseId)
      .not("source_module", "like", PROJECTION_LIKE),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).from("case_witnesses").select("*").eq("case_id", caseId),
  ]);

  const corpus = (docs ?? [])
    .filter((d) => d.status === "extracted")
    .map((d) => ({ id: d.id as string, filename: String(d.filename ?? ""), text: String(d.extracted_text ?? "") }));
  const allText = corpus.map((c) => c.text).join("\n\n");

  const nameSet = new Set<string>();
  // Human-reviewed/stored witness rows are authoritative seeds.
  for (const w of (witnessRows ?? []) as Array<{ name?: string }>) {
    if (typeof w?.name === "string" && w.name.trim()) nameSet.add(w.name.trim());
  }
  // Explicit witness/professional titles provide their own person context.
  for (const m of allText.matchAll(WITNESS_TITLE_RE)) nameSet.add(m[0]);

  // Generic proper-name extraction is only admitted if repeated AND at least
  // one occurrence sits in testimonial context. Repetition alone is never a
  // person signal.
  const properHits = new Map<string, number>();
  for (const m of allText.matchAll(PROPER_NAME_RE)) {
    const candidate = m[1];
    const context = allText.slice(Math.max(0, (m.index ?? 0) - 180), Math.min(allText.length, (m.index ?? 0) + candidate.length + 180));
    if (!isLikelyWitnessPersonName(candidate, context)) continue;
    properHits.set(candidate, (properHits.get(candidate) ?? 0) + 1);
  }
  for (const [n, c] of properHits) if (c >= 2) nameSet.add(n);

  const names = Array.from(nameSet)
    .filter((name) => {
      if ((witnessRows ?? []).some((w: any) => String(w?.name ?? "").trim() === name)) return true;
      if (new RegExp(`^(?:${WITNESS_TITLE_RE.source.replace(/^\\b|\/g$/, "")})$`, "i").test(name)) return true;
      return contextsAround(allText, name).some((ctx) => isLikelyWitnessPersonName(name, ctx));
    })
    .slice(0, 40);

  return names.map((name) => {
    const sources = corpus.filter((c) => c.text.toLowerCase().includes(name.toLowerCase())).map((c) => c.filename);
    const statements = pickStatements(allText, name, 5);
    const nameContexts = contextsAround(allText, name);
    const role = roleFor(name, nameContexts.join("\n"));
    const relatedFindings = (findings ?? []).filter((f) => {
      const blob = `${f.title ?? ""} ${f.description ?? ""} ${f.source_quote ?? ""}`;
      return blob.toLowerCase().includes(name.toLowerCase());
    });
    const credibility_supports: string[] = [];
    const credibility_risks: string[] = [];
    const bias_indicators: string[] = [];
    const impeachment_opportunities: string[] = [];

    if (role === "testigo colaborador") {
      bias_indicators.push("Testigo colaborador — verificar cualquier beneficio procesal documentado antes de atribuir un incentivo.");
    }
    if (role === "investigador") {
      credibility_supports.push("Servidor investigador identificado en el registro; contraste sus afirmaciones con informes y constancias contemporáneas.");
    }
    if (role === "perito") {
      credibility_risks.push("Verificar acreditación, metodología, datos de entrada y límites expresados en el dictamen antes de impugnar su confiabilidad.");
    }
    if (role === "víctima") bias_indicators.push("Calidad de víctima/ofendido; evaluar interés y corroboración sin presumir falta de credibilidad.");

    for (const f of relatedFindings) {
      const cat = String(f.category ?? "").toLowerCase();
      if (/contradict|credibility|impeach|inconsisten/.test(cat)) {
        impeachment_opportunities.push(String(f.title ?? "").slice(0, 200));
      }
    }

    const direct_questions = statements.length
      ? role === "investigador"
        ? ["Describa únicamente las diligencias que realizó personalmente.", "Identifique la constancia contemporánea que respalda cada afirmación relevante."]
        : role === "perito"
          ? ["Explique su acreditación, metodología y datos examinados.", "Indique los límites y margen de error de su conclusión."]
          : ["Relate únicamente lo que percibió directamente.", "Indique cuándo y cómo registró o comunicó esa percepción."]
      : [];
    const cross_questions = statements.length
      ? role === "investigador"
        ? ["¿Qué parte de su conclusión depende de información proporcionada por terceros?", "¿Qué líneas alternativas documentadas examinó y descartó?"]
        : role === "perito"
          ? ["¿Qué limitaciones metodológicas reconoce su propio dictamen?", "¿Qué datos, si cambiaran, modificarían su conclusión?"]
          : ["¿Su declaración actual difiere de alguna manifestación previa documentada?", "¿Qué parte de su relato proviene de percepción directa y cuál de información de terceros?"]
      : [];

    return {
      name,
      role,
      key_statements: statements,
      credibility_supports,
      credibility_risks,
      bias_indicators,
      impeachment_opportunities: impeachment_opportunities.slice(0, 5),
      direct_questions,
      cross_questions,
      sources: Array.from(new Set(sources)).slice(0, 6),
    };
  });
}

export type LegalIssueHit = {
  issue: string;
  indicator: string;
  document: string;
  quote: string;
  significance: string;
  next_step: string;
  case_law?: Array<{
    case_name: string;
    citation: string | null;
    court: string | null;
    date_filed: string | null;
    url: string;
    snippet: string;
  }>;
};

const ISSUE_RULES: Array<{
  issue: string;
  indicator: RegExp;
  description: string;
  significance: string;
  next_step: string;
}> = [
  {
    issue: "Cateo y Detención",
    indicator: /\b(orden\s+de\s+cateo|cateo\s+sin\s+orden|detenci[oó]n\s+sin\s+orden|flagrancia|caso\s+urgente|control\s+de\s+detenci[oó]n|aseguramiento\s+de\s+bienes)\b/i,
    description: "Orden de cateo, detención, flagrancia, caso urgente",
    significance: "Todo cateo o detención requiere orden judicial fundada y motivada, salvo flagrancia o caso urgente; la licitud debe verificarse contra las constancias y la norma vigente.",
    next_step: "Verificar la orden, acta y audiencia de control; cualquier promoción debe sustentarse en la irregularidad concreta documentada.",
  },
  {
    issue: "Declaración del Imputado sin Garantías",
    indicator: /\b(declaraci[oó]n\s+sin\s+defensor|coacci[oó]n\s+en\s+declaraci[oó]n|renuncia\s+al\s+derecho\s+a\s+guardar\s+silencio|entrevista\s+sin\s+abogado|declaraci[oó]n\s+ministerial\s+sin\s+asistencia)\b/i,
    description: "Declaración del imputado, asistencia de defensor, derecho a guardar silencio",
    significance: "Verificar si la declaración fue obtenida con defensa adecuada y respeto al derecho a guardar silencio.",
    next_step: "Revisar la constancia, registro audiovisual y asistencia de defensor antes de concluir que existe una violación.",
  },
  {
    issue: "Irregularidad en Solicitud de Cateo",
    indicator: /\b(datos\s+falsos\s+en\s+cateo|omisi[oó]n\s+sustancial\s+en\s+cateo|solicitud\s+de\s+cateo\s+irregular)\b/i,
    description: "Datos falsos u omisiones sustanciales en la solicitud de cateo",
    significance: "La solicitud y orden deben cumplir los requisitos aplicables; una irregularidad debe demostrarse con la propia solicitud, orden y ejecución.",
    next_step: "Comparar solicitud, orden y acta de ejecución; no recomendar una impugnación hasta identificar la irregularidad concreta.",
  },
  {
    issue: "Omisión en el Deber de Aportación Probatoria",
    indicator: /\b(dato\s+de\s+prueba\s+no\s+revelado|ocultamiento\s+de\s+evidencia|acuerdo\s+de\s+colaboraci[oó]n\s+no\s+revelado)\b/i,
    description: "Datos de prueba no revelados o acuerdos no divulgados",
    significance: "La existencia de una omisión debe verificarse contra el inventario y las constancias de acceso/descubrimiento probatorio.",
    next_step: "Contrastar el inventario con las constancias de entrega antes de atribuir una omisión al Ministerio Público.",
  },
  {
    issue: "Declaraciones Previas de Testigo",
    indicator: /\b(entrevista\s+previa|declaraci[oó]n\s+previa\s+del\s+testigo|notas\s+de\s+entrevista|declaraci[oó]n\s+inconsistente)\b/i,
    description: "Entrevistas o declaraciones previas documentadas",
    significance: "Una declaración previa puede ser relevante para consistencia y credibilidad si se identifica a la persona y el contenido concreto.",
    next_step: "Localizar la declaración previa completa y comparar pasajes específicos antes de formular preguntas de contradicción.",
  },
  {
    issue: "Cadena de Custodia",
    indicator: /\b(cadena\s+de\s+custodia|registro\s+de\s+cadena\s+de\s+custodia|sello\s+roto|manejo\s+de\s+indicios|laguna\s+en\s+custodia)\b/i,
    description: "Manejo de indicios y documentación de custodia",
    significance: "La integridad del indicio depende de las constancias concretas de identificación, traslado, almacenamiento y entrega.",
    next_step: "Revisar el registro completo de cadena de custodia y señalar sólo rupturas documentadas.",
  },
  {
    issue: "Fundamentación Probatoria",
    indicator: /\b(licitud\s+de\s+la\s+prueba|incorporaci[oó]n\s+de\s+prueba|prueba\s+superveniente|fundamentaci[oó]n\s+probatoria)\b/i,
    description: "Licitud e incorporación de la prueba",
    significance: "La licitud y forma de incorporación deben evaluarse contra la actuación documentada y la etapa procesal correcta.",
    next_step: "Identificar el medio de prueba, su origen y la actuación de incorporación antes de recomendar cualquier objeción.",
  },
  {
    issue: "Impugnación Pericial",
    indicator: /\b(dictamen\s+pericial|metodolog[ií]a\s+pericial|perito\s+sin\s+acreditaci[oó]n|error\s+de\s+laboratorio)\b/i,
    description: "Metodología y acreditación pericial",
    significance: "La confiabilidad pericial requiere examinar acreditación, método, datos y límites del dictamen concreto.",
    next_step: "Revisar el dictamen y anexos técnicos antes de plantear una impugnación metodológica.",
  },
];

export async function buildLegalIssues(db: Db, caseId: string): Promise<LegalIssueHit[]> {
  // This deterministic rule set is CNPP/penal-only; never scan another materia.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caseRow } = await (db as any).from("cases").select("case_type").eq("id", caseId).maybeSingle();
  const { mxProfileOrNull } = await import("../execution/mx-pipeline");
  if (mxProfileOrNull((caseRow as { case_type?: string | null } | null)?.case_type ?? null) !== "penal") return [];

  const { data: docs } = await db.from("documents").select("id,filename,extracted_text,status").eq("case_id", caseId);
  const hits: LegalIssueHit[] = [];
  const seen = new Set<string>();
  for (const d of (docs ?? []).filter((x) => x.status === "extracted")) {
    const filename = String(d.filename ?? "Untitled");
    const text = String(d.extracted_text ?? "");
    if (!text) continue;
    for (const rule of ISSUE_RULES) {
      const m = rule.indicator.exec(text);
      if (!m) continue;
      const start = Math.max(0, m.index - 80);
      const end = Math.min(text.length, m.index + m[0].length + 160);
      const quote = text.slice(start, end).replace(/\s+/g, " ").trim();
      const key = `${rule.issue}::${filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        issue: rule.issue,
        indicator: rule.description,
        document: filename,
        quote: quote.length > 320 ? quote.slice(0, 317) + "…" : quote,
        significance: rule.significance,
        next_step: rule.next_step,
      });
    }
  }
  return hits;
}

export async function buildLegalIssuesWithCaseLaw(db: Db, caseId: string): Promise<LegalIssueHit[]> {
  const issues = await buildLegalIssues(db, caseId);
  if (!issues.length) return issues;
  try {
    const { attachCaseLaw } = await import("./case-law.server");
    const { isFederalJurisdiction } = await import("./jurisdictions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caseRow } = await (db as any).from("cases").select("case_type, jurisdiction").eq("id", caseId).maybeSingle();
    const row = (caseRow ?? {}) as { case_type?: string | null; jurisdiction?: string | null };
    const { resolveCaseIdentity } = await import("./case-classification.server");
    const caseLawIdentity = await resolveCaseIdentity(db, caseId);
    return await attachCaseLaw(db, issues, caseLawIdentity.caseType ?? undefined, {
      federalOnly: isFederalJurisdiction(row.jurisdiction ?? null),
    });
  } catch (err) {
    console.warn("[legal-issues] case law attachment failed, returning issues without it:", err);
    return issues;
  }
}

export type DiscoveryStatus = "complete" | "partial" | "missing";
export type EvidenceInventoryItem = {
  item: string;
  source_document: string;
  what_it_shows: string;
  supports_theory: string;
  weakness_or_gap: string;
  what_is_needed: string;
  status: DiscoveryStatus;
  status_note: string;
};

type InvRule = { match: RegExp; item: string; shows: string; theory: string; weakness: string; needed: string };
const INV_RULES: InvRule[] = [
  { match: /\b(estado\s+de\s+cuenta|movimientos\s+bancarios|cuenta\s+bancaria)\b/i, item: "Estados de cuenta bancarios", shows: "Flujo de recursos y actividad de la cuenta", theory: "Acreditación patrimonial / defraudación", weakness: "Requiere perfeccionamiento y ratificación por la institución", needed: "Informe de la institución bancaria vía CNBV o requerimiento judicial" },
  { match: /\b(whatsapp|telegram|imessage|mensajes?\s+de\s+texto|sms|capturas?\s+de\s+pantalla)\b/i, item: "Registros de mensajería", shows: "Contenido y coordinación comunicada", theory: "Contexto e intención, sujeto a autenticación", weakness: "Capturas sin metadatos pueden ser incompletas", needed: "Extracción forense o fuente original con metadatos" },
  { match: /\b(cfdi|factura|comprobante\s+fiscal|contabilidad|p[oó]liza\s+contable|declaraci[oó]n\s+anual)\b/i, item: "Comprobantes fiscales y contabilidad", shows: "Operaciones registradas, ingresos y deducciones", theory: "Materialidad de operaciones / crédito fiscal", weakness: "Debe contrastarse con documentación soporte", needed: "Documentación soporte y constancias fiscales aplicables" },
  { match: /\b(pagar[eé]|t[ií]tulo\s+de\s+cr[eé]dito|letra\s+de\s+cambio|contrato\s+de\s+cr[eé]dito)\b/i, item: "Título de crédito o contrato mercantil", shows: "Obligación y monto documentados", theory: "Acción o cumplimiento contractual", weakness: "Verificar original, firma, exigibilidad y prescripción", needed: "Original y constancias de exigibilidad; pericial sólo si existe controversia documentada" },
  { match: /\b(correo\s+electr[oó]nico|oficio|carta|comunicaci[oó]n\s+escrita)\b/i, item: "Correspondencia y oficios", shows: "Comunicaciones documentadas", theory: "Notificación / conocimiento / contexto", weakness: "Debe acreditarse autoría y recepción cuando sean controvertidas", needed: "Hilo completo, encabezados o acuse según corresponda" },
  { match: /\b(transferencia|spei|clave\s+de\s+rastreo|remesa)\b/i, item: "Comprobantes de transferencia", shows: "Movimiento documentado de recursos", theory: "Origen y destino de recursos", weakness: "Verificar autenticidad y correspondencia con la cuenta", needed: "Comprobante verificable y, si se controvierte, informe institucional" },
  { match: /\b(videovigilancia|cctv|videograbaci[oó]n|c[aá]mara\s+de\s+seguridad|video)\b/i, item: "Videovigilancia", shows: "Registro audiovisual de hechos", theory: "Ubicación o dinámica de hechos", weakness: "Verificar integridad, fecha, fuente y continuidad", needed: "Archivo original y metadatos/constancias de obtención" },
  { match: /\b(expediente\s+cl[ií]nico|nota\s+m[eé]dica|hospital|necropsia|certificado\s+m[eé]dico)\b/i, item: "Documentación médica", shows: "Condición, atención o lesiones documentadas", theory: "Daño / nexo causal según materia", weakness: "Puede requerir interpretación profesional", needed: "Expediente íntegro y pericial sólo cuando la cuestión técnica lo requiera" },
  { match: /\b(entrevista|comparecencia|declaraci[oó]n|testimonial)\b/i, item: "Registro de entrevista o declaración", shows: "Manifestaciones documentadas de una persona", theory: "Corroboración / consistencia", weakness: "Verificar integridad y contexto", needed: "Registro completo y, si existe, audio/video original" },
  { match: /\b(escritura\s+p[uú]blica|certificado\s+de\s+libertad\s+de\s+gravamen|folio\s+real|catastro)\b/i, item: "Instrumentos y constancias registrales", shows: "Titularidad, gravámenes y situación registral", theory: "Acreditación inmobiliaria", weakness: "Verificar vigencia y correspondencia registral", needed: "Constancias registrales vigentes según el acto analizado" },
  { match: /\b(recibo\s+de\s+n[oó]mina|contrato\s+individual\s+de\s+trabajo|aviso\s+de\s+rescisi[oó]n|imss|control\s+de\s+asistencia)\b/i, item: "Documentación laboral", shows: "Relación, salario o condiciones documentadas", theory: "Relación laboral / prestaciones", weakness: "Verificar integridad y autoría", needed: "Expediente laboral y constancias relacionadas con el punto controvertido" },
];

function ruleFor(filename: string, headText: string): InvRule | null {
  const blob = `${filename}\n${headText.slice(0, 2000)}`;
  for (const r of INV_RULES) if (r.match.test(blob)) return r;
  return null;
}

export async function buildEvidenceInventory(db: Db, caseId: string): Promise<EvidenceInventoryItem[]> {
  const [{ data: docs }, { data: findings }] = await Promise.all([
    db.from("documents").select("id,filename,extracted_text,status").eq("case_id", caseId),
    db.from("case_findings").select("source_document_id,source_doc_ids,category,title").eq("case_id", caseId).not("source_module", "like", PROJECTION_LIKE),
  ]);

  const findingsByDoc = new Map<string, number>();
  for (const f of findings ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyF = f as any;
    const ids = new Set<string>();
    if (typeof anyF.source_document_id === "string") ids.add(anyF.source_document_id);
    if (Array.isArray(anyF.source_doc_ids)) for (const x of anyF.source_doc_ids) if (typeof x === "string") ids.add(x);
    for (const id of ids) findingsByDoc.set(id, (findingsByDoc.get(id) ?? 0) + 1);
  }

  const items: EvidenceInventoryItem[] = [];
  for (const d of docs ?? []) {
    const id = d.id as string;
    const filename = String(d.filename ?? "Untitled");
    const text = String(d.extracted_text ?? "");
    const extracted = d.status === "extracted" && text.trim().length >= 100;
    const rule = ruleFor(filename, text);
    let status: DiscoveryStatus;
    let statusNote: string;
    if (!extracted) {
      status = "missing";
      statusNote = d.status === "extracted" ? "Cargado pero el texto es ilegible — vuelva a digitalizar con mayor resolución." : `Sin extracción (estado=${d.status ?? "desconocido"}).`;
    } else if ((findingsByDoc.get(id) ?? 0) === 0) {
      status = "partial";
      statusNote = "Extraído pero ningún hallazgo canónico lo cita — revisar pertinencia antes de asumir que falta evidencia.";
    } else {
      status = "complete";
      statusNote = `Citado en ${findingsByDoc.get(id)} hallazgo(s).`;
    }
    items.push({
      item: rule?.item ?? "Documento",
      source_document: filename,
      what_it_shows: rule?.shows ?? "Antecedentes y contexto del asunto",
      supports_theory: rule?.theory ?? "General",
      weakness_or_gap: rule?.weakness ?? "Verificar pertinencia, autenticidad y alcance antes de asignar peso probatorio",
      what_is_needed: rule?.needed ?? "Sólo documentación complementaria específicamente vinculada a un punto controvertido no acreditado",
      status,
      status_note: statusNote,
    });
  }
  return items;
}

export type CrossOutline = { witness: string; topics: string[] };
export type WorkProduct = {
  case_strategy: string;
  strengths: Array<{ text: string; citation: string }>;
  weaknesses: Array<{ text: string; citation: string }>;
  motion_opportunities: Array<{ motion: string; basis: string; source_document: string }>;
  trial_themes: string[];
  cross_examination_outlines: CrossOutline[];
  jury_themes: string[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function citationOf(f: any): string {
  const doc = f?.source_document_id ? `DOC ${String(f.source_document_id).slice(0, 8)}` : "";
  const page = typeof f?.source_page === "number" ? ` p.${f.source_page}` : "";
  return doc ? `[${doc}${page}]` : "[uncited]";
}

const MOTION_MAP: Record<string, string> = {
  "Cateo y Detención": "Revisión de licitud de cateo/detención",
  "Declaración del Imputado sin Garantías": "Revisión de licitud de declaración",
  "Irregularidad en Solicitud de Cateo": "Revisión de legalidad de cateo",
  "Omisión en el Deber de Aportación Probatoria": "Revisión de acceso/aportación probatoria",
  "Declaraciones Previas de Testigo": "Revisión de declaración previa para contrainterrogatorio",
  "Cadena de Custodia": "Revisión de cadena de custodia",
  "Fundamentación Probatoria": "Revisión de licitud/incorporación de prueba",
  "Impugnación Pericial": "Revisión de dictamen pericial",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildWorkProduct(
  db: Db,
  caseId: string,
  ctx: { legalIssues?: any[]; witnessProfiles?: WitnessProfile[]; caseType?: string | null } = {},
): Promise<WorkProduct> {
  const { resolveMxProfile } = await import("../execution/mx-pipeline");
  const isPenal = resolveMxProfile(ctx.caseType) === "penal";
  const { data: findings } = await db
    .from("case_findings")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("title,description,category,affected_party,severity,evidence_type,source_document_id,source_page" as any)
    .eq("case_id", caseId)
    .not("source_module", "like", PROJECTION_LIKE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (findings ?? []) as any[];
  const favorable = rows.filter((f) => f.evidence_type === "exculpatory" || f.evidence_type === "impeachment");
  const adverse = rows.filter((f) => f.evidence_type === "inculpatory");
  const strongest = [...favorable].sort((a, b) => {
    const sev = (s: string) => (({ critical: 0, high: 1, medium: 2, low: 3, info: 4 }) as Record<string, number>)[s] ?? 4;
    return sev(String(a.severity)) - sev(String(b.severity));
  })[0];

  const case_strategy = strongest
    ? `El elemento favorable más sólido identificado es ${String(strongest.title ?? "").trim()}. Su uso estratégico debe mantenerse dentro del alcance de la evidencia citada y de su estado de verificación.`
    : "No hay suficientes hallazgos favorables verificados para formular una teoría dominante. Mantener separados los hechos acreditados de las líneas de investigación pendientes.";
  const strengths = favorable.slice(0, 8).map((f) => ({ text: String(f.title ?? "Hallazgo favorable"), citation: citationOf(f) }));
  const weaknesses = adverse.slice(0, 8).map((f) => ({ text: String(f.title ?? "Hallazgo adverso"), citation: citationOf(f) }));

  const issues = isPenal ? (ctx.legalIssues ?? []) : [];
  const seenMotion = new Set<string>();
  const motion_opportunities: WorkProduct["motion_opportunities"] = [];
  for (const iss of issues) {
    const motion = MOTION_MAP[String(iss.issue)] ?? `Revisión jurídica: ${iss.issue}`;
    const key = `${motion}::${iss.document}`;
    if (seenMotion.has(key)) continue;
    seenMotion.add(key);
    motion_opportunities.push({ motion, basis: String(iss.significance ?? iss.indicator ?? ""), source_document: String(iss.document ?? "") });
  }

  const trial_themes = favorable.slice(0, 5).map((f) => `${String(f.title ?? "").trim()} — ${String(f.category ?? "").toLowerCase()}.`);
  if (!trial_themes.length) trial_themes.push("No hay soporte suficiente para un tema dominante; revisar los hallazgos verificados y los vacíos identificados.");

  const cross_examination_outlines: CrossOutline[] = (ctx.witnessProfiles ?? [])
    .filter((w) => w.key_statements.length > 0 && (w.impeachment_opportunities.length > 0 || w.cross_questions.length > 0))
    .slice(0, 20)
    .map((w) => ({ witness: w.name, topics: [...w.impeachment_opportunities.slice(0, 3), ...w.cross_questions.slice(0, 3)].slice(0, 5) }));

  const jury_themes = isPenal
    ? ["Separar hechos acreditados de inferencias y exigir que cada conclusión relevante se sostenga en prueba incorporada y verificable."]
    : ["Separar determinaciones verificadas, inferencias sustentadas y cuestiones pendientes de revisión profesional."];

  return { case_strategy, strengths, weaknesses, motion_opportunities, trial_themes, cross_examination_outlines, jury_themes };
}
