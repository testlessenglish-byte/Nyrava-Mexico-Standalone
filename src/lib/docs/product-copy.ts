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
      "Cluster every statement each witness made across the record, compare accounts, and surface impeachment material.",
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
      { title: "Revise and export", description: "Export to DOCX for filing prep." },
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
      "The report is exported to PDF, DOCX, or JSON.",
    ],
    benefits: [
      "One consistent format across every matter.",
      "Grounded, cited, and reviewable end-to-end.",
      "Version-locked so downstream tooling can rely on the schema.",
    ],
    workflow: [
      { title: "Run the full pipeline", description: "All upstream engines populate the canonical analysis." },
      { title: "Open the Report panel", description: "The 17 sections render with citations." },
      { title: "Export", description: "PDF, DOCX, or JSON, with pagination optimized for court binders." },
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
];

export function getProduct(slug: string): ProductPageContent | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

// Placeholder to keep `ReactNode` import used if callers extend later.
export type _Rn = ReactNode;
