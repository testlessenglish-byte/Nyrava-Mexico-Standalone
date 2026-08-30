import type { ReactNode } from "react";

export type ProductPageContent = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  what: string;
  how: string[];
  benefits: string[];
  workflow: { title: string; description: string }[];
  examples: { title: string; description: string }[];
  bestPractices: string[];
  attorneyResponsibilities: string[];
  limitations: string[];
  scenarios: { title: string; description: string }[];
  faqs: { q: string; a: string }[];
  related: { label: string; to: string; description?: string }[];
  next?: { label: string; to: string };
};

const RELATED_ALL = {
  evidence: { label: "Evidence Intelligence", to: "/product/evidence-intelligence", description: "Grounded fact extraction from the corpus." },
  timeline: { label: "Timeline Intelligence", to: "/product/timeline-intelligence", description: "Automatic chronology with cited events." },
  witness: { label: "Witness Intelligence", to: "/product/witness-intelligence", description: "Cluster statements, surface contradictions." },
  constitutional: { label: "Constitutional Intelligence", to: "/product/constitutional-intelligence", description: "Issue-spot the record." },
  motion: { label: "Motion Intelligence", to: "/product/motion-intelligence", description: "First-draft motions grounded in evidence." },
  report: { label: "Report Intelligence", to: "/product/report-intelligence", description: "Canonical 17-section case analysis." },
  trust: { label: "Trust Center", to: "/trust", description: "How Nyrava handles sensitive case data." },
  ai: { label: "AI Transparency", to: "/ai-transparency", description: "Where AI is used and its limitations." },
  responsible: { label: "Responsible AI", to: "/responsible-ai", description: "Principles for evidence-grounded analysis." },
  security: { label: "Security Practices", to: "/security", description: "Authentication, authorization, encryption." },
  data: { label: "Data Control", to: "/data-control", description: "Export, delete, and manage workspace data." },
  care: { label: "Atención Integral", to: "/product/comprehensive-care", description: "Gestión de Casos Sociales, Planes de Cuidado y privacidad multinivel." },
  support: { label: "Apoyo Comunitario", to: "/product/community-support", description: "Campañas seguras, aportaciones en especie y donaciones verificadas." },
  talk: { label: "Hablar con el Caso de Atención", to: "/product/talk-to-cases", description: "Consulta conversacional fundamentada en el expediente social autorizado." },
};

