import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Lock, ShieldCheck, KeyRound, Database, FileKey, Eye } from "lucide-react";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Seguridad · Nyrava Intelligence México" },
      { name: "description", content: "Seguridad de grado gubernamental: cifrado, aislamiento por cliente, RLS, auditoría y confidencialidad para despachos legales en México." },
      { property: "og:title", content: "Seguridad — Nyrava México" },
      { property: "og:description", content: "Seguridad y confidencialidad para despachos e instituciones legales." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/security" }],
  }),
  component: SecurityPage,
});

const PILLAR_KEYS = [
  { key: "encryption", icon: Lock },
  { key: "isolation", icon: ShieldCheck },
  { key: "access", icon: KeyRound },
  { key: "residency", icon: Database },
  { key: "confidentiality", icon: FileKey },
  { key: "audit", icon: Eye },
] as const;

function SecurityPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <section className="mx-auto max-w-[100rem] px-6 py-20">
        <span className="tag-bracket font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {t("security.tag")}
        </span>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight md:text-5xl">
          {t("security.title.line1")} <span className="font-editorial text-primary">{t("security.title.line2")}</span>
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground">{t("security.body")}</p>

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PILLAR_KEYS.map((p) => (
            <div key={p.key} className="panel p-6">
              <p.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 font-display text-base font-semibold">{t(`security.pillar.${p.key}.name`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`security.pillar.${p.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
