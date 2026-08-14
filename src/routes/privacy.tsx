import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Nyrava" },
      { name: "description", content: "How Nyrava collects, uses, stores, and protects information." },
      { property: "og:title", content: "Privacy Policy — Nyrava" },
      { property: "og:description", content: "How Nyrava collects, uses, stores, and protects information." },
      { property: "og:url", content: "https://mexico.nyrava.com/privacy" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/privacy" },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { t, tList } = useI18n();
  return (
    <LegalPage
      eyebrow={t("footer.section.legal")}
      title={t("privacy.title")}
      updated={t("privacy.updated")}
      intro={<p>{t("privacy.intro")}</p>}
    >
      <Section heading={t("privacy.section.collect.heading")}>
        <p>{t("privacy.section.collect.body")}</p>
        <ul className="list-disc space-y-1 pl-5">
          {tList("privacy.section.collect.items").map((item) => {
            const [label, ...rest] = item.split(" — ");
            return (
              <li key={item}>
                <strong>{label}</strong> — {rest.join(" — ")}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section heading={t("privacy.section.use.heading")}>
        <p>{t("privacy.section.use.body")}</p>
      </Section>

      <Section heading={t("privacy.section.ai.heading")}>
        <p>
          {t("privacy.section.ai.before")}
          <a href="/ai-transparency" className="text-primary hover:underline">{t("privacy.section.ai.linkText")}</a>
          {t("privacy.section.ai.after")}
        </p>
      </Section>

      <Section heading={t("privacy.section.storage.heading")}>
        <p>
          {t("privacy.section.storage.before")}
          <a href="/security" className="text-primary hover:underline">{t("privacy.section.storage.linkText")}</a>
          {t("privacy.section.storage.after")}
        </p>
      </Section>

      <Section heading={t("privacy.section.retention.heading")}>
        <p>
          {t("privacy.section.retention.before")}
          <a href="/contact" className="text-primary hover:underline">{t("privacy.section.retention.linkText")}</a>
          {t("privacy.section.retention.after")}
        </p>
      </Section>

      <Section heading={t("privacy.section.rights.heading")}>
        <p>{t("privacy.section.rights.body")}</p>
      </Section>

      <Section heading={t("privacy.section.thirdParty.heading")}>
        <p>{t("privacy.section.thirdParty.body")}</p>
      </Section>

      <Section heading={t("privacy.section.contact.heading")}>
        <p>
          {t("privacy.section.contact.before")}
          <a href="/contact" className="text-primary hover:underline">{t("privacy.section.contact.linkText")}</a>
          {t("privacy.section.contact.after")}
        </p>
      </Section>
    </LegalPage>
  );
}
