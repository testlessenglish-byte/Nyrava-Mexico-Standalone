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

// Names we consider witnesses when scanning free text.
const WITNESS_TITLE_RE =
  /\b(?:CW-\d+|Detective|Det\.|Officer|Sergeant|Sgt\.|Lieutenant|Lt\.|Special Agent|Agent|Dr\.|Doctor|Professor|Prof\.|Deputy|Investigator|Sheriff)\s+[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)?\b/g;
const PROPER_NAME_RE = /\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b/g;

function roleFor(name: string, text: string): string {
  const n = name.toLowerCase();
  const t = text.toLowerCase();
  if (/^cw-\d+/i.test(name)) return "cooperating witness";
  if (/(victim|complainant)/.test(t) && t.includes(n)) return "victim";
  if (/(detective|officer|sergeant|lieutenant|deputy|agent|investigator|sheriff)/.test(name.toLowerCase()))
    return "investigator";
  if (/(doctor|dr\.|professor|prof\.|expert)/i.test(name)) return "expert";
  if (/defendant|accused/.test(t) && t.includes(n)) return "defendant";
  return "witness";
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

const ISSUE_RULES: Array<{
  issue: string;
  indicator: RegExp;
  description: string;
  significance: string;
  next_step: string;
}> = [
  {
    issue: "Fourth Amendment",
    indicator:
      /\b(search\s+warrant|warrantless|probable\s+cause|no[- ]knock|consent\s+to\s+search|expectation\s+of\s+privacy)\b/i,
    description: "Search warrant language, warrantless search, probable cause",
    significance: "Fruits of an unlawful search may be suppressed under the exclusionary rule.",
    next_step: "File motion to suppress; request Franks hearing if affidavit misstates facts.",
  },
  {
    issue: "Miranda",
    indicator: /\b(miranda|custodial\s+interrogation|waiver\s+of\s+rights|confession|self[- ]incrimination)\b/i,
    description: "Custodial interrogation, confession, waiver",
    significance: "Statements obtained without a valid Miranda waiver are inadmissible in the case-in-chief.",
    next_step: "Move to suppress the statement; demand Jackson-Denno / voluntariness hearing.",
  },
  {
    issue: "Franks",
    indicator: /\b(false\s+statement|material\s+omission|reckless\s+disregard|affiant\s+knew)\b/i,
    description: "False statements in warrant affidavit",
    significance: "Warrant may be voided if affiant knowingly or recklessly misstated material facts.",
    next_step: "Request Franks hearing and subpoena affiant.",
  },
  {
    issue: "Brady",
    indicator:
      /\b(exculpatory|impeach(?:ment|ing)|witness\s+deal|immunity|informant\s+file|cooperation\s+agreement)\b/i,
    description: "Exculpatory evidence, witness deals, immunity",
    significance: "Suppression of exculpatory or impeachment material by the prosecution violates due process.",
    next_step: "Serve Brady demand; move to compel production and preservation.",
  },
  {
    issue: "Jencks",
    indicator: /\b(prior\s+statement|grand\s+jury\s+testimony|interview\s+notes|302|rough\s+notes)\b/i,
    description: "Prior witness statements, inconsistent statements",
    significance: "Under 18 U.S.C. § 3500 the government must produce witnesses' prior statements after direct.",
    next_step: "Serve Jencks demand and preserve objection at trial before cross-examination.",
  },
  {
    issue: "Chain of Custody",
    indicator: /\b(chain\s+of\s+custody|evidence\s+log|seal(?:ed|ing)|tamper|storage\s+gap|missing\s+seal)\b/i,
    description: "Evidence handling, gaps in documentation",
    significance: "Breaks in custody go to weight and can support exclusion or a limiting instruction.",
    next_step: "Depose evidence custodian; move in limine to exclude or limit foundation.",
  },
  {
    issue: "Authentication",
    indicator:
      /\b(authenticat|foundation|hearsay|business\s+records?\s+exception|self[- ]authenticating|best\s+evidence)\b/i,
    description: "Business records, hearsay exceptions, foundation",
    significance: "Documents lacking foundation are inadmissible under FRE 901/902.",
    next_step: "Object to admission; require live custodian testimony.",
  },
  {
    issue: "Expert Admissibility",
    indicator: /\b(daubert|frye|methodology|error\s+rate|peer[- ]review|qualifications)\b/i,
    description: "Methodology, qualifications, Daubert/Frye",
    significance: "Unreliable expert methodology is inadmissible under FRE 702 / Daubert.",
    next_step: "File Daubert motion; retain rebuttal expert.",
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

// Same as buildLegalIssues(), but also attaches real case law (via
// CourtListener) to each detected issue. Kept as a separate function so
// every existing caller of buildLegalIssues() is completely unaffected.
// Fails soft: if case law lookup fails for any reason, issues are
// returned exactly as buildLegalIssues() would have returned them.
export async function buildLegalIssuesWithCaseLaw(db: Db, caseId: string): Promise<LegalIssueHit[]> {
  const issues = await buildLegalIssues(db, caseId);
  if (!issues.length) return issues;
  try {
    const { attachCaseLaw } = await import("./case-law.server");
    const { courtIdsForJurisdiction } = await import("./jurisdictions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caseRow } = await (db as any).from("cases").select("jurisdiction").eq("id", caseId).maybeSingle();
    const courtIds = courtIdsForJurisdiction(caseRow?.jurisdiction ?? null);
    return await attachCaseLaw(issues, courtIds);
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
  {
    match: /\b(bank\s+statement|bank\s+records|account\s+statement)\b/i,
    item: "Bank Records",
    shows: "Money trail / account activity",
    theory: "Financial Fraud",
    weakness: "Authentication as business record",
    needed: "Custodian affidavit or testimony",
  },
  {
    match: /\b(whatsapp|signal|telegram|imessage|text\s+messages?|sms)\b/i,
    item: "Messaging App Records",
    shows: "Intent, planning, coordination",
    theory: "Conspiracy / Intent",
    weakness: "Metadata gaps; unauthenticated screenshots",
    needed: "Forensic extraction with hash + custody log",
  },
  {
    match: /\b(coinbase|binance|kraken|blockchain|crypto|wallet\s+address)\b/i,
    item: "Cryptocurrency Records",
    shows: "Movement of funds / laundering",
    theory: "Financial Crime",
    weakness: "Custodian testimony; wallet attribution",
    needed: "Subpoena compliance certificate + chain analysis",
  },
  {
    match: /\b(journal|ledger|diary|memo\s+to\s+file|cfo\s+notes)\b/i,
    item: "Internal Journal / Ledger",
    shows: "Pattern of conduct",
    theory: "Criminal Conduct / Fraud Pattern",
    weakness: "Cooperating-witness bias; self-serving entries",
    needed: "Corroborating documents",
  },
  {
    match: /\b(email|correspondence|letter)\b/i,
    item: "Email / Correspondence",
    shows: "State of mind, notice, admissions",
    theory: "Intent / Notice",
    weakness: "Hearsay unless party-opponent or business record",
    needed: "Full thread with headers",
  },
  {
    match: /\b(wire\s+transfer|swift|ach|remittance)\b/i,
    item: "Wire Transfer Records",
    shows: "Cross-account fund movement",
    theory: "Wire Fraud / Money Laundering",
    weakness: "Foreign bank cooperation",
    needed: "MLAT request or subpoena to correspondent bank",
  },
  {
    match: /\b(tax\s+return|1099|k[- ]1|w[- ]2|irs)\b/i,
    item: "Tax Records",
    shows: "Unreported income / discrepancies",
    theory: "Tax Fraud",
    weakness: "Section 6103 disclosure limits",
    needed: "IRS ex parte order or taxpayer consent",
  },
  {
    match: /\b(surveillance|cctv|video|body\s+cam|dashcam)\b/i,
    item: "Video Surveillance",
    shows: "Physical presence / conduct",
    theory: "Identification",
    weakness: "Time-sync and chain of custody",
    needed: "Native file + hash + custody log",
  },
  {
    match: /\b(cell\s+site|cslr|tower\s+dump|ping|geolocation|gps\s+log)\b/i,
    item: "Cell-Site / Geolocation",
    shows: "Device location",
    theory: "Presence at Scene",
    weakness: "Sector overlap; Carpenter warrant requirements",
    needed: "Warrant + expert testimony",
  },
  {
    match: /\b(dna|serology|blood\s+sample)\b/i,
    item: "DNA / Serology",
    shows: "Biological identification",
    theory: "Identification",
    weakness: "Mixture interpretation; transfer / contamination",
    needed: "Defense expert review of lab notes",
  },
  {
    match: /\b(fingerprint|latent\s+print|afis)\b/i,
    item: "Latent Prints",
    shows: "Physical contact",
    theory: "Identification",
    weakness: "Subjective ACE-V methodology",
    needed: "Blind verification / defense expert",
  },
  {
    match: /\b(firearm|ballistic|toolmark|gsr|gunshot\s+residue)\b/i,
    item: "Firearms / Ballistics",
    shows: "Weapon linkage",
    theory: "Use of Weapon",
    weakness: "Toolmark subjectivity (PCAST 2016)",
    needed: "Independent examiner",
  },
  {
    match: /\b(drug|narcotic|controlled\s+substance|lab\s+report)\b/i,
    item: "Controlled-Substance Analysis",
    shows: "Substance identity / weight",
    theory: "Possession / Distribution",
    weakness: "Sampling protocol; instrument calibration",
    needed: "Bench notes + calibration logs",
  },
  {
    match: /\b(medical\s+record|hospital\s+chart|ems|autopsy)\b/i,
    item: "Medical Records",
    shows: "Injury / cause of death",
    theory: "Injury / Causation",
    weakness: "Hearsay; expert interpretation",
    needed: "Custodian affidavit; defense medical expert",
  },
  {
    match: /\b(interview|proffer|debrief|302|memo\s+of\s+interview)\b/i,
    item: "Witness Interview Notes",
    shows: "Prior statements",
    theory: "Impeachment / Corroboration",
    weakness: "Selective note-taking; missing verbatim",
    needed: "Rough notes + audio if any",
  },
  {
    match: /\b(search\s+warrant|warrant\s+affidavit|application\s+for\s+search)\b/i,
    item: "Search Warrant + Affidavit",
    shows: "Basis for search / seizure",
    theory: "Suppression",
    weakness: "Franks issues; staleness; overbreadth",
    needed: "Full affidavit + return inventory",
  },
  {
    match: /\b(indictment|information|complaint\b)\b/i,
    item: "Charging Document",
    shows: "Elements charged; theory of the case",
    theory: "Prosecution Theory",
    weakness: "Notice / duplicity issues",
    needed: "Bill of particulars if vague",
  },
  {
    match: /\b(grand\s+jury)\b/i,
    item: "Grand Jury Transcript",
    shows: "Prior sworn testimony",
    theory: "Impeachment",
    weakness: "Ex parte proceeding; leading questions",
    needed: "Complete transcript + exhibit list",
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

const MOTION_MAP: Record<string, string> = {
  "Fourth Amendment": "Motion to Suppress (Fourth Amendment / Franks)",
  Miranda: "Motion to Suppress Statement (Miranda / Jackson-Denno)",
  Franks: "Motion for Franks Hearing",
  Brady: "Motion to Compel Brady / Giglio Material",
  Jencks: "Demand for Jencks / 3500 Material",
  "Chain of Custody": "Motion in Limine — Chain of Custody",
  Authentication: "Motion in Limine — Authentication / Foundation",
  "Expert Admissibility": "Daubert Motion to Exclude Expert",
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
