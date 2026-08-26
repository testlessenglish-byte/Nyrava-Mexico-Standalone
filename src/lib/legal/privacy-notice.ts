/**
 * Aviso de Privacidad Integral — Nyrava México.
 *
 * Spanish-first, structured to the LFPDPPP (arts. 15–16) content requirements.
 * The Spanish text is the canonical version: PRIVACY_NOTICE_HASH is the
 * SHA-256 of `canonicalPrivacyText()` and is what gets recorded in
 * `legal_document_versions` and in every `user_consents` row.
 *
 * PLACEHOLDERS: anything wrapped in [POR CONFIRMAR: ...] is business/legal
 * identity information that must be supplied by Nyrava before this notice can
 * be considered final. Nothing here is invented.
 */

export const PRIVACY_DOCUMENT_TYPE = "aviso_privacidad";
export const PRIVACY_VERSION = "2026.08.1";
export const PRIVACY_EFFECTIVE_DATE = "2026-08-26";
/** SHA-256 of canonicalPrivacyText() — regenerate with scripts/privacy-hash.ts */
export const PRIVACY_NOTICE_HASH =
  "c49cc421e779494995003615c96e2782b0e5a51c442e42f2789d948c618b62cf";

export const PLACEHOLDER_MARK = "[POR CONFIRMAR:";

export type NoticeSection = { heading: string; body: string[]; bullets?: string[] };

