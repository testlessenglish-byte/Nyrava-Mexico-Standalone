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
    label: "Derecho Constitucional y Derechos Humanos",
    controlling_standards:
      "El Art. 1 CPEUM impone a toda autoridad las obligaciones de promover, respetar, proteger y garantizar los derechos humanos, con los principios de universalidad, interdependencia, indivisibilidad y progresividad, así como el control de convencionalidad ex officio y la interpretación conforme y pro persona. Los tratados internacionales integran el parámetro de regularidad constitucional (CT 293/2011). La afectación de derechos exige un test de proporcionalidad: fin constitucionalmente válido, idoneidad, necesidad y proporcionalidad en sentido estricto. Los medios de control constitucional son la controversia constitucional y la acción de inconstitucionalidad (Art. 105 CPEUM), el amparo (Arts. 103 y 107 CPEUM) y las recomendaciones de los organismos de derechos humanos (Art. 102-B CPEUM). Las violaciones graves (tortura, desaparición forzada, uso excesivo de la fuerza) tienen estándares probatorios y de investigación reforzados.",
    key_cases: [
      "Art. 1 CPEUM — obligaciones de las autoridades, interpretación pro persona y control de convencionalidad",
      "Contradicción de Tesis 293/2011 (SCJN) — parámetro de regularidad constitucional y jurisprudencia interamericana",
      "Varios 912/2010 (Caso Radilla, SCJN) — control de convencionalidad ex officio",
      "Art. 105 CPEUM — controversias constitucionales y acciones de inconstitucionalidad",
      "Art. 102 apartado B CPEUM — competencia de la CNDH y organismos estatales",
      "Corte IDH, Caso Radilla Pacheco vs. México — deber de investigar y reparar violaciones graves",
    ],
    canonical_motions: [
      "Demanda de amparo indirecto por violación a derechos humanos",
      "Queja ante la CNDH u organismo estatal de derechos humanos",
      "Controversia constitucional (Art. 105-I CPEUM)",
      "Acción de inconstitucionalidad (Art. 105-II CPEUM)",
      "Solicitud de medidas cautelares o de protección ante el organismo de derechos humanos",
      "Solicitud de reparación integral conforme a la Ley General de Víctimas",
    ],
    evidentiary_rules: [
      "Ante violaciones atribuidas a la autoridad, la carga de justificar la actuación recae en la autoridad; su silencio o expediente incompleto opera en su contra.",
      "El Protocolo de Estambul y el Protocolo de Minnesota rigen el peritaje en casos de tortura y muerte violenta.",
      "Los dictámenes médicos y psicológicos independientes son prueba idónea del daño y deben respetar la cadena de custodia documental.",
      "Los videos, informes policiales homologados y bitácoras de la autoridad son documentales públicas cuya ausencia debe destacarse como omisión imputable a la autoridad.",
    ],
    damages_or_remedies:
      "Reparación integral en términos del Art. 1 CPEUM y de la Ley General de Víctimas: restitución, rehabilitación, compensación, satisfacción y medidas de no repetición; nulidad o inaplicación del acto o norma; responsabilidad patrimonial del Estado y, en su caso, responsabilidad administrativa o penal de los servidores públicos involucrados.",
    drafting_notes:
      "Identificar el derecho humano afectado, la autoridad responsable y el acto u omisión concretos. Aplicar interpretación conforme y test de proporcionalidad, y citar el parámetro de regularidad constitucional. NUNCA uses figuras estadounidenses (§ 1983, qualified immunity, Monell, Bivens) — el marco es CPEUM, tratados, Ley de Amparo y jurisprudencia de la SCJN y la Corte IDH.",
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
    label: "Derecho Familiar",
    controlling_standards:
      "El interés superior de la niñez es el principio rector de toda decisión que afecte a menores (Art. 4° CPEUM; Art. 2 LGDNNA) y prevalece sobre cualquier interés de los progenitores. La guarda y custodia se determina conforme a la idoneidad parental real (no presunciones automáticas a favor de la madre), valorando estudios de trabajo social y dictámenes periciales en psicología cuando obren en el expediente. La pensión alimenticia se calcula conforme a la necesidad del acreedor alimentario y la capacidad económica real del deudor (incluyendo ingresos variables/por comisión cuando aplique), conforme al Código Civil o Código Familiar de la entidad federativa correspondiente (p. ej. Arts. 301–309 CCF; Art. 4.1 y ss. Código Familiar del Estado de México — el código local exacto depende de la jurisdicción del caso). El divorcio incausado (sin necesidad de acreditar causal) procede en la mayoría de las entidades tras reforma, sujeto al régimen del código local. El régimen patrimonial del matrimonio (sociedad conyugal o separación de bienes) determina la liquidación de bienes al disolverse el vínculo.",
    key_cases: [
      "No invente un número de tesis o registro de jurisprudencia de la SCJN. Existe jurisprudencia real y consolidada sobre interés superior de la niñez y sobre criterios de guarda y custodia — cítela solo si el corpus del expediente la aporta con registro verificable; de lo contrario, márquela como no verificada en lugar de fabricar una cita.",
    ],
    canonical_motions: [
      "Demanda de divorcio incausado",
      "Convenio regulador (guarda y custodia, régimen de convivencias, pensión alimenticia, liquidación de sociedad conyugal)",
      "Solicitud de medidas provisionales (guarda y custodia provisional, pensión alimenticia provisional, régimen de convivencias provisional)",
      "Incidente de incumplimiento de pensión alimenticia",
      "Solicitud de modificación de convenio por cambio sustancial de circunstancias",
      "Solicitud de restricción o suspensión de convivencias (violencia familiar o riesgo acreditado)",
    ],
    evidentiary_rules: [
      "Estudio de trabajo social e informe de convivencias, elaborados por perito adscrito al juzgado, son prueba central para determinar idoneidad parental y entorno del menor",
      "Dictamen pericial en psicología (vínculo afectivo, indicadores de alienación parental, estado emocional del menor)",
      "Comprobantes de ingresos del deudor alimentario (recibos de nómina, estados de cuenta, informe de trabajo ante el empleador) — distinguir ingreso fijo de comisiones variables",
      "Comunicaciones entre las partes (mensajes de texto, WhatsApp) frecuentemente centrales para acreditar o contradecir incumplimientos de convivencia o de pago",
      "Actas de nacimiento y matrimonio como documentales públicas base del expediente",
    ],
    damages_or_remedies:
      "Guarda y custodia (exclusiva o compartida), régimen de convivencias con horarios y puntos de entrega definidos, pensión alimenticia definitiva (con posible aseguramiento vía retención en fuente de trabajo), compensación económica por dedicación al hogar cuando el código local la contemple (p. ej. Art. 267 fracc. VI CCDF), liquidación de la sociedad conyugal, y medidas de protección en casos de violencia familiar acreditada.",
    drafting_notes:
      "Fundamentar SIEMPRE cada pretensión en el artículo específico del Código Civil/Familiar de la entidad correspondiente — no basta invocar 'pensión alimenticia' sin citar el artículo que la regula en esa jurisdicción. Encuadrar todo argumento de guarda y custodia a través del interés superior de la niñez, con citas a evidencia concreta (estudios, dictámenes, comunicaciones), no como fórmula genérica. Los cálculos de pensión deben mostrar la operación aritmética sobre ingresos acreditados, distinguiendo fijo de variable. NUNCA uses terminología o marcos estadounidenses (best-interests factors enumerados por state code, community property/equitable distribution, custody/visitation en el sentido de derecho estadounidense, child support guidelines por income shares) — usa siempre guarda y custodia, régimen de convivencias, sociedad conyugal/separación de bienes y pensión alimenticia conforme al código civil o familiar local aplicable. Si citas jurisprudencia de la SCJN, incluye rubro, número de registro y tesis; si el corpus no los aporta, márcala como no verificada en lugar de presentarla como cita firme.",
  },

  laboral: {
    label: "Derecho Laboral (LFT y tribunales laborales)",
    controlling_standards:
      "El Art. 123 apartado A CPEUM y la LFT rigen la relación individual de trabajo. Presumida la relación laboral, la carga de la prueba sobre antigüedad, salario, jornada, pagos, causa y fecha del despido corresponde al patrón (Arts. 784 y 804 LFT), quien debe conservar los documentos obligatorios. El despido debe constar en aviso escrito entregado al trabajador o notificado por la autoridad dentro de cinco días hábiles (Art. 47 LFT), so pena de injustificación. La reforma de 2019 sustituyó a las Juntas de Conciliación y Arbitraje por los tribunales laborales del Poder Judicial y estableció la conciliación prejudicial obligatoria ante el Centro de Conciliación (Arts. 684-A a 684-E LFT), salvo las excepciones del Art. 685 ter. Rige la suplencia de la queja en favor del trabajador (Art. 685 LFT) y la caducidad y prescripción de dos meses o un año según la acción (Arts. 516–519 LFT).",
    key_cases: [
      "Art. 123 apartado A CPEUM — derechos mínimos de la relación de trabajo",
      "Arts. 47 y 48 LFT — rescisión sin responsabilidad para el patrón, aviso de despido y acciones de reinstalación o indemnización",
      "Arts. 784 y 804 LFT — reversión de la carga probatoria y documentos que el patrón debe conservar",
      "Arts. 684-A a 684-E LFT — conciliación prejudicial obligatoria",
      "Arts. 516–519 LFT — prescripción de las acciones laborales",
      "Art. 50 LFT — cuantificación de la indemnización constitucional y prima de antigüedad",
    ],
    canonical_motions: [
      "Demanda laboral ante el tribunal laboral (reinstalación o indemnización constitucional)",
      "Solicitud de conciliación ante el Centro de Conciliación (constancia de no conciliación)",
      "Ofrecimiento de trabajo y su calificación de buena o mala fe",
      "Incidente de nulidad de actuaciones o de notificación",
      "Demanda de amparo directo contra la sentencia del tribunal laboral",
    ],
    evidentiary_rules: [
      "Los recibos de nómina, contratos individuales, controles de asistencia y avisos de rescisión son prueba a cargo del patrón; su falta se resuelve en favor del trabajador (Art. 805 LFT).",
      "El ofrecimiento de trabajo se califica de buena o mala fe según las condiciones ofrecidas; la mala fe no revierte la carga de la prueba del despido.",
      "La testimonial es admisible y frecuente, pero se valora en conjunto con las documentales de la relación laboral.",
      "Las constancias del IMSS e INFONAVIT acreditan antigüedad y salario base de cotización.",
    ],
    damages_or_remedies:
      "Reinstalación o indemnización constitucional de tres meses (Art. 48 LFT), salarios caídos con el límite de doce meses más intereses del dos por ciento mensual sobre quince meses, prima de antigüedad (Art. 162 LFT), vacaciones, prima vacacional, aguinaldo, horas extra, y prestaciones de seguridad social omitidas.",
    drafting_notes:
      "Precisar fecha de ingreso, salario integrado, jornada y fecha y forma del despido. Verificar la constancia de conciliación prejudicial antes de la demanda. NUNCA uses categorías estadounidenses (Title VII, EEOC, at-will employment, FMLA, wrongful termination) — el marco es la LFT, la CPEUM y la jurisprudencia laboral de la SCJN.",
  },
  mercantil: {
    label: "Derecho Mercantil (Código de Comercio, LGTOC, LGSM)",
    controlling_standards:
      "Los actos de comercio se rigen por el Código de Comercio y, supletoriamente, por el CCF y el CFPC (Arts. 1054 y 1063 Código de Comercio). Los títulos de crédito se rigen por la LGTOC: el pagaré y la letra de cambio deben satisfacer los requisitos literales de los Arts. 5, 76 y 170 LGTOC y son ejecutivos, por lo que la vía ejecutiva mercantil procede con el documento base de la acción (Art. 1391 Código de Comercio). El demandado sólo puede oponer las excepciones tasadas del Art. 8 LGTOC (falsedad de firma, falta de requisitos literales, alteración, prescripción, pago, entre otras). La acción cambiaria directa prescribe en tres años desde el vencimiento (Art. 165 LGTOC). Las sociedades mercantiles se rigen por la LGSM (formalidades de asamblea, representación, responsabilidad de administradores) y la insolvencia por la Ley de Concursos Mercantiles.",
    key_cases: [
      "Arts. 5, 76, 170 y 171 LGTOC — requisitos literales del pagaré y de la letra de cambio",
      "Art. 8 LGTOC — excepciones oponibles en el juicio cambiario",
      "Art. 165 LGTOC — prescripción de la acción cambiaria directa",
      "Art. 1391 Código de Comercio — títulos que traen aparejada ejecución",
      "Arts. 178–200 LGSM — asambleas de accionistas y su nulidad",
      "Ley de Concursos Mercantiles — concurso, conciliación y quiebra",
    ],
    canonical_motions: [
      "Demanda en la vía ejecutiva mercantil con auto de exequendo y embargo",
      "Juicio oral mercantil por incumplimiento contractual",
      "Objeción de firma y ofrecimiento de peritaje en documentoscopia y grafoscopia",
      "Incidente de nulidad de actuaciones o de notificación",
      "Nulidad de asamblea de accionistas (LGSM)",
      "Solicitud de concurso mercantil",
    ],
    evidentiary_rules: [
      "El título de crédito original es el documento base de la acción; su exhibición y guarda en el seguro del juzgado es indispensable.",
      "La objeción de firma abre necesariamente el peritaje en documentoscopia y grafoscopia, con carga probatoria para quien objeta.",
      "Los estados de cuenta certificados por contador facultado de la institución de crédito hacen prueba salvo prueba en contrario (Art. 68 LIC).",
      "Los libros de comercio, facturas (CFDI), pólizas contables y actas de asamblea son documentales cuya congruencia debe verificarse.",
    ],
    damages_or_remedies:
      "Pago de la suerte principal, intereses ordinarios y moratorios pactados (con el límite del interés usurario conforme a CT 350/2013), gastos y costas, ejecución del embargo y remate, cumplimiento forzoso o rescisión contractual con daños y perjuicios, y nulidad de actos societarios.",
    drafting_notes:
      "Verificar primero la literalidad del título y la vía procedente (ejecutiva mercantil, oral mercantil u ordinaria por cuantía). Analizar el interés pactado bajo el estándar de usura. NUNCA uses figuras del derecho estadounidense (UCC, Restatement, Delaware, promissory estoppel) — el marco es el Código de Comercio, la LGTOC, la LGSM y la jurisprudencia mercantil de la SCJN.",
  },
  fiscal: {
    label: "Derecho Fiscal (CFF, LFPCA, TFJA)",
    controlling_standards:
      "La contribución debe estar prevista en ley y respetar proporcionalidad y equidad (Art. 31-IV CPEUM). Las facultades de comprobación del SAT (visita domiciliaria, revisión de gabinete, revisión electrónica) se rigen por los Arts. 42 a 53 CFF, con plazos máximos de conclusión y consecuencias de nulidad por su exceso. Toda resolución determinante de crédito fiscal debe estar fundada y motivada (Art. 38 CFF). Los medios de defensa son el recurso de revocación dentro de treinta días hábiles (Arts. 116–133 CFF) y el juicio contencioso administrativo ante el TFJA en el mismo plazo (Art. 13 LFPCA), con las causales de ilegalidad del Art. 51 LFPCA. Las facultades de las autoridades caducan en cinco años (Art. 67 CFF) y el crédito prescribe en cinco años (Art. 146 CFF). La materialidad de las operaciones y la razón de negocios son el eje del litigio actual (Arts. 5-A y 69-B CFF).",
    key_cases: [
      "Art. 31 fracción IV CPEUM — legalidad, proporcionalidad y equidad tributarias",
      "Arts. 42–53 CFF — facultades de comprobación y plazos de la revisión",
      "Art. 38 CFF — requisitos de fundamentación y motivación del acto fiscal",
      "Arts. 5-A y 69-B CFF — razón de negocios y operaciones inexistentes (EFOS/EDOS)",
      "Arts. 67 y 146 CFF — caducidad de facultades y prescripción del crédito fiscal",
      "Art. 51 LFPCA — causales de ilegalidad del acto impugnado",
    ],
    canonical_motions: [
      "Recurso de revocación ante el SAT (Arts. 116–133 CFF)",
      "Demanda de juicio contencioso administrativo ante el TFJA",
      "Solicitud de suspensión de la ejecución y garantía del interés fiscal",
      "Aclaración y desvirtuación del procedimiento del Art. 69-B CFF",
      "Solicitud de devolución o compensación de saldos a favor (Art. 22 CFF)",
      "Amparo indirecto contra normas fiscales autoaplicativas",
    ],
    evidentiary_rules: [
      "La contabilidad, los CFDI, los estados de cuenta bancarios y los contratos deben acreditar la materialidad de la operación, no sólo su registro documental.",
      "Las actas parciales, la última acta parcial y el acta final de la visita domiciliaria delimitan los hechos y los plazos; sus vicios son causa de nulidad.",
      "La documental privada requiere elementos de convicción adicionales para acreditar la efectiva prestación del servicio o entrega del bien.",
      "Los dictámenes contables y periciales en materia fiscal se valoran conforme al CFPC de aplicación supletoria.",
    ],
    damages_or_remedies:
      "Nulidad lisa y llana o para efectos de la resolución determinante, cancelación del crédito fiscal, devolución de cantidades pagadas indebidamente con actualización e intereses (Arts. 22 y 22-A CFF), condonación o reducción de multas y, en su caso, reducción de recargos y acuerdos conclusivos ante la PRODECON.",
    drafting_notes:
      "Precisar el acto impugnado, su fecha de notificación y la etapa de la facultad de comprobación. Vincular cada agravio a una fracción del Art. 51 LFPCA y verificar caducidad y prescripción. NUNCA uses el marco estadounidense (IRC, IRS, Tax Court, Notice of Deficiency, § 7201) — el marco es el CFF, la LISR, la LIVA, la LFPCA y la jurisprudencia del TFJA y la SCJN.",
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
  ambiental: {
    label: "Derecho Ambiental (LGEEPA y legislación conexa; PROFEPA, SEMARNAT, CONAGUA, ASEA, CONANP, CONAFOR; TFJA)",
    controlling_standards:
      "La materia ambiental federal se rige principalmente por la Ley General del Equilibrio Ecológico y la Protección al Ambiente (LGEEPA), la Ley General de Vida Silvestre, la Ley General para la Prevención y Gestión Integral de los Residuos (LGPGIR), la Ley de Aguas Nacionales, la Ley General de Cambio Climático y las NOM ambientales aplicables. Según el recurso o actividad involucrada, la autoridad competente puede ser PROFEPA (inspección y sanción general), SEMARNAT (autorizaciones y permisos, incluyendo la manifestación de impacto ambiental), CONAGUA (aguas nacionales y descargas), ASEA (seguridad industrial y ambiental del sector hidrocarburos) o CONANP/CONAFOR (áreas naturales protegidas y aprovechamiento forestal). Los actos de estas autoridades (actas de inspección, medidas de seguridad, clausuras, negativas de permiso, multas) se impugnan mediante recurso de revisión ante la propia autoridad o directamente mediante juicio de nulidad ante el Tribunal Federal de Justicia Administrativa (LFPCA), con posible amparo directo o indirecto posterior — incluyendo, cuando proceda, planteamientos fundados en el Art. 4 CPEUM (derecho a un medio ambiente sano). El daño ambiental puede además dar lugar a responsabilidad bajo la Ley Federal de Responsabilidad Ambiental (LFRA).",
    key_cases: [
      "LGEEPA — régimen sustantivo de protección ambiental, evaluación de impacto ambiental y facultades de inspección y sanción",
      "Ley Federal de Responsabilidad Ambiental (LFRA) — responsabilidad por daño ambiental",
      "LFPCA — juicio de nulidad contra resoluciones de PROFEPA/SEMARNAT/CONAGUA/ASEA/CONANP/CONAFOR ante el TFJA",
      "Ley General de Vida Silvestre — régimen de especies y hábitat protegidos",
      "Ley de Aguas Nacionales — concesiones, descargas y aprovechamiento de aguas nacionales (CONAGUA)",
      "Ley General de Cambio Climático — obligaciones de mitigación y reporte de emisiones",
      "Art. 4 CPEUM — derecho a un medio ambiente sano, invocable en amparo",
      "Aún no se han incorporado tesis o precedentes jurisprudenciales verificados para esta materia; no citar jurisprudencia ambiental hasta integrar fuentes verificadas al corpus.",
    ],
    canonical_motions: [
      "Recurso de revisión contra acta de inspección o resolución de la autoridad ambiental competente",
      "Demanda de juicio de nulidad ante el TFJA contra sanción, clausura o negativa de permiso ambiental",
      "Solicitud de suspensión de medidas de seguridad o clausura",
      "Denuncia popular ambiental (LGEEPA)",
      "Escrito de manifestación de impacto ambiental o su impugnación",
      "Impugnación de negativa de concesión o permiso de descarga ante CONAGUA",
      "Impugnación de negativa o revocación de permiso forestal ante CONAFOR",
      "Amparo indirecto fundado en el derecho a un medio ambiente sano (Art. 4 CPEUM)",
    ],
    evidentiary_rules: [
      "El acta de inspección de la autoridad ambiental competente goza de presunción de legalidad, desvirtuable por el particular con prueba en contrario.",
      "Los dictámenes periciales ambientales (calidad de agua, suelo, aire, manejo de residuos) son la prueba técnica central en la mayoría de los expedientes.",
      "Las manifestaciones de impacto ambiental, estudios de riesgo, estudios hidrológicos e informes de monitoreo previamente presentados ante la autoridad son documentales relevantes para acreditar o desvirtuar el incumplimiento.",
      "El muestreo ambiental, los reportes de laboratorio acreditado, la cartografía/SIG, las imágenes satelitales y la fotografía o video con drones son medios de prueba técnica admisibles para acreditar el estado del sitio o la extensión del daño.",
    ],
    damages_or_remedies:
      "Nulidad lisa y llana o para efectos de la resolución impugnada, levantamiento de medidas de seguridad o clausura, otorgamiento del permiso o concesión indebidamente negado, y remediación del daño ambiental conforme a la LFRA (incluyendo restauración del ecosistema afectado) en los casos que la propia ley califica.",
    drafting_notes:
      "Identificar con precisión el acto impugnado (acta de inspección, medida de seguridad, resolución sancionadora, negativa de permiso), la autoridad emisora (PROFEPA, SEMARNAT, CONAGUA, ASEA, CONANP o CONAFOR), su fecha de notificación y el plazo aplicable. Distinguir la vía de recurso de revisión de la vía directa de juicio de nulidad ante el TFJA, y evaluar si procede amparo indirecto fundado en el Art. 4 CPEUM. Aviso: este perfil de materia se incorporó recientemente al motor; el abogado responsable debe confirmar contra la fuente primaria vigente los números de artículo, la sala/ponencia competente del TFJA y cualquier tesis o precedente antes de que se incluyan en el producto de trabajo final.",
  },
  inmobiliario: {
    label: "Bienes Raíces (transacción inmobiliaria — compraventa, cierre, due diligence de título; no litigio)",
    controlling_standards:
      "No es una materia litigiosa: es una transacción regida por el Código Civil aplicable (federal o estatal, según la ubicación del inmueble), la Ley del Notariado de la entidad correspondiente y el Reglamento del Registro Público de la Propiedad (RPP) de esa entidad. El Notario Público ejerce fe pública, verifica la propiedad y la libertad de gravámenes antes de autorizar la escritura, y es responsable de calcular y enterar el impuesto de traslado de dominio (ISAI/ISR según el caso). Si el comprador es extranjero y el inmueble se ubica en la zona restringida (100 km de fronteras / 50 km de costas), el Art. 27 CPEUM y la Ley de Inversión Extranjera exigen adquisición vía fideicomiso bancario. Toda transacción de valor relevante está sujeta a las obligaciones de identificación de las partes de la Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita (Ley Antilavado). Si surge una controversia sobre el inmueble (nulidad de la compraventa, fraude en el título, vicios ocultos, usucapión), el asunto deja de ser inmobiliario y pasa a tramitarse como civil — este perfil no cubre esos supuestos.",
    key_cases: [
      "Código Civil aplicable (federal o estatal) — régimen de compraventa, título de propiedad y vicios del consentimiento",
      "Ley del Notariado de la entidad donde se ubica el inmueble — deberes de verificación del notario",
      "Reglamento del Registro Público de la Propiedad de la entidad — inscripción y oponibilidad frente a terceros",
      "CPEUM Art. 27; Ley de Inversión Extranjera — fideicomiso para adquisición extranjera en zona restringida",
      "Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita — identificación de las partes",
      "No se han incorporado tesis o precedentes jurisprudenciales a este perfil, porque el flujo estándar no es contencioso; no citar jurisprudencia bajo este perfil salvo que el asunto haya derivado en una controversia (en cuyo caso corresponde al perfil civil).",
    ],
    canonical_motions: [],
    evidentiary_rules: [
      "El estándar aquí no es un régimen probatorio judicial, sino el deber de verificación documental del notario antes de autorizar la escritura: título de propiedad, libertad de gravamen, regularidad fiscal (predial) y, en su caso, cancelación de hipoteca previa.",
      "La escritura pública, el certificado de libertad de gravamen y la boleta catastral son los documentos centrales para acreditar la titularidad y el estado registral del inmueble.",
      "Las discrepancias entre el nombre del propietario, las medidas y colindancias, el folio real o la clave catastral entre distintos documentos (escritura, catastro, predial, levantamiento topográfico) son la señal de riesgo más común y deben resolverse antes del cierre, no después.",
    ],
    damages_or_remedies:
      "No aplica en el sentido litigioso. El resultado esperado es el cierre: escritura firmada, impuestos pagados, inscripción en el RPP completada y fondos liberados. Si el due diligence revela un defecto de título no subsanable antes del cierre, la vía es renegociar o no cerrar la operación, no un remedio judicial — salvo que la contraparte incumpla el contrato de compraventa, en cuyo caso el asunto se convierte en civil.",
    drafting_notes:
      "Este perfil es transaccional: el 'producto de trabajo' no son escritos procesales sino verificación de documentos, cartas de solicitud al cliente y reportes de due diligence/cierre. Aviso: este perfil se incorporó recientemente al motor junto con la materia inmobiliario; el abogado responsable debe confirmar los requisitos exactos (documentos, impuestos, plazos de inscripción) contra la Ley del Notariado y el Reglamento del RPP del estado específico donde se ubica el inmueble antes de que se incluyan en un producto de trabajo final — estos varían por entidad y no están unificados a nivel nacional.",
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