export const PRODUCTS: ProductPageContent[] = [

  {
    slug: "evidence-intelligence",
    title: "Evidence Intelligence",
    eyebrow: "Product",
    description:
      "Turn a case corpus into a structured, cited, reviewable evidence map. Every fact is anchored to a source document.",
    what:
      "Evidence Intelligence ingests every document in a matter — pleadings, the expediente, transcripts, medical records, exhibits, notes — and produces a structured index of the factual assertions those documents contain. Each extracted fact is anchored to the specific passage it came from so an attorney can verify it in one click. It is the foundation on which every downstream engine (timeline, witness, constitutional, motion, report) is built.",
    how: [
      "Documents are extracted and normalized. Scanned PDFs and images pass through OCR so that photographed reports and handwritten notes become searchable text.",
      "The corpus is chunked and indexed. A retrieval layer maintains embeddings for every passage so the model can look up support before writing anything.",
      "Extraction engines identify entities, events, statements, and factual claims, tagging each with the document, page, and paragraph it appeared in.",
      "An evidence gate suppresses any claim the retrieval layer cannot ground back to a source passage. Suppressions are logged in the pipeline ledger for review.",
      "Findings are written to your workspace with citation metadata attached so downstream engines can reuse them without regenerating.",
    ],
    benefits: [
      "Stop losing facts across thousands of pages of expediente.",
      "Every claim is verifiable — click a citation to jump to the source.",
      "Downstream analyses reuse the same grounded facts.",
      "Ungrounded model output is rejected before it reaches a report.",
    ],
    workflow: [
      { title: "Create a case", description: "Give the matter a name and case type (materia)." },
      { title: "Upload the corpus", description: "Drag in the full expediente. OCR runs automatically on scans." },
      { title: "Run analysis", description: "Evidence Intelligence extracts and indexes the record." },
      { title: "Review findings", description: "Open the Evidence panel and verify each cited claim." },
    ],
    examples: [
      { title: "Responsabilidad Civil", description: "Reconstruct a traffic-accident sequence from the parte de tránsito, peritaje en tránsito terrestre, and medical admission notes." },
      { title: "Derecho Penal", description: "Surface every mention of the imputado's rights during detention across the informe policial homologado, video de la audiencia de control de detención, and declaración ministerial." },
      { title: "Derecho Laboral", description: "Pull every performance-related statement from personnel files and WhatsApp/email threads, with dates and authors, to support or rebut a despido justificado." },
    ],
    bestPractices: [
      "Upload the entire expediente, not curated excerpts — downstream contradiction detection depends on it.",
      "Label documents clearly (número de foja, quién los aportó) so citations resolve unambiguously in a filing.",
      "Rerun extraction after supplemental filings so the evidence index stays current.",
      "Review the evidence panel before moving to motion drafting — the gate is stricter earlier than later.",
    ],
    attorneyResponsibilities: [
      "Verify each cited claim against the source before relying on it.",
      "Redact privileged material before uploading to a shared workspace.",
      "Confirm that OCR-derived text matches the original where the extraction is close-call.",
      "Retain final judgment on what constitutes admissible or material evidence.",
    ],
    limitations: [
      "OCR accuracy on very low-quality scans or dense handwriting may require attorney correction.",
      "Extraction quality depends on document structure — heavily tabular exhibits can require secondary review.",
      "Attribution of statements to a specific speaker is inferred from context and is not infallible.",
    ],
    scenarios: [
      { title: "Ampliaciones al expediente", description: "Add supplemental documents mid-case; rerun extraction to refresh the evidence index without losing prior citations." },
      { title: "Cross-witness reconciliation", description: "Feed the evidence output into Witness Intelligence to see who said what about the same subject across the record." },
    ],
    faqs: [
      { q: "How large a corpus can I upload?", a: "Case sizes in the thousands of pages are typical. Very large expedientes can be uploaded in batches — each batch triggers incremental indexing." },
      { q: "Does it work on scanned PDFs?", a: "Yes. OCR runs automatically on image-based pages and photographed exhibits." },
      { q: "What happens to claims the model can't ground?", a: "They are suppressed by the evidence gate and never surface to a report. The suppression is written to the pipeline ledger so reviewers can see what was rejected and why." },
      { q: "Are claims cited to a specific page or paragraph?", a: "Both. Citations include document, page, and the paragraph or passage the claim was drawn from." },
    ],
    related: [RELATED_ALL.timeline, RELATED_ALL.witness, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.trust, RELATED_ALL.ai],
    next: { label: "Timeline Intelligence", to: "/product/timeline-intelligence" },
  },
  {
    slug: "timeline-intelligence",
    title: "Timeline Intelligence",
    eyebrow: "Product",
    description:
      "Reconstruct the case timeline automatically from the record, with every event cited to its source.",
    what:
      "Timeline Intelligence assembles a chronological view of the matter from the extracted evidence. Each event carries the date, the actors involved, and citations back to the document(s) that placed it there. Conflicting dates across sources are flagged as contradictions rather than silently resolved.",
    how: [
      "Extracted events and statements from Evidence Intelligence are normalized to ISO dates where possible.",
      "Events are clustered by subject, actor, and location.",
      "Date conflicts between sources are surfaced as contradictions instead of being averaged away.",
      "The timeline can be filtered by actor, document, or subject and exported to PDF for a court binder.",
    ],
    benefits: [
      "See the case chronology at a glance.",
      "Every date is cited — nothing is invented.",
      "Conflicting timelines across witnesses become visible immediately.",
    ],
    workflow: [
      { title: "Run Evidence Intelligence first", description: "The timeline is projected from grounded evidence." },
      { title: "Open the Timeline panel", description: "The chronological view is generated automatically." },
      { title: "Filter and export", description: "Filter by actor or subject; export a court-ready PDF." },
    ],
    examples: [
      { title: "Responsabilidad Médica", description: "Assemble a minute-by-minute emergency-room timeline from clinical records, the informe de responsabilidad, and expert affidavit." },
      { title: "Amparo Directo", description: "Reconstruct procedural history across the expediente and audiencias for the fact section of a demanda de amparo directo." },
    ],
    bestPractices: [
      "Include ambient documents (bitácoras, registros de acceso, listas de asistencia) — they anchor dates that testimony alone leaves ambiguous.",
      "Review contradictions early; an unresolved date conflict often signals an impeachment opportunity.",
      "Export the filtered view rather than the full timeline when preparing a specific audiencia.",
    ],
    attorneyResponsibilities: [
      "Confirm the date each event resolved to matches the source.",
      "Decide whether a conflict is a genuine dispute, a transcription error, or a witness memory issue.",
      "Retain edited timelines under the workspace's normal work-product controls.",
    ],
    limitations: [
      "Approximate dates (\"principios de abril\") are placed heuristically and flagged as low-confidence.",
      "Time zones in raw records are treated as-written unless a document declares otherwise.",
    ],
    scenarios: [
      { title: "Preparación de audiencia", description: "Export a witness-filtered timeline before a desahogo de prueba testimonial to see every date that witness placed on the record." },
      { title: "Argumento de secuencia", description: "Use the exported chronology as the factual backbone of an escrito de alegatos." },
    ],
    faqs: [
      { q: "What if two documents disagree on a date?", a: "The disagreement becomes a contradiction entry rather than a silent choice, with both sources cited." },
      { q: "Can I edit the timeline?", a: "Yes. Attorney edits are preserved and marked so the source-derived version is never overwritten silently." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.witness, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.ai],
    next: { label: "Witness Intelligence", to: "/product/witness-intelligence" },
  },
  {
    slug: "witness-intelligence",
    title: "Witness Intelligence",
    eyebrow: "Product",
    description:
      "Cluster every statement and testimony across the case record, compare accounts, and surface inconsistencies.",
    what:
      "Witness Intelligence groups statements by witness and by subject. It compares what each witness said in different documents and highlights inconsistencies, corroborations, and gaps that a cross-examiner or an escrito de tacha needs to see.",
    how: [
      "Statements attributed to a witness are pulled from every document in the corpus.",
      "Statements are clustered by subject so the same topic across declaraciones, entrevistas, and testimoniales is grouped.",
      "Contradiction detection compares statements within a single witness and across witnesses.",
      "Each conflict is presented with both source passages side by side and cited.",
    ],
    benefits: [
      "See every version of a witness's story on one screen.",
      "Cross-witness contradictions surface automatically.",
      "Foundation for cross-examination outlines and tacha memos.",
    ],
    workflow: [
      { title: "Load witness documents", description: "Declaraciones, entrevistas, testimoniales, actas, transcripts." },
      { title: "Open the Witness panel", description: "Witnesses are listed with statement counts and conflict flags." },
      { title: "Drill into a witness", description: "Statements clustered by subject with citations to source." },
    ],
    examples: [
      { title: "Uso Excesivo de la Fuerza", description: "Compare officer statements across the informe policial homologado, bitácora de C5, and declaración ministerial." },
      { title: "Derecho Familiar", description: "Reconcile parent statements across the informe de trabajo social, denuncia de violencia familiar, and financial disclosures in a custody/alimony matter." },
    ],
    bestPractices: [
      "Upload prior sworn testimony from unrelated matters when it's already in your possession — it strengthens impeachment clustering.",
      "Review speaker attributions on transcripts with speaker-tag noise before relying on the cluster.",
      "Use the exported cross-witness comparison as a starting point, not a finished cross outline.",
    ],
    attorneyResponsibilities: [
      "Confirm every statement attribution before using it in cross.",
      "Preserve the underlying source document alongside any impeachment excerpt.",
      "Weigh materiality — not every inconsistency is worth impeachment.",
    ],
    limitations: [
      "Speaker attribution on ambiguous transcripts is inferred and can be wrong.",
      "Statements paraphrased in third-party reports are labeled as such but may lose nuance.",
    ],
    scenarios: [
      { title: "Preparación de contrainterrogatorio", description: "Filter to a single witness and export a subject-clustered brief with every citation prewired." },
      { title: "Estrategia de desahogo", description: "Identify subjects the witness has not testified about but that appear in the record." },
    ],
    faqs: [
      { q: "How does Nyrava know a statement belongs to a witness?", a: "Speaker attribution is inferred from surrounding text (etiquetas de declarante, hablantes en la transcripción, firmas de declaración) and every attribution is cited so you can verify." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.timeline, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.ai],
    next: { label: "Constitutional Intelligence", to: "/product/constitutional-intelligence" },
  },
  {
    slug: "constitutional-intelligence",
    title: "Constitutional Intelligence",
    eyebrow: "Product",
    description:
      "Identify constitutional and human-rights issues in the record — illegal detention, unlawful search, the right to an adequate defense, due process — with citations back to the facts and to the CPEUM and applicable treaties.",
    what:
      "Constitutional Intelligence scans the record for facts that implicate constitutional doctrine under the Constitución Política de los Estados Unidos Mexicanos (CPEUM) and applicable international human-rights treaties, and drafts an initial analysis for attorney review. It cites both the triggering facts and the doctrinal framework applied — control de constitucionalidad and control de convencionalidad ex officio.",
    how: [
      "Facts are matched against pattern libraries for common constitutional issues under Mexican law (arts. 14, 16, 19, and 20 CPEUM: debido proceso, cateo sin orden, detención arbitraria, prueba ilícita, derecho de defensa adecuada).",
      "Each identified issue is drafted with the triggering facts and citations to the CPEUM article, jurisprudencia, and applicable treaty.",
      "Attorney review is required before any output is used in a filing.",
    ],
    benefits: [
      "Catch constitutional issues you might overlook in a large expediente.",
      "See the fact pattern and the doctrine side-by-side.",
      "Foundation for a demanda de amparo or an incidente de exclusión de prueba ilícita.",
    ],
    workflow: [
      { title: "Analyze the case", description: "Ensure Evidence Intelligence has run." },
      { title: "Open the Constitutional panel", description: "Issues are grouped by CPEUM article and severity." },
      { title: "Draft a motion", description: "Export an issue as the seed of an amparo or exclusion-of-evidence draft." },
    ],
    examples: [
      { title: "Derecho Penal", description: "Analysis of article 16 CPEUM on a cateo without a judicial order and of article 20 on a declaración taken without defense counsel present." },
      { title: "Derechos Humanos", description: "Excessive use of force and authority liability under article 1 CPEUM and inter-American jurisprudencia." },
    ],
    bestPractices: [
      "Feed the constitutional output into Motion Intelligence to draft an amparo or an exclusión de prueba grounded in the same facts.",
      "Attach video de audiencia and body-worn/C5 footage when available — they materially change the analysis.",
      "Use the exported issue list as a checklist, not as a finished demanda.",
    ],
    attorneyResponsibilities: [
      "Verify every doctrinal citation against controlling jurisprudencia (SCJN, Tribunales Colegiados) for your circuito.",
      "Confirm the fact pattern the model relied on before advancing it.",
      "Decide whether raising a constitutional issue is strategically appropriate.",
    ],
    limitations: [
      "Pattern libraries reflect federal CPEUM doctrine plus the most commonly litigated jurisprudencia; niche local/estatal variants may need manual expansion.",
      "The model does not evaluate procedural bars (preclusión, consentimiento tácito) automatically.",
    ],
    scenarios: [
      { title: "Preparación de amparo", description: "Chain from Constitutional Intelligence to Motion Intelligence to produce a first draft of a demanda de amparo with facts and authorities aligned." },
      { title: "Exclusión probatoria", description: "Use identified illegal-search or coerced-statement issues as the seed for an incidente de exclusión de prueba ilícita." },
    ],
    faqs: [
      { q: "Does this replace legal research?", a: "No. It surfaces issues in the expediente and provides doctrinal starting points anchored to the CPEUM and jurisprudencia. Legal research and briefing remain the attorney's responsibility." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.responsible, RELATED_ALL.trust],
    next: { label: "Motion Intelligence", to: "/product/motion-intelligence" },
  },
  {
    slug: "motion-intelligence",
    title: "Motion Intelligence",
    eyebrow: "Product",
    description:
      "Draft promociones and escritos grounded in the case record, with citations to evidence and to authority verified before they reach the draft.",
    what:
      "Motion Intelligence produces a first-draft promoción — hechos, derecho, and petitorio — grounded in the case record. Every factual assertion in the draft cites the underlying document. Every authority citation is verified against a legal-research provider before it reaches the draft.",
    how: [
      "You choose a filing type (incidente de exclusión de prueba, amparo, recurso, etc.).",
      "Motion Intelligence assembles the statement of facts from grounded evidence.",
      "The argument section is drafted with authorities pulled and verified.",
      "The full draft is written to a Motion Editor you can revise and export.",
    ],
    benefits: [
      "Cut hours off the first-draft cycle.",
      "Every factual assertion is cited to the record.",
      "Attorney remains the drafter of record.",
    ],
    workflow: [
      { title: "Pick a filing type", description: "Choose from the supported promoción library." },
      { title: "Review the draft", description: "The Motion Editor opens with the generated draft." },
      { title: "Revise and export", description: "Export to PDF for filing prep." },
    ],
    examples: [
      { title: "Incidente de Exclusión de Prueba Ilícita", description: "Draft grounded in the acta de cateo/detención, video de audiencia, and dictamen pericial." },
    ],
    bestPractices: [
      "Confirm your órgano jurisdiccional's preferred format before exporting — the editor supports jurisdiction-specific headers you should set.",
      "Use the draft as scaffolding; substantive editing remains the attorney's work.",
      "Regenerate specific sections rather than entire drafts when refining tone or emphasis.",
    ],
    attorneyResponsibilities: [
      "Verify every jurisprudencia and tesis citation is still vigente (not superada or contradicha) before filing.",
      "Confirm each factual citation resolves to the passage cited.",
      "Sign only what you would have written yourself.",
    ],
    limitations: [
      "The supported filing library is limited to the types listed in the app; other types are on the roadmap.",
      "Local court formalities are not applied automatically; verify page limits, formatting, and carátulas.",
    ],
    scenarios: [
      { title: "Promoción urgente", description: "Assemble a factual statement quickly from the record before drafting the argument by hand." },
      { title: "Escritos de contestación", description: "Feed the contraparte's promoción in and generate a responsive first draft against the same evidence base." },
    ],
    faqs: [
      { q: "Are authority citations verified?", a: "Yes. Fabricated citations are rejected before appearing in the draft." },
      { q: "Do I still need to verify authority myself?", a: "Yes. Attorneys must independently verify that jurisprudencia and tesis are still vigente for their circuito before filing." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.constitutional, RELATED_ALL.report, RELATED_ALL.responsible, RELATED_ALL.trust],
    next: { label: "Report Intelligence", to: "/product/report-intelligence" },
  },
  {
    slug: "report-intelligence",
    title: "Report Intelligence",
    eyebrow: "Product",
    description:
      "Assemble a case-wide analysis report with 17 fixed sections, scored, cited, and export-ready.",
    what:
      "Report Intelligence synthesizes the outputs of every engine — evidence, timeline, witnesses, contradictions, constitutional, motion, strategy — into a single canonical case analysis. The report structure is version-locked at 1.0.0 and includes 17 sections covering facts, issues, evidence, opposing-party analysis, and recommended next steps.",
    how: [
      "Every engine writes into a canonical analysis object rather than into free-form prose.",
      "A validation gate confirms that all 17 sections are populated with grounded content before the report can be finalized.",
      "The report is exported to PDF or JSON.",
    ],
    benefits: [
      "One consistent format across every matter.",
      "Grounded, cited, and reviewable end-to-end.",
      "Version-locked so downstream tooling can rely on the schema.",
    ],
    workflow: [
      { title: "Run the full pipeline", description: "All upstream engines populate the canonical analysis." },
      { title: "Open the Report panel", description: "The 17 sections render with citations." },
      { title: "Export", description: "PDF or JSON, with pagination optimized for court binders." },
    ],
    examples: [
      { title: "Juicio de Nulidad ante el TFJA", description: "Report includes analysis of the resolución determinante, factual reconstruction, and legal issues with cited authorities." },
    ],
    bestPractices: [
      "Rerun the report after adding supplemental documents so the canonical analysis stays fresh.",
      "Use the JSON export for downstream tooling (case-management imports, internal dashboards).",
      "Prefer the PDF export for client-facing packets; pagination is tuned for print binders.",
    ],
    attorneyResponsibilities: [
      "Review every section before sharing externally.",
      "Redact or refactor sections that include work-product or privileged analysis.",
      "Decide which sections belong in client communications versus internal case files.",
    ],
    limitations: [
      "The 17-section schema is frozen at v1.0.0; adding sections requires documented approval.",
      "Scoring reflects internal heuristics and should not be treated as an assessment of case value.",
    ],
    scenarios: [
      { title: "Case intake review", description: "Generate a report immediately after intake to structure early strategy discussions." },
      { title: "Settlement prep", description: "Use the report as an internal reference for the strengths/weaknesses discussion before a mediation or conciliación." },
    ],
    faqs: [
      { q: "Can I add or remove sections?", a: "The 17-section schema is frozen at v1.0.0 to keep the format consistent. New sections require documented business justification and explicit approval." },
      { q: "Can I export raw JSON?", a: "Yes. The canonical analysis can be exported as JSON for downstream tooling." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.timeline, RELATED_ALL.witness, RELATED_ALL.motion, RELATED_ALL.trust, RELATED_ALL.data],
  },
  {
    slug: "corporate",
    title: "Corporate Law Intelligence",
    eyebrow: "Practice Area",
    description:
      "Governance, mergers & acquisitions (fusiones y adquisiciones), and due-diligence analysis grounded in your corporate record — under the Ley General de Sociedades Mercantiles (LGSM) and the Código de Comercio. Same 17-section canonical report, corporate-flavored content.",
    what:
      "Corporate Law Intelligence adapts the Nyrava engine to transactional and governance matters — acta constitutiva, estatutos sociales, libro de actas, actas de asamblea de accionistas and de consejo de administración, contratos de compraventa de acciones o activos, convenios entre accionistas, and due-diligence productions. It reuses every universal engine (evidence extraction, timeline reconstruction, contradiction detection, discovery-gap analysis, verification, hallucination detection) and specializes the finding modules, motion families, terminology, and legal-standards prompt to Mexican corporate law (LGSM, Código de Comercio, and, for public companies, the Ley del Mercado de Valores). Findings render into the same locked 17-section canonical report — Executive Summary, Findings, Risks, Attorney Action Center, Work Product, etc. — with corporate content instead of criminal or civil.",
    how: [
      "Upload the corporate corpus: acta constitutiva, estatutos sociales, libro de actas, actas de asamblea de accionistas y del consejo de administración, libro de registro de acciones, contratos de compraventa de acciones o activos, convenios entre accionistas, expedientes de due diligence.",
      "Extraction identifies governance events (acuerdos de asamblea, resoluciones del consejo, aumentos o reducciones de capital), entity structure (administradores, comisario, accionistas, partes relacionadas), and financial-terms language (garantías, indemnizaciones, condiciones suspensivas, cláusulas de no competencia).",
      "Practice-area gating routes corporate-only finding modules (deber de diligencia y de lealtad de los administradores, quórum y formalidades de asamblea, derecho de preferencia, contradicciones en el libro de actas, responsabilidad de administradores) to the analyzers while suppressing criminal-only agents.",
      "Contradiction detection compares the same event across actas, resoluciones, disclosure schedules, and management presentations to surface acuerdos sin quórum, missing signatures, and inconsistent representations.",
      "The report generator writes the standard 17 sections using the Mexican corporate legal-standards block (LGSM, Código de Comercio, Ley del Mercado de Valores when applicable, deber de diligencia y lealtad, responsabilidad de administradores).",
    ],
    benefits: [
      "One evidence-grounded workspace for governance review, due diligence, and deal-related dispute posture.",
      "Every governance conclusion is cited to a specific acta, resolución, or contractual clause.",
      "Missing quórum, gaps in the libro de actas, and backdated approvals are surfaced explicitly instead of glossed over.",
      "Corporate work product (draft resoluciones, requerimientos de información, disclosure-schedule corrections) reuses the same verification pipeline as litigation work.",
    ],
    workflow: [
      { title: "Create a corporate matter", description: "Pick 'Derecho Mercantil (gobierno corporativo, M&A, due diligence)' as the case type." },
      { title: "Upload the corporate record", description: "Acta constitutiva, estatutos, actas de asamblea, contratos, convenios, expedientes de due diligence." },
      { title: "Run analysis", description: "Extraction, evidence intelligence, timeline, contradictions, discovery gaps, corporate findings, and verification run end-to-end." },
      { title: "Review the report", description: "Same 17 canonical sections, corporate content — Executive Summary → Findings → Risks → Attorney Action Center → Work Product → Appendices." },
    ],
    examples: [
      { title: "Revisión de gobierno corporativo", description: "Reconcile actas de consejo against resoluciones and convenios de accionistas to surface missing approvals, backdating, and unauthorized officer actions." },
      { title: "Due diligence de M&A", description: "Cross-check the disclosure schedules against the underlying corporate record; flag misalignment between the representations in the contrato de compraventa and the source documents." },
      { title: "Requerimiento de información a accionistas", description: "Structure a minority shareholder's information request and the responsive production around the specific right invoked under the LGSM." },
      { title: "Responsabilidad de administradores", description: "Assemble the factual predicate for a claim against administradores for breach of the deber de diligencia or de lealtad before drafting the demanda." },
    ],
    bestPractices: [
      "Upload the full libro de actas, not just the resolutions — deliberation records defeat or support a business-judgment defense.",
      "Include the estatutos sociales for every entity in the structure; corporate-only findings need the actual governance instrument.",
      "Attach the disclosure schedules with the purchase agreement — representations and schedules must be analyzed together.",
      "For minority-shareholder work, upload the request, the response, and any prior correspondence in the same corpus.",
    ],
    attorneyResponsibilities: [
      "Confirm the corporate form (S.A. de C.V., S. de R.L. de C.V., S.A.P.I., etc.) and applicable statute before relying on any LGSM-flavored analysis.",
      "Verify administrador independence and conflicts of interest against the current corporate record, not the model's inference.",
      "Independently confirm that any deber de diligencia/lealtad framing is supported by the specific factual predicate Mexican case law requires.",
      "Do not file corporate work product without human review of every citation to a bylaw, agreement section, or governance document.",
    ],
    limitations: [
      "Corporate Law Intelligence renders into the frozen 17-section canonical report — it does not produce a bespoke governance-only template.",
      "The engine assumes a Sociedad Anónima de Capital Variable when the corpus does not specify the corporate form; it flags this assumption but does not choose the form for you.",
      "Analysis of Ley del Mercado de Valores obligations applies only when the corpus indicates a public/listed issuer.",
      "The verification pipeline suppresses fabricated board actions; it will not invent actas or resoluciones that are missing from the record.",
    ],
    scenarios: [
      { title: "Diligencia previa a la firma", description: "Score governance risk before the carta de intención so deal terms can be negotiated with a real evidentiary basis." },
      { title: "Disputas post-cierre", description: "Reconstruct the pre-closing record from the data-room production when a claim under the representations arises." },
      { title: "Defensa ante requerimiento de accionista minoritario", description: "Prepare a defensible response to an information request grounded in the actual corporate record." },
    ],
    faqs: [
      { q: "Does Nyrava replace corporate counsel for board advice?", a: "No. Corporate Law Intelligence is an analysis and drafting tool for licensed counsel. Every governance conclusion must be reviewed by an attorney before use." },
      { q: "Which corporate form does the engine assume?", a: "Sociedad Anónima de Capital Variable (S.A. de C.V.) by default, with the assumption flagged in the report. When the corpus specifies a different form (S. de R.L., S.A.P.I., etc.), the engine defers to the applicable rules under the LGSM." },
      { q: "Does it work for sociedades de responsabilidad limitada?", a: "Yes. The engine treats S. de R.L. matters as contract-first (estatutos sociales), then applies the LGSM's default rules for that corporate form." },
      { q: "Can I draft board resolutions from it?", a: "Yes. Draft resoluciones and actas render into the Work Product section of the canonical report, with citations to the underlying corporate record." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.timeline, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.trust, RELATED_ALL.ai],
  },
  {
    slug: "commercial",
    title: "Business & Commercial Law Intelligence",
    eyebrow: "Practice Area",
    description:
      "Contract disputes, compraventa mercantil, business torts, and trade-secret matters — analyzed inside Nyrava's 17-section canonical report with commercial-specific findings, motions, and standards under the Código de Comercio and the Código Civil Federal.",
    what:
      "Business & Commercial Law Intelligence adapts the Nyrava engine to the everyday work of commercial litigators and transactional counsel: breach-of-contract disputes, compraventa mercantil matters, warranty and vicios-ocultos claims, competencia desleal, secretos industriales misappropriation, and non-compete enforcement. It reuses every universal engine — evidence extraction, timeline reconstruction, contradiction detection, discovery-gap analysis, cross-examination scaffolding, verification, and hallucination suppression — and specializes the finding modules, motion families, and legal-standards prompt to contract-first analysis grounded in the actual written agreement, course of dealing, and communications record. Findings render into the same locked 17-section canonical report used across every practice area, with commercial content instead of criminal or governance.",
    how: [
      "Upload the commercial corpus: the master contract, purchase orders, invoices, acknowledgments, negotiation emails, notice-of-breach letters, cure demands, termination correspondence, damage models, and any prior-course-of-dealing documentation.",
      "Extraction tags every clause of the agreement (integración, notificación, limitación de responsabilidad, ley aplicable, jurisdicción o arbitraje) so downstream engines know which arguments are actually available on the record.",
      "Practice-area gating routes commercial-only finding modules (incumplimiento total vs. parcial, análisis de entrega conforme, cláusula penal, garantías y vicios ocultos, elementos de competencia desleal) while suppressing criminal-only agents.",
      "Contradiction detection cross-checks representations across the contract, invoices, POs, and email negotiations to surface course-of-dealing disputes and shifting damage theories.",
      "The report generator writes the standard 17 sections using the Mexican commercial legal-standards block (Código de Comercio, Código Civil Federal or estatal as supletorio, cláusula penal, teoría de la imprevisión, and the Ley Federal de Protección a la Propiedad Industrial for secretos industriales).",
    ],
    benefits: [
      "One evidence-grounded workspace for contract analysis, breach posture, damages theory, and pre-litigation strategy.",
      "Every commercial conclusion is cited to a specific clause, invoice, PO, or dated communication — no free-floating characterizations.",
      "Missing notices, expired cure windows, and undisclosed vicios ocultos are surfaced explicitly instead of assumed away.",
      "Commercial work product (demandas, requerimientos de pago, solicitudes de medidas cautelares for trade-secret matters) reuses the same verification pipeline as litigation work.",
    ],
    workflow: [
      { title: "Create a commercial matter", description: "Pick 'Derecho Mercantil (contratos, competencia desleal)' as the case type." },
      { title: "Upload the commercial record", description: "Contract, POs, invoices, negotiation emails, notice-of-breach letters, damage models." },
      { title: "Run analysis", description: "Extraction, evidence intelligence, timeline, contradictions, discovery gaps, commercial findings, cross-examination prep, and verification run end-to-end." },
      { title: "Review the report", description: "Same 17 canonical sections, commercial content — Executive Summary → Findings → Risks → Attorney Action Center → Work Product → Appendices." },
    ],
    examples: [
      { title: "Postura de incumplimiento contractual", description: "Reconcile the contract, cure correspondence, and performance record to determine incumplimiento total vs. parcial and whether the non-breaching party's own duties were excused." },
      { title: "Compraventa mercantil — vicios ocultos", description: "Analyze every purchase order, acknowledgment, and inspection record to determine whether the delivered goods conformed to the contract." },
      { title: "Apropiación de secretos industriales", description: "Assemble the factual predicate for a medida cautelar — reasonable secrecy measures, improper means, and independent economic value." },
      { title: "Defensa de competencia desleal", description: "Test whether the alleged conduct meets the elements of competencia desleal under Mexican law, not merely aggressive competition." },
    ],
    bestPractices: [
      "Upload the fully-integrated contract and every convenio modificatorio — the integration clause governs what parol evidence is admissible.",
      "Include the full email negotiation thread; contract-formation and dolo/error analysis both depend on the order of documents.",
      "Attach every notice of breach, cure demand, and termination letter with dates intact — cure-period math is dispositive on many claims.",
      "For secretos industriales matters, upload the confidentiality-policy documents and secrecy-measure evidence alongside the alleged misappropriation record.",
    ],
    attorneyResponsibilities: [
      "Confirm the governing law and forum-selection (jurisdicción o arbitraje) provision before relying on any state-specific commercial analysis.",
      "Verify the applicable prescripción (statute of limitations) for the forum before advancing any tort theory that overlaps with a breach claim.",
      "Independently confirm the enforceability of any arbitration, limitation-of-liability, or non-compete clause under Mexican law.",
      "Do not file commercial work product without human review of every citation to a contract section, statutory provision, or case authority.",
    ],
    limitations: [
      "Business & Commercial Law Intelligence renders into the frozen 17-section canonical report — it does not produce a bespoke commercial-only template.",
      "The engine defers to the written agreement's choice-of-law clause; when the corpus is silent, it flags the assumption rather than choosing law for you.",
      "Warranty and vicios-ocultos analysis assumes the written terms in the corpus control — post-hoc oral modifications require separate corroboration.",
      "The verification pipeline suppresses fabricated communications; it will not invent notices or cure demands that are missing from the record.",
    ],
    scenarios: [
      { title: "Postura prelitigiosa", description: "Score breach exposure and damages ceiling before sending a requerimiento de pago so settlement negotiations start from an evidentiary basis." },
      { title: "Solicitud de medida cautelar", description: "Assemble the trade-secret or non-compete predicate — probable success, irreparable harm, and balance of interests." },
      { title: "Arbitraje vs. tribunal", description: "Determine whether the dispute falls inside the arbitration clause's scope and whether any carve-outs apply." },
    ],
    faqs: [
      { q: "Does Nyrava replace commercial trial counsel?", a: "No. Business & Commercial Law Intelligence is an analysis and drafting tool for licensed counsel. Every conclusion must be reviewed by an attorney before use." },
      { q: "Which law does the engine apply to a compraventa mercantil?", a: "The engine follows the choice-of-law clause when the corpus specifies one, defaulting to the Código de Comercio and, where it is silent, the applicable Código Civil as supletorio." },
      { q: "Can it handle mixed goods-and-services contracts?", a: "Yes. The engine applies the dominant-purpose test under Mexican doctrine to decide whether compraventa mercantil or service-contract rules govern, and flags the analysis explicitly." },
      { q: "Can I draft complaints and motions from it?", a: "Yes. Draft demandas, requerimientos de pago, and solicitudes de medidas cautelares render into the Work Product section of the canonical report with citations to the underlying commercial record." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.timeline, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.trust, RELATED_ALL.ai],
  },
  {
    slug: "comprehensive-care",
    title: "Atención Integral (Comprehensive Care)",
    eyebrow: "Product",
    description:
      "Plataforma multidisciplinaria para la gestión integral de casos sociales, planes de cuidado, red de canalización institucional y privacidad confidencial por niveles.",
    what:
      "Atención Integral es el entorno operativo diseñado para equipos de trabajo social, defensores de derechos humanos y organizaciones comunitarias. Permite gestionar el ciclo de vida completo del caso social (ingesta, valoración de riesgo en 7 dimensiones, planes de cuidado por metas, intervenciones, canalizaciones a instituciones públicas y privadas, y consentimiento informado), manteniendo una separación estricta de expedientes generales, sociales, jurídicos, psicosociales, médicos y de protección de menores.",
    how: [
      "Recepción y registro estructurado de casos con folios correlativos automáticos (INT-YYYY-XXXX) y triaje de urgencia.",
      "Valoración multidimensional de riesgo y factores de protección en 7 ejes: seguridad, vivienda, salud, psicosocial, legal, nutrición y situación migratoria.",
      "Planes de cuidado orientados a objetivos con registro cronológico de intervenciones, servicios directos y reconocimientos de supervisión.",
      "Red de canalización institucional con directorio gestionado de organismos públicos mexicanos (DIF, CEAV, INM, COMAR, Fiscalías) y seguimiento de respuestas.",
      "Privacidad confidencial en 6 niveles (General, Trabajo Social, Legal Privilegiado, Psicosocial, Médico y Protección de la Infancia) con verificación de consentimiento.",
      "Asistente Talk to Care Case para análisis contextual, detección de vacíos de atención y preparación de formatos y actas administrativas mexicanas.",
    ],
    benefits: [
      "Visibilidad completa y coordinada de la atención multidisciplinaria sin mezclar registros sensibles.",
      "Trazabilidad estricta con historial inmutable de revisiones de riesgo y planes de cuidado.",
      "Canalizaciones seguras a instituciones oficiales con control de consentimiento antes de la divulgación.",
      "Informes institucionales de auditoría e impacto con firma digital SHA-256 para donantes y autoridades.",
    ],
    workflow: [
      { title: "Ingesta y Triaje", description: "Registro inicial de la necesidad, asignación de folio y priorización de urgencia por el supervisor." },
      { title: "Valoración Multidimensional", description: "Evaluación estructurada de riesgos y factores de protección con historial de versiones." },
      { title: "Plan de Cuidado e Intervenciones", description: "Definición de metas, hitos, asignación de responsables y registro de apoyos directos." },
      { title: "Canalización y Seguimiento", description: "Emisión de paquetes de derivación a instituciones del directorio y registro de resultados." },
    ],
    examples: [
      { title: "Atención a Familias y Niñez", description: "Coordinación de apoyo nutricional, estudio socioeconómico y vinculación con DIF bajo nivel de protección infantil restringido." },
      { title: "Acompañamiento a Refugiados y Migrantes", description: "Enlace entre el caso social y el trámite de asilo ante COMAR o regularización migratoria ante INM con consentimiento informado." },
      { title: "Protección Psicosocial y Legal", description: "Intervención ante violencia familiar con resguardo de notas clínicas psicosociales y coordinación de medidas cautelares de protección." },
    ],
    bestPractices: [
      "Registrar el consentimiento informado antes de generar paquetes de canalización externa o compartir documentos.",
      "Utilizar los niveles de registro restringidos (médico, psicosocial, protección de menores) para salvaguardar notas sensibles.",
      "Ejecutar la verificación de salud del caso (Case Health Check) periódicamente para detectar tareas vencidas o valoraciones pendientes.",
      "Documentar el cierre formal del caso con resumen de metas cumplidas y aprobación del supervisor responsable.",
    ],
    attorneyResponsibilities: [
      "Verificar la veracidad de los datos socioeconómicos y consentimientos proporcionados por los titulares.",
      "Respetar las limitaciones éticas y legales en la divulgación de información confidencial de beneficiarios.",
      "Supervisar que las canalizaciones a dependencias públicas cumplan con las leyes mexicanas aplicables.",
    ],
    limitations: [
      "El asistente Talk to Care Case asiste en la redacción y síntesis; no sustituye la valoración profesional clínica o de trabajo social.",
      "La disponibilidad de servicios en la red institucional depende de cada organismo público o privado en su demarcación territorial.",
    ],
    scenarios: [
      { title: "Derivación Institucional Urgente", description: "Generar un oficio de canalización con antecedentes estructurados y resguardo de datos personales confidenciales." },
      { title: "Auditoría de Rendición de Cuentas", description: "Exportar el informe de impacto institucional con resumen de servicios, metas alcanzadas y verificación criptográfica SHA-256." },
    ],
    faqs: [
      { q: "¿Cómo se protege la información psicosocial y médica?", a: "Se resguarda bajo niveles de acceso restringido (6 niveles de privacidad) que impiden el acceso a personal no autorizado o su inclusión en reportes generales." },
      { q: "¿Requiere consentimiento informado para compartir datos?", a: "Sí. El sistema exige un registro de consentimiento activo y vigente antes de permitir la emisión de paquetes de derivación externa." },
      { q: "¿Quién puede generar reportes institucionales?", a: "La generación de informes de auditoría institucional y de rendición de cuentas está reservada exclusivamente a la cuenta del suscriptor principal." },
    ],
    related: [RELATED_ALL.support, RELATED_ALL.talk, RELATED_ALL.report, RELATED_ALL.trust, RELATED_ALL.security],
    next: { label: "Apoyo Comunitario", to: "/product/community-support" },
  },
  {
    slug: "community-support",
    title: "Apoyo Comunitario (Community Support)",
    eyebrow: "Product",
    description:
      "Plataforma de campañas solidarias, aportaciones en especie, servicios profesionales y recaudación externa autorizada con protección integral de la identidad.",
    what:
      "Apoyo Comunitario permite a las organizaciones gestionar campañas de asistencia social para necesidades individuales de casos o programas comunitarios institucionales. Facilita la recepción de donaciones en especie (alimentos, ropa, enseres, útiles escolares, medicamentos), servicios profesionales voluntarios y recaudación financiera mediante enlaces a destinos externos configurados y autorizados (como GoFundMe), manteniendo la identidad de los beneficiarios resguardada mediante modalidades públicas seguras.",
    how: [
      "Creación de campañas asociadas a casos específicos o de alcance institucional con descripción pública protegida.",
      "Protección de identidad en 4 modalidades públicas: Anónimo, Solo Primer Nombre, Descripción Familiar o Nombre Completo autorizado.",
      "Recepción y gestión de ofertas de apoyo en especie y servicios profesionales con revisión previa del equipo antes de conectar con el beneficiario.",
      "Vinculación con recaudadores financieros externos autorizados sin custodia directa de fondos por parte de la plataforma.",
      "Difusión multicanal con enlaces optimizados para WhatsApp, Facebook, correo electrónico, copia directa y códigos QR.",
      "Gobernanza financiera con validación fiscal de la organización titular (RFC, Constancia de Situación Fiscal e identificación oficial).",
    ],
    benefits: [
      "Canalizar ayuda solidaria directa protegiendo la dignidad y privacidad de familias y personas vulnerables.",
      "Control de inventario en tiempo real: artículos necesitados, comprometidos, recibidos y pendientes.",
      "Gobernanza y aprobación del suscriptor titular antes de publicar cualquier campaña pública.",
      "Transparencia total con registro inmutable de auditoría para donaciones y apoyos entregados.",
    ],
    workflow: [
      { title: "Solicitud y Borrador", description: "El equipo de trabajo social formula la necesidad de apoyo con descripción segura y catálogo de artículos." },
      { title: "Aprobación del Titular", description: "El suscriptor principal revisa la vista previa y autoriza la publicación de la campaña." },
      { title: "Difusión y Recepción", description: "Compartir la página pública vía WhatsApp o redes; recepción de ofertas de apoyo de la comunidad." },
      { title: "Revisión y Entrega", description: "Aceptación de ofertas, registro de recepción y seguimiento hasta el cumplimiento final." },
    ],
    examples: [
      { title: "Campaña de Emergencia Médica", description: "Solicitud de medicamentos específicos y apoyo en transporte para tratamiento especializado." },
      { title: "Útiles y Educación Comunitaria", description: "Campaña institucional para dotar de mochilas, libros y calzado a menores en situación vulnerable." },
      { title: "Asistencia Habitacional y Enseres", description: "Acopio de cobijas, estufas y materiales de reconstrucción tras contingencias ambientales." },
    ],
    bestPractices: [
      "Usar siempre la modalidad de identidad protegida (Anónimo o Descripción Familiar) en casos de violencia o menores de edad.",
      "Revisar y verificar las ofertas de servicios profesionales antes de coordinar el contacto directo con la persona beneficiaria.",
      "Actualizar el estado de los artículos conforme se reciban para evitar sobre-recaudación de insumos.",
      "Cerrar la campaña oportunamente una vez que los objetivos hayan sido satisfechos.",
    ],
    attorneyResponsibilities: [
      "Asegurar que la difusión pública cumpla con las leyes de protección de datos personales y dignidad de las personas.",
      "Confirmar que los enlaces de recaudación financiera externa correspondan a cuentas autorizadas de la institución.",
    ],
    limitations: [
      "Nyrava México no procesa directamente fondos ni actúa como intermediario financiero bancario; facilita la coordinación y vinculación con recaudadores externos autorizados.",
      "El cumplimiento de las ofertas en especie y servicios depende de la entrega voluntaria por parte de los aportantes.",
    ],
    scenarios: [
      { title: "Apoyo en Especie Inmediato", description: "Publicar una campaña con meta de 20 despensas familiares; registrar aportaciones y actualizar inventario en tiempo real." },
      { title: "Servicios Pro-Bono", description: "Recibir ofertas de psicólogos o médicos voluntarios para atención a casos comunitarios específicos." },
    ],
    faqs: [
      { q: "¿Qué información personal se publica en la campaña?", a: "Únicamente la descripción autorizada y la necesidad requerida. Las notas privadas del caso, diagnósticos médicos y domicilios exactos nunca se publican." },
      { q: "¿Nyrava cobra comisiones sobre donaciones?", a: "No. Nyrava México no custodia fondos ni cobra comisiones sobre recaudaciones financieras canalizadas a plataformas externas." },
      { q: "¿Cómo se aprueban las campañas antes de publicarse?", a: "Toda campaña requiere aprobación explícita por parte del titular principal de la organización tras revisar la vista previa pública." },
    ],
    related: [RELATED_ALL.care, RELATED_ALL.talk, RELATED_ALL.security, RELATED_ALL.trust],
    next: { label: "Talk to Cases", to: "/product/talk-to-cases" },
  },
  {
    slug: "talk-to-cases",
    title: "Talk to Cases (Inteligencia Conversacional)",
    eyebrow: "Product",
    description:
      "Interrogación conversacional en lenguaje natural con grounding estricto en el expediente del caso y en la jurisprudencia y leyes mexicanas.",
    what:
      "Talk to Cases permite a los profesionales jurídicos y equipos de atención dialogar con el expediente en lenguaje natural. A diferencia de un asistente conversacional genérico, cada respuesta generada por Talk to Cases está rigurosamente anclada a los pasajes documentales del caso, artículos de los códigos sustantivos y adjetivos aplicables, y precedentes de la SCJN. Las afirmaciones no verificables en el expediente son suprimidas.",
    how: [
      "Indexación vectorial y semántica del expediente documental completo con metadatos de foja, autor y fecha.",
      "Recuperación aumentada con verificación contextual de los hechos y marco normativo mexicano aplicable.",
      "Respuestas estructuradas con citas navegables al documento exacto y párrafo de origen.",
      "Detección de vacíos probatorios, contradicciones testimoniales y prescripciones procesales.",
      "Modo determinista de respaldo que garantiza respuestas basadas exclusivamente en hechos comprobados.",
    ],
    benefits: [
      "Respuestas inmediatas a preguntas complejas sobre expedientes de miles de fojas.",
      "Cero alucinaciones: cada hecho citado enlaza directamente al documento de origen.",
      "Contextualización automática en el marco procesal mexicano (sistema acusatorio, amparo, civil, familiar, laboral).",
      "Asistencia en la preparación de borradores, oficios y líneas de interrogatorio.",
    ],
    workflow: [
      { title: "Cargar Expediente", description: "Subir las actuaciones, pruebas y documentos del caso." },
      { title: "Formular Consulta", description: "Hacer preguntas específicas en lenguaje natural sobre hechos, fechas, testigos o leyes aplicables." },
      { title: "Verificar Citas", description: "Revisar la respuesta y hacer clic en las citas para contrastar con el texto original del expediente." },
      { title: "Exportar o Integrar", description: "Copiar argumentos o evidencias directamente al centro de estrategia o borrador de promociones." },
    ],
    examples: [
      { title: "Contradicciones Testimoniales", description: "¿En qué puntos discrepa la declaración ministerial del imputado con el informe policial homologado respecto a la hora de detención?" },
      { title: "Análisis de Prescripción", description: "¿Cuándo se realizó la última notificación fehaciente y cuál es el término aplicable para interponer el recurso según la legislación vigente?" },
      { title: "Fundamentación Constitucional", description: "¿Qué jurisprudencia de la SCJN aplica a la exclusión de pruebas obtenidas sin orden de cateo en este supuesto fáctico?" },
    ],
    bestPractices: [
      "Subir el expediente íntegro para que la recuperación tenga acceso a todas las actuaciones y anexos.",
      "Revisar siempre los pasajes citados antes de utilizar cualquier respuesta en un escrito judicial.",
      "Hacer preguntas acotadas por actor, fecha o documento para obtener la máxima precisión probatoria.",
    ],
    attorneyResponsibilities: [
      "El abogado conserva la responsabilidad exclusiva sobre el criterio jurídico y la estrategia procesal.",
      "Verificar que la jurisprudencia o tesis citada se encuentre vigente y no haya sido superada o interrumpida.",
    ],
    limitations: [
      "Talk to Cases no emite consejos jurídicos vinculantes ni sustituye el juicio profesional del abogado postulante.",
      "La calidad de las respuestas depende de la legibilidad y completitud del expediente cargado.",
    ],
    scenarios: [
      { title: "Preparación de Audiencia Inicial", description: "Extraer en minutos todos los datos sobre la cadena de custodia y control de detención citados con foja exacta." },
      { title: "Redacción de Conceptos de Violación", description: "Sintetizar los agravios y relacionarlos con las violaciones procesales documentadas en el expediente." },
    ],
    faqs: [
      { q: "¿Puede inventar hechos que no están en el expediente?", a: "No. El motor cuenta con un filtro estricto de evidencia que suprime cualquier respuesta que no pueda anclarse a un pasaje documental del expediente." },
      { q: "¿Se utilizan mis casos para entrenar modelos de IA?", a: "No. Las consultas se procesan bajo aislamiento de espacio de trabajo y enrutamiento controlado; la plataforma no utiliza los expedientes confidenciales para entrenamiento de modelos generales." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.care, RELATED_ALL.trust],
  },
];

export function getProduct(slug: string): ProductPageContent | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

const SPANISH_CANONICAL_NAMES: Record<string, Pick<ProductPageContent, "title"> & Partial<Pick<ProductPageContent, "next">>> = {
  "comprehensive-care": { title: "Atención Integral" },
  "community-support": {
    title: "Apoyo Comunitario",
    next: { label: "Hablar con el Caso de Atención", to: "/product/talk-to-cases" },
  },
  "talk-to-cases": { title: "Hablar con el Caso de Atención" },
};

const CARE_PRODUCTS_EN: Record<string, ProductPageContent> = {
  "comprehensive-care": {
    slug: "comprehensive-care",
    title: "Comprehensive Care",
    eyebrow: "Product",
    description:
      "A multidisciplinary platform for social case management, care plans, institutional referrals, informed consent, and tiered confidentiality.",
    what:
      "Comprehensive Care is the operating environment for social-work teams, human-rights defenders, and community organizations. It manages the complete social-case lifecycle—from intake and seven-axis risk assessment through goal-based care plans, interventions, institutional referrals, informed consent, follow-up, and documented closure—while strictly separating general, social-work, privileged legal, psychosocial, medical, and child-protection records.",
    how: [
      "Receive and register cases with automatic sequential folios (INT-YYYY-XXXX) and urgency triage.",
      "Assess risks and protective factors across seven axes: safety, housing, health, psychosocial, legal, nutrition, and immigration status.",
      "Build goal-based care plans with milestones, assigned professionals, direct-service records, interventions, and supervisor acknowledgements.",
      "Coordinate referrals through a managed directory of Mexican institutions, including DIF, CEAV, INM, COMAR, and prosecutor offices, while tracking responses and outcomes.",
      "Protect records through six confidentiality tiers—General, Social Work, Privileged Legal, Psychosocial, Medical, and Child Protection—with active consent verification.",
      "Use Talk to Care Case for contextual analysis, care-gap detection, and preparation of Mexican administrative forms and case records.",
    ],
    benefits: [
      "Coordinate multidisciplinary care without mixing sensitive record types.",
      "Maintain a traceable, versioned history of risk reviews and care plans.",
      "Create secure institutional referrals with consent controls before disclosure.",
      "Produce institutional impact and audit reports with SHA-256 verification for authorized stakeholders.",
    ],
    workflow: [
      { title: "Intake & Triage", description: "Record the initial need, assign a folio, and prioritize urgency under supervisor review." },
      { title: "Multidimensional Assessment", description: "Evaluate risks and protective factors with a versioned review history." },
      { title: "Care Plan & Interventions", description: "Define goals and milestones, assign professionals, and record direct support." },
      { title: "Referral & Follow-up", description: "Create consent-controlled referral packets and document institutional responses." },
      { title: "Health Check & Closure", description: "Resolve overdue work, summarize completed goals, and close the case with supervisor approval." },
    ],
    examples: [
      { title: "Families and Child Protection", description: "Coordinate nutrition support, socioeconomic assessment, and DIF services under restricted child-protection access." },
      { title: "Refugees and Migrants", description: "Connect social support with COMAR asylum or INM immigration procedures under informed consent." },
      { title: "Psychosocial and Legal Protection", description: "Coordinate family-violence intervention while protecting clinical notes and documenting legal safeguards." },
    ],
    bestPractices: [
      "Record informed consent before generating an external referral packet or sharing documents.",
      "Use Medical, Psychosocial, and Child Protection tiers for sensitive professional notes.",
      "Run Case Health Check regularly to identify overdue tasks and pending assessments.",
      "Document formal closure with completed goals and approval by the responsible supervisor.",
    ],
    attorneyResponsibilities: [
      "Verify socioeconomic information, risk assessments, and consent records before relying on them.",
      "Follow professional, ethical, safeguarding, and privacy obligations when handling beneficiary information.",
      "Confirm that institutional referrals are appropriate, authorized, and compliant with applicable Mexican requirements.",
      "Escalate clinical, safeguarding, or legal decisions to an appropriately qualified professional.",
    ],
    limitations: [
      "Talk to Care Case supports drafting, synthesis, and gap detection; it does not replace clinical, social-work, safeguarding, or legal judgment.",
      "Service availability and eligibility depend on each public or private institution and its geographic coverage.",
      "The platform records and coordinates professional decisions; it does not independently authorize disclosure or determine a person's care needs.",
    ],
    scenarios: [
      { title: "Urgent Institutional Referral", description: "Prepare a consent-controlled referral record with structured background and protected personal information." },
      { title: "Accountability Audit", description: "Export an institutional impact report summarizing services, completed goals, and SHA-256 verification." },
    ],
    faqs: [
      { q: "How are psychosocial and medical records protected?", a: "They remain in restricted confidentiality tiers so unauthorized staff cannot access them or include them in general records." },
      { q: "Is informed consent required before sharing information?", a: "Yes. The system checks for an active, applicable consent record before an external referral packet or protected document can be released." },
      { q: "Who can approve care plans and institutional reports?", a: "Approval is limited by workspace role and organization policy, including supervisor acknowledgement and subscriber-level controls where configured." },
      { q: "Does Comprehensive Care replace a social worker or clinician?", a: "No. It structures records, coordination, and review. Qualified professionals retain responsibility for assessments, safeguarding, clinical decisions, and services." },
    ],
    related: [
      { label: "Community Support", to: "/product/community-support", description: "Protected campaigns and coordinated contributions." },
      { label: "Talk to Care Case", to: "/product/talk-to-cases", description: "Role-aware questions grounded in the care record." },
      RELATED_ALL.report,
      RELATED_ALL.trust,
      RELATED_ALL.security,
    ],
    next: { label: "Community Support", to: "/product/community-support" },
  },
  "community-support": {
    slug: "community-support",
    title: "Community Support",
    eyebrow: "Product",
    description:
      "Protected solidarity campaigns, in-kind contributions, professional services, and authorized external fundraising for social-care needs.",
    what:
      "Community Support helps organizations coordinate assistance campaigns for an individual social case or an organization-wide community program. Teams can manage in-kind donations, volunteer professional services, and links to authorized external fundraising destinations while protecting beneficiary identity through controlled public-display modes.",
    how: [
      "Create a campaign linked to an authorized case or institutional program with a protected public description.",
      "Choose one of four public identity modes: Anonymous, First Name Only, Family Description, or Authorized Full Name.",
      "Receive and review offers of in-kind assistance or professional services before connecting a contributor with a beneficiary.",
      "Link to approved external fundraising destinations without Nyrava taking custody of funds.",
      "Share through WhatsApp, Facebook, email, direct links, and QR codes.",
      "Apply organization-level fiscal governance and subscriber approval before public release.",
    ],
    benefits: [
      "Coordinate direct support while protecting the dignity and privacy of people and families.",
      "Track requested, pledged, received, and outstanding items in real time.",
      "Require authorized organization approval before publishing a campaign.",
      "Maintain an immutable audit history of contributions and delivered support.",
    ],
    workflow: [
      { title: "Request & Draft", description: "Describe the support need safely and list requested goods or services." },
      { title: "Authorized Review", description: "The designated organization owner reviews the public preview and approves publication." },
      { title: "Sharing & Offers", description: "Share the campaign and receive community offers through protected channels." },
      { title: "Review & Delivery", description: "Approve offers, record receipt, and follow the campaign through completion." },
    ],
    examples: [
      { title: "Medical Emergency", description: "Request specified medicine and transportation support for specialized treatment." },
      { title: "Education Support", description: "Coordinate school supplies, books, clothing, and footwear for children while protecting identity." },
      { title: "Housing Assistance", description: "Coordinate blankets, appliances, and recovery materials after an environmental emergency." },
    ],
    bestPractices: [
      "Use Anonymous or Family Description for violence-related matters and cases involving minors.",
      "Verify professional-service offers before coordinating direct beneficiary contact.",
      "Update item status as contributions arrive to prevent unnecessary collection.",
      "Close the campaign promptly when approved goals have been met.",
    ],
    attorneyResponsibilities: [
      "Confirm that public descriptions respect consent, dignity, safeguarding rules, and personal-data requirements.",
      "Verify that external fundraising links belong to destinations approved by the organization.",
      "Document delivery and campaign closure under the organization's accountability controls.",
    ],
    limitations: [
      "Nyrava does not hold funds or operate as a financial intermediary; it coordinates support and links to approved external fundraisers.",
      "In-kind and professional-service offers depend on voluntary fulfillment by contributors.",
    ],
    scenarios: [
      { title: "Immediate In-kind Support", description: "Publish a protected campaign for family food packages and update inventory as contributions arrive." },
      { title: "Pro-bono Services", description: "Receive and review offers from volunteer psychologists, physicians, or other professionals." },
    ],
    faqs: [
      { q: "What personal information appears publicly?", a: "Only the authorized public description and requested need. Private case notes, diagnoses, and exact addresses are never published." },
      { q: "Does Nyrava charge a donation commission?", a: "No. Nyrava does not hold funds or take a percentage of fundraising handled by external destinations." },
      { q: "How are campaigns approved?", a: "A designated organization owner must review the protected public preview and explicitly approve publication." },
    ],
    related: [
      { label: "Comprehensive Care", to: "/product/comprehensive-care", description: "Social case management, care plans, and tiered confidentiality." },
      { label: "Talk to Care Case", to: "/product/talk-to-cases", description: "Role-aware questions grounded in the care record." },
      RELATED_ALL.security,
      RELATED_ALL.trust,
    ],
    next: { label: "Talk to Care Case", to: "/product/talk-to-cases" },
  },
  "talk-to-cases": {
    slug: "talk-to-cases",
    title: "Talk to Care Case",
    eyebrow: "Product",
    description:
      "A conversational assistant grounded in the authorized social-case record, care assessments, consent, interventions, and referrals.",
    what:
      "Talk to Care Case lets authorized care professionals ask natural-language questions about a social case. Responses are grounded in the records the user is permitted to access, including intake, assessments, care plans, interventions, consent, referrals, and follow-up. It identifies missing documentation and pending work without replacing professional judgment.",
    how: [
      "Index authorized case records with record type, author, date, and confidentiality metadata.",
      "Retrieve only information allowed by the user's role and the record's confidentiality tier.",
      "Return structured answers with links to the relevant case records.",
      "Flag care gaps, overdue tasks, inconsistent assessments, missing consent, and incomplete referrals.",
      "Use deterministic care rules when an AI-generated answer is unavailable or inappropriate.",
    ],
    benefits: [
      "Review long-running social cases without manually searching every entry.",
      "Trace each factual statement to an authorized case record.",
      "Identify incomplete care steps, pending referrals, and overdue follow-up.",
      "Prepare administrative summaries and forms for professional review.",
    ],
    workflow: [
      { title: "Open an Authorized Case", description: "Select a Comprehensive Care case available to your role." },
      { title: "Ask a Focused Question", description: "Ask about risks, goals, interventions, consent, referrals, or follow-up." },
      { title: "Review Source Records", description: "Open linked records and verify the answer against the case history." },
      { title: "Take Professional Action", description: "Update the care plan, complete a task, document a referral, or escalate to a qualified professional." },
    ],
    examples: [
      { title: "Care-plan Gaps", description: "Which high-risk needs do not yet have an assigned goal, professional, or intervention?" },
      { title: "Consent Review", description: "Is there active consent for the proposed referral recipient and information categories?" },
      { title: "Follow-up", description: "Which referrals have no response and which milestones are overdue?" },
    ],
    bestPractices: [
      "Ask focused questions tied to an assessment, goal, intervention, referral, or period of time.",
      "Review linked source records before taking action or sharing information.",
      "Escalate clinical, safeguarding, and legal decisions to the appropriately qualified professional.",
    ],
    attorneyResponsibilities: [
      "Use the assistant only within the permissions and confidentiality tier assigned to your role.",
      "Verify answers against the underlying records and current professional assessment.",
      "Do not use generated summaries as a substitute for clinical, social-work, safeguarding, or legal judgment.",
    ],
    limitations: [
      "Talk to Care Case cannot diagnose, determine eligibility, authorize disclosure, or make a safeguarding decision.",
      "Answer quality depends on the completeness and accuracy of the authorized case record.",
    ],
    scenarios: [
      { title: "Supervisor Review", description: "Summarize unresolved high-risk needs, overdue milestones, and pending acknowledgements before case review." },
      { title: "Referral Preparation", description: "Identify the authorized facts and consent scope needed for a proposed institutional referral." },
    ],
    faqs: [
      { q: "Can it access every record in the case?", a: "No. Retrieval is limited by the user's role and each record's confidentiality tier." },
      { q: "Can it make clinical or safeguarding decisions?", a: "No. It can organize information and flag gaps, but a qualified professional must assess and decide." },
      { q: "Are social cases used to train general models?", a: "No. Nyrava does not use confidential case records to train general-purpose models." },
    ],
    related: [
      { label: "Comprehensive Care", to: "/product/comprehensive-care", description: "Social case management, care plans, and tiered confidentiality." },
      { label: "Community Support", to: "/product/community-support", description: "Protected campaigns and coordinated contributions." },
      RELATED_ALL.security,
      RELATED_ALL.trust,
    ],
  },
};

const TALK_TO_CARE_ES: ProductPageContent = {
  slug: "talk-to-cases",
  title: "Hablar con el Caso de Atención",
  eyebrow: "Producto",
  description:
    "Asistente conversacional fundamentado en el expediente social autorizado, las valoraciones, el consentimiento, las intervenciones y las canalizaciones.",
  what:
    "Hablar con el Caso de Atención permite que profesionales autorizados consulten un caso social en lenguaje natural. Las respuestas se fundamentan exclusivamente en los registros accesibles para la función del usuario: ingesta, valoraciones, planes de cuidado, intervenciones, consentimiento, canalizaciones y seguimiento. Identifica documentación faltante y trabajo pendiente sin sustituir el criterio profesional.",
  how: [
    "Indexa los registros autorizados con tipo de registro, autoría, fecha y nivel de confidencialidad.",
    "Recupera únicamente información permitida por la función del usuario y el nivel de acceso de cada registro.",
    "Devuelve respuestas estructuradas con vínculos a los registros correspondientes del caso.",
    "Señala vacíos de atención, tareas vencidas, valoraciones inconsistentes, consentimiento faltante y canalizaciones incompletas.",
    "Utiliza reglas deterministas de atención cuando una respuesta generada por IA no está disponible o no resulta apropiada.",
  ],
  benefits: [
    "Revisar casos sociales de larga duración sin buscar manualmente cada registro.",
    "Rastrear cada afirmación fáctica hasta un registro autorizado.",
    "Identificar pasos incompletos, canalizaciones pendientes y seguimientos vencidos.",
    "Preparar resúmenes administrativos y formatos para revisión profesional.",
  ],
  workflow: [
    { title: "Abrir un Caso Autorizado", description: "Seleccionar un caso de Atención Integral disponible para su función." },
    { title: "Formular una Pregunta Acotada", description: "Consultar riesgos, metas, intervenciones, consentimiento, canalizaciones o seguimiento." },
    { title: "Revisar Registros de Origen", description: "Abrir los registros vinculados y verificar la respuesta contra el historial del caso." },
    { title: "Realizar una Actuación Profesional", description: "Actualizar el plan, completar una tarea, documentar una canalización o escalar a la persona profesional competente." },
  ],
  examples: [
    { title: "Vacíos del Plan de Cuidado", description: "¿Qué necesidades de alto riesgo aún no tienen meta, profesional o intervención asignada?" },
    { title: "Revisión de Consentimiento", description: "¿Existe consentimiento activo para la institución receptora y las categorías de información propuestas?" },
    { title: "Seguimiento", description: "¿Qué canalizaciones no tienen respuesta y qué hitos están vencidos?" },
  ],
  bestPractices: [
    "Formular preguntas acotadas a una valoración, meta, intervención, canalización o periodo.",
    "Revisar los registros vinculados antes de actuar o compartir información.",
    "Escalar decisiones clínicas, de protección o jurídicas a la persona profesional competente.",
  ],
  attorneyResponsibilities: [
    "Utilizar el asistente únicamente dentro de los permisos y el nivel de confidencialidad asignados.",
    "Verificar las respuestas contra los registros de origen y la valoración profesional vigente.",
    "No utilizar resúmenes generados como sustituto del criterio clínico, de trabajo social, protección o jurídico.",
  ],
  limitations: [
    "Hablar con el Caso de Atención no diagnostica, determina elegibilidad, autoriza divulgaciones ni toma decisiones de protección.",
    "La calidad de las respuestas depende de la integridad y exactitud del expediente autorizado.",
  ],
  scenarios: [
    { title: "Revisión de Supervisión", description: "Resumir necesidades de alto riesgo pendientes, hitos vencidos y reconocimientos faltantes antes de revisar el caso." },
    { title: "Preparación de una Canalización", description: "Identificar los hechos autorizados y el alcance del consentimiento necesario para una canalización institucional." },
  ],
  faqs: [
    { q: "¿Puede consultar todos los registros del caso?", a: "No. La recuperación está limitada por la función del usuario y el nivel de confidencialidad de cada registro." },
    { q: "¿Puede tomar decisiones clínicas o de protección?", a: "No. Organiza información y señala vacíos, pero una persona profesional calificada debe valorar y decidir." },
    { q: "¿Los casos sociales se usan para entrenar modelos generales?", a: "No. Nyrava no utiliza expedientes confidenciales para entrenar modelos de propósito general." },
  ],
  related: [RELATED_ALL.care, RELATED_ALL.support, RELATED_ALL.security, RELATED_ALL.trust],
};

export function getLocalizedProduct(product: ProductPageContent, locale: "es" | "en"): ProductPageContent {
  if (locale === "en" && CARE_PRODUCTS_EN[product.slug]) return CARE_PRODUCTS_EN[product.slug];
  if (locale === "es" && product.slug === "talk-to-cases") return TALK_TO_CARE_ES;
  const canonical = SPANISH_CANONICAL_NAMES[product.slug];
  return canonical ? { ...product, ...canonical } : product;
}

// Placeholder to keep `ReactNode` import used if callers extend later.
export type _Rn = ReactNode;
