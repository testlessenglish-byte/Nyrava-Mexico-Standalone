import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "Cómo Funciona — Nyrava México" },
      { name: "description", content: "Cómo el motor de inteligencia jurídica de Nyrava procesa expedientes, extrae hechos fundamentados y genera análisis con citas verificadas para el derecho mexicano." },
      { property: "og:title", content: "Cómo Funciona — Nyrava Inteligencia Jurídica" },
      { property: "og:description", content: "Procesamiento, análisis, fundamentación y redacción de expedientes legales con citas verificadas." },
      { property: "og:url", content: "https://mexico.nyrava.com/how-it-works" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/how-it-works" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/how-it-works" }],
  }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  return (
    <LegalPage
      eyebrow="Plataforma"
      title="Cómo Funciona Nyrava"
      intro={
        <p>
          Nyrava transforma expedientes y documentos jurídicos en un análisis estructurado,
          fundamentado y verificable. Cada conclusión está anclada a sus fuentes documentales.
        </p>
      }
    >
      <Section heading="1. Ingesta y normalización">
        <p>
          Cargue el expediente completo — demandas, acuerdos, testimoniales, peritajes y notas.
          Los documentos se extraen, normalizan mediante OCR avanzado e indexan de forma segura
          en su espacio de trabajo.
        </p>
      </Section>
      <Section heading="2. Análisis especializado">
        <p>
          Motores jurídicos construyen la cronología de los hechos, identifican testigos, detectan
          violaciones a garantías constitucionales, señalan contradicciones y evalúan el soporte probatorio.
        </p>
      </Section>
      <Section heading="3. Fundamentación y compuerta probatoria">
        <p>
          Cada hallazgo incluye citas directas al texto fuente que lo respalda. Todo dato no fundamentado
          es suprimido automáticamente por la compuerta de evidencia antes de incorporarse al reporte.
        </p>
      </Section>
      <Section heading="4. Proyectos de escritos e informes">
        <p>
          Los módulos de Inteligencia de Escritos e Informes estructuran proyectos de trabajo
          completos, listos para ser exportados, revisados y perfeccionados por el profesional del derecho.
        </p>
      </Section>
      <Section heading="5. Control y responsabilidad del abogado">
        <p>
          Cada resultado producido por Nyrava está diseñado para la revisión profesional.
          La plataforma propone y asiste; el abogado mantiene siempre el criterio, la decisión y la responsabilidad final.
        </p>
      </Section>
    </LegalPage>
  );
}
