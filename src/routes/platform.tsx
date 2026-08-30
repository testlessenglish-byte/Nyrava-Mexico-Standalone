import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/i18n";
import { FileText, ShieldCheck, HeartHandshake, GitBranch, Scale, Database } from "lucide-react";

export const Route = createFileRoute("/platform")({
  head: () => ({
    meta: [
      { title: "Plataforma · Nyrava Intelligence México" },
      { name: "description", content: "Arquitectura integral de inteligencia jurídica y atención social: procesamiento documental con citas a fojas, compuertas probatorias, planes de cuidado y privacidad en 6 niveles." },
      { property: "og:title", content: "Plataforma — Nyrava Intelligence México" },
      { property: "og:description", content: "Arquitectura de inteligencia legal y atención integral para México." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/platform" }],
  }),
  component: PlatformPage,
});

const LEGAL_STEPS = [
  { key: "ingest", num: "01", icon: FileText, titleEs: "Ingesta y OCR de Expedientes", titleEn: "Record Ingestion & OCR", descEs: "Carga de actuaciones completas con digitalización y normalización automática de fojas.", descEn: "Complete case ingestion with automated OCR digitization and page normalization." },
  { key: "classify", num: "02", icon: Scale, titleEs: "Clasificación en 14 Materias", titleEn: "14-Materia Classification", descEs: "Identificación de materia (Penal, Civil, Familiar, Amparo, etc.) y fuero Federal o Estatal.", descEn: "Matter classification (Criminal, Civil, Family, Amparo, etc.) and Federal or State jurisdiction." },
  { key: "extract", num: "03", icon: Database, titleEs: "Extracción y Compuerta de Evidencia", titleEn: "Extraction & Evidence Gate", descEs: "Anclaje de hechos a fojas exactas y supresión automática de afirmaciones no verificables.", descEn: "Fact anchoring to exact pages and automatic suppression of ungrounded assertions." },
  { key: "intel", num: "04", icon: GitBranch, titleEs: "Motores Jurídicos Especializados", titleEn: "Specialized Legal Engines", descEs: "Cronologías con contradicciones, análisis testimonial y detección de cuestiones constitucionales.", descEn: "Timelines with contradiction flags, testimony analysis, and constitutional issue-spotting." },
  { key: "promociones", num: "05", icon: FileText, titleEs: "Borradores de Promociones", titleEn: "Motion & Pleadings Drafts", descEs: "Generación de proyectos de escritos fundamentados en jurisprudencia de la SCJN.", descEn: "Drafting of pleadings grounded in evidence and SCJN binding jurisprudence." },
  { key: "reports", num: "06", icon: ShieldCheck, titleEs: "Informe Canónico de 17 Secciones", titleEn: "17-Section Canonical Report", descEs: "Dossier estructurado y versionado exportable a PDF y JSON con verificación SHA-256.", descEn: "Version-locked structured dossier exportable to PDF and JSON with SHA-256 verification." },
];

const CARE_STEPS = [
  { num: "01", icon: FileText, titleEs: "Ingesta y Triaje con Folio", titleEn: "Intake & Triage with Folio", descEs: "Registro estructurado con folio correlativo (INT-YYYY-XXXX) y categorización de urgencia.", descEn: "Structured intake logging with automated sequential folios and urgency triage." },
  { num: "02", icon: ShieldCheck, titleEs: "Valoración de Riesgo en 7 Ejes", titleEn: "7-Axis Multidimensional Risk", descEs: "Evaluación de seguridad, vivienda, salud, psicosocial, legal, nutrición y situación migratoria.", descEn: "Risk evaluation across safety, housing, health, psychosocial, legal, nutrition, and immigration." },
  { num: "03", icon: GitBranch, titleEs: "Planes de Cuidado e Intervenciones", titleEn: "Care Plans & Interventions", descEs: "Metas e hitos con registro de acciones directas y reconocimientos de supervisión.", descEn: "Goals and milestones with direct service tracking and supervisor acknowledgments." },
  { num: "04", icon: HeartHandshake, titleEs: "Canalización Institucional y Consentimiento", titleEn: "Referral Network & Consent", descEs: "Derivación segura a organismos públicos (DIF, CEAV, INM, COMAR) con consentimiento informado.", descEn: "Secure referrals to public agencies (DIF, CEAV, INM, COMAR) with informed consent." },
  { num: "05", icon: ShieldCheck, titleEs: "Privacidad Confidencial en 6 Niveles", titleEn: "6-Tier Record Privacy", descEs: "Separación estricta de registros generales, sociales, legales, psicosociales y médicos.", descEn: "Strict isolation of general, social, legal, psychosocial, and medical case records." },
  { num: "06", icon: HeartHandshake, titleEs: "Apoyo Comunitario y Rendición de Cuentas", titleEn: "Community Support & Auditing", descEs: "Campañas solidarias protegidas e informes de auditoría institucional con firma digital.", descEn: "Protected solidarity campaigns and institutional audit reports with digital signatures." },
];

function PlatformPage() {
  const { locale } = useI18n();
  const isEs = locale === "es";

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-[100rem] px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {isEs ? "ARQUITECTURA DE DOBLE NÚCLEO" : "DUAL-CORE ARCHITECTURE"}
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          {isEs ? "Plataforma Tecnológica " : "Technology Platform "}
          <span className="font-editorial text-primary">{isEs ? "Nyrava México" : "Nyrava Mexico"}</span>
        </h1>
        <p className="mt-6 max-w-3xl text-muted-foreground">
          {isEs
            ? "Diseñada específicamente para las exigencias procesales del sistema jurídico mexicano y la atención multidisciplinaria de organizaciones civiles y de derechos humanos."
            : "Engineered specifically for the procedural demands of the Mexican legal system and the multidisciplinary care workflows of civil and human rights organizations."}
        </p>

        {/* Core 1: Legal Intelligence */}
        <div className="mt-16">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            <Scale className="h-4 w-4" /> {isEs ? "NÚCLEO 1: INTELIGENCIA JURÍDICA" : "CORE 1: LEGAL INTELLIGENCE"}
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold">
            {isEs ? "Procesamiento Probatorio y Análisis Procesal" : "Evidentiary Processing & Procedural Analysis"}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {LEGAL_STEPS.map((s) => (
              <div key={s.num} className="panel p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-primary">{s.num}</span>
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="mt-3 font-display text-base font-semibold">{isEs ? s.titleEs : s.titleEn}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{isEs ? s.descEs : s.descEn}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Core 2: Comprehensive Care */}
        <div className="mt-20 border-t border-border/60 pt-16">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            <HeartHandshake className="h-4 w-4" /> {isEs ? "NÚCLEO 2: ATENCIÓN INTEGRAL Y TRABAJO SOCIAL" : "CORE 2: COMPREHENSIVE CARE & SOCIAL WORK"}
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold">
            {isEs ? "Gestión de Casos Sociales, Planes de Cuidado y Red Institucional" : "Social Case Management, Care Plans & Institutional Network"}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CARE_STEPS.map((s) => (
              <div key={s.num} className="panel p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-primary">{s.num}</span>
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="mt-3 font-display text-base font-semibold">{isEs ? s.titleEs : s.titleEn}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{isEs ? s.descEs : s.descEn}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
