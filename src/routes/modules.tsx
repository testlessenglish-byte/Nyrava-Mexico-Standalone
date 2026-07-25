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
  }),
  component: ModulesPage,
});

const MODULE_KEYS = [
  "legal", "case", "evidence", "witness", "timeline", "litigation", "contract", "research",
] as const;

function ModulesPage() {
  const { t, tList } = useI18n();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-7xl px-6 py-20">
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
      </section>
      <SiteFooter />
    </div>
  );
}
