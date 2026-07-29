// Deterministic report augmentation: witness profiles + legal issue spotting.
// Pure heuristics over documents + findings + case_witnesses. No LLM call.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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

// Names we consider witnesses when scanning free text. Mexican
// investigative/procedural roles (REBUILT 2026-07-29 — previously used
// U.S. police ranks: Detective, Sergeant, Lieutenant, Deputy, Sheriff).
const WITNESS_TITLE_RE =
  /\b(?:Policía de Investigación|Agente del Ministerio Público|Ministerio Público|Fiscal|Perito|Dr\.|Doctor|Doctora|Dra\.|Profesor|Profesora|Prof\.|Custodio)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’.-]+)?\b/g;
const PROPER_NAME_RE = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b/g;

function roleFor(name: string, text: string): string {
  const n = name.toLowerCase();
  const t = text.toLowerCase();
  if (/^cw-\d+/i.test(name)) return "testigo colaborador";
  if (/(v[ií]ctima|ofendido|denunciante)/.test(t) && t.includes(n)) return "víctima";
  if (
    /(polic[ií]a de investigaci[oó]n|agente del ministerio p[uú]blico|ministerio p[uú]blico|fiscal|custodio)/.test(
      name.toLowerCase(),
    )
  )
    return "investigador";
  if (/(doctor|dr\.|doctora|dra\.|profesor|profesora|prof\.|perito)/i.test(name)) return "perito";
  if (/imputado|acusado/.test(t) && t.includes(n)) return "imputado";
  return "testigo";
}

function pickStatements(text: string, name: string, max = 4): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length < 320 && s.length > 30);
  const hits: string[] = [];
  for (const s of sentences) {
    if (s.includes(name) || s.toLowerCase().includes(name.toLowerCase())) {
      hits.push(s.trim());
      if (hits.length >= max) break;
    }
  }
  return hits;
}