export const PRIVACY_NOTICE_ES: { title: string; intro: string; sections: NoticeSection[] } = {
  title: "Aviso de Privacidad Integral",
  intro:
    "El presente Aviso de Privacidad se emite en cumplimiento de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP), su Reglamento y los Lineamientos del Aviso de Privacidad. Describe qué datos personales tratamos, con qué finalidades, con quién los compartimos y cómo puede usted ejercer sus derechos ARCO.",
  sections: [
    {
      heading: "1. Identidad y domicilio del responsable",
      body: [
        "El responsable del tratamiento de sus datos personales es [POR CONFIRMAR: razón social completa del titular de Nyrava México], con Registro Federal de Contribuyentes [POR CONFIRMAR: RFC] y domicilio en [POR CONFIRMAR: domicilio fiscal completo, incluyendo calle, número, colonia, municipio/alcaldía, entidad federativa y código postal].",
        "La plataforma opera bajo la marca Nyrava México en el dominio mexico.nyrava.com.",
      ],
    },
    {
      heading: "2. Canal de contacto en materia de privacidad",
      body: [
        "Para cualquier asunto relacionado con sus datos personales, incluyendo el ejercicio de derechos ARCO, la revocación del consentimiento o la limitación del uso o divulgación de sus datos, puede comunicarse con el área de datos personales en [POR CONFIRMAR: correo electrónico oficial de privacidad] o mediante el formulario disponible en la página de Contacto de la plataforma.",
        "El área responsable de atender estas solicitudes es [POR CONFIRMAR: nombre del área o persona designada como responsable de datos personales].",
      ],
    },
    {
      heading: "3. Categorías de datos personales que tratamos",
      body: ["Tratamos únicamente los datos necesarios para prestar el servicio:"],
      bullets: [
        "Datos de identificación y contacto: nombre, correo electrónico, identificadores de autenticación y, en su caso, organización o despacho al que pertenece.",
        "Datos profesionales: perfil profesional, área de práctica y datos de registro proporcionados durante la configuración de la cuenta.",
        "Datos de facturación y suscripción: plan contratado, estado de la suscripción y eventos de pago procesados por el proveedor de pagos.",
        "Datos técnicos y de uso: registros de acceso, marcas de tiempo, identificadores de solicitud, eventos de error y telemetría operativa.",
        "Contenido de expedientes: documentos, evidencia, notas y metadatos que usted o su equipo cargan a la plataforma.",
      ],
    },
    {
      heading: "4. Datos personales sensibles",
      body: [
        "El tratamiento de expedientes jurídicos implica que los documentos que usted carga pueden contener datos personales sensibles de terceros, en términos del artículo 3, fracción VI de la LFPDPPP: estado de salud, origen étnico, datos biométricos, creencias religiosas, opiniones políticas, preferencia sexual, información sobre procedimientos penales, migratorios, familiares o de protección social.",
        "Nyrava no solicita datos sensibles de manera directa ni los utiliza para finalidad distinta a la ejecución del análisis que usted solicita. Usted, como profesional del derecho o del ámbito social, es responsable de contar con la base legal o el consentimiento del titular para incorporar dicha información a la plataforma. Se requiere su consentimiento expreso para que Nyrava procese esta categoría de información por cuenta suya.",
      ],
    },
    {
      heading: "5. Documentos de casos y evidencia cargada",
      body: [
        "Los archivos que se cargan se almacenan cifrados en tránsito y en reposo, quedan delimitados a su espacio de trabajo mediante seguridad a nivel de fila y solo son accesibles por usted, por los miembros de su organización a quienes usted otorgue acceso y por el personal técnico estrictamente necesario para operar o restaurar el servicio.",
        "El contenido de sus expedientes no se utiliza para entrenar modelos de propósito general ni se comercializa.",
      ],
    },
    {
      heading: "6. Tratamiento asistido por inteligencia artificial",
      body: [
        "Cuando usted ejecuta un análisis, fragmentos de los documentos del expediente se transmiten a proveedores de modelos de lenguaje para extracción, clasificación, construcción de cronologías, análisis de evidencia y generación de reportes.",
        "Los resultados generados por IA son apoyo profesional y no constituyen asesoría jurídica; deben ser verificados por la persona profesional responsable del asunto. El detalle del funcionamiento se describe en la página de Transparencia de IA.",
      ],
    },
    {
      heading: "7. Encargados y terceros",
      body: [
        "Para operar la plataforma recurrimos a encargados que tratan datos por cuenta nuestra, bajo instrucción y con obligaciones de confidencialidad:",
      ],
      bullets: [
        "Infraestructura de nube, base de datos, autenticación y almacenamiento de archivos.",
        "Proveedores de modelos de inteligencia artificial utilizados para el análisis de expedientes.",
        "Proveedor de correo transaccional para notificaciones e invitaciones.",
        "Proveedor de procesamiento de pagos para suscripciones.",
      ],
    },
    {
      heading: "8. Transferencias y tratamiento internacional",
      body: [
        "La infraestructura de cómputo y los proveedores de modelos de inteligencia artificial pueden encontrarse fuera del territorio nacional, principalmente en los Estados Unidos de América. Ello implica que sus datos y los contenidos de sus expedientes pueden ser tratados en el extranjero por dichos encargados.",
        "No realizamos transferencias de datos personales a terceros que los traten para finalidades propias, salvo requerimiento de autoridad competente. Las remisiones a encargados se realizan conforme al artículo 36 de la LFPDPPP y a los contratos de tratamiento correspondientes.",
      ],
    },
    {
      heading: "9. Finalidades del tratamiento",
      body: ["Finalidades primarias, necesarias para la relación con usted:"],
      bullets: [
        "Crear y administrar su cuenta, su organización y los permisos de su equipo.",
        "Ejecutar los análisis, reportes y herramientas de inteligencia jurídica que usted solicita.",
        "Almacenar y poner a su disposición los expedientes y la evidencia cargada.",
        "Facturación, control de suscripción y soporte técnico.",
        "Seguridad de la plataforma, prevención de abuso, auditoría y cumplimiento legal.",
      ],
    },
    {
      heading: "10. Conservación y eliminación",
      body: [
        "Los datos de expedientes se conservan mientras exista su espacio de trabajo. Usted puede eliminar casos y documentos en cualquier momento desde la aplicación. Al eliminar un caso se eliminan sus datos derivados asociados.",
        "Los registros de consentimiento, auditoría y facturación se conservan por el plazo legal aplicable aun después de la baja de la cuenta, por tratarse de evidencia de cumplimiento. La solicitud de eliminación total de la cuenta se atiende por el canal de privacidad indicado en la sección 2.",
      ],
    },
    {
      heading: "11. Derechos ARCO y revocación",
      body: [
        "Usted tiene derecho a Acceder a sus datos personales, Rectificarlos cuando sean inexactos, Cancelarlos cuando considere que no se requieren para alguna de las finalidades señaladas, y a Oponerse a su tratamiento para fines específicos. Asimismo, puede revocar el consentimiento otorgado y limitar el uso o divulgación de sus datos.",
      ],
    },
    {
      heading: "12. Cómo ejercer sus derechos ARCO",
      body: [
        "Puede presentar su solicitud desde la sección Control de Datos dentro de la plataforma, o por escrito al canal indicado en la sección 2. La solicitud debe incluir: nombre del titular y medio para comunicar la respuesta, documento que acredite identidad o representación, descripción clara de los datos y del derecho que se ejerce, y cualquier elemento que facilite la localización de los datos.",
        "Daremos respuesta en un plazo máximo de 20 días hábiles y, de resultar procedente, la haremos efectiva dentro de los 15 días hábiles siguientes, conforme al artículo 32 de la LFPDPPP. Si considera que su derecho no fue atendido, puede acudir ante el organismo garante competente en materia de protección de datos personales.",
      ],
    },
    {
      heading: "13. Cambios al Aviso de Privacidad",
      body: [
        "Este aviso se versiona. Cada versión se registra con su fecha de entrada en vigor y una huella criptográfica (SHA-256) del texto. Cuando exista un cambio sustancial, se publicará la nueva versión en esta página y se solicitará nuevamente su acuse dentro de la plataforma antes de continuar utilizando el servicio.",
      ],
    },
  ],
};

