import { createFileRoute, Link } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";
import { FileText } from "lucide-react";

type Sample = {
  slug: string;
  practiceArea: string;
  title: string;
  summary: string;
  highlights: string[];
};

const SAMPLES: Sample[] = [
  {
    slug: "penal",
    practiceArea: "Derecho Penal",
    title: "Causa penal — robo calificado con violencia",
    summary:
      "Análisis del artículo 16 CPEUM sobre una detención sin control judicial oportuno, el artículo 20 sobre una declaración ministerial rendida sin defensor presente, y la reconstrucción probatoria de la detención.",
    highlights: [
      "Problemas constitucionales redactados con citas al informe policial homologado y a la transcripción de la audiencia de control de detención.",
      "Contradicciones entre la declaración de la víctima y el audio de la cámara corporal surgieron automáticamente.",
      "Bosquejo del incidente de exclusión de prueba ilícita extraído del análisis constitucional.",
    ],
  },
  {
    slug: "responsabilidad-civil",
    practiceArea: "Derecho Civil",
    title: "Accidente de tránsito — vehículo de carga vs. particular",
    summary:
      "Reconstrucción de la secuencia del choque a partir del parte de tránsito, la bitácora de viaje del vehículo, las notas de ingreso a urgencias y la declaración del demandado.",
    highlights: [
      "Cronología minuto a minuto anclada a la bitácora de viaje.",
      "Plan de rehabilitación cotejado con los diagnósticos del expediente clínico.",
      "Marco de daños (cuantificación del daño) esbozado con citas de soporte.",
    ],
  },
  {
    slug: "responsabilidad-medica",
    practiceArea: "Derecho Civil",
    title: "Mala práctica médica — urgencias y diagnóstico tardío",
    summary:
      "Construcción de una cronología de urgencias minuto a minuto a partir del expediente clínico, el acta de investigación interna y el dictamen pericial.",
    highlights: [
      "Análisis de lex artis (estándar de atención) fundamentado en el dictamen pericial.",
      "Hallazgos de autopsia conciliados con la secuencia de registros médicos.",
      "Acta de investigación interna cotejada con la cronología clínica.",
    ],
  },
  {
    slug: "laboral",
    practiceArea: "Derecho Laboral",
    title: "Despido injustificado con reclamo de hostigamiento",
    summary:
      "Tres años de historial de desempeño, una queja interna ante Recursos Humanos y un hilo de correos analizados para determinar la oportunidad del despido y su pretexto.",
    highlights: [
      "Análisis de pretexto vinculado a pasajes específicos de la evaluación de desempeño.",
      "Queja interna conciliada contra el registro de incidentes.",
      "Cronología de actividad protegida vs. acto adverso producida automáticamente.",
    ],
  },
  {
    slug: "familiar",
    practiceArea: "Derecho Familiar",
    title: "Divorcio con guarda y custodia y alegaciones de violencia familiar",
    summary:
      "Conciliación de la denuncia de violencia familiar, el informe de trabajo social y las declaraciones patrimoniales encontradas.",
    highlights: [
      "Comparación cruzada de declaraciones parentales entre el informe de trabajo social y las declaraciones.",
      "Cronología de la denuncia superpuesta con las fechas de la declaración patrimonial.",
      "Factores del interés superior del menor surgieron con citas de soporte.",
    ],
  },
  {
    slug: "amparo",
    practiceArea: "Amparo",
    title: "Amparo directo — cuestiones probatorias y constitucionales",
    summary:
      "Reconstrucción del historial procesal a partir de la demanda de amparo, actas de audiencia, el informe justificado y la réplica.",
    highlights: [
      "Cronología procesal extraída para la sección de antecedentes.",
      "Análisis de definitividad anclado a citas del expediente.",
      "Conceptos de violación redactados con citas al expediente y marco doctrinal.",
    ],
  },
  {
    slug: "constitucional",
    practiceArea: "Derecho Constitucional / Derechos Humanos",
    title: "Uso excesivo de la fuerza y responsabilidad de la autoridad",
    summary:
      "Análisis del artículo 1 CPEUM con agrupación de declaraciones oficiales entre el informe policial, la bitácora de asuntos internos y la declaración ministerial.",
    highlights: [
      "Contradicciones entre testigos cruzadas entre la bitácora de asuntos internos y la declaración ministerial.",
      "Teoría de responsabilidad institucional esbozada con citas al historial de quejas internas.",
      "Marco de reparación del daño vinculado a registros médicos y testimonios.",
    ],
  },
  {
    slug: "fiscal",
    practiceArea: "Derecho Fiscal",
    title: "Resolución determinante y juicio de nulidad ante el TFJA",
    summary:
      "Conciliación del acta final de visita, estados de cuenta y correspondencia con el contador público para un juicio de nulidad.",
    highlights: [
      "Conciliación de depósitos vinculada a registros bancarios a nivel CFDI.",
      "Sustento de gastos de oficina en casa y vehículo cotejado con bitácoras de soporte.",
      "Determinación del recurso de revocación integrada a la reconstrucción factual de la demanda.",
    ],
  },
  {
    slug: "mercantil",
    practiceArea: "Derecho Mercantil",
    title: "Disputa contractual con reconvención",
    summary:
      "Contrato de compraventa mercantil, registro de pagos, hilo de correos e inspección independiente conciliados para un análisis de incumplimiento y reconvención.",
    highlights: [
      "Análisis del registro de pagos fundamentado en los registros contables subyacentes.",
      "Informe de inspección cotejado contra los entregables del contrato.",
      "Teoría de reconvención esbozada con citas responsivas.",
    ],
  },
];