export async function buildWitnessProfiles(db: Db, caseId: string): Promise<WitnessProfile[]> {
  const [{ data: docs }, { data: findings }, { data: witnessRows }] = await Promise.all([
    db.from("documents").select("id,filename,extracted_text,status").eq("case_id", caseId),
    db.from("case_findings").select("title,description,category,source_quote,source_document_id").eq("case_id", caseId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).from("case_witnesses").select("*").eq("case_id", caseId),
  ]);

  const corpus = (docs ?? [])
    .filter((d) => d.status === "extracted")
    .map((d) => ({ id: d.id as string, filename: String(d.filename ?? ""), text: String(d.extracted_text ?? "") }));
  const allText = corpus.map((c) => c.text).join("\n\n");

  const nameSet = new Set<string>();
  // Seed with existing witnesses table.
  for (const w of (witnessRows ?? []) as Array<{ name?: string }>) {
    if (typeof w?.name === "string" && w.name.trim()) nameSet.add(w.name.trim());
  }
  // Extract from corpus.
  for (const m of allText.matchAll(WITNESS_TITLE_RE)) nameSet.add(m[0]);
  const properHits = new Map<string, number>();
  for (const m of allText.matchAll(PROPER_NAME_RE)) {
    properHits.set(m[1], (properHits.get(m[1]) ?? 0) + 1);
  }
  for (const [n, c] of properHits) if (c >= 3) nameSet.add(n);

  // Cap so a giant corpus doesn't produce hundreds of low-quality profiles.
  const names = Array.from(nameSet).slice(0, 40);
  const profiles: WitnessProfile[] = names.map((name) => {
    const sources = corpus.filter((c) => c.text.includes(name)).map((c) => c.filename);
    const statements = pickStatements(allText, name, 5);
    const role = roleFor(name, allText);
    const relatedFindings = (findings ?? []).filter((f) => {
      const blob = `${f.title ?? ""} ${f.description ?? ""} ${f.source_quote ?? ""}`;
      return blob.includes(name);
    });
    const credibility_supports: string[] = [];
    const credibility_risks: string[] = [];
    const bias_indicators: string[] = [];
    const impeachment_opportunities: string[] = [];

    if (role === "cooperating witness") {
      bias_indicators.push("Cooperating witness — inherent incentive to testify favorably to prosecution.");
      credibility_risks.push("Possible plea/proffer agreement; verify sentencing exposure and benefits received.");
    }
    if (role === "investigator") {
      credibility_supports.push("Sworn law enforcement officer with contemporaneous reports.");
      credibility_risks.push("Confirmation bias risk; check whether investigation narrowed early to a single suspect.");
    }
    if (role === "expert") {
      credibility_risks.push("Subject to Daubert/Frye challenge on methodology and qualifications.");
    }
    if (role === "victim") {
      bias_indicators.push("Victim status — strong emotional stake in outcome.");
    }
    for (const f of relatedFindings) {
      const cat = String(f.category ?? "").toLowerCase();
      if (/contradict/.test(cat) || /credibility/.test(cat) || /impeach/.test(cat)) {
        impeachment_opportunities.push(String(f.title ?? "").slice(0, 200));
      }
    }
    const direct_questions =
      role === "investigator"
        ? [
            `Please walk the jury through your investigation, ${name}.`,
            `What evidence corroborates each element of the charge?`,
            `Describe the chain of custody for each item you seized.`,
          ]
        : role === "expert"
          ? [
              `Please describe your qualifications and the methodology you applied.`,
              `What are the error rates associated with your technique?`,
              `Have your conclusions been peer reviewed?`,
            ]
          : [
              `Please tell the jury what you saw, ${name}.`,
              `How certain are you of what you observed?`,
              `Did you record or document your observations at the time?`,
            ];
    const cross_questions =
      role === "cooperating witness"
        ? [
            `You entered a cooperation agreement in exchange for reduced exposure, correct?`,
            `Your testimony today is a term of that agreement, isn't it?`,
            `You've reviewed your prior statements with the prosecutor before testifying?`,
          ]
        : role === "investigator"
          ? [
              `You focused on the defendant early in the investigation, didn't you?`,
              `You did not pursue [alternative lead] because it did not fit your theory?`,
              `Isn't it true that your report omits [contradicting fact]?`,
            ]
          : role === "expert"
            ? [
                `Your methodology has a known error rate of ___, correct?`,
                `Other qualified experts disagree with your conclusion, don't they?`,
                `You were retained and paid by [party], correct?`,
              ]
            : [
                `Your prior statement on [date] said something different, didn't it?`,
                `You've discussed your testimony with counsel before today, correct?`,
                `You cannot rule out [alternative explanation], can you?`,
              ];

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

  return profiles;
}

// ---------------------------------------------------------------------------
// LEGAL ISSUE SPOTTING (Task 8)
// ---------------------------------------------------------------------------
export type LegalIssueHit = {
  issue: string;
  indicator: string;
  document: string;
  quote: string;
  significance: string;
  next_step: string;
  // Optional — populated only when buildLegalIssuesWithCaseLaw() is used
  // instead of buildLegalIssues(). Left undefined otherwise, so nothing
  // that reads this type without knowing about case_law breaks.
  case_law?: Array<{
    case_name: string;
    citation: string | null;
    court: string | null;
    date_filed: string | null;
    url: string;
    snippet: string;
  }>;
};

// REBUILT 2026-07-29: replaces the prior ISSUE_RULES, which detected and
// generated next-step guidance for U.S. federal criminal procedure
// (Fourth Amendment, Miranda, Franks, Brady, Jencks, FRE 901/902/702) —
// none of which exist in Mexican penal procedure. This platform is
// "Built exclusively for Mexican law" per its own README; the prior
// table meant a real Mexican penal case running through buildWorkProduct()
// could receive "File motion to suppress; request Franks hearing" or
// "Serve Brady demand" as generated next steps — legal mechanisms with no
// standing in a CNPP proceeding.
//
// Every rule below is grounded in CPEUM/CNPP:
//   - Cateo y Detención: CPEUM Art. 16 (orden judicial fundada y
//     motivada, salvo flagrancia o caso urgente); violations can support
//     exclusión de prueba ilícita (CPEUM Art. 20, apartado A, fracción
//     IX; CNPP Art. 97).
//   - Declaración del Imputado sin Garantías: CPEUM Art. 20, apartado B
//     (derecho a guardar silencio, asistencia de defensor desde la
//     detención).
//   - Irregularidad en Solicitud de Cateo: CNPP arts. 282–284 (requisitos
//     de la solicitud y orden de cateo).
//   - Omisión en el Deber de Aportación Probatoria: CPEUM Art. 21
//     (principio de objetividad del Ministerio Público — no solo debe
//     buscar la condena) together with CNPP Art. 218–219 (deber de
//     poner a disposición de la defensa los registros de la
//     investigación).
//   - Declaraciones Previas de Testigo: entrevistas registradas en la
//     carpeta de investigación, usadas para contrainterrogatorio conforme
//     a las técnicas de litigación oral del CNPP (arts. 375–386) — there
//     is no Mexican grand jury and no direct Jencks-Act equivalent; this
//     is the actual functional analogue.
//   - Cadena de Custodia: CNPP arts. 227–230.
//   - Fundamentación Probatoria: licitud e incorporación de la prueba en
//     juicio oral (CNPP Art. 357 and surrounding provisions).
//   - Impugnación Pericial: CNPP arts. 368–372 (dictamen pericial,
//     acreditación del perito, metodología).
//
// Article citations here are the general provisions governing each
// mechanism, not a substitute for verifying against the specific case
// file — same caveat this platform already applies to every other
// generated citation.
const ISSUE_RULES: Array<{
  issue: string;
  indicator: RegExp;
  description: string;
  significance: string;
  next_step: string;
}> = [
  {
    issue: "Cateo y Detención",
    indicator:
      /\b(orden\s+de\s+cateo|cateo\s+sin\s+orden|detenci[oó]n\s+sin\s+orden|flagrancia|caso\s+urgente|control\s+de\s+detenci[oó]n|aseguramiento\s+de\s+bienes)\b/i,
    description: "Orden de cateo, detención, flagrancia, caso urgente",
    significance:
      "Todo cateo o detención requiere orden judicial fundada y motivada, salvo flagrancia o caso urgente (Art. 16 CPEUM). Los indicios obtenidos en un cateo o detención irregulares pueden excluirse como prueba ilícita (Art. 20, apartado A, fracción IX, CPEUM; Art. 97 CNPP).",
    next_step:
      "Promover incidente de exclusión de prueba ilícita ante el Juez de Control; solicitar la comparecencia del elemento aprehensor en audiencia de control de detención.",
  },
  {
    issue: "Declaración del Imputado sin Garantías",
    indicator:
      /\b(declaraci[oó]n\s+sin\s+defensor|coacci[oó]n\s+en\s+declaraci[oó]n|renuncia\s+al\s+derecho\s+a\s+guardar\s+silencio|entrevista\s+sin\s+abogado|declaraci[oó]n\s+ministerial\s+sin\s+asistencia)\b/i,
    description: "Declaración del imputado, asistencia de defensor, derecho a guardar silencio",
    significance:
      "El imputado tiene derecho a guardar silencio y a la asistencia de un defensor desde el momento de su detención (Art. 20, apartado B, CPEUM). Una declaración obtenida sin estas garantías es nula y no puede utilizarse en su contra.",
    next_step:
      "Promover la exclusión de la declaración por violación al derecho de defensa adecuada; solicitar se declare la nulidad del acto ante el Juez de Control.",
  },
  {
    issue: "Irregularidad en Solicitud de Cateo",
    indicator:
      /\b(datos\s+falsos\s+en\s+cateo|omisi[oó]n\s+sustancial\s+en\s+cateo|solicitud\s+de\s+cateo\s+irregular)\b/i,
    description: "Datos falsos u omisiones sustanciales en la solicitud de cateo",
    significance:
      "La solicitud y orden de cateo deben cumplir los requisitos del Art. 282 y siguientes del CNPP. Si se acredita que la solicitud contuvo datos falsos u omitió información sustancial, la orden y sus frutos pueden invalidarse.",
    next_step:
      "Impugnar la legalidad del cateo ante el Juez de Control; solicitar la comparecencia del solicitante para acreditar la irregularidad.",
  },
  {
    issue: "Omisión en el Deber de Aportación Probatoria",
    indicator:
      /\b(dato\s+de\s+prueba\s+no\s+revelado|prueba\s+no\s+desahogada|ocultamiento\s+de\s+evidencia|omisi[oó]n\s+probatoria|acuerdo\s+de\s+colaboraci[oó]n\s+no\s+revelado)\b/i,
    description: "Datos de prueba no revelados, acuerdos de colaboración no divulgados",
    significance:
      "El Ministerio Público debe conducirse con objetividad y no únicamente buscar la condena (Art. 21 CPEUM); la carpeta de investigación debe ponerse a disposición de la defensa (Art. 218–219 CNPP). La ocultación de datos favorables a la defensa vulnera el derecho de defensa adecuada.",
    next_step:
      "Solicitar al Juez de Control que requiera al Ministerio Público la exhibición íntegra de la carpeta de investigación; promover incidente por omisión en el deber de aportación probatoria.",
  },
  {
    issue: "Declaraciones Previas de Testigo",
    indicator:
      /\b(entrevista\s+previa|declaraci[oó]n\s+previa\s+del\s+testigo|notas\s+de\s+entrevista|declaraci[oó]n\s+inconsistente)\b/i,
    description: "Entrevistas previas del testigo registradas en la carpeta de investigación",
    significance:
      "Las entrevistas previas registradas en la carpeta de investigación, si son contradictorias con el testimonio rendido en juicio oral, pueden emplearse para impugnar la credibilidad del testigo durante el contrainterrogatorio (Art. 375–386 CNPP).",
    next_step:
      "Solicitar copia de las entrevistas previas del testigo para preparar el contrainterrogatorio y evidenciar contradicciones.",
  },
  {
    issue: "Cadena de Custodia",
    indicator:
      /\b(cadena\s+de\s+custodia|registro\s+de\s+cadena\s+de\s+custodia|sello\s+roto|manejo\s+de\s+indicios|laguna\s+en\s+custodia)\b/i,
    description: "Manejo de indicios, vacíos en la documentación de custodia",
    significance:
      "La cadena de custodia debe documentarse conforme a los Arts. 227–230 del CNPP. Las rupturas no explicadas afectan el valor probatorio del indicio y pueden fundar su exclusión.",
    next_step:
      "Solicitar el registro completo de cadena de custodia; promover la exclusión del indicio si existen rupturas no explicadas.",
  },
  {
    issue: "Fundamentación Probatoria",
    indicator:
      /\b(licitud\s+de\s+la\s+prueba|incorporaci[oó]n\s+de\s+prueba|prueba\s+superveniente|fundamentaci[oó]n\s+probatoria)\b/i,
    description: "Licitud e incorporación de la prueba al juicio oral",
    significance:
      "Todo medio de prueba debe incorporarse al juicio oral conforme a las reglas del CNPP (Art. 357 y correlativos); la prueba obtenida o incorporada sin cumplir estos requisitos carece de valor probatorio.",
    next_step:
      "Objetar la incorporación de la prueba por falta de licitud o fundamentación; exigir la comparecencia del custodio o generador del medio de prueba.",
  },
  {
    issue: "Impugnación Pericial",
    indicator:
      /\b(dictamen\s+pericial|metodolog[ií]a\s+pericial|perito\s+sin\s+acreditaci[oó]n|error\s+de\s+laboratorio)\b/i,
    description: "Metodología del dictamen pericial, acreditación del perito",
    significance:
      "El dictamen pericial debe sustentarse en una metodología reconocida y el perito debe estar debidamente acreditado (Arts. 368–372 CNPP). Un dictamen con deficiencias metodológicas puede impugnarse y perder valor probatorio.",
    next_step:
      "Promover la impugnación del dictamen pericial por deficiencia metodológica; ofrecer perito de la defensa conforme al Art. 368 del CNPP.",
  },
];

export async function buildLegalIssues(db: Db, caseId: string): Promise<LegalIssueHit[]> {
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
      // Grab surrounding context as the quote.
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

// Same as buildLegalIssues(), but also attaches real SCJN/CJF
// jurisprudencia (via legal_authorities, see case-law.server.ts) to each
// detected issue. Kept as a separate function so every existing caller
// of buildLegalIssues() is completely unaffected. Fails soft: if case
// law lookup fails for any reason, issues are returned exactly as
// buildLegalIssues() would have returned them.
export async function buildLegalIssuesWithCaseLaw(db: Db, caseId: string): Promise<LegalIssueHit[]> {
  const issues = await buildLegalIssues(db, caseId);
  if (!issues.length) return issues;
  try {
    const { attachCaseLaw } = await import("./case-law.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caseRow } = await (db as any).from("cases").select("case_type").eq("id", caseId).maybeSingle();
    const materia = (caseRow as { case_type?: string } | null)?.case_type ?? undefined;
    return await attachCaseLaw(db, issues, materia);
  } catch (err) {
    console.warn("[legal-issues] case law attachment failed, returning issues without it:", err);
    return issues;
  }
}

// ---------------------------------------------------------------------------
// EVIDENCE INVENTORY (Task 9)
// Enumerate every extracted document as an evidence item, deriving what it
// shows / supports / weaknesses / discovery status from filename + doc-type
// heuristics + finding references. Deterministic, no LLM.
// ---------------------------------------------------------------------------
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

type InvRule = {
  match: RegExp;
  item: string;
  shows: string;
  theory: string;
  weakness: string;
  needed: string;
};

const INV_RULES: InvRule[] = [
  // Mexican evidence inventory. Patterns match Spanish filings; the columns
  // describe value, procedural theory, weakness and what is still needed under
  // Mexican law. The previous table was U.S. federal practice (302 memos, MLAT
  // requests, IRS §6103, Franks/Carpenter, grand jury, PCAST) and matched
  // almost nothing in a Mexican expediente.
  {
    match: /\b(estado\s+de\s+cuenta|estados\s+de\s+cuenta|movimientos\s+bancarios|cuenta\s+bancaria)\b/i,
    item: "Estados de cuenta bancarios",
    shows: "Flujo de recursos y actividad de la cuenta",
    theory: "Acreditación patrimonial / defraudación",
    weakness: "Requiere perfeccionamiento y ratificación por la institución",
    needed: "Informe de la institución bancaria vía CNBV o requerimiento judicial",
  },
  {
    match: /\b(whatsapp|telegram|imessage|mensajes?\s+de\s+texto|sms|capturas?\s+de\s+pantalla)\b/i,
    item: "Registros de mensajería",
    shows: "Intención, planeación y coordinación entre las partes",
    theory: "Dolo / acuerdo de voluntades",
    weakness: "Capturas sin metadatos no son fiables; posible objeción de autenticidad",
    needed: "Extracción forense con hash y registro de cadena de custodia",
  },
  {
    match: /\b(cfdi|factura|comprobante\s+fiscal|contabilidad|p[oó]liza\s+contable|declaraci[oó]n\s+anual)\b/i,
    item: "Comprobantes fiscales y contabilidad",
    shows: "Operaciones registradas, ingresos y deducciones",
    theory: "Materialidad de operaciones / crédito fiscal",
    weakness: "Presunción de inexistencia de operaciones (art. 69-B CFF)",
    needed: "Documentación soporte de materialidad y opinión de cumplimiento SAT",
  },
  {
    match: /\b(pagar[eé]|t[ií]tulo\s+de\s+cr[eé]dito|letra\s+de\s+cambio|contrato\s+de\s+cr[eé]dito)\b/i,
    item: "Título de crédito o contrato mercantil",
    shows: "Obligación exigible y monto reclamado",
    theory: "Acción cambiaria / cumplimiento de contrato",
    weakness: "Objeción de firma, prescripción y requisitos del art. 170 LGTOC",
    needed: "Documento original y, en su caso, dictamen en documentoscopía",
  },
  {
    match: /\b(bit[aá]cora|libro\s+de\s+actas|libro\s+mayor|memor[aá]ndum\s+interno)\b/i,
    item: "Bitácora o libros internos",
    shows: "Patrón de conducta y decisiones internas",
    theory: "Conducta reiterada / responsabilidad corporativa",
    weakness: "Elaboración unilateral; posible autofavorecimiento",
    needed: "Documentos corroborantes y ratificación de quien los elaboró",
  },
  {
    match: /\b(correo\s+electr[oó]nico|oficio|carta|comunicaci[oó]n\s+escrita)\b/i,
    item: "Correspondencia y oficios",
    shows: "Conocimiento, notificación y reconocimiento de hechos",
    theory: "Notificación / confesión extrajudicial",
    weakness: "Requiere acreditar autoría y recepción",
    needed: "Hilo completo con encabezados o acuse de recibo",
  },
  {
    match: /\b(transferencia|spei|clave\s+de\s+rastreo|remesa)\b/i,
    item: "Comprobantes de transferencia",
    shows: "Movimiento de recursos entre cuentas",
    theory: "Origen y destino de los recursos",
    weakness: "Sin clave de rastreo no se acredita la operación",
    needed: "Comprobante con clave de rastreo e informe de la institución",
  },
  {
    match: /\b(videovigilancia|cctv|videograbaci[oó]n|c[aá]mara\s+de\s+seguridad|video)\b/i,
    item: "Videovigilancia",
    shows: "Presencia física y conducta registrada",
    theory: "Identificación / dinámica de los hechos",
    weakness: "Sincronización horaria y continuidad de la cadena de custodia",
    needed: "Archivo original con hash y registro de cadena de custodia",
  },
  {
    match: /\b(geolocalizaci[oó]n|s[aá]bana\s+de\s+llamadas|antena|radiobases|gps)\b/i,
    item: "Geolocalización y registros de telefonía",
    shows: "Ubicación aproximada del dispositivo",
    theory: "Ubicación en el lugar de los hechos",
    weakness: "Cobertura por sector; exige autorización judicial previa (art. 303 CNPP)",
    needed: "Autorización judicial y perito en telefonía",
  },
  {
    match: /\b(gen[eé]tic[ao]|adn|serolog[ií]a|muestra\s+de\s+sangre)\b/i,
    item: "Dictamen genético / serológico",
    shows: "Identificación biológica",
    theory: "Identificación",
    weakness: "Interpretación de mezclas; riesgo de contaminación",
    needed: "Revisión por perito de la contraparte de las notas de laboratorio",
  },
  {
    match: /\b(dactilosc[oó]pic[ao]|huella|lof[oó]scop[ií]a)\b/i,
    item: "Dictamen dactiloscópico",
    shows: "Contacto físico con el objeto",
    theory: "Identificación",
    weakness: "Metodología comparativa con margen de subjetividad",
    needed: "Verificación independiente por perito de la contraparte",
  },
  {
    match: /\b(bal[ií]stic[ao]|arma\s+de\s+fuego|rodizonato|residuos\s+de\s+disparo)\b/i,
    item: "Dictamen en balística",
    shows: "Vinculación del arma con los hechos",
    theory: "Empleo de arma de fuego",
    weakness: "Subjetividad en el cotejo de marcas",
    needed: "Perito independiente y registro de cadena de custodia del arma",
  },
  {
    match: /\b(narc[oó]tico|sustancia\s+controlada|qu[ií]mic[ao]|dictamen\s+de\s+laboratorio)\b/i,
    item: "Dictamen químico de sustancias",
    shows: "Identidad y peso de la sustancia",
    theory: "Narcomenudeo / delitos contra la salud",
    weakness: "Protocolo de muestreo y calibración del instrumental",
    needed: "Notas de laboratorio y constancias de calibración",
  },
  {
    match: /\b(expediente\s+cl[ií]nico|nota\s+m[eé]dica|hospital|necropsia|certificado\s+m[eé]dico)\b/i,
    item: "Documentación médica",
    shows: "Lesiones, mecánica y causa de la muerte",
    theory: "Lesiones / nexo causal",
    weakness: "Requiere interpretación pericial y ratificación",
    needed: "Ratificación del médico y perito de la contraparte",
  },
  {
    match: /\b(entrevista|comparecencia|declaraci[oó]n|testimonial)\b/i,
    item: "Registro de entrevista o declaración",
    shows: "Manifestaciones previas de la persona",
    theory: "Corroboración / contradicción con lo declarado en juicio",
    weakness: "Registro incompleto o no textual",
    needed: "Registro íntegro y, en su caso, audio o video de la entrevista",
  },
  {
    match: /\b(orden\s+de\s+cateo|autorizaci[oó]n\s+judicial|orden\s+de\s+aprehensi[oó]n)\b/i,
    item: "Orden o autorización judicial",
    shows: "Fundamento del acto de molestia",
    theory: "Licitud de la prueba (arts. 16 CPEUM, 264 CNPP)",
    weakness: "Falta de fundamentación, motivación o exceso en su ejecución",
    needed: "Orden completa y acta de la diligencia con inventario",
  },
  {
    match: /\b(carpeta\s+de\s+investigaci[oó]n|denuncia|querella|acusaci[oó]n)\b/i,
    item: "Carpeta de investigación / acusación",
    shows: "Hechos imputados y teoría del caso de la Fiscalía",
    theory: "Teoría del caso de la parte acusadora",
    weakness: "Registros incompletos o descubrimiento probatorio parcial",
    needed: "Descubrimiento probatorio íntegro (arts. 337-340 CNPP)",
  },
  {
    match: /\b(escritura\s+p[uú]blica|certificado\s+de\s+libertad\s+de\s+gravamen|folio\s+real|catastro)\b/i,
    item: "Instrumentos y constancias registrales",
    shows: "Titularidad, gravámenes y situación registral del inmueble",
    theory: "Acreditación de la propiedad",
    weakness: "Constancias vencidas o inscripciones pendientes",
    needed: "Certificado vigente del RPP y constancias de no adeudo",
  },
  {
    match: /\b(recibo\s+de\s+n[oó]mina|contrato\s+individual\s+de\s+trabajo|aviso\s+de\s+rescisi[oó]n|imss|control\s+de\s+asistencia)\b/i,
    item: "Documentación laboral",
    shows: "Relación de trabajo, salario y condiciones",
    theory: "Acreditación de la relación laboral (art. 784 LFT)",
    weakness: "Carga de la prueba a cargo del patrón; documentos sin firma",
    needed: "Expediente laboral completo y constancias del IMSS",
  },
];

function ruleFor(filename: string, headText: string): InvRule | null {
  const blob = `${filename}\n${headText.slice(0, 2000)}`;
  for (const r of INV_RULES) if (r.match.test(blob)) return r;
  return null;
}

export async function buildEvidenceInventory(db: Db, caseId: string): Promise<EvidenceInventoryItem[]> {
  const [{ data: docs }, { data: findings }] = await Promise.all([
    db.from("documents").select("id,filename,extracted_text,status").eq("case_id", caseId),
    db.from("case_findings").select("source_document_id,source_doc_ids,category,title").eq("case_id", caseId),
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
    const item = rule?.item ?? "Document";
    const shows = rule?.shows ?? "Case background / context";
    const theory = rule?.theory ?? "General";
    const weakness = rule?.weakness ?? "Foundation / relevance";
    const needed = rule?.needed ?? "Custodian testimony if authenticity contested";

    let status: DiscoveryStatus;
    let statusNote: string;
    if (!extracted) {
      status = "missing";
      statusNote =
        d.status === "extracted"
          ? "Uploaded but text unreadable — re-scan at higher DPI."
          : `Not extracted (status=${d.status ?? "unknown"}).`;
    } else if ((findingsByDoc.get(id) ?? 0) === 0) {
      status = "partial";
      statusNote = "Extracted but no engine cited it — verify coverage or request supplemental production.";
    } else {
      status = "complete";
      statusNote = `Cited by ${findingsByDoc.get(id)} finding(s).`;
    }

    items.push({
      item,
      source_document: filename,
      what_it_shows: shows,
      supports_theory: theory,
      weakness_or_gap: weakness,
      what_is_needed: needed,
      status,
      status_note: statusNote,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// ATTORNEY WORK PRODUCT (Task 10)
// Template-driven assembly from findings + legal issues + witness profiles.
// Never invents content — every line ties to a finding, an issue, or a
// witness profile that already exists in the report.
// ---------------------------------------------------------------------------
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

// REBUILT 2026-07-29: matches the new ISSUE_RULES keys above. Mexican
// oral-adversarial procedure works through incidentes and solicitudes
// before the Juez de Control, not "motions" in the U.S. sense — the
// labels below use the actual CNPP procedural vehicle for each issue.
const MOTION_MAP: Record<string, string> = {
  "Cateo y Detención": "Incidente de Exclusión de Prueba Ilícita (Cateo/Detención)",
  "Declaración del Imputado sin Garantías": "Incidente de Exclusión de Declaración",
  "Irregularidad en Solicitud de Cateo": "Impugnación de Legalidad de Cateo",
  "Omisión en el Deber de Aportación Probatoria": "Incidente por Omisión en el Deber de Aportación Probatoria",
  "Declaraciones Previas de Testigo": "Solicitud de Entrevistas Previas para Contrainterrogatorio",
  "Cadena de Custodia": "Incidente de Exclusión — Cadena de Custodia",
  "Fundamentación Probatoria": "Objeción a la Incorporación de Prueba",
  "Impugnación Pericial": "Impugnación de Dictamen Pericial",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildWorkProduct(
  db: Db,
  caseId: string,
  ctx: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    legalIssues?: any[];
    witnessProfiles?: WitnessProfile[];
  } = {},
): Promise<WorkProduct> {
  const { data: findings } = await db
    .from("case_findings")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("title,description,category,affected_party,severity,evidence_type,source_document_id,source_page" as any)
    .eq("case_id", caseId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (findings ?? []) as any[];
  const defenseFav = rows.filter(
    (f) => f.affected_party === "prosecution" || f.evidence_type === "exculpatory" || f.evidence_type === "impeachment",
  );
  const prosFav = rows.filter((f) => f.affected_party === "defense" || f.evidence_type === "inculpatory");

  const strongest = [...defenseFav].sort((a, b) => {
    const sev = (s: string) =>
      (({ critical: 0, high: 1, medium: 2, low: 3, info: 4 }) as Record<string, number>)[s] ?? 4;
    return sev(String(a.severity)) - sev(String(b.severity));
  })[0];

  const case_strategy = strongest
    ? `The strongest defense theory is grounded in ${String(strongest.category ?? "the record")
        .toString()
        .toLowerCase()}: ${String(strongest.title ?? "").trim()}. This should anchor motion practice and cross-examination while contesting the prosecution's theory head-on.`
    : "Insufficient defense-favorable findings to state a single dominant theory. Prioritize additional discovery and expert review before committing to a strategy.";

  const strengths = defenseFav.slice(0, 8).map((f) => ({
    text: String(f.title ?? "Defense-favorable finding"),
    citation: citationOf(f),
  }));
  const weaknesses = prosFav.slice(0, 8).map((f) => ({
    text: String(f.title ?? "Prosecution-favorable finding"),
    citation: citationOf(f),
  }));

  const issues = ctx.legalIssues ?? [];
  const seenMotion = new Set<string>();
  const motion_opportunities: WorkProduct["motion_opportunities"] = [];
  for (const iss of issues) {
    const motion = MOTION_MAP[String(iss.issue)] ?? `Motion regarding ${iss.issue}`;
    const key = `${motion}::${iss.document}`;
    if (seenMotion.has(key)) continue;
    seenMotion.add(key);
    motion_opportunities.push({
      motion,
      basis: String(iss.significance ?? iss.indicator ?? ""),
      source_document: String(iss.document ?? ""),
    });
  }

  const themeSeeds = defenseFav
    .slice(0, 5)
    .map((f) => `${String(f.title ?? "").trim()} — ${String(f.category ?? "").toLowerCase()}.`);
  const trial_themes = themeSeeds.length
    ? themeSeeds
    : ["Reasonable doubt anchored in the gaps and inconsistencies in the government's proof."];

  const cross_examination_outlines: CrossOutline[] = (ctx.witnessProfiles ?? [])
    .filter((w) => w.impeachment_opportunities.length > 0 || w.cross_questions.length > 0)
    .slice(0, 20)
    .map((w) => ({
      witness: w.name,
      topics: [...w.impeachment_opportunities.slice(0, 3), ...w.cross_questions.slice(0, 3)].slice(0, 5),
    }));

  const jury_themes: string[] = [];
  if (defenseFav.some((f) => /credibility|impeach|bias|cooperat/i.test(`${f.title} ${f.category}`))) {
    jury_themes.push("The government's case rests on witnesses with reasons to shade the truth.");
  }
  if (issues.some((i) => i.issue === "Chain of Custody" || i.issue === "Authentication")) {
    jury_themes.push("Reliable evidence has a clean paper trail. This evidence does not.");
  }
  if (issues.some((i) => i.issue === "Brady" || i.issue === "Jencks")) {
    jury_themes.push("A case built on selective disclosure is not a case built on truth.");
  }
  if (!jury_themes.length) {
    jury_themes.push(
      "Assumptions are not evidence — the government must prove every element beyond a reasonable doubt.",
    );
  }

  return {
    case_strategy,
    strengths,
    weaknesses,
    motion_opportunities,
    trial_themes,
    cross_examination_outlines,
    jury_themes,
  };
}
