import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "Cómo Funciona — Nyrava México" },
      { name: "description", content: "Cómo opera Nyrava México: procesamiento de expedientes, compuerta probatoria, actualización incremental y gestión multidisciplinaria de atención integral." },
      { property: "og:title", content: "Cómo Funciona — Nyrava Inteligencia Jurídica y Atención Integral" },
      { property: "og:description", content: "Procesamiento de expedientes, fundamentación probatoria y flujos de atención integral para México." },
      { property: "og:url", content: "https://mexico.nyrava.com/how-it-works" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/how-it-works" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/how-it-works" }],
  }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  const { locale } = useI18n();
  const isEs = locale === "es";

  return (
    <LegalPage
      eyebrow={isEs ? "Metodología y Operación" : "Methodology & Architecture"}
      title={isEs ? "Cómo Funciona Nyrava México" : "How Nyrava México Works"}
      intro={
        <p>
          {isEs
            ? "Nyrava México opera bajo una arquitectura estructurada que atiende dos pilares fundamentales: la Inteligencia Jurídica para análisis probatorio y litigio, y la Atención Integral para trabajo social, planes de cuidado y red de canalización institucional."
            : "Nyrava México operates on a structured architecture supporting two fundamental pillars: Legal Intelligence for evidentiary analysis and litigation, and Comprehensive Care for social work, care plans, and institutional referral networks."}
        </p>
      }
    >
      <Section heading={isEs ? "1. Ingesta y Clasificación por Materia" : "1. Ingestion & Practice-Area Classification"}>
        <p>
          {isEs
            ? "Cargue el expediente o actuaciones del caso. El motor normaliza los documentos mediante OCR avanzado y clasifica el asunto dentro de las 14 materias canónicas del derecho mexicano (Penal, Civil, Mercantil, Familiar, Laboral, Amparo, etc.), identificando el fuero (Federal o Estatal)."
            : "Upload case documents or expediente files. The engine normalizes records via advanced OCR and classifies the matter into one of the 14 canonical practice areas of Mexican law (Penal, Civil, Commercial, Family, Labor, Amparo, etc.), identifying Federal or State jurisdiction."}
        </p>
      </Section>

      <Section heading={isEs ? "2. Extracción y Compuerta de Evidencia" : "2. Fact Extraction & Evidence Gate"}>
        <p>
          {isEs
            ? "Cada hecho, fecha y declaración testimonial se indexa con referencia exacta a la foja y párrafo de origen. Toda afirmación no respaldada por el expediente es suprimida automáticamente por la compuerta de evidencia antes de ingresar a los informes o borradores."
            : "Every fact, date, and witness statement is indexed with exact page and paragraph citations. Any ungrounded assertion is automatically suppressed by the evidence gate before entering reports or draft pleadings."}
        </p>
      </Section>

      <Section heading={isEs ? "3. Actualizaciones Incrementales del Expediente" : "3. Incremental Record Updates"}>
        <p>
          {isEs
            ? "A medida que el juicio avanza, los abogados pueden subir promociones supervenientes o acuerdos posteriores. Nyrava reconcilia la nueva información y actualiza la cronología y contradicciones sin destruir las notas ni anotaciones profesionales previas."
            : "As litigation progresses, attorneys can upload supplemental filings or new judicial rulings. Nyrava reconciles the new information, updating timelines and contradiction maps without overwriting prior attorney notes."}
        </p>
      </Section>

      <Section heading={isEs ? "4. Flujo de Atención Integral (Trabajo Social)" : "4. Comprehensive Care Workflow (Social Work)"}>
        <p>
          {isEs
            ? "Para organizaciones sociales y multidisciplinarias, el flujo abarca: Ingesta estructurada con folio único → Valoración multidimensional de riesgo en 7 ejes → Plan de cuidado por objetivos → Registro de intervenciones → Canalización a instituciones del directorio (DIF, CEAV, INM, COMAR) → Seguimiento y cierre documentado."
            : "For social and multidisciplinary organizations, the workflow spans: Structured intake with unique folio → 7-axis multidimensional risk assessment → Goal-driven care plan → Direct interventions logging → Institutional referral network coordination (DIF, CEAV, INM, COMAR) → Follow-up and documented closure."}
        </p>
      </Section>

      <Section heading={isEs ? "5. Privacidad Multinivel y Consentimiento Informado" : "5. Multi-Tier Privacy & Informed Consent"}>
        <p>
          {isEs
            ? "Los expedientes sociales se resguardan bajo 6 niveles de confidencialidad (General, Trabajo Social, Legal Privilegiado, Psicosocial, Médico y Protección de la Infancia). La emisión de paquetes de derivación o documentos compartidos requiere consentimiento informado vigente del titular."
            : "Social case records are protected across 6 confidentiality tiers (General, Social Work, Privileged Legal, Psychosocial, Medical, and Child Protection). Generating referral packets or sharing documents requires active informed consent."}
        </p>
      </Section>

      <Section heading={isEs ? "6. Control Humano y Responsabilidad Profesional" : "6. Human Oversight & Professional Responsibility"}>
        <p>
          {isEs
            ? "Nyrava asiste, estructura y analiza; la decisión estratégica, el criterio legal y la valoración clínica permanecen siempre bajo la exclusiva responsabilidad del profesional humano facultado."
            : "Nyrava assists, structures, and analyzes; strategic decisions, legal judgment, and clinical assessments remain exclusively under the authority of qualified human professionals."}
        </p>
      </Section>
    </LegalPage>
  );
}
