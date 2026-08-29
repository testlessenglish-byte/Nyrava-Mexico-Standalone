import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Términos de Servicio — Nyrava México" },
      { name: "description", content: "Términos y condiciones de uso de la plataforma de inteligencia jurídica Nyrava México." },
      { property: "og:title", content: "Términos de Servicio — Nyrava México" },
      { property: "og:description", content: "Términos y condiciones de uso de la plataforma de inteligencia jurídica Nyrava México." },
      { property: "og:url", content: "https://mexico.nyrava.com/terms" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/terms" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  const { t } = useI18n();
  return (
    <LegalPage
      eyebrow={t("footer.section.legal")}
      title={t("terms.title")}
      updated={t("terms.updated")}
      intro={<p>{t("terms.intro")}</p>}
    >
      <Section heading={t("terms.section.acceptableUse.heading")}>
        <p>{t("terms.section.acceptableUse.body")}</p>
      </Section>

      <Section heading={t("terms.section.content.heading")}>
        <p>{t("terms.section.content.body")}</p>
      </Section>

      <Section heading={t("terms.section.noAdvice.heading")}>
        <p>{t("terms.section.noAdvice.body")}</p>
      </Section>

      <Section heading={t("terms.section.aiOutput.heading")}>
        <p>
          {t("terms.section.aiOutput.before")}
          <a href="/ai-transparency" className="text-primary hover:underline">{t("terms.section.aiOutput.linkText")}</a>
          {t("terms.section.aiOutput.after")}
        </p>
      </Section>

      <Section heading={t("terms.section.disclaimers.heading")}>
        <p>{t("terms.section.disclaimers.body")}</p>
      </Section>

      <Section heading={t("terms.section.termination.heading")}>
        <p>
          {t("terms.section.termination.before")}
          <a href="/contact" className="text-primary hover:underline">{t("terms.section.termination.linkText")}</a>
          {t("terms.section.termination.after")}
        </p>
      </Section>

      <Section heading={t("terms.section.changes.heading")}>
        <p>{t("terms.section.changes.body")}</p>
      </Section>
    </LegalPage>
  );
}
