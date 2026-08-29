import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/i18n";
import { DocsLayout, DocsSection, FeatureGrid, StepList } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";
import { publicCapabilities } from "@/lib/capabilities";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Acerca de Nyrava — Sistema Operativo de Inteligencia Jurídica" },
      {
        name: "description",
        content:
          "Qué es Nyrava, cómo fluye un expediente a través de la plataforma, cómo la evidencia se convierte en inteligencia y cómo opera bajo control humano de abogados en México.",
      },
      { property: "og:url", content: "https://mexico.nyrava.com/about" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/about" },
      { property: "og:title", content: "Acerca de Nyrava — Inteligencia Jurídica para México" },
      {
        property: "og:description",
        content: "Plataforma de inteligencia jurídica y análisis de expedientes basada en evidencia estricta, versionada y bajo control humano.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/about" }],
  }),
  component: AboutPage,
});

function AboutPage() {
  const { t } = useI18n();

  const howItWorksSteps = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    title: t(`about.howItWorks.step${n}.title`),
    description: t(`about.howItWorks.step${n}.description`),
  }));

  const differentCards = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    title: t(`about.different.card${n}.title`),
    description: t(`about.different.card${n}.description`),
  }));

  const architectureSteps = Array.from({ length: 13 }, (_, i) => t(`about.architecture.step${i + 1}`));
  const cliSteps = Array.from({ length: 8 }, (_, i) => t(`about.whyCli.step${i + 1}`));

  const whoItems = [1, 2, 3, 4, 5, 6].map((n) => t(`about.who.item${n}`));
  const whatNotItems = [1, 2, 3, 4, 5, 6, 7].map((n) => t(`about.whatNot.item${n}`));

  const correctionSteps = Array.from({ length: 10 }, (_, i) => ({
    title: t(`about.corrections.step${i + 1}.title`),
    description: t(`about.corrections.step${i + 1}.description`),
  }));

  const principles = [1, 2, 3, 4, 5, 6].map((n) => ({
    title: t(`about.principles.item${n}.title`),
    body: t(`about.principles.item${n}.body`),
  }));

  const capabilities = publicCapabilities();

  return (
    <DocsLayout
      eyebrow={t("about.hero.eyebrow")}
      title={t("about.hero.title")}
      description={t("about.hero.description")}
      crumbs={[{ label: "Company" }, { label: "About" }]}
      toc={[
        { id: "mission", label: t("about.mission.heading") },
        { id: "how-it-works", label: t("about.howItWorks.heading") },
        { id: "different", label: t("about.different.heading") },
        { id: "architecture", label: t("about.architecture.heading") },
        { id: "capabilities", label: t("about.capabilities.heading") },
        { id: "who", label: t("about.who.heading") },
        { id: "what-not", label: t("about.whatNot.heading") },
        { id: "why-cli", label: t("about.whyCli.heading") },
        { id: "corrections", label: t("about.corrections.heading") },
        { id: "principles", label: t("about.principles.heading") },
      ]}
    >
      <DocsSection id="mission" heading={t("about.mission.heading")}>
        <p>{t("about.mission.body")}</p>
      </DocsSection>

      <DocsSection heading={t("about.vision.heading")}>
        <p>{t("about.vision.body")}</p>
      </DocsSection>

      <DocsSection heading={t("about.why.heading")}>
        <p>{t("about.why.body1")}</p>
        <p>{t("about.why.body2")}</p>
      </DocsSection>

      <DocsSection id="how-it-works" heading={t("about.howItWorks.heading")}>
        <p>{t("about.howItWorks.intro")}</p>
        <StepList steps={howItWorksSteps} />
      </DocsSection>

      <DocsSection id="different" heading={t("about.different.heading")}>
        <p>{t("about.different.intro")}</p>
        <div className="my-6">
          <FlowDiagram />
        </div>
        <FeatureGrid columns={2} items={differentCards} />
      </DocsSection>

      <DocsSection id="architecture" heading={t("about.architecture.heading")}>
        <p>{t("about.architecture.intro")}</p>
        <ol className="my-4 space-y-2 text-sm text-muted-foreground list-decimal pl-5">
          {architectureSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </DocsSection>

      <DocsSection id="capabilities" heading={t("about.capabilities.heading")}>
        <p>{t("about.capabilities.intro")}</p>
        <FeatureGrid
          columns={2}
          items={capabilities.map((c) => ({
            title: c.name,
            description: c.summary,
            href: `/modules#${c.id}`,
          }))}
        />
      </DocsSection>

      <DocsSection id="who" heading={t("about.who.heading")}>
        <p>{t("about.who.intro")}</p>
        <ul className="my-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
          {whoItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </DocsSection>

      <DocsSection id="what-not" heading={t("about.whatNot.heading")}>
        <p>{t("about.whatNot.intro")}</p>
        <ul className="my-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
          {whatNotItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </DocsSection>

      <DocsSection id="why-cli" heading={t("about.whyCli.heading")}>
        <p>{t("about.whyCli.intro")}</p>
        <ol className="my-4 space-y-2 text-sm text-muted-foreground list-decimal pl-5">
          {cliSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </DocsSection>

      <DocsSection id="corrections" heading={t("about.corrections.heading")}>
        <p>{t("about.corrections.intro")}</p>
        <StepList steps={correctionSteps} />
      </DocsSection>

      <DocsSection id="principles" heading={t("about.principles.heading")}>
        <p>{t("about.principles.intro")}</p>
        <div className="my-4 space-y-4">
          {principles.map((p, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              <h4 className="font-semibold text-foreground text-sm">{p.title}</h4>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection heading={t("about.cta.heading")}>
        <p>
          {t("about.cta.body")}{" "}
          <Link to="/auth" className="text-primary hover:underline font-semibold">
            {t("about.cta.link")}
          </Link>
          .
        </p>
      </DocsSection>
    </DocsLayout>
  );
}
