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

  penal: {
    label: "Derecho Penal (Sistema Acusatorio)",
    controlling_standards:
      "El sistema de justicia penal en México es acusatorio, adversarial y oral (Art. 20 CPEUM, vigente en todo el país desde 2016), regido por los principios de publicidad, contradicción, concentración, continuidad e inmediación. Rige la presunción de inocencia (Art. 20, apartado B, fracción I). El Ministerio Público dirige la investigación a través de la carpeta de investigación (Art. 21 CPEUM; CNPP). El proceso se estructura en etapas: investigación (inicial y complementaria), intermedia, y juicio oral. La vinculación a proceso debe resolverse dentro del plazo constitucional de 72 horas, ampliable a 144 a solicitud del imputado (Art. 19 CPEUM). Las medidas cautelares (Arts. 153–171 CNPP) incluyen la prisión preventiva justificada y, para el catálogo de delitos del Art. 19 CPEUM (delincuencia organizada, homicidio doloso, violación, secuestro, trata de personas, feminicidio, entre otros), la prisión preventiva OFICIOSA.",
    key_cases: [
      "Art. 20 CPEUM — principios rectores del proceso penal acusatorio y derechos del imputado y la víctima",
      "Art. 19 CPEUM — plazo constitucional, vinculación a proceso, catálogo de prisión preventiva oficiosa",
      "Arts. 227–230 CNPP — cadena de custodia",
      "Arts. 153–171 CNPP — medidas cautelares",
      "Arts. 186–207 CNPP — salidas alternas y formas de terminación anticipada (acuerdos reparatorios, suspensión condicional del proceso, procedimiento abreviado)",
      "Art. 20, apartado B, fracción VIII CPEUM — derecho a una defensa técnica adecuada",
    ],
    canonical_motions: [
      "Solicitud de no vinculación a proceso",
      "Impugnación de medidas cautelares (Arts. 161–162 CNPP)",
      "Solicitud de suspensión condicional del proceso",
      "Acuerdo reparatorio (cuando el delito lo permita — Art. 187 CNPP)",
      "Solicitud de procedimiento abreviado",
      "Recurso de apelación (Arts. 467–472 CNPP)",
      "Amparo indirecto en materia penal (contra actos dentro del procedimiento — ver módulo Amparo)",
    ],
    evidentiary_rules: [
      "Distinción procesal entre dato de prueba, medio de prueba y prueba (esta última solo se produce en juicio oral, ante el Tribunal de Enjuiciamiento)",
      "Cadena de custodia debe documentarse desde el aseguramiento del indicio hasta su desahogo en juicio (Arts. 227–230 CNPP)",
      "Principio de inmediación: solo lo desahogado ante el Tribunal de Enjuiciamiento constituye prueba válida para sentencia",
      "La confesión del imputado carece de valor probatorio pleno si no fue rendida con asistencia de su defensor (Art. 20, apartado B, fracción II CPEUM)",
    ],
    damages_or_remedies:
      "No hay daños monetarios como remedio principal en materia penal — la estrategia se centra en: no vinculación a proceso, modificación o revocación de medidas cautelares, salidas alternas (evitando el juicio oral), individualización favorable de la sanción, o absolución en juicio. La reparación del daño a la víctima se determina de forma independiente (Arts. 108–111 CNPP; Ley General de Víctimas) y puede exigirse incluso en salidas alternas.",
    drafting_notes:
      "Verificar SIEMPRE si el delito imputado está en el catálogo de prisión preventiva oficiosa (Art. 19 CPEUM) antes de plantear estrategia de medidas cautelares — si lo está, no procede solicitar cautelar distinta. Distinguir con precisión dato de prueba (etapa de investigación) de prueba (solo en juicio). Evaluar viabilidad de salidas alternas ANTES de asumir que el caso va a juicio oral — often la vía más favorable para el imputado. NUNCA uses terminología del sistema estadounidense (Miranda, grand jury, felony, misdemeanor, plea bargain, motion to suppress) — usa siempre los términos del CNPP y la CPEUM.",
  },

  constitucional: {
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

  civil: {
    label: "Derecho Civil (Federal y Local)",
    controlling_standards:
      "La materia civil en México se rige por el Código Civil Federal (CCF) y los códigos civiles de cada entidad federativa (frecuentemente CCDF/CCCDMX y análogos estatales, que en la práctica siguen la estructura del CCF), y procesalmente por el Código Federal de Procedimientos Civiles (CFPC) y los códigos de procedimientos civiles locales. Fuentes de las obligaciones (Art. 1792 y ss. CCF): contrato, declaración unilateral de la voluntad, enriquecimiento ilegítimo (Arts. 1882–1895), gestión de negocios (Arts. 1896–1909) y hechos ilícitos (Arts. 1910–1934). El contrato requiere consentimiento y objeto que pueda ser materia del contrato (Art. 1794 CCF); son elementos de validez la capacidad, la ausencia de vicios del consentimiento, licitud del objeto/motivo/fin, y forma exigida por la ley (Art. 1795 CCF). La responsabilidad civil puede ser subjetiva por hecho ilícito culposo (Art. 1910 CCF) u objetiva por uso de mecanismos, instrumentos, aparatos o sustancias peligrosas (Art. 1913 CCF). El daño comprende daño material (pérdida o menoscabo — daño emergente y lucro cesante, Art. 2109 CCF) y daño moral (Art. 1916 CCF, afectación a sentimientos, afectos, honor, vida privada o aspecto físico), reparable de forma independiente del daño material. La prescripción negativa ordinaria en materia civil es de diez años salvo plazos especiales (Arts. 1158–1164 CCF); la acción por responsabilidad civil extracontractual prescribe en dos años contados desde el día en que se causó el daño (Art. 1934 CCF).",
    key_cases: [
      "Arts. 1792–1859 CCF — contratos: definición, formación, elementos de existencia y validez, interpretación",
      "Arts. 1910–1934 CCF — hechos ilícitos y responsabilidad civil subjetiva y objetiva; daño moral (Art. 1916)",
      "Arts. 2062–2118 CCF — cumplimiento e incumplimiento de las obligaciones, mora, daños y perjuicios",
      "Arts. 1158–1164 y 1934 CCF — prescripción negativa (regla general y en responsabilidad civil extracontractual)",
      "Arts. 322–342 CFPC — ofrecimiento, admisión, desahogo y valoración de pruebas en el procedimiento civil federal",
      "Jurisprudencia SCJN sobre daño moral y su cuantificación (Primera Sala, línea consolidada desde 2014) — usar únicamente cuando el corpus incluya el registro/tesis específico; en caso contrario, marcar como no verificada",
    ],
    canonical_motions: [
      "Escrito inicial de demanda (Arts. 322 CFPC / análogo local) con hechos, prestaciones, fundamentos de derecho y ofrecimiento de pruebas",
      "Contestación de demanda con excepciones (dilatorias y perentorias) y, en su caso, reconvención",
      "Ofrecimiento y desahogo de pruebas (documental pública/privada, confesional, testimonial, pericial, inspección judicial, presuncional)",
      "Incidente de nulidad de actuaciones o de falta de personalidad",
      "Alegatos y sentencia; recurso de apelación ante Sala Civil (Arts. 231 y ss. CFPC / análogos locales)",
      "Amparo directo contra sentencia definitiva que ponga fin al juicio (ante Tribunal Colegiado de Circuito — ver módulo Amparo)",
      "Amparo indirecto ante Juez de Distrito contra actos dentro del juicio de imposible reparación (p. ej. providencias precautorias)",
    ],
    evidentiary_rules: [
      "Sistema mixto de valoración: prueba tasada para documentos públicos e instrumentos con reconocimiento judicial, y sana crítica del juzgador para las demás pruebas (Arts. 197–218 CFPC)",
      "Documentos públicos hacen prueba plena de su contenido y fecha (Art. 202 CFPC); los privados requieren reconocimiento expreso o tácito de la parte a quien se atribuyen (Arts. 203–210 CFPC)",
      "La prueba pericial es indispensable cuando la controversia requiere conocimientos técnicos, científicos o artísticos (Arts. 143–162 CFPC); cada parte designa perito y el juez tercero en discordia",
      "Los mensajes de datos (correos electrónicos, mensajería) se rigen por el Código de Comercio (Arts. 89–114) supletoriamente aplicable y por la NOM-151-SCFI-2016 para su valor probatorio pleno; sin conservación con constancia, su fuerza es indiciaria",
      "Carga de la prueba: quien afirma un hecho debe probarlo (Art. 81 CFPC); el actor debe probar los hechos constitutivos de su acción y el demandado los de sus excepciones",
    ],
    damages_or_remedies:
      "Cumplimiento forzoso de la obligación en especie cuando sea posible, o su equivalente en dinero (Arts. 2027–2028 CCF); indemnización por daños y perjuicios que comprende el daño emergente y el lucro cesante (Arts. 2108–2109 CCF); pago del daño moral (Art. 1916 CCF), reparable con independencia del daño material y determinado prudentemente por el juzgador considerando los derechos lesionados, el grado de responsabilidad, la situación económica del responsable y de la víctima, y las demás circunstancias del caso; rescisión del contrato con restitución mutua de prestaciones (Art. 1949 CCF, pacto comisorio tácito); nulidad absoluta o relativa según el vicio (Arts. 2224–2242 CCF); intereses moratorios legales al 9% anual si no se pactaron (Art. 2395 CCF). No existen 'daños punitivos' en el sentido del common law; la jurisprudencia mexicana ha reconocido, en supuestos acotados, componentes punitivos dentro de la indemnización por daño moral, pero SIEMPRE dentro de la lógica reparadora del CCF, nunca como categoría autónoma.",
    drafting_notes:
      "Identificar SIEMPRE el fundamento legal específico del CCF (o código local aplicable) para cada prestación reclamada — no basta afirmar 'incumplimiento contractual' sin citar el artículo del CCF que regula la obligación incumplida. Distinguir con precisión responsabilidad civil contractual (deriva de un contrato previo — Arts. 2104 y ss. CCF) de la extracontractual (hecho ilícito — Arts. 1910 y ss. CCF), porque los plazos de prescripción y la carga probatoria difieren. Al reclamar daño moral, fundar en Art. 1916 CCF y describir el bien jurídico lesionado (honor, sentimientos, vida privada, aspecto físico), no arrastrar categorías del common law. NUNCA uses terminología estadounidense (Rule 56, Twombly/Iqbal, motion to dismiss, summary judgment, discovery, deposition, subpoena, tort, punitive damages, hearsay) — usa siempre términos del CCF/CFPC y códigos locales. Si citas jurisprudencia de la SCJN, incluye rubro, número de registro y tesis; si el corpus no los aporta, márcala como no verificada en lugar de presentarla como cita firme.",
  },

  familiar: {
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

  laboral: {
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

  mercantil: {
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

  fiscal: {
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

  administrativo: {
    label: "Derecho Administrativo (juicio contencioso administrativo)",
    controlling_standards:
      "El acto administrativo debe cumplir los requisitos de competencia, fundamentación y motivación (Arts. 14 y 16 CPEUM; Arts. 3 y 16 LFPA). La impugnación transita por el recurso de revisión administrativo (Arts. 83–96 LFPA) o directamente por el juicio contencioso administrativo ante el TFJA (LFPCA), con plazo de treinta días hábiles siguientes a la notificación (Art. 13 LFPCA). Las causas de nulidad están tasadas en el Art. 51 LFPCA (incompetencia, omisión de formalidades, vicios del procedimiento, hechos distintos, desvío de poder) y los efectos de la sentencia en el Art. 52 LFPCA. La notificación defectuosa y la falta de competencia del emisor son los vicios de mayor rendimiento procesal.",
    key_cases: [
      "Arts. 14 y 16 CPEUM — audiencia previa, legalidad, fundamentación y motivación",
      "Art. 3 LFPA — elementos y requisitos del acto administrativo",
      "Art. 51 LFPCA — causales de ilegalidad del acto impugnado",
      "Art. 52 LFPCA — efectos de la sentencia (nulidad lisa y llana vs. para efectos)",
      "Art. 13 LFPCA — plazos para promover el juicio de nulidad",
    ],
    canonical_motions: [
      "Recurso de revisión administrativo",
      "Demanda de juicio contencioso administrativo (nulidad) ante el TFJA",
      "Solicitud de suspensión del acto administrativo impugnado",
      "Ampliación de demanda por notificación desconocida del acto",
      "Incidente de incompetencia por razón de territorio",
    ],
    evidentiary_rules: [
      "El expediente administrativo debe exhibirse íntegro por la autoridad; su omisión perjudica su defensa (Art. 45 LFPCA).",
      "Las actuaciones y notificaciones administrativas hacen prueba plena mientras no se objeten y desvirtúen.",
      "La documental pública se valora conforme al CFPC aplicado supletoriamente (Art. 1 LFPCA).",
      "Los peritajes técnicos y las inspecciones se valoran libremente y deben estar motivados.",
    ],
    damages_or_remedies:
      "Nulidad lisa y llana o para efectos, restitución del derecho afectado, devolución de cantidades pagadas indebidamente con actualización, y responsabilidad patrimonial del Estado (Art. 109 CPEUM; LFRPE) cuando exista actividad administrativa irregular.",
    drafting_notes:
      "Identificar con precisión el acto impugnado, su fecha de notificación y la autoridad emisora. Vincular cada agravio a una fracción del Art. 51 LFPCA y precisar el efecto pretendido conforme al Art. 52.",
  },
  electoral: {
    label: "Derecho Electoral (medios de impugnación)",
    controlling_standards:
      "El sistema de medios de impugnación en materia electoral se rige por los Arts. 41 y 99 CPEUM y la Ley General del Sistema de Medios de Impugnación en Materia Electoral (LGSMIME): recurso de revisión, recurso de apelación, juicio de inconformidad, recurso de reconsideración, juicio para la protección de los derechos político-electorales del ciudadano (JDC) y juicio de revisión constitucional electoral. Los plazos son de cuatro días y todos los días y horas son hábiles durante el proceso electoral (Arts. 7 y 8 LGSMIME). Rige el principio de definitividad y el de conservación de los actos válidamente celebrados.",
    key_cases: [
      "Arts. 41 y 99 CPEUM — sistema de medios de impugnación y competencia del TEPJF",
      "Arts. 7–10 LGSMIME — plazos, requisitos y causales de improcedencia",
      "Art. 78 LGSMIME — nulidad de elección",
      "Ley General de Instituciones y Procedimientos Electorales — nulidades de votación por casilla",
      "Jurisprudencia del TEPJF sobre suplencia de la queja en el JDC",
    ],
    canonical_motions: [
      "Juicio para la protección de los derechos político-electorales del ciudadano (JDC)",
      "Juicio de inconformidad contra resultados electorales",
      "Recurso de apelación contra acuerdos del INE/OPLE",
      "Recurso de reconsideración ante la Sala Superior del TEPJF",
      "Solicitud de medidas cautelares ante la Comisión de Quejas y Denuncias",
    ],
    evidentiary_rules: [
      "Sólo son admisibles documentales públicas y privadas, técnicas, presuncionales e instrumental de actuaciones (Art. 14 LGSMIME); la testimonial y la confesional son excepcionales.",
      "Las actas de escrutinio y cómputo son documentales públicas con valor probatorio pleno salvo prueba en contrario.",
      "Las pruebas técnicas (audio, video, redes sociales) requieren que el oferente describa con precisión lo que pretende acreditar.",
      "Los hechos notorios del proceso electoral no requieren prueba.",
    ],
    damages_or_remedies:
      "Revocación o modificación del acto o resolución impugnada, nulidad de votación recibida en casilla, nulidad de elección, restitución en el goce del derecho político-electoral vulnerado y, en su caso, nueva elección o recuento.",
    drafting_notes:
      "Precisar la fecha de conocimiento del acto para acreditar oportunidad y agotar la cadena impugnativa. Distinguir agravios de legalidad frente a los de constitucionalidad y solicitar la suplencia de la queja cuando proceda en el JDC.",
  },
  agrario: {
    label: "Derecho Agrario (tribunales unitarios agrarios)",
    controlling_standards:
      "La materia agraria se rige por el Art. 27 CPEUM y la Ley Agraria, con competencia de los Tribunales Unitarios Agrarios y del Tribunal Superior Agrario (Ley Orgánica de los Tribunales Agrarios). Los conflictos típicos son restitución, nulidad de actos de asamblea, conflictos por límites, sucesión de derechos agrarios, controversias sobre la posesión de parcelas y juicios de nulidad de resoluciones administrativas del RAN o de la Procuraduría Agraria. La asamblea de ejidatarios es el órgano supremo y sus formalidades de convocatoria y quórum (Arts. 22–31 Ley Agraria) son determinantes.",
    key_cases: [
      "Art. 27 CPEUM — régimen de propiedad social (ejidal y comunal)",
      "Arts. 22–31 Ley Agraria — asamblea, convocatoria, quórum y formalidades",
      "Arts. 76–86 Ley Agraria — derechos sobre parcelas y dominio pleno",
      "Arts. 17–19 Ley Agraria — sucesión de derechos agrarios",
      "Arts. 163–200 Ley Agraria — juicio agrario y suplencia de la deficiencia de la queja",
    ],
    canonical_motions: [
      "Demanda de restitución de tierras ejidales o comunales",
      "Nulidad de acta de asamblea por vicios de convocatoria o quórum",
      "Juicio sucesorio de derechos agrarios",
      "Conflicto por límites entre núcleos de población o parcelas",
      "Nulidad de resolución administrativa del RAN",
    ],
    evidentiary_rules: [
      "Los certificados de derechos agrarios, títulos parcelarios y actas de asamblea inscritos en el RAN son documentales públicas de valor preponderante.",
      "El plano definitivo y los trabajos técnicos topográficos son indispensables en conflictos de límites.",
      "La inspección judicial en el predio es prueba idónea de la posesión material.",
      "Opera la suplencia de la deficiencia de la queja en favor de ejidatarios, comuneros y núcleos de población (Art. 164 Ley Agraria).",
    ],
    damages_or_remedies:
      "Restitución de la posesión y de las tierras, nulidad de actos de asamblea o administrativos, reconocimiento de la titularidad de derechos agrarios, adjudicación sucesoria y pago de frutos o daños derivados de la ocupación indebida.",
    drafting_notes:
      "Precisar el régimen de la tierra (ejidal, comunal o pequeña propiedad) y la calidad del promovente (ejidatario, avecindado, posesionario). Acompañar siempre la documentación del RAN y solicitar la suplencia de la queja.",
  },
};

/**
 * Build the prompt fragment to append to `systemInstruction`. The materia is
 * resolved strictly — an unrecognized value is a routing error, never a
 * silent default to another area of Mexican law.
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
