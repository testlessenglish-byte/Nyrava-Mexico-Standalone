import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/i18n";

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

const STEP_KEYS = ["ingest", "classify", "extract", "relations", "intel", "product"] as const;

function PlatformPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-7xl px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {t("platform.tag")}
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          {t("platform.title.line1")}<br />
          <span className="font-editorial text-primary">{t("platform.title.line2")}</span>
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">{t("platform.body")}</p>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STEP_KEYS.map((k, i) => (
            <div key={k} className="panel p-6">
              <div className="font-mono text-[11px] tracking-[0.22em] text-primary">
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="mt-3 font-display text-lg font-semibold">{t(`platform.step.${k}.name`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`platform.step.${k}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
