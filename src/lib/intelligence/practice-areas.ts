// Practice Area Isolation Framework
// SINGLE SOURCE OF TRUTH for which intelligence executes and renders per
// legal practice area. Governs:
//   - which analyzers/engines may run        (ALLOWED_ANALYZERS)
//   - which finding modules may persist      (ALLOWED_FINDING_MODULES)
//   - which motion families may be drafted   (ALLOWED_MOTION_TYPES)
//   - which terms are forbidden in prose     (TERMINOLOGY_BLOCKLIST)
//   - which report sections render           (PRACTICE_SECTIONS)
//   - which workspace tabs appear            (PRACTICE_TABS)
//
// Every helper accepts an optional `activeDomains` set so a controlled
// cross-domain activation (cross-domain.server.ts) widens — never narrows —
// the base policy. The set must already contain the base area; helpers
// union the policies for every domain in the set.

export type PracticeArea =
  | "criminal"
  | "civil_rights"
  | "general_civil"
  | "personal_injury"
  | "medical_malpractice"
  | "employment"
  | "family"
  | "appellate"
  | "tax_law"
  | "corporate"
  | "commercial"
  | "ip"
  | "real_estate"
  | "estate"
  | "securities"
  | "banking"
  | "fintech"
  | "amparo";

// ---------------------------------------------------------------------------
// Section + Tab registries (unchanged shape, retained for export/UI)
// ---------------------------------------------------------------------------

export const UNIVERSAL_SECTIONS = new Set<string>([
  "exec",
  "action_center",
  "impact_dashboard",
  "overview",
  "facts",
  "timeline",
  "findings",
  "evidence_map",
  "evidence_intel",
  "coverage",
  "agent_stats",
  "contradictions",
  "witnesses",
  "legal_issues",
  "work_product",
  "audit",
  "appendix",
]);