export const PRIVACY_NOTICE_EN: { title: string; intro: string; sections: NoticeSection[] } = {
  title: "Privacy Notice",
  intro:
    "This is a courtesy English translation of the Spanish Aviso de Privacidad Integral. The Spanish version is the binding one and is the text that is hashed and versioned.",
  sections: [
    {
      heading: "1. Data controller",
      body: [
        "The controller is [TO BE CONFIRMED: full legal entity name], tax ID [TO BE CONFIRMED: RFC], with address at [TO BE CONFIRMED: full registered address]. The platform operates as Nyrava México at mexico.nyrava.com.",
      ],
    },
    {
      heading: "2. Privacy contact",
      body: [
        "Privacy matters and ARCO requests: [TO BE CONFIRMED: official privacy email], or the in-app Contact page. Responsible area: [TO BE CONFIRMED: designated data protection contact].",
      ],
    },
    {
      heading: "3. Categories of personal data",
      body: ["Identification and contact data, professional profile, billing and subscription data, technical and usage logs, and the case documents, evidence, notes and metadata you upload."],
    },
    {
      heading: "4. Sensitive personal data",
      body: [
        "Legal case files may contain sensitive personal data of third parties (health, ethnicity, biometrics, religious or political views, sexual preference, criminal, immigration, family or social-protection information). Nyrava does not request it directly and uses it only to run the analysis you request. You are responsible for having a lawful basis to upload it; your express consent is required for Nyrava to process this category on your behalf.",
      ],
    },
    {
      heading: "5. Case documents and uploaded evidence",
      body: [
        "Files are encrypted in transit and at rest, scoped to your workspace by row-level security, and are never used to train general-purpose models or sold.",
      ],
    },
    {
      heading: "6. AI-assisted processing",
      body: [
        "When you run an analysis, document excerpts are sent to large language model providers for extraction, classification, timeline building, evidence analysis and report generation. AI output is professional support, not legal advice, and must be verified by the responsible professional.",
      ],
    },
    {
      heading: "7. Processors and third parties",
      body: [
        "Cloud infrastructure, database, authentication and file storage; AI model providers; transactional email provider; payment processor. All act as processors on our instructions and under confidentiality obligations.",
      ],
    },
    {
      heading: "8. International processing and transfers",
      body: [
        "Infrastructure and AI providers may be located outside Mexico, principally in the United States, so your data and case content may be processed abroad. We do not transfer personal data to third parties for their own purposes, except where required by a competent authority.",
      ],
    },
    {
      heading: "9. Purposes",
      body: [
        "Account, organization and team management; running the analyses, reports and intelligence tools you request; storing and serving your case files; billing, subscription control and support; platform security, abuse prevention, audit and legal compliance.",
      ],
    },
    {
      heading: "10. Retention and deletion",
      body: [
        "Case data is retained while your workspace exists; you can delete cases and documents at any time. Consent, audit and billing records are retained for the applicable legal period as proof of compliance. Full account deletion is handled through the privacy channel in section 2.",
      ],
    },
    {
      heading: "11. ARCO rights and withdrawal",
      body: [
        "You may Access, Rectify, Cancel or Object to the processing of your personal data, withdraw consent, and limit the use or disclosure of your data.",
      ],
    },
    {
      heading: "12. Exercising ARCO rights",
      body: [
        "Submit a request from the Data Control section in the app or in writing to the channel in section 2, including proof of identity, a clear description of the data and of the right exercised. We answer within 20 business days and, where applicable, act within the following 15 business days (LFPDPPP art. 32).",
      ],
    },
    {
      heading: "13. Changes to this notice",
      body: [
        "Each version is registered with an effective date and a SHA-256 hash of the text. On material changes, the new version is published here and re-acknowledgement is requested in-app.",
      ],
    },
  ],
};

/** Canonical, hashable serialization of the Spanish notice. */
export function canonicalPrivacyText(): string {
  const n = PRIVACY_NOTICE_ES;
  const parts = [
    `${PRIVACY_DOCUMENT_TYPE}|${PRIVACY_VERSION}|es|${PRIVACY_EFFECTIVE_DATE}`,
    n.title,
    n.intro,
    ...n.sections.flatMap((s) => [s.heading, ...s.body, ...(s.bullets ?? [])]),
  ];
  return parts.join("\n");
}

/** Business information Nyrava still has to supply. */
export const REQUIRED_BUSINESS_INFO = [
  "Razón social completa del responsable",
  "RFC del responsable",
  "Domicilio fiscal completo",
  "Correo electrónico oficial de privacidad",
  "Nombre del área o persona designada para datos personales",
] as const;

/** Consent items presented at signup / first authenticated session. */
export const CONSENT_ITEMS = [
  { key: "privacy_notice", consentType: "acknowledgment", required: true },
  { key: "personal_data", consentType: "acceptance", required: true },
  { key: "sensitive_data", consentType: "sensitive_data_consent", required: true },
  { key: "ai_processing", consentType: "explicit_consent", required: true },
  { key: "international_transfer", consentType: "transfer_consent", required: true },
] as const;

export type ConsentKey = (typeof CONSENT_ITEMS)[number]["key"];
