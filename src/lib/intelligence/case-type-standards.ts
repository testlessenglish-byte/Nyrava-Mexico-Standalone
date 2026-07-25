// Case-type-specific legal standards injected into report-generation prompts.
//
// Purpose: give the LLM domain-grade legal knowledge (controlling standards,
// leading cases, canonical motions, evidentiary hooks, damages framework)
// keyed to the detected practice area. This is the competitive moat — no
// competitor injects domain law at this granularity.
//
// Usage:
//   import { buildCaseTypeStandardsBlock } from "@/lib/intelligence/case-type-standards";
//   const standardsBlock = buildCaseTypeStandardsBlock(caseType);
//   const systemInstruction = base + "\n" + standardsBlock;
//
// The block is a plain-text prompt fragment. It is deliberately concise
// (<1200 tokens per area) so it never dominates the token budget.

import { normalizePracticeArea, type PracticeArea } from "./practice-areas";

export interface CaseTypeStandards {
  label: string;
  controlling_standards: string;
  key_cases: string[];
  canonical_motions: string[];
  evidentiary_rules: string[];
  damages_or_remedies: string;
  drafting_notes: string;
}

const STANDARDS: Record<PracticeArea, CaseTypeStandards> = {
  criminal: {
    label: "Criminal Defense",
    controlling_standards:
      "Prosecution must prove every element beyond a reasonable doubt (In re Winship, 397 U.S. 358 (1970)). Fourth Amendment governs searches/seizures; Fifth Amendment governs custodial interrogation and self-incrimination; Sixth Amendment governs confrontation, counsel, and speedy trial; Fourteenth Amendment incorporates these to the states. Brady/Giglio impose an ongoing duty to disclose exculpatory and impeachment material.",
    key_cases: [
      "Brady v. Maryland, 373 U.S. 83 (1963) — duty to disclose exculpatory evidence",
      "Giglio v. United States, 405 U.S. 150 (1972) — impeachment material re: cooperating witnesses",
      "Miranda v. Arizona, 384 U.S. 436 (1966) — custodial interrogation warnings",
      "Terry v. Ohio, 392 U.S. 1 (1968) — investigative stops require reasonable suspicion",
      "Arizona v. Gant, 556 U.S. 332 (2009) — vehicle search incident to arrest",
      "Franks v. Delaware, 438 U.S. 154 (1978) — challenging warrant affidavit veracity",
      "Crawford v. Washington, 541 U.S. 36 (2004) — Confrontation Clause / testimonial hearsay",
      "Strickland v. Washington, 466 U.S. 668 (1984) — ineffective assistance of counsel",
    ],
    canonical_motions: [
      "Motion to Suppress (4th Am. / Miranda / voluntariness)",
      "Motion to Dismiss (speedy trial, statute of limitations, defective charging document)",
      "Franks Hearing Motion (false statements in warrant affidavit)",
      "Brady/Giglio Discovery Motion",
      "Motion in Limine (prior bad acts under FRE 404(b); prior convictions under FRE 609)",
      "Motion for Bill of Particulars",
    ],
    evidentiary_rules: [
      "Chain of custody must be established for physical evidence (FRE 901)",
      "Prior consistent/inconsistent statements: FRE 613, 801(d)(1)",
      "Character evidence limits: FRE 404, 405, 608",
      "Confessions: voluntariness under Jackson v. Denno, 378 U.S. 368 (1964)",
    ],
    damages_or_remedies:
      "Remedies: suppression of unlawfully obtained evidence, dismissal, sentence mitigation, acquittal. There are no monetary damages in a criminal case; strategy centers on suppression, negotiation, and trial acquittal.",
    drafting_notes:
      "Every IRAC block must state the constitutional or statutory rule with the correct case citation and year. Every motion must identify the specific evidence to be suppressed or claim to be dismissed, with pinpoint [DOC N p.M] citations. Do NOT invent Miranda facts absent an interrogation record.",
  },

  civil_rights: {
    label: "Civil Rights (§ 1983)",
    controlling_standards:
      "42 U.S.C. § 1983 requires (1) conduct by a person acting under color of state law that (2) deprives the plaintiff of a right secured by the Constitution or federal law. Qualified immunity shields officials unless the right was 'clearly established' at the time. Municipal liability requires a policy, custom, or failure to train (Monell).",
    key_cases: [
      "Monell v. Dep't of Soc. Servs., 436 U.S. 658 (1978) — municipal liability policy/custom",
      "Graham v. Connor, 490 U.S. 386 (1989) — excessive force objective reasonableness",
      "Tennessee v. Garner, 471 U.S. 1 (1985) — deadly force standard",
      "Harlow v. Fitzgerald, 457 U.S. 800 (1982) — qualified immunity framework",
      "Pearson v. Callahan, 555 U.S. 223 (2009) — QI two-step order flexible",
      "City of Canton v. Harris, 489 U.S. 378 (1989) — failure-to-train Monell theory",
    ],
    canonical_motions: [
      "Opposition to Motion to Dismiss on Qualified Immunity",
      "Motion for Summary Judgment on Monell / policy liability",
      "Motion to Compel training records, IA files, prior complaints",
      "Motion for Preliminary Injunction (ongoing constitutional violation)",
    ],
    evidentiary_rules: [
      "Prior IA complaints, use-of-force reports, and training records are core discovery",
      "Body-cam / dash-cam authenticated under FRE 901; audio under 902(6)",
      "Expert testimony on police practices under Daubert / FRE 702",
    ],
    damages_or_remedies:
      "Compensatory damages (physical injury, emotional distress, medical), punitive against individual officers (not municipalities — City of Newport v. Fact Concerts, 453 U.S. 247 (1981)), attorney's fees under 42 U.S.C. § 1988, injunctive/declaratory relief.",
    drafting_notes:
      "For every excessive-force claim, apply Graham factors (severity of crime, immediate threat, active resistance) to the specific facts. For every QI defense, identify the 'clearly established' precedent by citation and year. Monell claims must plead the policy/custom/failure-to-train theory, not respondeat superior.",
  },

  personal_injury: {
    label: "Personal Injury",
    controlling_standards:
      "Negligence requires duty, breach, causation (both cause-in-fact and proximate), and damages. Comparative fault (pure or modified) reduces or bars recovery in most jurisdictions. Statutes of limitation typically 2–3 years; discovery rule tolls for latent injuries.",
    key_cases: [
      "Palsgraf v. Long Island R.R., 248 N.Y. 339 (1928) — foreseeability / proximate cause",
      "Daubert v. Merrell Dow Pharmaceuticals, 509 U.S. 579 (1993) — expert admissibility",
      "Summers v. Tice, 33 Cal. 2d 80 (1948) — alternative liability",
    ],
    canonical_motions: [
      "Motion for Summary Judgment on liability (undisputed negligence per se)",
      "Daubert Motion / Motion to Exclude Defense Expert",
      "Motion to Compel medical records, employer records, ELD/EDR data",
      "Motion in Limine re: collateral source rule",
    ],
    evidentiary_rules: [
      "Negligence per se: violation of safety statute establishes duty + breach",
      "Res ipsa loquitur when instrumentality in defendant's exclusive control",
      "Medical bills authenticated under FRE 803(6); life-care plans require expert",
      "ELD / black-box data authenticated under FRE 901 + 902(13)–(14)",
    ],
    damages_or_remedies:
      "Economic (past + future medical, lost earnings, diminished earning capacity, life-care plan), non-economic (pain and suffering, loss of consortium), punitive if reckless/malicious. Preserve future-damages theory with expert testimony.",
    drafting_notes:
      "Every liability theory must map duty → breach → causation → damages with citations. Cite the specific safety regulation for negligence per se (e.g., 49 C.F.R. § 395.8 for FMCSA hours-of-service). Damages sections must separate economic and non-economic with numeric ranges when supported by the corpus.",
  },

  medical_malpractice: {
    label: "Medical Malpractice",
    controlling_standards:
      "Plaintiff must prove (1) the standard of care applicable to the defendant provider, (2) breach of that standard, (3) causation (typically requires expert testimony that the breach more likely than not caused the injury), and (4) damages. Most states require a certificate of merit or affidavit of a qualified expert filed with or shortly after the complaint.",
    key_cases: [
      "Helling v. Carey, 83 Wn.2d 514 (1974) — standard of care can exceed customary practice",
      "Daubert v. Merrell Dow Pharmaceuticals, 509 U.S. 579 (1993) — expert admissibility",
    ],
    canonical_motions: [
      "Motion to Compel complete medical records + audit trail (EMR metadata)",
      "Daubert Motion re: defense causation expert",
      "Motion for Summary Judgment on informed-consent claim",
      "Motion in Limine re: subsequent remedial measures (FRE 407)",
    ],
    evidentiary_rules: [
      "Expert affidavit typically required at filing (state-specific)",
      "Learned treatise exception FRE 803(18)",
      "Business records exception for medical records FRE 803(6)",
      "EMR audit trails frequently admissible to show alteration/timing",
    ],
    damages_or_remedies:
      "Economic (past + future medical, lost earnings), non-economic (pain and suffering — often statutorily capped), wrongful death per state statute, loss of chance in some jurisdictions.",
    drafting_notes:
      "State the applicable standard of care with the source (specialty board guideline, expert affidavit, learned treatise) before analyzing breach. Every causation opinion must be more-likely-than-not, not 'possible.' Identify EMR audit-trail entries with pinpoint citations when timeline manipulation is alleged.",
  },

  employment: {
    label: "Employment Law",
    controlling_standards:
      "Title VII of the Civil Rights Act of 1964 (42 U.S.C. § 2000e) prohibits discrimination based on race, color, religion, sex, national origin. ADA (42 U.S.C. § 12101) prohibits disability discrimination and requires reasonable accommodation. FMLA (29 U.S.C. § 2601) protects covered leave. Retaliation claims under 42 U.S.C. § 2000e-3(a) require protected activity, adverse action, and causal connection. McDonnell Douglas burden-shifting applies to pretext cases.",
    key_cases: [
      "McDonnell Douglas Corp. v. Green, 411 U.S. 792 (1973) — burden-shifting framework",
      "Burlington N. & Santa Fe Ry. Co. v. White, 548 U.S. 53 (2006) — retaliation standard",
      "Faragher v. Boca Raton, 524 U.S. 775 (1998) & Ellerth, 524 U.S. 742 (1998) — harassment affirmative defense",
      "Univ. of Tex. Sw. Med. Ctr. v. Nassar, 570 U.S. 338 (2013) — but-for causation for Title VII retaliation",
    ],
    canonical_motions: [
      "Opposition to Motion for Summary Judgment (pretext under McDonnell Douglas)",
      "Motion to Compel personnel files, HR investigation notes, Slack/email exports",
      "Motion for Class Certification (pattern-and-practice)",
      "Motion in Limine re: after-acquired evidence",
    ],
    evidentiary_rules: [
      "Comparator evidence — similarly situated employees treated more favorably",
      "Statistical evidence for pattern-and-practice cases",
      "Contemporaneous performance reviews contradicting termination memo are prime impeachment",
      "Slack/email exports authenticated under FRE 901 + 902(14)",
    ],
    damages_or_remedies:
      "Back pay, front pay, compensatory (emotional distress — statutorily capped by employer size under 42 U.S.C. § 1981a), punitive (same caps), reinstatement, attorney's fees under 42 U.S.C. § 2000e-5(k).",
    drafting_notes:
      "Every discrimination claim must complete the McDonnell Douglas frame: prima facie case → legitimate non-discriminatory reason → pretext. Highlight temporal proximity for retaliation. Contradictions between performance reviews and termination memo are the strongest impeachment lever — pinpoint-cite both.",
  },

  general_civil: {
    label: "General Civil Litigation",
    controlling_standards:
      "Contract claims require formation (offer, acceptance, consideration), breach, and damages. Tort claims require duty, breach, causation, damages. Federal Rules of Civil Procedure govern federal actions; state analogs (e.g., CCP) govern state actions. Rule 56 summary judgment: no genuine dispute of material fact and movant entitled to judgment as a matter of law (Celotex, Anderson, Matsushita trilogy).",
    key_cases: [
      "Celotex Corp. v. Catrett, 477 U.S. 317 (1986) — summary judgment burden",
      "Anderson v. Liberty Lobby, 477 U.S. 242 (1986) — genuine issue of material fact",
      "Ashcroft v. Iqbal, 556 U.S. 662 (2009) & Bell Atl. v. Twombly, 550 U.S. 544 (2007) — pleading plausibility",
      "Hadley v. Baxendale, 9 Ex. 341 (1854) — foreseeability of contract damages",
    ],
    canonical_motions: [
      "Motion to Dismiss (12(b)(6)) — plausibility under Twombly/Iqbal",
      "Motion for Summary Judgment (Rule 56)",
      "Motion to Compel (Rule 37) with meet-and-confer certification",
      "Motion for Protective Order (Rule 26(c))",
      "Motion for Sanctions (Rule 11, Rule 37)",
    ],
    evidentiary_rules: [
      "Parol evidence rule limits extrinsic evidence contradicting integrated writings",
      "Business records exception FRE 803(6) for internal memos, ledgers, invoices",
      "Statements of party opponent FRE 801(d)(2) — emails between principals",
      "Authentication of electronic records FRE 901, 902(13)–(14)",
    ],
    damages_or_remedies:
      "Contract: expectation, reliance, restitution damages; specific performance for unique goods/real property. Tort: compensatory + punitive when clear and convincing evidence of malice/oppression/fraud. Attorney's fees only when contract or statute provides.",
    drafting_notes:
      "For every breach-of-contract claim, quote the contract provision and the breach conduct side-by-side with pinpoint citations. Damages must tie to a specific measure (expectation vs. reliance). Cite Twombly/Iqbal explicitly when opposing motion to dismiss.",
  },

  family: {
    label: "Family Law",
    controlling_standards:
      "Custody governed by best-interests-of-the-child standard with state-specific factor lists (e.g., Cal. Fam. Code § 3011; UMDA § 402). Child support calculated by state guideline (income shares or percentage). Property division: community property or equitable distribution depending on jurisdiction. Domestic violence findings alter presumptions.",
    key_cases: ["Troxel v. Granville, 530 U.S. 57 (2000) — parental rights in custody disputes"],
    canonical_motions: [
      "Motion for Temporary Custody / Support Orders",
      "Motion to Modify Custody (substantial change in circumstances)",
      "Motion for Contempt (support arrears, visitation interference)",
      "Motion for Protective Order (DV)",
    ],
    evidentiary_rules: [
      "Financial affidavits and income statements are core discovery",
      "Custody evaluations by neutral evaluators admissible under state rules",
      "Communications between parents (text, email) frequently central impeachment",
    ],
    damages_or_remedies:
      "Custody / visitation orders, child support, spousal support (rehabilitative or long-term), equitable division of assets and debts, attorney's fees where statute provides.",
    drafting_notes:
      "Frame every custody argument through best-interests factors with citations to specific evidence (evaluations, incident reports, communications). Support calculations must show guideline math. Do NOT invoke criminal, employment, or medical-malpractice frameworks.",
  },

  appellate: {
    label: "Appellate Practice",
    controlling_standards:
      "Standards of review: de novo (legal), abuse of discretion (evidentiary/procedural), clear error (fact findings), substantial evidence (jury verdicts). Preservation of error is jurisdictional in most contexts — issues not raised below are typically waived. Harmless-error doctrine: reversal requires prejudice affecting substantial rights (FRCP 61, FRE 103, Kotteakos v. United States, 328 U.S. 750 (1946)).",
    key_cases: [
      "Chapman v. California, 386 U.S. 18 (1967) — harmless error beyond reasonable doubt (constitutional)",
      "Kotteakos v. United States, 328 U.S. 750 (1946) — non-constitutional harmless error",
      "Anders v. California, 386 U.S. 738 (1967) — appointed appellate counsel duties",
    ],
    canonical_motions: [
      "Motion for Extension of Time (FRAP 26(b))",
      "Motion for Rehearing / Rehearing En Banc (FRAP 40, 35)",
      "Motion for Stay Pending Appeal (FRAP 8)",
      "Motion for Judicial Notice (FRE 201)",
    ],
    evidentiary_rules: [
      "Appellate record is limited to what was before the trial court",
      "Judicial notice under FRE 201 is the primary vehicle to expand the record",
    ],
    damages_or_remedies:
      "Affirmance, reversal, remand with instructions, new trial, judgment as a matter of law. Appellate courts do not award damages directly.",
    drafting_notes:
      "Identify the standard of review for every issue. Cite the trial record page and line for every factual assertion. Show preservation of error (motion, objection, offer of proof) before addressing the merits.",
  },

  tax_law: {
    label: "Tax Law",
    controlling_standards:
      "CIVIL TRACK (default): The Commissioner's deficiency determination is presumptively correct; the taxpayer bears the burden of proving it wrong by a preponderance of the evidence (Welch v. Helvering), except IRC § 7491 shifts the burden to the IRS on factual issues if the taxpayer produces credible evidence and has maintained required records. Tax Court petitions must be filed within 90 days of a Notice of Deficiency (IRC § 6213). Substantiation of deductions follows the Cohan rule where records are incomplete but a rational basis exists to estimate. Accuracy-related penalties under IRC § 6662 require reasonable-cause-and-good-faith analysis (§ 6664(c)). Innocent spouse relief (IRC § 6015) requires no actual knowledge of the understatement. CRIMINAL TRACK (activates automatically once an indictment, criminal information, or IRS-CID referral appears in the corpus): Tax evasion (26 U.S.C. § 7201) and willful failure to file/pay (§ 7203) require proof of willfulness beyond a reasonable doubt — a voluntary, intentional violation of a known legal duty (Cheek v. United States), not mere negligence or a good-faith misunderstanding of the law. False statements on a return (§ 7206(1)) require a knowing false statement as to a material matter.",
    key_cases: [
      "Welch v. Helvering, 290 U.S. 111 (1933) — taxpayer bears burden of proving Commissioner's determination wrong",
      "Cohan v. Commissioner, 39 F.2d 540 (2d Cir. 1930) — courts may estimate deductible expenses absent exact records",
      "Commissioner v. Soliman, 506 U.S. 168 (1993) — home-office / principal-place-of-business deduction standard",
      "INDOPCO v. Commissioner, 503 U.S. 79 (1992) — capitalize vs. currently deduct",
      "Cheek v. United States, 498 U.S. 192 (1991) — willfulness requires knowledge of and intentional violation of a known legal duty (criminal track)",
      "United States v. Klein, 247 F.2d 908 (2d Cir. 1957) — conspiracy to impede IRS functions (criminal track)",
      "Boyle v. United States, 469 U.S. 241 (1985) — reliance on an agent does not excuse a late-filing penalty",
    ],
    canonical_motions: [
      "Tax Court Petition (contesting a Notice of Deficiency, IRC § 6213)",
      "Motion for Collection Due Process hearing (IRC §§ 6320, 6330)",
      "Innocent Spouse Relief Petition (IRC § 6015)",
      "Offer in Compromise / Doubt as to Collectibility submission",
      "Motion to Compel IRS administrative file / workpapers production",
      "Refund Suit (26 U.S.C. § 7422; full-payment rule under Flora v. United States)",
      "[Criminal track only, once charging docs present] Motion to Suppress (4th/5th Amendment re: IRS-CID interviews), Motion to Dismiss Indictment, Kastigar/immunity motions where prior civil-audit statements are at issue",
    ],
    evidentiary_rules: [
      "Substantiation burden — receipts, mileage logs, and contemporaneous records under IRC § 274(d) for travel/entertainment/listed property",
      "Bank-deposits and net-worth methods of proof are common in both audit reconstruction and criminal tax-fraud prosecutions — flag which method the corpus supports",
      "Badges of fraud (civil § 6663 / criminal willfulness): consistent underreporting, concealment of assets, inadequate records, implausible or shifting explanations",
      "Fifth Amendment implications where a civil audit interview could be used against the taxpayer in a parallel or subsequent criminal referral",
    ],
    damages_or_remedies:
      "Civil: deficiency plus interest (IRC § 6601), accuracy-related penalty (20%, § 6662) or fraud penalty (75%, § 6663), abatement, installment agreement, offer in compromise, innocent spouse relief. Criminal: fine and/or imprisonment (up to 5 years for § 7201 evasion, up to 1 year for § 7203 willful failure to file), restitution, and the collateral civil deficiency/fraud-penalty exposure that typically follows a conviction.",
    drafting_notes:
      "Default every IRAC block to CIVIL terminology (deficiency, liability, penalty abatement, Tax Court) unless the corpus contains a charging document, at which point criminal terminology (willfulness, evasion, conviction/acquittal) becomes appropriate for the criminal-track sections only — never blend the two frames in the same finding. Always identify which burden-of-proof rule applies (default Commissioner-presumed-correct vs. § 7491 shift) before assessing case strength. Do NOT characterize a taxpayer as having committed 'tax fraud' or 'evasion' absent a charging document or an explicit fraud-penalty determination in the record — reasoning errors and negligence are civil, not criminal, matters.",
  },

  corporate: {
    label: "Corporate Law",
    controlling_standards:
      "Corporate governance is anchored in the state of incorporation's business-organizations code — most publicly cited authority is Delaware General Corporation Law (DGCL), with the Model Business Corporation Act (MBCA) governing many other states. Directors and officers owe fiduciary duties of care and loyalty to the corporation and its shareholders; the business judgment rule (BJR) presumes that in making a business decision, directors acted on an informed basis, in good faith, and in the honest belief that the action was in the best interests of the company (Aronson v. Lewis). The BJR is rebutted by evidence of self-dealing, gross negligence, or bad faith, at which point entire fairness (fair dealing + fair price) governs. Enhanced scrutiny under Unocal applies to defensive measures against hostile takeovers; Revlon duties (maximize short-term shareholder value) attach once a sale of control becomes inevitable. Caremark establishes director oversight liability where the board utterly failed to implement any reporting or information system, or having implemented one, consciously failed to monitor it. DGCL § 220 provides shareholders a statutory right to inspect books and records for a proper purpose. DGCL § 251 governs mergers; § 262 provides appraisal rights. Federal securities-law disclosure duties (10b-5, Item 303 MD&A) attach to public issuers and can convert governance failures into securities-fraud exposure. LLCs are governed by the operating agreement first and the state LLC act as a default — fiduciary duties may be waived or limited by contract in most jurisdictions.",
    key_cases: [
      "Aronson v. Lewis, 473 A.2d 805 (Del. 1984) — business judgment rule presumption and demand futility",
      "Smith v. Van Gorkom, 488 A.2d 858 (Del. 1985) — gross negligence in an uninformed board decision defeats BJR",
      "Unocal Corp. v. Mesa Petroleum Co., 493 A.2d 946 (Del. 1985) — enhanced scrutiny of defensive measures",
      "Revlon, Inc. v. MacAndrews & Forbes Holdings, 506 A.2d 173 (Del. 1986) — sale-of-control triggers duty to maximize value",
      "In re Caremark Int'l Deriv. Litig., 698 A.2d 959 (Del. Ch. 1996) — director oversight / good-faith monitoring duty",
      "Stone v. Ritter, 911 A.2d 362 (Del. 2006) — bad-faith failure to monitor as breach of duty of loyalty",
      "Marchand v. Barnhill, 212 A.3d 805 (Del. 2019) — Caremark liability for failure to oversee mission-critical risk",
      "Weinberger v. UOP, Inc., 457 A.2d 701 (Del. 1983) — entire fairness (fair dealing + fair price) on interested transactions",
      "Kahn v. M&F Worldwide Corp., 88 A.3d 635 (Del. 2014) — MFW conditions for BJR review of controller squeeze-outs",
    ],
    canonical_motions: [
      "DGCL § 220 books-and-records demand and enforcement action",
      "Verified shareholder derivative complaint (demand or demand-futility pled with particularity, Ct. Ch. R. 23.1)",
      "Motion for expedited proceedings / preliminary injunction (deal litigation, disclosure claims)",
      "Motion to dismiss under Rule 23.1 (demand not excused) or Rule 12(b)(6)",
      "Motion for summary judgment on entire-fairness or Caremark oversight claims",
      "Application for appraisal (DGCL § 262) post-merger",
      "Board resolutions authorizing/rescinding transactions; shareholder written consents in lieu of meeting (DGCL § 228)",
      "Advancement / indemnification action under corporate bylaws and DGCL § 145",
    ],
    evidentiary_rules: [
      "Board minutes and unanimous written consents are the primary record of director deliberation — gaps, backdating, or missing signatures are material",
      "Internal presentations, financial models, and banker fairness opinions establish the informational basis on which directors relied (Van Gorkom)",
      "Emails and board-portal messages routinely defeat BJR where they show self-interest, deal-price shading, or coercion of independent directors",
      "Section 220 productions ('tools at hand') should be exhausted before pleading a derivative claim; failure to plead with particularity is dispositive",
      "Attorney-client privilege can be pierced under Garner v. Wolfinbarger, 430 F.2d 1093 (5th Cir. 1970), for good-cause shareholder claims",
      "Common-interest / joint-defense privilege is fragile in M&A contexts — flag every communication shared across deal parties",
    ],
    damages_or_remedies:
      "Direct damages against directors/officers (recoverable subject to DGCL § 102(b)(7) exculpation, which does not cover duty-of-loyalty or bad-faith breaches), rescission or rescissory damages on tainted transactions, disgorgement of improper benefits, appraisal (§ 262) as an alternative to challenging a merger, preliminary or permanent injunctions against deal-protection devices, and derivative recovery to the corporation. Indemnification and D&O insurance interact with any liability finding and must be analyzed together with the underlying claim.",
    drafting_notes:
      "Identify the state of incorporation (default to Delaware if not specified in the corpus, and say so). Every governance argument must cite the specific bylaw section, operating-agreement provision, or DGCL/MBCA section it turns on. Do NOT assert a Caremark, Revlon, or Unocal claim unless the corpus supports the factual predicate (mission-critical failure, sale of control, hostile-takeover context). Do NOT fabricate board minutes, resolutions, or shareholder consents — if the record is silent, the finding is 'missing governance record,' not a substantive breach. Distinguish LLC (contract-first, fiduciary waiver possible) from corporate (statutory) analysis in every finding. Never blur federal-securities disclosure claims with state-law fiduciary claims — treat them as parallel tracks that may overlap on the same conduct but require separate elements and pleading.",
  },

  commercial: {
    label: "Business & Commercial Law",
    controlling_standards:
      "Commercial disputes turn primarily on the parties' written agreement, filled in by (i) the common law of contracts (Restatement (Second) of Contracts) for services and mixed contracts, and (ii) UCC Article 2 (as adopted by the forum state) for the sale of goods. Contract formation requires offer, acceptance, consideration, and a manifested intent to be bound; UCC § 2-204 relaxes formalities for merchants and § 2-207 governs battle-of-the-forms. The parol evidence rule bars extrinsic evidence contradicting a fully-integrated writing but admits evidence to explain ambiguity, prove course of dealing (UCC § 1-303), or establish fraud in the inducement. Every contract carries an implied covenant of good faith and fair dealing that cannot be disclaimed. Breach is either 'material' (excusing further performance) or 'partial' (damages only); UCC § 2-601 imposes the 'perfect tender' rule on single-lot goods contracts, subject to cure (§ 2-508), installment-contract nuance (§ 2-612), and revocation of acceptance (§ 2-608). Warranty theory follows UCC § 2-313 (express), § 2-314 (implied warranty of merchantability), and § 2-315 (fitness for a particular purpose), each disclaimable under § 2-316 with conspicuous language. Damages are governed by the expectancy measure (Hadley v. Baxendale foreseeability limits consequentials), UCC §§ 2-708 / 2-712 / 2-713 / 2-715 for sales, plus reliance and restitution as alternatives. Business-tort claims (tortious interference with contract or with prospective advantage, misappropriation of trade secrets under state UTSA and federal DTSA, unfair competition, fraudulent misrepresentation) supplement contract theory where the wrongful conduct is independent of the breach itself.",
    key_cases: [
      "Hadley v. Baxendale, 9 Ex. 341 (1854) — foreseeability limit on consequential damages",
      "Hawkins v. McGee, 84 N.H. 114 (1929) — expectation measure of contract damages",
      "Lucy v. Zehmer, 84 S.E.2d 516 (Va. 1954) — objective theory of assent",
      "Jacob & Youngs v. Kent, 230 N.Y. 239 (1921) — substantial performance and cost-of-completion vs. diminution",
      "Peevyhouse v. Garland Coal & Mining Co., 382 P.2d 109 (Okla. 1962) — damages disproportionate to breach",
      "ProCD, Inc. v. Zeidenberg, 86 F.3d 1447 (7th Cir. 1996) — enforceability of shrink-wrap terms",
      "Klocek v. Gateway, Inc., 104 F. Supp. 2d 1332 (D. Kan. 2000) — UCC § 2-207 applied to consumer software terms",
      "Lumley v. Gye, 118 Eng. Rep. 749 (Q.B. 1853) — tortious interference with contract (foundational)",
      "Della Penna v. Toyota Motor Sales U.S.A., 902 P.2d 740 (Cal. 1995) — modern independently wrongful requirement for interference with prospective advantage",
      "E.I. duPont de Nemours & Co. v. Christopher, 431 F.2d 1012 (5th Cir. 1970) — misappropriation of trade secrets by improper means",
    ],
    canonical_motions: [
      "Complaint for breach of contract (with alternative counts: unjust enrichment, quantum meruit, promissory estoppel)",
      "Complaint or counterclaim for declaratory judgment interpreting a disputed clause",
      "Motion for preliminary injunction / TRO (non-compete, trade-secret misappropriation, tortious interference)",
      "Motion for summary judgment (integration/parol evidence, unambiguous contract interpretation, statute-of-frauds bar)",
      "Motion to compel arbitration and stay proceedings under the FAA (9 U.S.C. § 3)",
      "Motion to dismiss for failure to state a claim (economic-loss doctrine, statute of limitations, forum-selection clause)",
      "Motion in limine to exclude parol evidence and prior negotiations of an integrated writing",
      "Application for prejudgment attachment / writ of sequestration under the forum's civil practice act",
    ],
    evidentiary_rules: [
      "The signed writing is Exhibit A of the case — line-by-line clause tagging (integration, merger, notice, limitation-of-liability, choice-of-law, forum-selection, arbitration) governs which arguments are even available",
      "Course-of-dealing and course-of-performance evidence (UCC § 1-303) is admissible to explain ambiguity and prove trade usage",
      "Emails and negotiation drafts are the primary battleground for fraud-in-the-inducement and course-of-negotiation arguments; preservation and Bates numbering must be exhaustive",
      "Written notices of breach, cure demands, and termination letters establish or defeat the perfect-tender / cure / material-breach analysis under UCC § 2-508 and § 2-608",
      "Invoices, purchase orders, and acknowledgments drive the UCC § 2-207 battle-of-the-forms analysis — treat every document as a candidate offer, acceptance, or additional term",
      "Damage models must reconcile to admissible business records (Rule 803(6)); consequential-damages theories require foreseeability evidence at contract formation, not with hindsight",
    ],
    damages_or_remedies:
      "Expectation damages (benefit of the bargain), reliance damages (out-of-pocket loss when expectation is uncertain), restitution (disgorgement / unjust enrichment), consequential damages (Hadley foreseeability required and typically disclaimable), incidental damages, cover damages (UCC § 2-712) or market-price damages (UCC § 2-713) for buyers, resale damages (UCC § 2-706) or lost-profits damages (UCC § 2-708(2)) for sellers, specific performance for unique goods or land (UCC § 2-716), rescission and restitution for material breach or fraud, and injunctive relief in trade-secret and tortious-interference matters. Punitive damages are unavailable for pure contract breach but recoverable on independent tort theories (fraud, tortious interference, trade-secret misappropriation) where state law permits.",
    drafting_notes:
      "Identify the applicable regime first: goods (UCC Article 2), services (common law), or mixed (apply the 'predominant purpose' test). Every clause-based argument must cite the specific section of the contract. Do NOT treat every breach as material — apply the Restatement § 241 factors (extent of benefit received, adequacy of damages compensation, hardship, willfulness) and, for goods, distinguish single-lot (perfect tender) from installment (substantial impairment) analysis. Do NOT assert tortious interference or fraud in the inducement unless the corpus supports an independent wrongful act — the economic-loss doctrine bars tort claims that duplicate the breach. Flag every limitation-of-liability, indemnification, and integration clause and analyze how it limits or preserves each theory. Do NOT fabricate course-of-dealing evidence — if the corpus shows a single transaction, do not narrate a 'longstanding pattern.' Note the choice-of-law and forum-selection clause of the contract and confirm whether the pleading is filed in the correct forum before advancing case-strategy conclusions.",
  },

  ip: {
    label: "Intellectual Property",
    controlling_standards:
      "Patent validity/infringement is governed by Title 35 (§ 101 eligibility under Alice/Mayo, § 102 novelty, § 103 obviousness, § 112 enablement/definiteness); claim construction is a question of law decided by the court (Markman). Trademark claims turn on likelihood of confusion under the Lanham Act (15 U.S.C. § 1114, § 1125(a)) and, for dilution, § 1125(c). Copyright requires originality and a fixed, tangible medium (17 U.S.C. § 102); infringement requires access plus substantial similarity, subject to fair use (§ 107). Trade secret claims under the Defend Trade Secrets Act (18 U.S.C. § 1836) and state UTSA require (1) information deriving independent economic value from secrecy, (2) reasonable measures to maintain secrecy, and (3) misappropriation by improper means or breach of a duty of confidentiality.",
    key_cases: [
      "Alice Corp. v. CLS Bank Int'l, 573 U.S. 208 (2014) — patent-eligibility two-step framework",
      "Markman v. Westview Instruments, 517 U.S. 370 (1996) — claim construction is for the court",
      "KSR Int'l Co. v. Teleflex Inc., 550 U.S. 398 (2007) — obviousness / motivation to combine",
      "Two Pesos, Inc. v. Taco Cabana, Inc., 505 U.S. 763 (1992) — inherently distinctive trade dress",
      "Qualitex Co. v. Jacobson Prods. Co., 514 U.S. 159 (1995) — color marks require secondary meaning",
      "Feist Publications, Inc. v. Rural Tel. Serv. Co., 499 U.S. 340 (1991) — originality required for copyright",
      "Campbell v. Acuff-Rose Music, Inc., 510 U.S. 569 (1994) — transformative-use fair-use factor",
      "PepsiCo, Inc. v. Redmond, 54 F.3d 1262 (7th Cir. 1995) — inevitable-disclosure trade-secret theory",
    ],
    canonical_motions: [
      "Motion for claim construction (Markman hearing) and accompanying brief",
      "Motion to dismiss on patent-eligibility grounds (§ 101 / Alice)",
      "Motion for temporary restraining order / preliminary injunction (trade-secret misappropriation or trademark infringement)",
      "Motion to compel forensic imaging of departing-employee devices and cloud accounts",
      "Motion for summary judgment (non-infringement, invalidity, fair use, no likelihood of confusion)",
      "Motion for expedited discovery re: trade-secret identification (reasonable particularity)",
    ],
    evidentiary_rules: [
      "Invention disclosure records, lab notebooks, and assignment agreements establish priority and ownership — date-stamping is dispositive",
      "File-access logs, download timestamps, and forensic device images are the core proof of trade-secret exfiltration; chain of custody must be documented",
      "Confidentiality/NDA and IP-assignment agreement language controls who owns work product created during employment",
      "Consumer-confusion survey evidence and actual-confusion instances drive trademark likelihood-of-confusion analysis",
      "Prior-art search results and file histories are central to § 102/§ 103 validity challenges",
    ],
    damages_or_remedies:
      "Patent: lost profits or reasonable royalty (35 U.S.C. § 284), enhanced damages up to treble for willful infringement, injunctive relief (eBay v. MercExchange four-factor test). Trademark: defendant's profits, plaintiff's damages, corrective advertising, injunction. Copyright: actual damages plus infringer's profits, or statutory damages ($750–$150,000 per work for willful infringement) if timely registered, plus injunction. Trade secret: actual loss, unjust enrichment, reasonable royalty in lieu of injunction, exemplary damages up to 2x for willful/malicious misappropriation, and injunctive relief including a lead-time injunction.",
    drafting_notes:
      "Identify the specific IP right at issue (patent/trademark/copyright/trade secret) before applying any standard — they are not interchangeable and elements differ sharply. For trade-secret claims, require the corpus to establish 'reasonable measures' (marking, access controls, NDAs) before assuming secrecy. Do NOT infer bad-faith intent from access-log timing alone — reconcile against recruiter/offer-letter dates and resignation timeline before characterizing conduct as 'planned theft.' Do NOT invent prior art, priority dates, or survey data absent in the corpus.",
  },

  real_estate: {
    label: "Real Estate",
    controlling_standards:
      "Real property transactions are governed by the common law of contracts as modified by the statute of frauds (writing required for sale of land), state recording acts (race, notice, or race-notice, determining priority among competing claimants), and title/marketability doctrine (a seller must convey marketable title free of undisclosed encumbrances absent an 'as-is' or express assumption clause). Landlord-tenant disputes turn on the lease as the controlling instrument, implied covenants of quiet enjoyment and (in residential contexts) habitability, and estoppel certificates as binding representations to purchasers/lenders. Easements are created by express grant, implication (prior use), necessity, or prescription, and survive transfer of the servient estate as encumbrances of record.",
    key_cases: [
      "Sabo v. Horvath, 559 P.2d 1038 (Alaska 1976) — recording act priority and constructive notice",
      "Lohmeyer v. Bower, 227 P.2d 102 (Kan. 1951) — marketable title and undisclosed zoning/building violations",
      "Tulk v. Moxhay, 41 Eng. Rep. 1143 (Ch. 1848) — equitable servitudes run with the land",
      "Van Sandt v. Royster, 83 P.2d 698 (Kan. 1938) — implied easement from prior use",
      "Willard v. First Church of Christ, Scientist, 498 P.2d 987 (Cal. 1972) — reservation of easement in favor of a third party",
      "Raab v. Casper, 124 Cal. Rptr. 590 (Ct. App. 1975) — adverse possession elements",
    ],
    canonical_motions: [
      "Complaint for specific performance of a purchase and sale agreement",
      "Petition/complaint to quiet title",
      "Motion for declaratory judgment construing an easement, restrictive covenant, or lease provision",
      "Motion for preliminary injunction against encroachment or interference with easement rights",
      "Motion for summary judgment on marketable-title objection or recording-act priority",
      "Action for ejectment or unlawful detainer",
    ],
    evidentiary_rules: [
      "The title commitment/Schedule B exceptions define what is and is not insured and must be cross-checked line-by-line against the survey and recorded instruments",
      "A licensed survey is the authoritative document for encroachments, boundary disputes, and easement conformity — reconcile it against title exceptions before pleading any encroachment claim",
      "Estoppel certificates are representations relied on by buyers and lenders; discrepancies between an estoppel certificate and the seller's rent roll or lease file are material and must be flagged, not silently reconciled",
      "Recorded instruments (deeds, easements, liens) control priority under the forum's recording act; unrecorded amendments are not binding on bona fide purchasers without actual or inquiry notice",
    ],
    damages_or_remedies:
      "Specific performance (land is presumed unique), rescission and restitution, damages for breach of the purchase agreement (benefit-of-the-bargain or cover), quiet title, ejectment, injunctive relief against encroachment or easement interference, and — for landlord-tenant disputes — abatement of rent, lease termination, or damages for breach of the covenant of quiet enjoyment/habitability.",
    drafting_notes:
      "Reconcile every figure across title commitment, survey, rent roll, and estoppel certificate before characterizing a discrepancy as fraud, mistake, or an undisclosed amendment — identify which document is authoritative and why. Do NOT assume a jurisdiction's recording-act type unless stated in the corpus. Distinguish an insured title exception (already priced into the transaction) from an uninsured, newly discovered defect. Do NOT fabricate chain-of-title history not present in the corpus.",
  },

  estate: {
    label: "Estate Planning & Probate",
    controlling_standards:
      "Testamentary capacity requires the testator to understand (1) the nature and extent of their property, (2) the natural objects of their bounty, and (3) the nature of the act of making a will — a materially lower bar than contractual capacity. A will is presumptively valid if it satisfies the jurisdiction's execution formalities (writing, signature, attesting witnesses, and often a self-proving affidavit). Undue influence requires a confidential relationship plus active participation by the influencer in procuring a will that unnaturally benefits them, and may be presumed under 'suspicious circumstances' doctrine, shifting the burden to the proponent. Trustees and executors owe fiduciary duties of loyalty, prudence, and impartiality among beneficiaries under the Uniform Trust Code / Uniform Probate Code framework as adopted by the forum state.",
    key_cases: [
      "In re Kaufmann's Will, 247 N.Y.S.2d 664 (App. Div. 1964) — undue influence via confidential relationship",
      "Lipper v. Weslow, 369 S.W.2d 698 (Tex. Civ. App. 1963) — factors distinguishing persuasion from undue influence",
      "Latham v. Father Divine, 85 N.E.2d 168 (N.Y. 1949) — constructive trust for tortious interference with expectancy",
      "In re Groffman, [1969] 1 W.L.R. 733 — strict compliance with attestation formalities",
      "Marsman v. Nasca, 573 N.E.2d 1025 (Mass. App. Ct. 1991) — trustee's duty to inquire into beneficiary's needs",
    ],
    canonical_motions: [
      "Petition to admit will to probate / petition contesting probate of a will",
      "Petition to remove executor or trustee for breach of fiduciary duty",
      "Petition for accounting and surcharge against a fiduciary",
      "Motion for declaratory judgment construing an ambiguous will or trust provision",
      "Petition for appointment of a special/temporary administrator pending contest resolution",
    ],
    evidentiary_rules: [
      "Contemporaneous medical and facility records at or near the date of execution are the primary evidence on capacity — reconcile any conflict against the attorney's drafting/execution notes rather than crediting one source by default",
      "Attorney drafting files (client interview notes, prior will drafts, correspondence) are highly probative of both capacity and the testator's actual intent",
      "A self-proving affidavit creates a rebuttable presumption of due execution but does not itself establish capacity or the absence of undue influence",
      "Confidential-relationship evidence (power of attorney, caregiving role, isolation from family) combined with active procurement of the instrument supports the suspicious-circumstances presumption",
    ],
    damages_or_remedies:
      "Denial of probate (will contest success), constructive trust over property procured by undue influence or fraud, surcharge (personal financial liability) against a breaching fiduciary, removal and replacement of executor/trustee, compelled accounting, and reformation or construction of ambiguous instrument language. There are no punitive damages in most probate proceedings absent an independent tort claim.",
    drafting_notes:
      "Identify which instrument governs if multiple wills or trust amendments exist in the corpus, and state the execution date of each. Do NOT assume undue influence from a confidential relationship alone — the corpus must show active participation in procurement. Do NOT fabricate medical or psychiatric findings; if the record is silent on capacity at the execution date, say so as a finding rather than inferring capacity or incapacity. Distinguish testamentary capacity (low bar) from capacity to contract or manage property (higher bar) if both are at issue.",
  },

  securities: {
    label: "Securities Law",
    controlling_standards:
      "Section 10(b) of the Exchange Act and Rule 10b-5 prohibit material misstatements or omissions made with scienter, in connection with the purchase or sale of a security, on which the plaintiff relied (often via the fraud-on-the-market presumption for efficient markets), causing economic loss proximately traced to the revealed truth. The Private Securities Litigation Reform Act (PSLRA) requires plaintiffs to plead each misstatement with particularity and facts giving rise to a 'strong inference' of scienter. Section 11 of the Securities Act imposes near-strict liability for material misstatements in a registration statement. Insider trading liability rests on the classical theory (breach of duty to one's own shareholders) or the misappropriation theory (breach of duty to the source of confidential information), subject to the Rule 10b5-1 affirmative defense for trading plans adopted in good faith before the trader possessed material nonpublic information.",
    key_cases: [
      "Basic Inc. v. Levinson, 485 U.S. 224 (1988) — materiality and the fraud-on-the-market presumption",
      "TSC Indus., Inc. v. Northway, Inc., 426 U.S. 438 (1976) — 'total mix' materiality standard",
      "Central Bank of Denver v. First Interstate Bank, 511 U.S. 164 (1994) — no private aiding-and-abetting liability under 10b-5",
      "Dirks v. SEC, 463 U.S. 646 (1983) — tipper/tippee liability and the personal-benefit test",
      "United States v. O'Hagan, 521 U.S. 642 (1997) — misappropriation theory of insider trading",
      "Halliburton Co. v. Erica P. John Fund, Inc., 573 U.S. 258 (2014) — rebuttable fraud-on-the-market presumption",
      "Matrixx Initiatives, Inc. v. Siracusano, 563 U.S. 27 (2011) — materiality does not require statistical significance",
    ],
    canonical_motions: [
      "Motion to dismiss for failure to plead scienter with particularity under the PSLRA",
      "Motion to dismiss under Fed. R. Civ. P. 9(b) for failure to plead fraud with particularity",
      "Motion for class certification (predominance of fraud-on-the-market reliance)",
      "Motion for summary judgment on loss causation",
      "Motion to compel trading records, 10b5-1 plan documents, and internal communications predating a disclosure",
    ],
    evidentiary_rules: [
      "The adoption date of a Rule 10b5-1 trading plan relative to the date the trader first possessed material nonpublic information is often outcome-determinative for the affirmative defense",
      "Internal communications (engineering, sales, or risk emails) predating a public disclosure are the primary scienter evidence when they contradict the public statement's characterization",
      "Event-study / stock-price-reaction evidence is the standard method for establishing loss causation at the corrective disclosure",
      "Trading-window and blackout-period policies establish the baseline against which unusual trading activity is measured",
    ],
    damages_or_remedies:
      "Private plaintiffs: out-of-pocket / rescissory damages measured against the artificially inflated price, with damages capped by the PSLRA's 90-day look-back bounce-back rule. SEC enforcement: civil penalties, disgorgement of ill-gotten gains plus prejudgment interest, injunctive relief, and officer-and-director bars. Section 11: rescission or damages measured at the time of suit, subject to a due-diligence defense for non-issuer defendants.",
    drafting_notes:
      "Plead specific facts — not conclusions — supporting a strong inference of scienter; identify the exact misstatement, the speaker, and the date. Do NOT conflate a Rule 10b5-1 plan's mere existence with a valid affirmative defense — check the plan's adoption date against the earliest date the corpus shows knowledge of adverse information. Distinguish federal securities-fraud claims from parallel state-law breach-of-fiduciary-duty claims; they require separate elements even on overlapping facts. Do NOT fabricate trading data or event-study results not present in the corpus.",
  },

  banking: {
    label: "Banking Law",
    controlling_standards:
      "Secured lending is governed by UCC Article 9 (attachment requires a security agreement, value given, and rights in the collateral; perfection is typically by filing a UCC-1 financing statement, and priority among competing secured creditors generally follows first-to-file-or-perfect under § 9-322). Deposit accounts and negotiable instruments are governed by UCC Articles 3 and 4. Consumer lending disclosure obligations arise under the Truth in Lending Act (Regulation Z) and anti-discrimination obligations under the Equal Credit Opportunity Act (Regulation B). Loan workouts and forbearance agreements modify but do not, absent express language, waive the lender's underlying default remedies or guaranty rights. Guaranties are construed under ordinary contract principles, with 'unconditional and continuing' language generally waiving suretyship defenses.",
    key_cases: [
      "Benedict v. Ratner, 268 U.S. 353 (1925) — floating lien / dominion over collateral (foundational to Article 9's design)",
      "Twyne's Case, 76 Eng. Rep. 809 (Star Chamber 1601) — badges of fraudulent conveyance",
      "In re Cybernetic Servs., Inc., 252 F.3d 1039 (9th Cir. 2001) — proper method of perfecting a security interest in intangible collateral",
      "TMG Life Ins. Co. v. Ashner, 898 P.2d 1200 (Kan. Ct. App. 1995) — enforceability of unconditional guaranty waiver language",
    ],
    canonical_motions: [
      "Motion for summary judgment enforcing an unconditional guaranty",
      "Complaint/motion to determine priority among competing secured creditors under UCC § 9-322",
      "Motion for prejudgment writ of possession / replevin over collateral",
      "Motion to compel accounting under a forbearance or workout agreement",
      "Motion for summary judgment on TILA disclosure or rescission claims",
    ],
    evidentiary_rules: [
      "UCC-1 financing statement filings and their filing dates are dispositive on perfection and priority — always compare against the security agreement's grant date and the collateral description's sufficiency",
      "Borrowing base certificates are the borrower's periodic representation of eligible collateral value; a certificate that is inconsistent with a contemporaneous field exam or inventory report is a material discrepancy, not a rounding difference",
      "Loan and forbearance agreement default provisions, notice-and-cure clauses, and acceleration language control whether a default has been properly declared",
      "Guaranty language must be parsed clause-by-clause for waiver of suretyship defenses (notice, impairment of collateral, modification without consent)",
    ],
    damages_or_remedies:
      "Deficiency judgment following foreclosure or repossession of collateral, specific enforcement of a guaranty, declaratory judgment on lien priority, replevin/possession of collateral, TILA statutory damages and rescission, and — where fraudulent conveyance is shown — avoidance of the transfer under the Uniform Voidable Transactions Act.",
    drafting_notes:
      "Determine whether the security interest is perfected (by filing, possession, or control) before asserting any priority argument. Reconcile every borrowing-base certificate figure against the corpus's field-exam/inventory data before characterizing a discrepancy as misrepresentation versus good-faith estimation error. Distinguish borrower default from guarantor liability — they can diverge if guaranty defenses were not validly waived. Do NOT fabricate UCC filing dates, lien priority, or appraisal values not present in the corpus.",
  },

  fintech: {
    label: "FinTech (Payments, Digital Assets, Money Transmission)",
    controlling_standards:
      "State money-transmitter licensing statutes generally require a license for any entity that receives money for transmission or holds customer funds, with custody of customer assets (rather than mere technology facilitation) being the key trigger. The Bank Secrecy Act and its AML/KYC implementing regulations apply to money services businesses. Consumer electronic-funds-transfer protections and error-resolution/liability-limitation rules arise under the Electronic Fund Transfer Act (Regulation E); commercial wire transfers are governed by UCC Article 4A. Digital-asset classification as a 'security' turns on the Howey investment-contract test (investment of money in a common enterprise with an expectation of profit from the efforts of others); assets that fail Howey may still be regulated as commodities.",
    key_cases: [
      "SEC v. W.J. Howey Co., 328 U.S. 293 (1946) — investment-contract test for securities",
      "CFTC v. McDonnell, 287 F. Supp. 3d 213 (E.D.N.Y. 2018) — virtual currency as a commodity under the CEA",
      "United States v. E-Gold, Ltd., 550 F. Supp. 2d 82 (D.D.C. 2008) — custodial control triggers money-transmission regulation",
    ],
    canonical_motions: [
      "Motion to dismiss claim of unlicensed money transmission (non-custodial technology-provider defense)",
      "Motion for temporary restraining order to freeze or preserve a digital-asset wallet",
      "Motion to compel arbitration under platform terms of service",
      "Motion for summary judgment on Howey-test application to a specific digital asset or program",
      "Motion to compel production of on-chain transaction records and internal custody architecture documentation",
    ],
    evidentiary_rules: [
      "Internal systems-architecture and key-custody documentation controls whether a platform is custodial (holds private keys / unilateral control over funds) or non-custodial — this is often decisive and frequently in tension with public-facing marketing claims",
      "Terms of service and public disclosures are representations to consumers/regulators and must be checked against actual system architecture and operational practice, not assumed accurate",
      "On-chain transaction records and internal ledger entries are the authoritative record of fund movement and should be reconciled against customer-facing statements",
      "State licensing correspondence (inquiries, cease-and-desist letters, license applications) is direct evidence of a regulator's view on required licensure",
    ],
    damages_or_remedies:
      "EFTA/Regulation E statutory damages and limitation of consumer liability for unauthorized transfers, disgorgement and civil penalties in regulatory enforcement, injunctive relief (including asset freezes), rescission of unregistered securities sales under Section 12(a)(1) of the Securities Act, and restitution to affected customers.",
    drafting_notes:
      "Classify the specific asset or service under the correct regulatory regime (money transmission, securities, commodities, EFTA) before asserting a violation — these are independent, not interchangeable, analyses. Do NOT assume custodial status or non-custodial status from marketing language alone; reconcile against the corpus's technical/architecture documents. Do NOT apply Howey conclusorily — walk through each element against the corpus facts. Do NOT fabricate on-chain data, license status, or regulator correspondence not present in the corpus.",
  },

  amparo: {
    label: "Juicio de Amparo",
    controlling_standards:
      "El juicio de amparo (Arts. 103 y 107 CPEUM; Ley de Amparo) protege contra actos de autoridad que violen derechos humanos reconocidos en la Constitución o en tratados internacionales, o que invadan la esfera de competencia federal/estatal. Amparo INDIRECTO procede ante Juez de Distrito contra actos de autoridad distintos de sentencias definitivas (o excepcionalmente contra estas). Amparo DIRECTO procede ante Tribunal Colegiado de Circuito contra sentencias definitivas, laudos o resoluciones que ponen fin al juicio. Rige el PRINCIPIO DE DEFINITIVIDAD: deben agotarse los recursos ordinarios antes de acudir al amparo, salvo las excepciones previstas en la Ley de Amparo. El quejoso debe acreditar interés jurídico (derecho subjetivo) o, desde la reforma de 2013, interés legítimo (afectación real y actual derivada de una situación jurídica especial).",
    key_cases: [
      "Art. 61 Ley de Amparo — causales de improcedencia: identificar cuál aplica antes de admitir o analizar el fondo",
      "Art. 79 Ley de Amparo — suplencia de la queja deficiente: obligatoria en materia penal (favor del inculpado), laboral (favor del trabajador), agraria (favor de núcleos de población ejidal/comunal), y en favor de menores, incapaces, y cuando el acto reclamado se funde en normas declaradas inconstitucionales por jurisprudencia de la SCJN",
      "Arts. 125–157 Ley de Amparo — suspensión del acto reclamado (provisional y definitiva): analizar apariencia del buen derecho y no afectación al interés social",
      "Jurisprudencia SCJN sobre interés legítimo (reforma constitucional de 2013 y Ley de Amparo vigente) — distinguir de interés jurídico tradicional",
    ],
    canonical_motions: [
      "Demanda de amparo indirecto",
      "Demanda de amparo directo",
      "Incidente de suspensión (provisional y/o definitiva)",
      "Recurso de revisión",
      "Recurso de queja",
      "Ampliación de demanda (cuando proceda)",
    ],
    evidentiary_rules: [
      "El acto reclamado debe estar plenamente identificado: autoridad responsable, fecha, y forma en que se tuvo conocimiento — la falta de precisión es causal frecuente de improcedencia",
      "Los conceptos de violación deben vincular cada acto reclamado con el derecho humano o garantía específicamente violada — no basta una afirmación genérica de inconstitucionalidad",
      "Copias certificadas de constancias del expediente de origen (cuando exista juicio natural) son la prueba primaria; el amparo directo se resuelve sobre el expediente del juicio de origen, no admite generalmente pruebas nuevas",
      "Verificar oportunidad: el plazo general es de 15 días hábiles desde que se tuvo conocimiento del acto reclamado (con plazos especiales para ciertas materias — penal, expropiación, normas generales)",
    ],
    damages_or_remedies:
      "El amparo NO otorga daños compensatorios como remedio principal — su efecto es la concesión (amparo y protección de la Justicia Federal), que restituye al quejoso en el goce del derecho violado, obligando a la autoridad responsable a dejar sin efectos el acto reclamado y, en su caso, a actuar conforme a los lineamientos de la ejecutoria. La reparación de daños derivada de responsabilidad del Estado se tramita por vía distinta (responsabilidad patrimonial del Estado), no dentro del propio juicio de amparo.",
    drafting_notes:
      "Verificar PRIMERO la procedencia (Art. 61) y la definitividad antes de analizar el fondo — un amparo improcedente se sobresee sin importar qué tan sólidos sean los conceptos de violación. Distinguir con precisión amparo directo de indirecto según la naturaleza del acto reclamado. Identificar si aplica suplencia de la queja obligatoria (Art. 79) antes de calificar los conceptos de violación como insuficientes. NUNCA inventes tesis, jurisprudencias, números de registro, o expedientes que no aparezcan en el corpus — si una autoridad no puede verificarse contra el contexto proporcionado, márcala como no verificada en lugar de presentarla como cita firme.",
  },
};

/**
 * Build the prompt fragment to append to `systemInstruction`. Safe to call
 * with any value — falls back to general_civil for unknown areas.
 */
export function buildCaseTypeStandardsBlock(caseType: unknown): string {
  const area = normalizePracticeArea(caseType);
  const s = STANDARDS[area];
  return [
    `\nCASE-TYPE STANDARDS (${s.label}) — apply these throughout the report:`,
    `Controlling standards: ${s.controlling_standards}`,
    `Key cases (cite by name and year in IRAC 'rule' fields when applicable): ${s.key_cases.join("; ")}.`,
    `Canonical motions (map recommended_motions and motion_opportunities to these when supported by the corpus): ${s.canonical_motions.join("; ")}.`,
    `Evidentiary rules (surface in cross-examination, evidence_index, and motion strategy): ${s.evidentiary_rules.join("; ")}.`,
    `Damages / remedies framework: ${s.damages_or_remedies}`,
    `Drafting notes: ${s.drafting_notes}`,
    `Every IRAC 'rule' field MUST cite a real case by name and year drawn from this list or from the corpus. Do NOT cite made-up cases. If the corpus does not support any of these motions, omit that motion — do NOT fabricate factual basis.`,
  ].join("\n");
}
