import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/i18n";
import { DocsLayout, DocsSection, FeatureGrid, StepList } from "@/components/DocsLayout";
import { FlowDiagram } from "@/components/docs/FlowDiagram";
import { publicCapabilities } from "@/lib/capabilities";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Nyrava — Legal Intelligence OS" },
      {
        name: "description",
        content:
          "What Nyrava is, how a case moves through it, how evidence becomes intelligence, and how Continuous Legal Intelligence improves future analysis under human control.",
      },
      { property: "og:url", content: "https://mexico.nyrava.com/about" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/about" },
      { property: "og:title", content: "About Nyrava — Legal Intelligence OS" },
      {
        property: "og:description",
        content: "A legal intelligence and case-analysis infrastructure platform — evidence-grounded, versioned, and human-controlled.",
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
        <FeatureGrid items={differentCards} />
      </DocsSection>

      <DocsSection id="architecture" heading={t("about.architecture.heading")}>
        <p>{t("about.architecture.intro")}</p>
        <FlowDiagram
          steps={architectureSteps}
          ariaLabel={t("about.architecture.ariaLabel")}
          caption={t("about.architecture.caption")}
        />
      </DocsSection>

      <DocsSection id="capabilities" heading={t("about.capabilities.heading")}>
        <p>{t("about.capabilities.intro")}</p>
        <div className="my-6 grid gap-3 sm:grid-cols-2">
          {capabilities.map((c) => {
            const title = t(c.titleKey);
            const description = t(c.descriptionKey);
            const body = (
              <>
                <div className="flex items-center gap-2">
                  <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
                  {c.status === "BETA" && (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                      {t("about.capabilities.betaLabel")}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</div>
                {c.route && (
                  <div className="mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-primary">
                    {t("about.capabilities.openLink")} →
                  </div>
                )}
              </>
            );
            return c.route ? (
              <Link
                key={c.id}
                to={c.route}
                className="rounded-lg border border-border/60 bg-card/30 p-4 hover:border-primary/40 hover:bg-card/60"
              >
                {body}
              </Link>
            ) : (
              <div key={c.id} className="rounded-lg border border-border/60 bg-card/30 p-4">
                {body}
              </div>
            );
          })}
        </div>
      </DocsSection>

      <DocsSection id="who" heading={t("about.who.heading")}>
        <p>{t("about.who.intro")}</p>
        <ul className="list-disc space-y-1 pl-5">
          {whoItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
        <p className="text-foreground/80">{t("about.who.disclaimer")}</p>
      </DocsSection>

      <DocsSection id="what-not" heading={t("about.whatNot.heading")}>
        <p>{t("about.whatNot.intro")}</p>
        <ul className="list-disc space-y-1 pl-5">
          {whatNotItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </DocsSection>

      <DocsSection id="why-cli" heading={t("about.whyCli.heading")}>
        <p>{t("about.whyCli.intro1")}</p>
        <p>{t("about.whyCli.intro2")}</p>
        <FlowDiagram steps={cliSteps} ariaLabel={t("about.whyCli.ariaLabel")} caption={t("about.whyCli.caption")} />
      </DocsSection>

      <DocsSection id="corrections" heading={t("about.corrections.heading")}>
        <p>{t("about.corrections.intro")}</p>
        <StepList steps={correctionSteps} />
      </DocsSection>

      <DocsSection id="principles" heading={t("about.principles.heading")}>
        <ol className="list-decimal space-y-2 pl-5">
          {principles.map((p, i) => (
            <li key={i}>
              <strong>{p.title}</strong> {p.body}
            </li>
          ))}
        </ol>
      </DocsSection>
    </DocsLayout>
  );
}