const PRACTICE_SECTIONS: Record<PracticeArea, string[]> = {
  criminal: [
    "constitutional",
    "discovery",
    "cross_exam",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  civil_rights: [
    "constitutional",
    "discovery",
    "cross_exam",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  general_civil: [
    "discovery",
    "cross_exam",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  personal_injury: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  medical_malpractice: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  employment: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  family: ["theories", "opportunities", "strategy_synthesis", "recommendations", "scorecard", "perspectives"],
  appellate: ["theories", "recommendations", "scorecard", "risk"],
  // Base profile is civil tax controversy (audit, deficiency, Tax Court).
  // "constitutional" and "cross_exam" are NOT in the base list — they
  // unlock automatically via the charging-doc cross-domain trigger
  // (see cross-domain.server.ts) the moment a criminal tax-fraud charging
  // document (indictment, criminal information, etc.) enters the corpus.
  tax_law: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // Corporate Law — governance, M&A, due diligence, fiduciary duty.
  // No constitutional/cross_exam by default (transactional/advisory work);
  // discovery is retained because corporate litigation posture matters.
  corporate: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // Business / Commercial Law — contract disputes, UCC Article 2 sales,
  // tortious interference, unfair competition, business torts. Litigation-
  // heavy discipline, so retains discovery, cross_exam, and risk sections.
  commercial: [
    "discovery",
    "cross_exam",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // Intellectual Property — patent, trademark, copyright, trade secret.
  ip: [
    "discovery",
    "cross_exam",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // Real Estate — transactions, title, land use, landlord/tenant, foreclosure.
  real_estate: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // Estate Planning & Probate — wills, trusts, contested estates, fiduciary administration.
  estate: ["theories", "opportunities", "strategy_synthesis", "recommendations", "scorecard", "risk", "perspectives"],
  // Securities Regulation — issuer disclosure, 10b-5, insider trading, enforcement.
  securities: [
    "discovery",
    "cross_exam",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // Banking & Lending — commercial loans, workouts, UCC Article 9, regulatory compliance.
  banking: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // FinTech — payments, digital assets, money transmission, consumer finance.
  fintech: [
    "discovery",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
  // Amparo — constitutional review of an acto de autoridad. Narrow by
  // nature (record-based review, not a fresh evidentiary trial), so no
  // "discovery" or "cross_exam" by default; "constitutional" carries the
  // core analysis (acto reclamado, garantías violadas, suplencia de la
  // queja). Widens automatically via cross-domain activation if the
  // underlying act itself involves an unrelated substantive area (e.g. an
  // amparo challenging a labor-board ruling also touches employment law).
  amparo: [
    "constitutional",
    "theories",
    "opportunities",
    "strategy_synthesis",
    "recommendations",
    "scorecard",
    "risk",
    "perspectives",
  ],
};

export const UNIVERSAL_TABS = new Set<string>([
  "dashboard",
  "strategic",
  "attack",
  "evidence",
  "findings",
  "intel",
  "analyzers",
  "agents",
  "witnesses",
  "work",
  "chat",
  "report",
]);

const PRACTICE_TABS: Record<PracticeArea, string[]> = {
  criminal: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  civil_rights: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  general_civil: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  personal_injury: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  medical_malpractice: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  employment: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  family: ["perspectives", "strategy", "theories", "opportunities", "scorecard"],
  appellate: ["strategy", "theories", "scorecard"],
  tax_law: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  corporate: ["perspectives", "strategy", "theories", "opportunities", "scorecard"],
  commercial: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  ip: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  real_estate: ["perspectives", "strategy", "theories", "opportunities", "scorecard"],
  estate: ["perspectives", "strategy", "theories", "opportunities", "scorecard"],
  securities: ["perspectives", "strategy", "theories", "opportunities", "trial", "scorecard"],
  banking: ["perspectives", "strategy", "theories", "opportunities", "scorecard"],
  fintech: ["perspectives", "strategy", "theories", "opportunities", "scorecard"],
  amparo: ["perspectives", "strategy", "theories", "opportunities", "scorecard"],
};

// ---------------------------------------------------------------------------
// Analyzer / engine allow-lists. Engine ids match docs/ARCHITECTURE.md §2
// and engine-audit.server.ts::EngineName.
//
// Engines NOT listed here are universal infrastructure (extraction, ocr,
// fact_extraction, timeline, scoring, ess_validator, claim_validator,
// report_generator, report_validator, analyzers, agents). Practice-area
// gating only applies to PRACTICE_GATED_ENGINES below.
// ---------------------------------------------------------------------------

export const UNIVERSAL_ENGINES = new Set<string>([
  "extraction",
  "ocr",
  "entity_extraction",
  "fact_extraction",
  "evidence_intelligence",
  "contradictions",
  "timeline",
  "evidence_map",
  "discovery_gaps",
  "witness_intelligence",
  "scoring",
  "ess_validator",
  "claim_validator",
  "report_generator",
  "report_validator",
  "analyzers",
  "agents",
]);

// Engines that ONLY run for specific practice areas. Listed here so we can
// quickly decide "should this engine even start?" without re-deriving from
// the full registry.
// Engines that ONLY run for specific practice areas. The agent engines
// (constitutional_compliance, chain_of_custody, procedural_violations) are
// gated here too so the agent dispatcher can skip them entirely for
// non-criminal matters instead of generating Miranda / 4th Amendment /
// chain-of-custody / FRCP-deadline findings on contract disputes,
// employment, malpractice, etc.
//
// FIX (2026-07-13): procedural_violations was defined in the AGENTS array
// (pipeline.server.ts) and dispatched every run, but was never added to this
// gate set or to PRACTICE_ENGINES.criminal below. isAnalyzerAllowed() then
// always returned false for it on every case type, so runAgents() recorded
// it as "Skipped — Not Applicable" (0ms, no provider, no tokens) on 100% of
// runs, regardless of case type. Adding it here re-enables it for the case
// types where FRCP/FRCrP/local-rule/deadline violations are actually a live
// issue (criminal, civil_rights).
export const PRACTICE_GATED_ENGINES = new Set<string>([
  "constitutional_compliance",
  "chain_of_custody",
  "procedural_violations",
  "trial_prep",
  "cross_examination",
]);

const PRACTICE_ENGINES: Record<PracticeArea, string[]> = {
  criminal: [
    "constitutional_compliance",
    "chain_of_custody",
    "procedural_violations",
    "trial_prep",
    "cross_examination",
  ],
  civil_rights: [
    "constitutional_compliance",
    "chain_of_custody",
    "procedural_violations",
    "trial_prep",
    "cross_examination",
  ],
  general_civil: ["trial_prep", "cross_examination"],
  personal_injury: ["trial_prep"],
  medical_malpractice: ["trial_prep"],
  employment: ["trial_prep"],
  family: [],
  appellate: [],
  // Civil tax controversy (audit defense, Tax Court petitions) needs
  // trial_prep + cross_examination (deposing/cross-examining revenue agents,
  // accountants, appraisers) but NOT the criminal-only agents by default.
  // Those four (constitutional_compliance, chain_of_custody,
  // procedural_violations, plus the criminal jury-metrics framing in
  // trial_prep) activate automatically the moment a charging document
  // (indictment, criminal information, etc.) is detected in the case
  // corpus — see cross-domain.server.ts's charging-doc trigger, which
  // tax_law is deliberately NOT exempted from.
  tax_law: ["trial_prep", "cross_examination"],
  // Corporate matters routinely reach deposition (§ 220 books-and-records,
  // derivative suits, M&A busted-deal litigation) so cross_examination
  // stays on; trial_prep is enabled for the litigated subset.
  corporate: ["trial_prep", "cross_examination"],
  // Commercial litigation routinely reaches deposition and trial
  // (breach-of-contract, UCC sales disputes, business torts).
  commercial: ["trial_prep", "cross_examination"],
  ip: ["trial_prep", "cross_examination"],
  real_estate: [],
  estate: [],
  securities: ["trial_prep", "cross_examination"],
  banking: ["trial_prep"],
  fintech: [],
  amparo: ["constitutional_compliance", "procedural_violations"],
};

// ---------------------------------------------------------------------------
// Finding-module allow-lists. `case_findings.source_module` is matched as a
// prefix (e.g. "engine:miranda:foo" matches the "miranda" entry).
//
// The categories below mirror the spec's case-type rule sets. A module name
// here is the canonical short tag the rest of the system uses.
// ---------------------------------------------------------------------------

const UNIVERSAL_FINDING_MODULES = [
  "extraction",
  "fact",
  "timeline",
  "witness",
  "evidence",
  "contradiction",
  "dispute",
  "discovery_gap",
  "coverage",
  "scoring",
  "ess",
  "validator",
  "misc",
];

// Source_module wrapper tokens that carry no domain information — must be
// ignored when matching policy. Without this filter, any "engine:..." or
// "agent:..." prefix would be treated as universally allowed.
const MODULE_NOISE_TOKENS = new Set<string>([
  "engine",
  "engines",
  "agent",
  "agents",
  "analyzer",
  "analyzers",
  "intelligence",
  "report",
  "reports",
  "general",
  "module",
  "modules",
  "source",
  "src",
  "v1",
  "v2",
]);

const PRACTICE_FINDING_MODULES: Record<PracticeArea, string[]> = {
  criminal: [
    "carpeta_de_investigacion",
    "vinculacion_a_proceso",
    "medidas_cautelares",
    "prision_preventiva_oficiosa",
    "cadena_de_custodia",
    "debido_proceso",
    "presuncion_de_inocencia",
    "defensa_adecuada",
    "datos_de_prueba",
    "individualizacion_sancion",
    "salidas_alternas",
    "trial_strategy",
    "procedural",
    // Tax-fraud specific — only reachable on a tax_law case once the
    // charging-doc cross-domain trigger activates "criminal" (or on a
    // criminal case type directly).
    "tax_evasion",
    "defraudacion_fiscal",
    "willfulness",
    "false_return",
  ],
  civil_rights: [
    "constitutional",
    "qualified_immunity",
    "section_1983",
    "fourth_amendment",
    "first_amendment",
    "excessive_force",
    "monell",
    "brady",
    "giglio",
    "procedural",
  ],
  general_civil: [
    "contrato",
    "incumplimiento_contractual",
    "hecho_ilicito",
    "responsabilidad_civil_subjetiva",
    "responsabilidad_civil_objetiva",
    "dano_material",
    "dano_moral",
    "danos_y_perjuicios",
    "nulidad_absoluta",
    "nulidad_relativa",
    "rescision_contractual",
    "cumplimiento_forzoso",
    "vicios_del_consentimiento",
    "prescripcion_negativa",
    "mora",
    "gestion_de_negocios",
    "enriquecimiento_ilegitimo",
    "ofrecimiento_de_pruebas",
    "excepciones_dilatorias",
    "excepciones_perentorias",
    "civil_procedure_mx",
  ],
  personal_injury: [
    "liability",
    "damages",
    "negligence",
    "causation",
    "medical_treatment",
    "lost_wages",
    "future_damages",
    "comparative_fault",
    "premises",
  ],
  medical_malpractice: [
    "standard_of_care",
    "causation",
    "damages",
    "informed_consent",
    "medical_records",
    "expert_testimony",
    "medical_timeline",
  ],
  employment: [
    "wrongful_termination",
    "discrimination",
    "retaliation",
    "ada",
    "fmla",
    "eeoc",
    "hr_records",
    "payroll",
    "wage_hour",
    "harassment",
    "hostile_work",
  ],
  family: [
    "custody",
    "parenting",
    "child_support",
    "spousal_support",
    "property_division",
    "visitation",
    "best_interests",
  ],
  appellate: ["preserved_error", "standard_of_review", "appellate_brief", "record_citation", "harmless_error"],
  tax_law: [
    // Civil tax controversy — always allowed.
    "tax_deficiency",
    "notice_of_deficiency",
    "tax_court",
    "innocent_spouse",
    "penalty_abatement",
    "offer_in_compromise",
    "collection_due_process",
    "audit_reconsideration",
    "tax_liability",
    "tax_lien",
    "tax_levy",
    "burden_of_proof",
  ],
  corporate: [
    "corporate_governance",
    "fiduciary_duty",
    "business_judgment",
    "duty_of_care",
    "duty_of_loyalty",
    "duty_of_good_faith",
    "caremark",
    "revlon",
    "unocal",
    "self_dealing",
    "conflict_of_interest",
    "shareholder_agreement",
    "operating_agreement",
    "bylaws",
    "articles_of_incorporation",
    "board_resolution",
    "board_minutes",
    "corporate_minutes",
    "director_liability",
    "officer_liability",
    "derivative_action",
    "books_and_records",
    "section_220",
    "merger",
    "acquisition",
    "asset_purchase",
    "stock_purchase",
    "due_diligence",
    "corporate_compliance",
    "corporate_disclosure",
    "corporate_governance_gap",
    "entity_structure",
    "corporate_dissolution",
  ],
  commercial: [
    "contract",
    "contract_formation",
    "contract_interpretation",
    "breach",
    "breach_of_contract",
    "material_breach",
    "anticipatory_repudiation",
    "conditions_precedent",
    "waiver_estoppel",
    "modification",
    "novation",
    "assignment",
    "delegation",
    "third_party_beneficiary",
    "damages",
    "consequential_damages",
    "liquidated_damages",
    "mitigation",
    "specific_performance",
    "rescission",
    "reformation",
    "unjust_enrichment",
    "quantum_meruit",
    "promissory_estoppel",
    "misrepresentation",
    "fraud_in_inducement",
    "negligent_misrepresentation",
    "tortious_interference",
    "interference_with_contract",
    "interference_with_prospective_advantage",
    "unfair_competition",
    "trade_secret",
    "misappropriation",
    "duty_of_good_faith",
    "ucc_article_2",
    "goods",
    "sale_of_goods",
    "warranty",
    "express_warranty",
    "implied_warranty",
    "merchantability",
    "fitness_particular_purpose",
    "disclaimer",
    "conforming_goods",
    "perfect_tender",
    "revocation_of_acceptance",
    "cover",
    "commercial_impracticability",
    "force_majeure",
    "guaranty",
    "indemnity_clause",
    "limitation_of_liability",
    "choice_of_law",
    "forum_selection",
    "arbitration_clause",
    "commercial_discovery",
    "commercial_motion",
  ],
  ip: [
    "patent",
    "patent_infringement",
    "claim_construction",
    "markman",
    "obviousness",
    "anticipation",
    "prior_art",
    "inequitable_conduct",
    "willful_infringement",
    "doctrine_of_equivalents",
    "prosecution_history_estoppel",
    "patent_eligibility",
    "section_101",
    "section_102",
    "section_103",
    "section_112",
    "trademark",
    "trademark_infringement",
    "likelihood_of_confusion",
    "dilution",
    "genericness",
    "trade_dress",
    "secondary_meaning",
    "descriptive_fair_use",
    "nominative_fair_use",
    "lanham_act",
    "copyright",
    "copyright_infringement",
    "substantial_similarity",
    "fair_use",
    "dmca",
    "safe_harbor",
    "derivative_work",
    "work_for_hire",
    "registration",
    "trade_secret",
    "misappropriation",
    "reasonable_secrecy_measures",
    "improper_means",
    "defend_trade_secrets_act",
    "dtsa",
    "utsa",
    "licensing",
    "license_scope",
    "royalty",
    "assignment",
    "ip_ownership",
    "inventorship",
    "authorship",
    "chain_of_title",
    "ip_discovery",
    "ip_motion",
    "injunction",
  ],
  real_estate: [
    "purchase_agreement",
    "sale_agreement",
    "closing",
    "title",
    "title_defect",
    "title_insurance",
    "marketable_title",
    "quiet_title",
    "adverse_possession",
    "prescriptive_easement",
    "easement",
    "encumbrance",
    "lien",
    "mechanics_lien",
    "deed",
    "warranty_deed",
    "quitclaim",
    "grant_deed",
    "recording",
    "chain_of_title",
    "mortgage",
    "deed_of_trust",
    "foreclosure",
    "judicial_foreclosure",
    "non_judicial_foreclosure",
    "deficiency_judgment",
    "redemption",
    "reinstatement",
    "lease",
    "landlord_tenant",
    "eviction",
    "unlawful_detainer",
    "quiet_enjoyment",
    "constructive_eviction",
    "habitability",
    "security_deposit",
    "commercial_lease",
    "cam_charges",
    "zoning",
    "variance",
    "conditional_use",
    "land_use",
    "subdivision",
    "ceqa",
    "nepa",
    "eminent_domain",
    "condemnation",
    "regulatory_taking",
    "inverse_condemnation",
    "hoa",
    "cc_and_r",
    "covenants",
    "restrictive_covenants",
    "boundary_dispute",
    "escrow",
    "closing_disclosure",
    "respa",
    "tila",
    "disclosure_violation",
    "real_estate_discovery",
    "real_estate_motion",
  ],
  estate: [
    "will",
    "testamentary_capacity",
    "undue_influence",
    "duress",
    "fraud_in_execution",
    "revocation",
    "codicil",
    "holographic_will",
    "attestation",
    "witness_requirement",
    "self_proving_affidavit",
    "trust",
    "revocable_trust",
    "irrevocable_trust",
    "spendthrift",
    "trust_amendment",
    "trust_restatement",
    "pour_over",
    "fiduciary_duty",
    "trustee_duty",
    "duty_of_loyalty",
    "duty_of_impartiality",
    "duty_to_account",
    "self_dealing",
    "prudent_investor",
    "probate",
    "letters_testamentary",
    "letters_of_administration",
    "intestate",
    "intestate_succession",
    "elective_share",
    "pretermitted_heir",
    "omitted_spouse",
    "omitted_child",
    "beneficiary_designation",
    "pod",
    "tod",
    "joint_tenancy",
    "community_property",
    "estate_tax",
    "gift_tax",
    "gst",
    "portability",
    "marital_deduction",
    "charitable_deduction",
    "power_of_attorney",
    "advance_directive",
    "guardianship",
    "conservatorship",
    "capacity",
    "will_contest",
    "trust_contest",
    "no_contest_clause",
    "in_terrorem",
    "estate_discovery",
    "estate_motion",
    "petition_for_probate",
    "petition_for_instructions",
  ],
  securities: [
    "10b_5",
    "rule_10b_5",
    "material_misstatement",
    "material_omission",
    "scienter",
    "loss_causation",
    "transaction_causation",
    "reliance",
    "fraud_on_the_market",
    "basic_v_levinson",
    "section_11",
    "section_12",
    "section_15",
    "registration_statement",
    "prospectus",
    "s_1",
    "s_3",
    "s_4",
    "form_10_k",
    "form_10_q",
    "form_8_k",
    "item_303",
    "mdna",
    "risk_factor",
    "insider_trading",
    "tipping",
    "misappropriation_theory",
    "classical_theory",
    "regulation_fd",
    "regulation_d",
    "rule_506",
    "accredited_investor",
    "regulation_s",
    "regulation_a",
    "investment_adviser",
    "advisers_act",
    "investment_company_act",
    "ica",
    "sec_enforcement",
    "wells_notice",
    "wells_submission",
    "administrative_proceeding",
    "cease_and_desist",
    "disgorgement",
    "civil_penalty",
    "sarbanes_oxley",
    "sox",
    "internal_controls",
    "icfr",
    "section_302",
    "section_404",
    "section_906",
    "dodd_frank",
    "whistleblower",
    "clawback",
    "securities_class_action",
    "pslra",
    "lead_plaintiff",
    "particularity",
    "safe_harbor_forward_looking",
    "beneficial_ownership",
    "13d",
    "13g",
    "section_16",
    "short_swing",
    "securities_discovery",
    "securities_motion",
  ],
  banking: [
    "loan_agreement",
    "credit_agreement",
    "term_loan",
    "revolver",
    "revolving_credit",
    "syndicated_loan",
    "letter_of_credit",
    "commitment_letter",
    "term_sheet",
    "promissory_note",
    "guaranty",
    "surety",
    "subordination",
    "intercreditor",
    "security_agreement",
    "ucc_article_9",
    "ucc_1",
    "financing_statement",
    "perfection",
    "priority",
    "purchase_money_security_interest",
    "pmsi",
    "collateral",
    "attachment",
    "default",
    "event_of_default",
    "acceleration",
    "workout",
    "forbearance",
    "waiver_and_amendment",
    "cure",
    "cross_default",
    "cross_collateralization",
    "foreclosure",
    "repossession",
    "self_help",
    "commercially_reasonable",
    "deficiency",
    "surplus",
    "strict_foreclosure",
    "bankruptcy_stay",
    "automatic_stay",
    "relief_from_stay",
    "adequate_protection",
    "cash_collateral",
    "dip_financing",
    "preference",
    "fraudulent_transfer",
    "truth_in_lending",
    "tila",
    "respa",
    "ecoa",
    "fair_lending",
    "hmda",
    "cra",
    "flood_disaster_protection_act",
    "bank_secrecy_act",
    "bsa",
    "aml",
    "sar",
    "ctr",
    "ofac",
    "sanctions",
    "kyc",
    "cip",
    "usury",
    "loan_participation",
    "assignment_of_loan",
    "servicing",
    "escrow",
    "regulation_z",
    "regulation_b",
    "regulation_e",
    "regulation_o",
    "regulation_w",
    "banking_discovery",
    "banking_motion",
  ],
  fintech: [
    "money_transmission",
    "money_transmitter_license",
    "mtl",
    "state_licensing",
    "finCEN",
    "msb",
    "payments",
    "ach",
    "nacha",
    "same_day_ach",
    "wire",
    "card_network",
    "interchange",
    "durbin_amendment",
    "psp",
    "payment_processor",
    "digital_asset",
    "cryptocurrency",
    "stablecoin",
    "token",
    "utility_token",
    "security_token",
    "howey_test",
    "reves_test",
    "custody_of_digital_assets",
    "qualified_custodian",
    "cold_storage",
    "consumer_finance",
    "buy_now_pay_later",
    "bnpl",
    "installment_loan",
    "earned_wage_access",
    "ewa",
    "cfpb",
    "udaap",
    "prepaid_card",
    "gift_card",
    "regulation_e_error_resolution",
    "kyc",
    "cip",
    "aml",
    "bsa",
    "sar",
    "ctr",
    "ofac",
    "sanctions",
    "screening",
    "smart_contract",
    "defi",
    "dex",
    "aml_travel_rule",
    "vasp",
    "data_privacy",
    "gdpr",
    "ccpa",
    "cpra",
    "glba",
    "cybersecurity",
    "nydfs_500",
    "part_500",
    "banking_as_a_service",
    "baas",
    "sponsor_bank",
    "true_lender",
    "bank_partnership",
    "electronic_signature",
    "e_sign",
    "ueta",
    "fintech_discovery",
    "fintech_motion",
  ],
  // Amparo-specific finding tags: procedencia/improcedencia analysis,
  // the challenged act and responsible authority, suspension, and
  // suplencia de la queja (the court's duty to supplement deficient
  // pleading in favor of the quejoso in certain matters — labor, agrarian,
  // criminal defendants, minors).
  amparo: [
    "acto_reclamado",
    "autoridad_responsable",
    "conceptos_de_violacion",
    "procedencia",
    "improcedencia",
    "suspension",
    "suplencia_de_la_queja",
    "violacion_derechos_humanos",
    "interes_juridico",
    "interes_legitimo",
  ],
};

// ---------------------------------------------------------------------------
// Motion-type allow-lists. Motion families the Motion Center may draft.
// Match is by lowercased prefix on `motion_type` / `category`.
// ---------------------------------------------------------------------------

const UNIVERSAL_MOTION_TYPES = ["procedural", "scheduling", "in_limine"];

const PRACTICE_MOTION_TYPES: Record<PracticeArea, string[]> = {
  criminal: [
    "solicitud_de_no_vinculacion",
    "impugnacion_medidas_cautelares",
    "suspension_condicional",
    "acuerdo_reparatorio",
    "procedimiento_abreviado",
    "recurso_de_apelacion",
    "amparo_indirecto_penal",
  ],
  civil_rights: ["summary_judgment", "preliminary_injunction", "qualified_immunity", "section_1983", "discovery"],
  general_civil: [
    "summary_judgment",
    "dismiss",
    "compel",
    "protective_order",
    "sanctions",
    "amend",
    "remand",
    "discovery",
  ],
  personal_injury: ["summary_judgment", "compel", "protective_order", "daubert", "expert", "discovery"],
  medical_malpractice: ["daubert", "expert", "summary_judgment", "compel", "discovery"],
  employment: ["summary_judgment", "compel", "protective_order", "discovery", "class_certification"],
  family: [
    "custody_modification",
    "support_modification",
    "temporary_orders",
    "contempt",
    "visitation",
    "protective_order",
  ],
  appellate: ["extension", "rehearing", "stay", "supplemental_brief", "judicial_notice"],
  tax_law: [
    "tax_court_petition",
    "deficiency",
    "collection_due_process",
    "innocent_spouse",
    "offer_in_compromise",
    "refund_suit",
    "summary_judgment",
    "compel",
    "discovery",
  ],
  corporate: [
    "books_and_records",
    "section_220",
    "derivative",
    "derivative_action",
    "preliminary_injunction",
    "summary_judgment",
    "dismiss",
    "compel",
    "protective_order",
    "expedited_proceedings",
    "board_resolution",
    "corporate_minutes",
    "shareholder_consent",
    "merger_approval",
    "asset_purchase_agreement",
    "stock_purchase_agreement",
    "due_diligence_request",
    "disclosure_schedule",
    "discovery",
  ],
  commercial: [
    "breach_of_contract",
    "declaratory_judgment",
    "specific_performance",
    "preliminary_injunction",
    "tro",
    "temporary_restraining_order",
    "summary_judgment",
    "partial_summary_judgment",
    "judgment_on_pleadings",
    "dismiss",
    "compel",
    "protective_order",
    "sanctions",
    "amend",
    "remand",
    "expert",
    "daubert",
    "attachment",
    "sequestration",
    "confess_judgment",
    "confirm_arbitration",
    "vacate_arbitration",
    "compel_arbitration",
    "stay_pending_arbitration",
    "class_certification",
    "discovery",
  ],
  ip: [
    "preliminary_injunction",
    "permanent_injunction",
    "summary_judgment",
    "markman_hearing",
    "claim_construction_brief",
    "dismiss",
    "compel",
    "protective_order",
    "expert",
    "daubert",
    "seizure_order",
    "tro",
    "temporary_restraining_order",
    "discovery",
  ],
  real_estate: [
    "quiet_title",
    "specific_performance",
    "summary_judgment",
    "dismiss",
    "compel",
    "protective_order",
    "unlawful_detainer",
    "preliminary_injunction",
    "lis_pendens",
    "interplead_escrow",
    "discovery",
  ],
  estate: [
    "petition_for_probate",
    "petition_for_instructions",
    "will_contest",
    "trust_contest",
    "petition_to_compel_accounting",
    "petition_to_remove_fiduciary",
    "summary_judgment",
    "dismiss",
    "compel",
    "discovery",
  ],
  securities: [
    "motion_to_dismiss_pslra",
    "summary_judgment",
    "class_certification",
    "lead_plaintiff_motion",
    "dismiss",
    "compel",
    "protective_order",
    "discovery",
  ],
  banking: [
    "summary_judgment",
    "dismiss",
    "compel",
    "protective_order",
    "relief_from_stay",
    "replevin",
    "appointment_of_receiver",
    "discovery",
  ],
  fintech: [
    "summary_judgment",
    "dismiss",
    "compel",
    "protective_order",
    "preliminary_injunction",
    "class_certification",
    "discovery",
  ],
  // Not US "motions" — the actual filing types in an amparo proceeding.
  amparo: [
    "demanda_de_amparo",
    "incidente_de_suspension",
    "recurso_de_revision",
    "recurso_de_queja",
  ],
};

// ---------------------------------------------------------------------------
// Terminology blocklist — phrases that must not appear in generated prose
// for the given area unless an additional domain unlocking them is active.
// Matched as case-insensitive whole-word regex by the consumer.
// ---------------------------------------------------------------------------

const PRACTICE_BLOCKED_TERMS: Record<PracticeArea, string[]> = {
  criminal: [
    "custody dispute",
    "child custody",
    "spousal support",
    "wrongful termination",
    "title vii",
    "discrimination claim",
    "payroll records",
    "miranda",
    "grand jury",
    "plea bargain",
    "felony",
    "misdemeanor",
    "district attorney",
  ],
  civil_rights: ["child custody", "spousal support", "payroll records", "divorce"],
  general_civil: [
    "miranda",
    "brady violation",
    "search and seizure",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  personal_injury: [
    "miranda",
    "brady violation",
    "criminal procedure",
    "indictment",
    "child custody",
    "spousal support",
    "title vii",
  ],
  medical_malpractice: [
    "miranda",
    "brady violation",
    "criminal procedure",
    "indictment",
    "child custody",
    "spousal support",
  ],
  employment: ["miranda", "brady violation", "criminal procedure", "indictment", "child custody", "spousal support"],
  family: [
    "miranda",
    "brady violation",
    "search and seizure",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "wrongful termination",
    "title vii",
    "eeoc",
    "medical malpractice",
    "standard of care",
  ],
  appellate: [
    // appellate work is meta — most domain-specific terms are allowed in
    // quotation; we only block aggressively cross-domain assertions.
  ],
  // Civil by default — a routine audit/deficiency dispute must not be
  // narrated with criminal-conviction language. These unblock automatically
  // the instant the charging-doc cross-domain trigger activates "criminal"
  // (getBlockedTerms deletes any term also present in an active domain's
  // own PRACTICE_BLOCKED_TERMS/PRACTICE_FINDING_MODULES list).
  tax_law: [
    "miranda",
    "indictment",
    "grand jury",
    "sentencing",
    "search and seizure",
    "criminal procedure",
    "child custody",
    "spousal support",
    "wrongful termination",
    "title vii",
  ],
  corporate: [
    "miranda",
    "brady violation",
    "search and seizure",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  commercial: [
    "miranda",
    "brady violation",
    "search and seizure",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  ip: [
    "miranda",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  real_estate: [
    "miranda",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  estate: [
    "miranda",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  securities: [
    "miranda",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  banking: [
    "miranda",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  fintech: [
    "miranda",
    "criminal procedure",
    "indictment",
    "grand jury",
    "sentencing",
    "child custody",
    "spousal support",
    "medical malpractice",
    "standard of care",
    "wrongful termination",
    "title vii",
    "eeoc",
  ],
  // Amparo is a narrow constitutional-review proceeding — block scope
  // creep into unrelated substantive civil-law domains that shouldn't
  // appear unless a real cross-domain activation widens the analysis.
  amparo: ["pensión alimenticia", "divorcio", "herencia", "contrato mercantil", "despido injustificado"],
};

// ---------------------------------------------------------------------------
// Field-scrub map (post-pipeline belt-and-braces — should be empty in normal
// runs once execution gates take hold).
// ---------------------------------------------------------------------------

const FORBIDDEN_REPORT_FIELDS: Record<PracticeArea, string[]> = {
  criminal: [],
  civil_rights: [],
  general_civil: ["constitutional_issues", "constitutional_issues_struct"],
  personal_injury: ["constitutional_issues", "constitutional_issues_struct", "cross_examination"],
  medical_malpractice: ["constitutional_issues", "constitutional_issues_struct", "cross_examination"],
  employment: ["constitutional_issues", "constitutional_issues_struct", "cross_examination"],
  family: ["constitutional_issues", "constitutional_issues_struct", "cross_examination", "discovery_analysis"],
  appellate: ["cross_examination", "discovery_analysis"],
  // cross_examination stays available (Tax Court proceedings routinely
  // cross-examine revenue agents, accountants, appraisers). constitutional
  // fields are scrubbed by default and only repopulate once the
  // charging-doc trigger activates the criminal domain.
  tax_law: ["constitutional_issues", "constitutional_issues_struct"],
  corporate: ["constitutional_issues", "constitutional_issues_struct"],
  commercial: ["constitutional_issues", "constitutional_issues_struct"],
  // Transactional/advisory-heavy practice areas — constitutional issues and
  // criminal cross-examination framing never apply unless a cross-domain
  // trigger activates a litigation domain on top.
  ip: ["constitutional_issues", "constitutional_issues_struct"],
  real_estate: ["constitutional_issues", "constitutional_issues_struct", "cross_examination"],
  estate: ["constitutional_issues", "constitutional_issues_struct", "cross_examination"],
  securities: ["constitutional_issues", "constitutional_issues_struct"],
  banking: ["constitutional_issues", "constitutional_issues_struct", "cross_examination"],
  fintech: ["constitutional_issues", "constitutional_issues_struct", "cross_examination"],
  amparo: [],
};

// ---------------------------------------------------------------------------
// Normalization + helpers
// ---------------------------------------------------------------------------

export function normalizePracticeArea(v: unknown): PracticeArea {
  const s = String(v ?? "").toLowerCase();
  if (
    s === "criminal" ||
    s === "civil_rights" ||
    s === "general_civil" ||
    s === "personal_injury" ||
    s === "medical_malpractice" ||
    s === "employment" ||
    s === "family" ||
    s === "appellate" ||
    s === "tax_law" ||
    s === "corporate" ||
    s === "commercial" ||
    s === "ip" ||
    s === "real_estate" ||
    s === "estate" ||
    s === "securities" ||
    s === "banking" ||
    s === "fintech"
  )
    return s;
  // Common aliases callers might use
  if (s === "corporate_law" || s === "corporate_governance") return "corporate";
  if (
    s === "commercial_law" ||
    s === "business" ||
    s === "business_law" ||
    s === "business_commercial" ||
    s === "contract_dispute" ||
    s === "breach_of_contract" ||
    s === "commercial_dispute" ||
    s === "commercial_litigation"
  )
    return "commercial";
  if (
    s === "intellectual_property" ||
    s === "patent" ||
    s === "patent_law" ||
    s === "trademark" ||
    s === "trademark_law" ||
    s === "copyright" ||
    s === "copyright_law" ||
    s === "trade_secret" ||
    s === "trade_secret_law"
  )
    return "ip";
  if (
    s === "real_property" ||
    s === "real_property_law" ||
    s === "property_law" ||
    s === "landlord_tenant" ||
    s === "landlord_tenant_law"
  )
    return "real_estate";
  if (
    s === "estate_planning" ||
    s === "probate" ||
    s === "probate_law" ||
    s === "trusts_and_estates" ||
    s === "trust_and_estate" ||
    s === "wills_and_trusts" ||
    s === "guardianship" ||
    s === "conservatorship"
  )
    return "estate";
  if (
    s === "securities_law" ||
    s === "securities_regulation" ||
    s === "securities_fraud" ||
    s === "sec" ||
    s === "sec_enforcement"
  )
    return "securities";
  if (s === "banking_law" || s === "lending" || s === "lending_law" || s === "commercial_lending" || s === "loan_law")
    return "banking";
  if (
    s === "financial_technology" ||
    s === "fin_tech" ||
    s === "payments" ||
    s === "payments_law" ||
    s === "digital_assets" ||
    s === "crypto" ||
    s === "cryptocurrency_law"
  )
    return "fintech";
  return "general_civil";
}

type AreaInput = PracticeArea | string | null | undefined;
type DomainSet = ReadonlySet<string> | ReadonlyArray<string> | null | undefined;

function effectiveAreas(area: AreaInput, activeDomains: DomainSet): PracticeArea[] {
  const set = new Set<PracticeArea>([normalizePracticeArea(area)]);
  if (activeDomains) for (const d of activeDomains) set.add(normalizePracticeArea(d));
  return Array.from(set);
}

// -------- Sections / tabs --------

export function getApplicableSections(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_SECTIONS);
  for (const a of effectiveAreas(area, activeDomains)) for (const s of PRACTICE_SECTIONS[a]) out.add(s);
  return out;
}
export function isSectionApplicable(area: AreaInput, sectionId: string, activeDomains?: DomainSet): boolean {
  return getApplicableSections(area, activeDomains).has(sectionId);
}

export function getApplicableTabs(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_TABS);
  for (const a of effectiveAreas(area, activeDomains)) for (const t of PRACTICE_TABS[a]) out.add(t);
  return out;
}
export function isTabApplicable(area: AreaInput, tabKey: string, activeDomains?: DomainSet): boolean {
  return getApplicableTabs(area, activeDomains).has(tabKey);
}

// -------- Analyzers --------

export function getAllowedAnalyzers(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_ENGINES);
  for (const a of effectiveAreas(area, activeDomains)) for (const e of PRACTICE_ENGINES[a]) out.add(e);
  return out;
}
export function isAnalyzerAllowed(area: AreaInput, engineId: string, activeDomains?: DomainSet): boolean {
  if (UNIVERSAL_ENGINES.has(engineId)) return true;
  return getAllowedAnalyzers(area, activeDomains).has(engineId);
}

// -------- Finding modules (prefix-match) --------

export function getAllowedFindingModules(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_FINDING_MODULES);
  for (const a of effectiveAreas(area, activeDomains)) for (const m of PRACTICE_FINDING_MODULES[a]) out.add(m);
  return out;
}
export function isFindingAllowed(
  area: AreaInput,
  sourceModule: string | null | undefined,
  activeDomains?: DomainSet,
): boolean {
  const m = String(sourceModule ?? "").toLowerCase();
  if (!m) return true; // nothing to gate on; let downstream validators decide
  const allowed = getAllowedFindingModules(area, activeDomains);
  // Source module convention: "<wrapper>:<domain>[:<sub>]" — e.g.
  // "engine:miranda:violation", "agent:custody:primary", or a single compound
  // token like "engine:constitutional_compliance". Wrapper/sub tokens are
  // noise; everything else is the domain signal.
  const tokens = m.split(/[^a-z0-9_]+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !MODULE_NOISE_TOKENS.has(t));
  if (meaningful.length === 0) return true; // pure wrapper id — let validators decide
  const domainToken = meaningful[0];

  // 1. Exact match on the whole first token (covers "miranda", and
  //    colon-separated compounds like "engine:chain_of_custody").
  if (allowed.has(domainToken)) return true;

  // 2. Multi-word allowed module (e.g. "chain_of_custody") as a substring of
  //    the full joined path — catches suffixed variants like
  //    "chain_of_custody_primary".
  const joined = meaningful.join("_");
  for (const a of allowed) if (a.includes("_") && joined.includes(a)) return true;

  // 3. Compound single token where the domain word leads and a modifier
  //    trails ("constitutional_compliance", "witness_credibility",
  //    "procedural_violations"). Only the FIRST word of the token carries
  //    the domain signal — checking every word would let a generic
  //    universal module name (e.g. "dispute") falsely match an unrelated
  //    compound like "custody_dispute" just because it appears as a
  //    trailing component.
  const firstWord = domainToken.split("_")[0];
  if (firstWord && firstWord !== domainToken && allowed.has(firstWord)) return true;

  return false;
}

// -------- Motion types --------

export function getAllowedMotionTypes(area: AreaInput, activeDomains?: DomainSet): Set<string> {
  const out = new Set<string>(UNIVERSAL_MOTION_TYPES);
  for (const a of effectiveAreas(area, activeDomains)) for (const t of PRACTICE_MOTION_TYPES[a]) out.add(t);
  return out;
}
export function isMotionAllowed(
  area: AreaInput,
  motionType: string | null | undefined,
  activeDomains?: DomainSet,
): boolean {
  const m = String(motionType ?? "")
    .toLowerCase()
    .trim();
  if (!m) return true;
  const allowed = getAllowedMotionTypes(area, activeDomains);
  for (const a of allowed) if (m === a || m.startsWith(a) || m.includes(a)) return true;
  return false;
}

// -------- Terminology --------

export function getBlockedTerms(area: AreaInput, activeDomains?: DomainSet): string[] {
  const base = new Set<string>(PRACTICE_BLOCKED_TERMS[normalizePracticeArea(area)]);
  // Anything unlocked by an active domain is REMOVED from the blocklist.
  for (const d of effectiveAreas(area, activeDomains).slice(1)) {
    for (const t of PRACTICE_FINDING_MODULES[d]) base.delete(t);
    for (const t of PRACTICE_BLOCKED_TERMS[d]) base.delete(t);
  }
  return Array.from(base);
}

/** Returns the list of blocked terms that appear in `text`. */
export function findBlockedTermsIn(text: string, area: AreaInput, activeDomains?: DomainSet): string[] {
  const terms = getBlockedTerms(area, activeDomains);
  if (terms.length === 0 || !text) return [];
  const hits: string[] = [];
  const lower = String(text).toLowerCase();
  for (const t of terms) if (lower.includes(t.toLowerCase())) hits.push(t);
  return hits;
}

// -------- Scrub helpers (unchanged) --------

export function getForbiddenReportFields(area: AreaInput): string[] {
  return FORBIDDEN_REPORT_FIELDS[normalizePracticeArea(area)];
}

export function scrubReportForPracticeArea<T extends Record<string, unknown>>(report: T, area: AreaInput): T {
  const fields = getForbiddenReportFields(area);
  for (const k of fields) {
    if (k in report) {
      const v = report[k];
      if (Array.isArray(v)) (report as Record<string, unknown>)[k] = [];
      else if (typeof v === "string") (report as Record<string, unknown>)[k] = "";
      else if (v && typeof v === "object") (report as Record<string, unknown>)[k] = {};
      else (report as Record<string, unknown>)[k] = null;
    }
  }
  return report;
}

export const PRACTICE_AREA_LABELS: Record<PracticeArea, string> = {
  criminal: "Criminal",
  civil_rights: "Civil Rights (§1983)",
  general_civil: "General Civil",
  personal_injury: "Personal Injury",
  medical_malpractice: "Medical Malpractice",
  employment: "Employment",
  family: "Family Law",
  appellate: "Appellate",
  tax_law: "Tax Law",
  corporate: "Corporate Law",
  commercial: "Business & Commercial Law",
  ip: "Intellectual Property",
  real_estate: "Real Estate",
  estate: "Estate Planning & Probate",
  securities: "Securities Law",
  banking: "Banking Law",
  fintech: "Financial Technology (FinTech)",
  amparo: "Juicio de Amparo",
};

// ---------------------------------------------------------------------------
// Shared UI option list — SINGLE SOURCE for every case-type <select>/<option>
// in the app. Previously these three lists were copy-pasted independently
// in CaseControlPanel.tsx, new.tsx, and cases.$caseId.tsx, which meant a new
// practice area (like tax_law) had to be added by hand in three places and
// could silently drift out of sync. Import CASE_TYPE_SELECT_OPTIONS instead.
// ---------------------------------------------------------------------------

export interface CaseTypeSelectOption {
  value: PracticeArea;
  label: string;
}

export interface CaseTypeSelectGroup {
  group: string;
  options: CaseTypeSelectOption[];
}

export const CASE_TYPE_SELECT_GROUPS: CaseTypeSelectGroup[] = [
  {
    group: "Civil",
    options: [
      { value: "general_civil", label: "General civil" },
      { value: "personal_injury", label: "Personal injury / motor vehicle" },
      { value: "medical_malpractice", label: "Medical malpractice" },
      { value: "employment", label: "Employment" },
      { value: "family", label: "Family law" },
      { value: "appellate", label: "Appellate" },
    ],
  },
  {
    group: "Tax",
    options: [{ value: "tax_law", label: "Tax law (audit, Tax Court, or fraud)" }],
  },
  {
    group: "Corporate & Transactional",
    options: [
      { value: "corporate", label: "Corporate law (governance, M&A, due diligence)" },
      { value: "commercial", label: "Business & commercial law (contracts, UCC, business torts)" },
      { value: "ip", label: "Intellectual property (patent, trademark, copyright, trade secret)" },
      { value: "real_estate", label: "Real estate (transactions, title, landlord/tenant)" },
      { value: "estate", label: "Estate planning & probate (wills, trusts, guardianship)" },
      { value: "securities", label: "Securities law (disclosure, enforcement, 10b-5)" },
      { value: "banking", label: "Banking law (lending, workouts, UCC Article 9)" },
      { value: "fintech", label: "FinTech (payments, digital assets, money transmission)" },
    ],
  },
  {
    group: "Criminal / civil rights",
    options: [
      { value: "criminal", label: "Criminal" },
      { value: "civil_rights", label: "Civil rights (§1983)" },
    ],
  },
  {
    group: "Constitucional",
    options: [{ value: "amparo", label: "Juicio de Amparo" }],
  },
];

/** Flat list — convenient for plain (non-grouped) <select> pickers. */
export const CASE_TYPE_SELECT_OPTIONS: CaseTypeSelectOption[] = CASE_TYPE_SELECT_GROUPS.flatMap((g) => g.options);

/** Canonical reason string written to `pipeline_engine_runs.skipped_reason`. */
export const SKIP_REASON_NOT_APPLICABLE = "not_applicable_to_case_type";

// ---------------------------------------------------------------------------
// Case-Type Manifest
// ---------------------------------------------------------------------------
// Snapshot of what the engine intends to execute for a given case BEFORE the
// run starts. Persisted on the report and emitted to pipeline_events so the
// audit trail shows the routing decision separately from the outcome.

export interface CaseTypeManifest {
  case_type: PracticeArea;
  case_type_label: string;
  enabled_engines: string[];
  skipped_engines: string[];
  cross_domain_engines: string[];
  active_domains: string[];
  enabled_sections: string[];
  enabled_tabs: string[];
  allowed_motion_types: string[];
  generated_at: string;
}

const ALL_PRACTICE_ENGINES = new Set<string>(Object.values(PRACTICE_ENGINES).flat());

export function buildCaseTypeManifest(area: AreaInput, activeDomains?: DomainSet): CaseTypeManifest {
  const base = normalizePracticeArea(area);
  const domains = new Set<string>();
  if (activeDomains)
    for (const d of activeDomains) {
      const n = normalizePracticeArea(d);
      if (n !== base) domains.add(n);
    }
  const allowed = getAllowedAnalyzers(base, domains);
  const enabled: string[] = [];
  const skipped: string[] = [];
  const cross: string[] = [];
  const basePolicy = new Set<string>([...UNIVERSAL_ENGINES, ...PRACTICE_ENGINES[base]]);
  for (const e of UNIVERSAL_ENGINES) enabled.push(e);
  for (const e of ALL_PRACTICE_ENGINES) {
    if (basePolicy.has(e)) enabled.push(e);
    else if (allowed.has(e)) cross.push(e);
    else skipped.push(e);
  }
  return {
    case_type: base,
    case_type_label: PRACTICE_AREA_LABELS[base],
    enabled_engines: Array.from(new Set(enabled)).sort(),
    skipped_engines: skipped.sort(),
    cross_domain_engines: cross.sort(),
    active_domains: Array.from(domains).sort(),
    enabled_sections: Array.from(getApplicableSections(base, domains)).sort(),
    enabled_tabs: Array.from(getApplicableTabs(base, domains)).sort(),
    allowed_motion_types: Array.from(getAllowedMotionTypes(base, domains)).sort(),
    generated_at: new Date().toISOString(),
  };
}
