import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/platform")({
  head: () => ({
    meta: [
      { title: "Plataforma · Nyrava Intelligence México" },
      { name: "description", content: "Arquitectura de inteligencia legal: procesamiento de documentos, extracción de entidades, relaciones y espacio de trabajo por caso." },
      { property: "og:title", content: "Plataforma — Nyrava Intelligence México" },
      { property: "og:description", content: "Arquitectura de inteligencia legal para el sistema jurídico mexicano." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlatformPage,
});

const PIPELINE = [
  { step: "01", name: "Ingesta", desc: "Documentos, escritos, contratos, resoluciones — cualquier formato." },
  { step: "02", name: "Clasificación", desc: "Tipo documental, jurisdicción, materia, actores." },
  { step: "03", name: "Extracción", desc: "Entidades, hechos, evidencia, testigos, fechas, autoridades." },
  { step: "04", name: "Relaciones", desc: "Mapeo entre personas, organizaciones, eventos y evidencia." },
  { step: "05", name: "Inteligencia", desc: "Cuestiones, contradicciones, argumentos, riesgos, cronología." },
  { step: "06", name: "Producto", desc: "Memoranda, escritos, resúmenes, informes y trabajo del abogado." },
];

function PlatformPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-7xl px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Arquitectura
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          Un pipeline de inteligencia<br />
          <span className="font-editorial text-primary">construido para el derecho mexicano.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          Cada documento cargado en Nyrava atraviesa un flujo determinista de procesamiento
          que produce un modelo de conocimiento navegable — no una respuesta de chatbot.
        </p>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((p) => (
            <div key={p.step} className="panel p-6">
              <div className="font-mono text-[11px] tracking-[0.22em] text-primary">{p.step}</div>
              <h3 className="mt-3 font-display text-lg font-semibold">{p.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
