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
      "Evidence Intelligence ingests every document in a matter — pleadings, discovery productions, transcripts, medical records, exhibits, notes — and produces a structured index of the factual assertions those documents contain. Each extracted fact is anchored to the specific passage it came from so an attorney can verify it in one click. It is the foundation on which every downstream engine (timeline, witness, constitutional, motion, report) is built.",
    how: [
      "Documents are extracted and normalized. Scanned PDFs and images pass through OCR so that photographed reports and handwritten notes become searchable text.",
      "The corpus is chunked and indexed. A retrieval layer maintains embeddings for every passage so the model can look up support before writing anything.",
      "Extraction engines identify entities, events, statements, and factual claims, tagging each with the document, page, and paragraph it appeared in.",
      "An evidence gate suppresses any claim the retrieval layer cannot ground back to a source passage. Suppressions are logged in the pipeline ledger for review.",
      "Findings are written to your workspace with citation metadata attached so downstream engines can reuse them without regenerating.",
    ],
    benefits: [
      "Stop losing facts across thousands of pages of discovery.",
      "Every claim is verifiable — click a citation to jump to the source.",
      "Downstream analyses reuse the same grounded facts.",
      "Ungrounded model output is rejected before it reaches a report.",
    ],
    workflow: [
      { title: "Create a case", description: "Give the matter a name and case type." },
      { title: "Upload the corpus", description: "Drag in the full production. OCR runs automatically on scans." },
      { title: "Run analysis", description: "Evidence Intelligence extracts and indexes the record." },
      { title: "Review findings", description: "Open the Evidence panel and verify each cited claim." },
    ],
    examples: [
      { title: "Personal Injury", description: "Reconstruct the crash sequence from crash reports, ELD logbooks, trauma admission notes, and deposition testimony." },
      { title: "Criminal Defense", description: "Surface every mention of Miranda warnings across arrest report, body-cam transcript, and interrogation notes." },
      { title: "Employment", description: "Pull every performance-related statement from three years of emails and HR files, with dates and authors." },
    ],
    bestPractices: [
      "Upload the entire production, not curated excerpts — downstream contradiction detection depends on it.",
      "Label documents clearly (bates ranges, produced-by) so citations resolve unambiguously in a filing.",
      "Rerun extraction after supplemental productions so the evidence index stays current.",
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
      { title: "Rolling productions", description: "Add supplemental documents mid-case; rerun extraction to refresh the evidence index without losing prior citations." },
      { title: "Cross-witness reconciliation", description: "Feed the evidence output into Witness Intelligence to see who said what about the same subject across the record." },
    ],
    faqs: [
      { q: "How large a corpus can I upload?", a: "Case sizes in the thousands of pages are typical. Very large productions can be uploaded in batches — each batch triggers incremental indexing." },
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
      "The timeline can be filtered by actor, document, or subject and exported to PDF for court binders.",
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
      { title: "Medical Malpractice", description: "Assemble a minute-by-minute ED timeline from records, RCA memo, and expert affidavit." },
      { title: "Appellate", description: "Reconstruct procedural history across briefs and transcripts for the fact section of an opening brief." },
    ],
    bestPractices: [
      "Include ambient documents (calendars, delivery logs, sign-in sheets) — they anchor dates that testimony alone leaves ambiguous.",
      "Review contradictions early; an unresolved date conflict often signals an impeachment opportunity.",
      "Export the filtered view rather than the full timeline when preparing a specific hearing.",
    ],
    attorneyResponsibilities: [
      "Confirm the date each event resolved to matches the source.",
      "Decide whether a conflict is a genuine dispute, a transcription error, or a witness memory issue.",
      "Retain edited timelines under the workspace's normal work-product controls.",
    ],
    limitations: [
      "Approximate dates (\"early April\") are placed heuristically and flagged as low-confidence.",
      "Time zones in raw records are treated as-written unless a document declares otherwise.",
    ],
    scenarios: [
      { title: "Deposition prep", description: "Export a witness-filtered timeline before cross-examination to see every date that witness placed on the record." },
      { title: "Sequencing argument", description: "Use the exported chronology as the factual backbone of a summary-judgment brief." },
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
      "Witness Intelligence groups statements by witness and by subject. It compares what each witness said in different documents and highlights inconsistencies, corroborations, and gaps that a cross-examiner or impeachment memo needs to see.",
    how: [
      "Statements attributed to a witness are pulled from every document in the corpus.",
      "Statements are clustered by subject so the same topic across depositions, affidavits, and interviews is grouped.",
      "Contradiction detection compares statements within a single witness and across witnesses.",
      "Each conflict is presented with both source passages side by side and cited.",
    ],
    benefits: [
      "See every version of a witness's story on one screen.",
      "Cross-witness contradictions surface automatically.",
      "Foundation for cross-examination outlines and impeachment memos.",
    ],
    workflow: [
      { title: "Load witness documents", description: "Statements, depositions, interviews, affidavits, transcripts." },
      { title: "Open the Witness panel", description: "Witnesses are listed with statement counts and conflict flags." },
      { title: "Drill into a witness", description: "Statements clustered by subject with citations to source." },
    ],
    examples: [
      { title: "Civil Rights §1983", description: "Compare officer statements across arrest report, IA log, and deposition." },
      { title: "Family Law", description: "Reconcile parent statements across custody evaluation, DV incident report, and financial affidavit." },
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
      { title: "Cross prep", description: "Filter to a single witness and export a subject-clustered brief with every citation prewired." },
      { title: "Deposition strategy", description: "Identify subjects the witness has not testified about but that appear in the record." },
    ],
    faqs: [
      { q: "How does Nyrava know a statement belongs to a witness?", a: "Speaker attribution is inferred from surrounding text (deponent labels, transcript speakers, affidavit signature blocks) and every attribution is cited so you can verify." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.timeline, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.ai],
    next: { label: "Constitutional Intelligence", to: "/product/constitutional-intelligence" },
  },
  {
    slug: "constitutional-intelligence",
    title: "Constitutional Intelligence",
    eyebrow: "Product",
    description:
      "Identify constitutional issues in the record — search and seizure, Miranda, due process, Brady — with citations back to the facts and the doctrine.",
    what:
      "Constitutional Intelligence scans the record for facts that implicate constitutional doctrine and drafts an initial analysis for attorney review. It cites both the facts that triggered the issue and the doctrinal framework applied.",
    how: [
      "Facts are matched against pattern libraries for common constitutional issues (Fourth, Fifth, Sixth, Fourteenth Amendment; Brady/Giglio; equal protection).",
      "Each identified issue is drafted with the triggering facts and doctrinal citations.",
      "Attorney review is required before any output is used in a filing.",
    ],
    benefits: [
      "Catch constitutional issues you might overlook in a large record.",
      "See the fact pattern and the doctrine side-by-side.",
      "Foundation for a motion to suppress or §1983 complaint.",
    ],
    workflow: [
      { title: "Analyze the case", description: "Ensure Evidence Intelligence has run." },
      { title: "Open the Constitutional panel", description: "Issues are grouped by amendment and severity." },
      { title: "Draft a motion", description: "Export an issue as the seed of a motion draft." },
    ],
    examples: [
      { title: "Criminal Defense", description: "Fourth Amendment analysis of a warrantless vehicle search and Fifth Amendment analysis of a post-invocation interrogation." },
      { title: "Civil Rights", description: "Excessive force and municipal liability analysis under §1983." },
    ],
    bestPractices: [
      "Feed the constitutional output into Motion Intelligence to draft a suppression motion grounded in the same facts.",
      "Attach body-cam transcripts and dispatch audio when available — they materially change the analysis.",
      "Use the exported issue list as a checklist during a preservation motion, not as a finished brief.",
    ],
    attorneyResponsibilities: [
      "Verify every doctrinal citation against controlling authority in your jurisdiction.",
      "Confirm the fact pattern the model relied on before advancing it.",
      "Decide whether raising a constitutional issue is strategically appropriate.",
    ],
    limitations: [
      "Pattern libraries reflect federal doctrine plus commonly litigated state variants; niche state rules may need manual expansion.",
      "The model does not evaluate procedural bars (waiver, preservation) automatically.",
    ],
    scenarios: [
      { title: "Motion to suppress prep", description: "Chain from Constitutional Intelligence to Motion Intelligence to produce a first draft with facts and authorities aligned." },
      { title: "§1983 complaint drafting", description: "Use identified excessive-force and municipal-liability issues as the seed for a complaint outline." },
    ],
    faqs: [
      { q: "Does this replace legal research?", a: "No. It surfaces issues in the record and provides doctrinal starting points. Legal research and briefing remain the attorney's responsibility." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.responsible, RELATED_ALL.trust],
    next: { label: "Motion Intelligence", to: "/product/motion-intelligence" },
  },
  {
    slug: "motion-intelligence",
    title: "Motion Intelligence",
    eyebrow: "Product",
    description:
      "Draft motions grounded in the case record, with citations to evidence and to authority verified before it reaches the draft.",
    what:
      "Motion Intelligence produces a first-draft motion — statement of facts, argument, and prayer — grounded in the case record. Every factual assertion in the draft cites the underlying document. Every authority citation is verified against a legal-research provider before it reaches the draft.",
    how: [
      "You choose a motion type (suppress, dismiss, summary judgment, in limine, etc.).",
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
      { title: "Pick a motion type", description: "Choose from the supported motion library." },
      { title: "Review the draft", description: "The Motion Editor opens with the generated draft." },
      { title: "Revise and export", description: "Export to DOCX for filing prep." },
    ],
    examples: [
      { title: "Motion to Suppress", description: "Draft grounded in the search warrant affidavit, body-cam transcript, and lab report." },
    ],
    bestPractices: [
      "Confirm your jurisdiction's preferred format before exporting — the editor supports jurisdictional headers you should set.",
      "Use the draft as scaffolding; substantive editing remains the attorney's work.",
      "Regenerate specific sections rather than entire drafts when refining tone or emphasis.",
    ],
    attorneyResponsibilities: [
      "Shepardize every authority before filing — Nyrava verifies existence, not current good law in your jurisdiction.",
      "Confirm each factual citation resolves to the passage cited.",
      "Sign only what you would have written yourself.",
    ],
    limitations: [
      "The supported motion library is limited to the types listed in the app; other types are on the roadmap.",
      "Jurisdictional local rules are not applied automatically; verify page limits, formatting, and captions.",
    ],
    scenarios: [
      { title: "Emergency motion", description: "Assemble a factual statement quickly from the record before drafting the argument by hand." },
      { title: "Response drafts", description: "Feed opposing counsel's motion in and generate a responsive first draft against the same evidence base." },
    ],
    faqs: [
      { q: "Are authority citations verified?", a: "Yes. Fabricated citations are rejected before appearing in the draft." },
      { q: "Do I still need to Shepardize?", a: "Yes. Attorneys must independently verify authority for their jurisdiction before filing." },
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
      "Report Intelligence synthesizes the outputs of every engine — evidence, timeline, witnesses, contradictions, constitutional, motion, strategy — into a single canonical case analysis. The report structure is version-locked at 1.0.0 and includes 17 sections covering facts, issues, evidence, opposition analysis, and recommended next steps.",
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
      { title: "Tax Court petition prep", description: "Report includes deficiency analysis, factual reconstruction, and legal issues with cited authorities." },
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
      { title: "Settlement prep", description: "Use the report as an internal reference for the strengths/weaknesses discussion before a mediation." },
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
      "Governance, M&A, and due-diligence analysis grounded in your corporate record. Same 17-section canonical report, corporate-flavored content.",
    what:
      "Corporate Law Intelligence adapts the Nyrava engine to transactional and governance matters — articles, bylaws, operating and shareholder agreements, board minutes, resolutions, merger and purchase agreements, due-diligence productions, and § 220 books-and-records demands. It reuses every universal engine (evidence extraction, timeline reconstruction, contradiction detection, discovery-gap analysis, verification, hallucination detection) and specializes the finding modules, motion families, terminology, and legal-standards prompt to Delaware / MBCA corporate law. Findings render into the same locked 17-section canonical report — Executive Summary, Findings, Risks, Attorney Action Center, Work Product, etc. — with corporate content instead of criminal or civil.",
    how: [
      "Upload the corporate corpus: charter documents, bylaws, operating or shareholder agreement, board minutes and consents, resolutions, cap table, disclosure schedules, merger/asset/stock purchase agreements, due-diligence memos, § 220 productions.",
      "Extraction identifies governance events (board actions, shareholder consents, amendments), entity structure (directors, officers, shareholders, affiliates), and financial-terms language (indemnities, escrows, MAC clauses, no-shops, break fees).",
      "Practice-area gating routes corporate-only finding modules (Caremark oversight, Revlon duties, § 220 gaps, self-dealing, missing consents, disclosure-schedule contradictions) to the analyzers while suppressing criminal-only agents (Miranda, chain of custody).",
      "Contradiction detection compares the same event across minutes, resolutions, disclosure schedules, and management presentations to surface backdated approvals, missing signatures, and inconsistent representations.",
      "The report generator writes the standard 17 sections using the corporate legal-standards block (DGCL, MBCA, BJR, Caremark, Revlon, Unocal, § 220, § 251, § 262, § 145 indemnification).",
    ],
    benefits: [
      "One evidence-grounded workspace for governance review, due diligence, and deal litigation posture.",
      "Every governance conclusion is cited to a specific minute, resolution, or agreement section.",
      "Missing consents, gaps in the board record, and backdated approvals are surfaced explicitly instead of glossed over.",
      "Corporate work product (draft resolutions, § 220 demands, disclosure-schedule corrections) reuses the same verification pipeline as litigation work.",
    ],
    workflow: [
      { title: "Create a corporate matter", description: "Pick 'Corporate law (governance, M&A, due diligence)' as the case type." },
      { title: "Upload the corporate record", description: "Charter, bylaws, agreements, minutes, consents, disclosure schedules, DD memos." },
      { title: "Run analysis", description: "Extraction, evidence intelligence, timeline, contradictions, discovery gaps, corporate findings, and verification run end-to-end." },
      { title: "Review the report", description: "Same 17 canonical sections, corporate content — Executive Summary → Findings → Risks → Attorney Action Center → Work Product → Appendices." },
    ],
    examples: [
      { title: "Governance health check", description: "Reconcile board minutes against resolutions and shareholder consents to surface missing approvals, backdating, and unauthorized officer actions." },
      { title: "M&A due diligence", description: "Cross-check the disclosure schedules against the underlying corporate record; flag misalignment between the reps in the SPA and the source documents." },
      { title: "§ 220 books-and-records demand", description: "Structure the demand and the responsive production around the specific proper purpose stated in the demand letter." },
      { title: "Derivative-suit posture", description: "Assemble the factual predicate for a Caremark or Revlon claim before drafting the complaint under Ct. Ch. R. 23.1." },
    ],
    bestPractices: [
      "Upload the full board book, not just the resolutions — deliberation records defeat or support the business judgment rule.",
      "Include the operating agreement or bylaws for every entity in the structure; corporate-only findings need the actual governance instrument.",
      "Attach the disclosure schedules with the purchase agreement — reps and schedules must be analyzed together.",
      "For § 220 work, upload the demand, the response, and any prior stockholder correspondence in the same corpus.",
    ],
    attorneyResponsibilities: [
      "Confirm the state of incorporation and controlling statute before relying on any DGCL-flavored analysis.",
      "Verify director independence and interestedness against the current corporate record, not the model's inference.",
      "Independently confirm that any Caremark, Revlon, or Unocal framing is supported by the specific factual predicate the doctrine requires.",
      "Do not file corporate work product without human review of every citation to a bylaw, agreement section, or governance document.",
    ],
    limitations: [
      "Corporate Law Intelligence renders into the frozen 17-section canonical report — it does not produce a bespoke governance-only template.",
      "The engine defaults to Delaware law when the corpus does not specify a state of incorporation; it flags this assumption but does not choose law for you.",
      "Fiduciary-duty analysis for LLCs depends on the operating agreement, which the model reads as-is — contractual waivers or modifications must be confirmed by counsel.",
      "The verification pipeline suppresses fabricated board actions; it will not invent minutes or consents that are missing from the record.",
    ],
    scenarios: [
      { title: "Pre-signing diligence", description: "Score governance risk before the LOI so deal terms can be negotiated with a real evidentiary basis." },
      { title: "Post-close disputes", description: "Reconstruct the pre-closing record from the data-room production when a rep-and-warranty claim arises." },
      { title: "Activist / § 220 defense", description: "Prepare a defensible response to a books-and-records demand grounded in the actual corporate record." },
    ],
    faqs: [
      { q: "Does Nyrava replace corporate counsel for board advice?", a: "No. Corporate Law Intelligence is an analysis and drafting tool for licensed counsel. Every governance conclusion must be reviewed by an attorney before use." },
      { q: "Which state's corporate law does the engine apply?", a: "Delaware by default, with the assumption flagged in the report. When the corpus specifies a different state of incorporation, the engine defers to that state's business-organizations code and case law." },
      { q: "Does it work for LLCs and partnerships?", a: "Yes. The engine treats LLC and partnership matters as contract-first (operating agreement / partnership agreement), then applies statutory defaults from the relevant state act." },
      { q: "Can I draft board resolutions from it?", a: "Yes. Draft resolutions and consents render into the Work Product section of the canonical report, with citations to the underlying corporate record." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.timeline, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.trust, RELATED_ALL.ai],
  },
  {
    slug: "commercial",
    title: "Business & Commercial Law Intelligence",
    eyebrow: "Practice Area",
    description:
      "Contract disputes, UCC Article 2 sales, business torts, and trade-secret matters — analyzed inside Nyrava's 17-section canonical report with commercial-specific findings, motions, and standards.",
    what:
      "Business & Commercial Law Intelligence adapts the Nyrava engine to the everyday work of commercial litigators and transactional counsel: breach-of-contract disputes, UCC Article 2 sale-of-goods matters, warranty claims, business torts (tortious interference, unfair competition), trade-secret misappropriation, and non-compete enforcement. It reuses every universal engine — evidence extraction, timeline reconstruction, contradiction detection, discovery-gap analysis, cross-examination scaffolding, verification, and hallucination suppression — and specializes the finding modules, motion families, and legal-standards prompt to contract-first analysis grounded in the actual written agreement, course of dealing, and communications record. Findings render into the same locked 17-section canonical report used across every practice area, with commercial content instead of criminal or governance.",
    how: [
      "Upload the commercial corpus: the master contract, purchase orders, invoices, acknowledgments, negotiation emails, notice-of-breach letters, cure demands, termination correspondence, damage models, and any prior-course-of-dealing documentation.",
      "Extraction tags every clause of the agreement (integration, notice, limitation-of-liability, choice-of-law, forum selection, arbitration) so downstream engines know which arguments are actually available on the record.",
      "Practice-area gating routes commercial-only finding modules (material vs. partial breach, perfect-tender analysis, § 2-207 battle-of-the-forms, warranty disclaimers, tortious-interference elements) while suppressing criminal-only agents (Miranda, chain of custody).",
      "Contradiction detection cross-checks representations across the contract, invoices, POs, and email negotiations to surface course-of-dealing disputes, parol-evidence conflicts, and shifting damage theories.",
      "The report generator writes the standard 17 sections using the commercial legal-standards block (Restatement (Second) of Contracts, UCC Article 2, Hadley foreseeability, business-tort elements, economic-loss doctrine).",
    ],
    benefits: [
      "One evidence-grounded workspace for contract analysis, breach posture, damages theory, and pre-litigation strategy.",
      "Every commercial conclusion is cited to a specific clause, invoice, PO, or dated communication — no free-floating characterizations.",
      "Missing notices, expired cure windows, and undisclaimed warranties are surfaced explicitly instead of assumed away.",
      "Commercial work product (complaints, cure demands, motions to compel arbitration, TROs for trade-secret matters) reuses the same verification pipeline as litigation work.",
    ],
    workflow: [
      { title: "Create a commercial matter", description: "Pick 'Business & commercial law (contracts, UCC, business torts)' as the case type." },
      { title: "Upload the commercial record", description: "Contract, POs, invoices, negotiation emails, notice-of-breach letters, damage models." },
      { title: "Run analysis", description: "Extraction, evidence intelligence, timeline, contradictions, discovery gaps, commercial findings, cross-examination prep, and verification run end-to-end." },
      { title: "Review the report", description: "Same 17 canonical sections, commercial content — Executive Summary → Findings → Risks → Attorney Action Center → Work Product → Appendices." },
    ],
    examples: [
      { title: "Breach-of-contract posture", description: "Reconcile the contract, cure correspondence, and performance record to determine material vs. partial breach and whether the non-breaching party's own duties were excused." },
      { title: "UCC § 2-207 battle of the forms", description: "Analyze every purchase order, acknowledgment, and confirmation to determine which terms actually govern the sale of goods between merchants." },
      { title: "Trade-secret misappropriation", description: "Assemble the factual predicate for a TRO or preliminary injunction — reasonable secrecy measures, improper means, and independent economic value." },
      { title: "Tortious interference defense", description: "Test whether the alleged interference was independently wrongful under the forum's modern standard, not merely competitive." },
    ],
    bestPractices: [
      "Upload the fully-integrated contract and every amendment — the integration clause governs what parol evidence is admissible.",
      "Include the full email negotiation thread; § 2-207 and fraud-in-the-inducement analysis both depend on the order of documents.",
      "Attach every notice of breach, cure demand, and termination letter with dates intact — cure-period math is dispositive on many claims.",
      "For trade-secret matters, upload the confidentiality-policy documents and secrecy-measure evidence alongside the alleged misappropriation record.",
    ],
    attorneyResponsibilities: [
      "Confirm the governing law and forum-selection provision before relying on any state-specific UCC or business-tort analysis.",
      "Verify the economic-loss doctrine and applicable statute of limitations for the forum before advancing any tort theory that overlaps with a breach claim.",
      "Independently confirm the enforceability of any arbitration, limitation-of-liability, or non-compete clause under the forum's law.",
      "Do not file commercial work product without human review of every citation to a contract section, UCC provision, or case authority.",
    ],
    limitations: [
      "Business & Commercial Law Intelligence renders into the frozen 17-section canonical report — it does not produce a bespoke commercial-only template.",
      "The engine defers to the written agreement's choice-of-law clause; when the corpus is silent, it flags the assumption rather than choosing law for you.",
      "Warranty and disclaimer analysis assumes the written terms in the corpus control — post-hoc oral modifications require separate corroboration.",
      "The verification pipeline suppresses fabricated communications; it will not invent notices or cure demands that are missing from the record.",
    ],
    scenarios: [
      { title: "Pre-litigation posture", description: "Score breach exposure and damages ceiling before sending a demand letter so settlement negotiations start from an evidentiary basis." },
      { title: "Motion for preliminary injunction", description: "Assemble the trade-secret or non-compete predicate — likelihood of success, irreparable harm, balance of equities, public interest." },
      { title: "Arbitration vs. court", description: "Determine whether the dispute falls inside the arbitration clause's scope and whether any carve-outs (IP, injunctive relief) apply." },
    ],
    faqs: [
      { q: "Does Nyrava replace commercial trial counsel?", a: "No. Business & Commercial Law Intelligence is an analysis and drafting tool for licensed counsel. Every conclusion must be reviewed by an attorney before use." },
      { q: "Which UCC state adoption does the engine apply?", a: "The engine follows the choice-of-law clause when the corpus specifies one. When silent, it flags the assumption and defaults to the forum state's UCC Article 2 as adopted." },
      { q: "Can it handle mixed goods-and-services contracts?", a: "Yes. The engine applies the 'predominant purpose' test to decide whether Article 2 or the common law of contracts governs, and flags the analysis explicitly." },
      { q: "Can I draft complaints and motions from it?", a: "Yes. Draft complaints, cure demands, motions to compel arbitration, and TRO papers render into the Work Product section of the canonical report with citations to the underlying commercial record." },
    ],
    related: [RELATED_ALL.evidence, RELATED_ALL.timeline, RELATED_ALL.motion, RELATED_ALL.report, RELATED_ALL.trust, RELATED_ALL.ai],
  },
];

export function getProduct(slug: string): ProductPageContent | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

// Placeholder to keep `ReactNode` import used if callers extend later.
export type _Rn = ReactNode;
