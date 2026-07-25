import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/modules")({
  head: () => ({
    meta: [
      { title: "Módulos de Inteligencia · Nyrava México" },
      { name: "description", content: "Legal, Caso, Evidencia, Testigos, Línea de Tiempo, Litigio, Contratos e Investigación — los ocho módulos de Nyrava Intelligence México." },
      { property: "og:title", content: "Módulos de Inteligencia · Nyrava" },
      { property: "og:description", content: "Ocho módulos de inteligencia legal integrados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ModulesPage,
});

const MODULES = [
  { name: "Inteligencia Legal", features: ["Análisis estatutario", "Investigación de jurisprudencia", "Razonamiento legal", "Recomendaciones de citación", "Análisis de autoridad aplicable"] },
  { name: "Inteligencia de Caso", features: ["Resúmenes del caso", "Identificación de cuestiones", "Extracción de hechos", "Mapeo de relaciones", "Organización del caso"] },
  { name: "Inteligencia de Evidencia", features: ["Clasificación", "Relaciones entre evidencias", "Detección de evidencia faltante", "Evidencia contradictoria", "Análisis de fuerza probatoria"] },
  { name: "Inteligencia de Testigos", features: ["Perfiles de testigos", "Comparación de declaraciones", "Análisis de contradicciones", "Observaciones de credibilidad", "Mapeo de relaciones"] },
  { name: "Inteligencia de Línea de Tiempo", features: ["Cronología automática", "Correlación de eventos", "Cronología de testigos", "Cronología de evidencia", "Visualización interactiva"] },
  { name: "Inteligencia de Litigio", features: ["Cuestiones procesales", "Observaciones estratégicas", "Argumentos potenciales", "Análisis de riesgos", "Fortalezas y debilidades"] },
  { name: "Inteligencia Contractual", features: ["Revisión de contratos", "Extracción de cláusulas", "Identificación de riesgos", "Seguimiento de plazos", "Revisión de cumplimiento"] },
  { name: "Investigación", features: ["Legislación Federal", "Legislación Estatal", "SCJN", "Poder Judicial Federal y Estatal", "DOF y códigos procesales"] },
];

function ModulesPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-7xl px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Módulos
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          Ocho módulos<span className="font-editorial text-primary">.</span> Un solo modelo.
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          Cada módulo funciona de manera independiente y contribuye al modelo de inteligencia global del caso.
        </p>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.name} className="panel p-6">
              <h3 className="font-display text-lg font-semibold">{m.name}</h3>
              <ul className="mt-4 space-y-2">
                {m.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
