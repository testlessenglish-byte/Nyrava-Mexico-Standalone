import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/i18n";

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
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/modules" }],
  }),
  component: ModulesPage,
});

const MODULE_KEYS = [
  "legal", "case", "evidence", "witness", "timeline", "litigation", "contract", "research", "care", "community",
] as const;

const CANONICAL_MATERIAS_LIST = [
  { es: "Derecho Penal (Sistema Acusatorio)", en: "Criminal Law (Accusatory System)" },
  { es: "Derecho Civil", en: "Civil Law" },
  { es: "Derecho Mercantil (Gobierno Corporativo y M&A)", en: "Commercial & Corporate Law" },
  { es: "Derecho Familiar", en: "Family Law" },
  { es: "Derecho Laboral", en: "Labor Law" },
  { es: "Derecho Administrativo", en: "Administrative Law" },
  { es: "Derecho Fiscal y TFJA", en: "Tax Law" },
  { es: "Juicio de Amparo (Directo e Indirecto)", en: "Amparo Proceedings" },
  { es: "Derecho Electoral", en: "Electoral Law" },
  { es: "Derecho Agrario", en: "Agrarian Law" },
  { es: "Derecho Constitucional y Derechos Humanos", en: "Constitutional & Human Rights Law" },
  { es: "Derecho Ambiental", en: "Environmental Law" },
  { es: "Derecho Inmobiliario", en: "Real Estate Law" },
  { es: "Derecho Migratorio", en: "Immigration Law" },
];

function ModulesPage() {
  const { t, tList, locale } = useI18n();
  const isEs = locale === "es";

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-[100rem] px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {t("modules.tag")}
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          {t("modules.title.line1")}<span className="font-editorial text-primary">{t("modules.title.line2")}</span>
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">{t("modules.body")}</p>

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {MODULE_KEYS.map((k) => (
            <div key={k} className="panel p-6">
              <h3 className="font-display text-lg font-semibold">{t(`module.${k}.name`)}</h3>
              <ul className="mt-4 space-y-2">
                {tList(`modules.${k}.features`).map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-20 border-t border-border/60 pt-16">
          <h2 className="font-display text-2xl font-bold">{t("modules.materias.title")}</h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{t("modules.materias.desc")}</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CANONICAL_MATERIAS_LIST.map((m, i) => (
              <div key={m.es} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 p-3.5">
                <span className="font-mono text-xs font-semibold text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-sm font-medium text-foreground">{isEs ? m.es : m.en}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