export const Route = createFileRoute("/resources")({
  head: () => {
    const url = `${CANONICAL_BASE}/resources`;
    const desc =
      "Reportes de muestra redactados en nueve áreas del derecho mexicano — penal, civil, laboral, familiar, amparo, derechos humanos, fiscal y mercantil.";
    return {
      meta: [
        { title: "Recursos — Reportes de muestra por área de práctica | Nyrava" },
        { name: "description", content: desc },
        { property: "og:title", content: "Recursos — Nyrava" },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: breadcrumbJsonLd(CANONICAL_BASE, [{ label: "Recursos", to: "/resources" }]),
      }],
    };
  },
  component: Resources,
});

function Resources() {
  return (
    <DocsLayout
      eyebrow="Recursos"
      title="Reportes de muestra por área de práctica"
      description="Resúmenes breves del análisis de Nyrava en nueve áreas de práctica. Cada resumen describe el expediente analizado y los puntos destacados del reporte generado — útil para evaluar ajuste."
      crumbs={[{ label: "Recursos", to: "/resources" }]}
    >
      <Callout variant="info" title="Material sintético redactado">
        Los corpus de muestra son compuestos sintéticos construidos para evaluación y entrenamiento.
        No se derivan de ningún asunto real ni representan a ninguna parte real.
      </Callout>

      <DocsSection>
        <div className="my-4 grid gap-4 sm:grid-cols-2">
          {SAMPLES.map((s) => (
            <div key={s.slug} className="flex flex-col rounded-xl border border-border/60 bg-card/30 p-5">
              <div className="mb-3 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-primary">
                <FileText className="h-3.5 w-3.5" />
                {s.practiceArea}
              </div>
              <div className="text-[14px] font-semibold text-foreground">{s.title}</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{s.summary}</p>
              <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground">
                {s.highlights.map((h, i) => (
                  <li key={i} className="pl-4 -indent-4">→ {h}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection heading="¿Quiere ver un reporte en su área de práctica?">
        <p>
          Solicite una demostración a través de la página de{" "}
          <Link to="/contact" className="text-primary hover:underline">Contacto</Link> e indíquenos
          qué área de práctica está evaluando. Los bufetes inscritos en la beta también pueden
          ejecutar cualquiera de los corpus de muestra directamente desde la herramienta de fixtures
          del administrador.
        </p>
      </DocsSection>
    </DocsLayout>
  );
}
