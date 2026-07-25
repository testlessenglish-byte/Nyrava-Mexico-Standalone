import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookie Policy — Nyrava" },
      { name: "description", content: "How Nyrava uses cookies and similar browser storage." },
      { property: "og:title", content: "Cookie Policy \u2014 Nyrava" },
      { property: "og:description", content: "How Nyrava uses cookies and similar browser storage." },
      { property: "og:url", content: "https://nyrava.com/cookies" },
      { name: "twitter:url", content: "https://nyrava.com/cookies" },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Cookie Policy"
      updated="2026-07-18"
      intro={
        <p>
          Nyrava uses a small number of cookies and browser storage entries
          strictly to operate the application. We do not use advertising
          cookies.
        </p>
      }
    >
      <Section heading="Essential Cookies & Storage">
        <p>
          The application stores an authentication token in browser storage so
          you remain signed in between visits. Removing this entry signs you
          out. Additional lightweight preferences (for example the last-used
          case view) may also be stored locally.
        </p>
      </Section>

      <Section heading="Analytics">
        <p>
          We may collect aggregate, non-identifying usage telemetry to keep
          the service running reliably. We do not sell this data.
        </p>
      </Section>

      <Section heading="Managing Cookies">
        <p>
          You can clear browser storage or cookies at any time through your
          browser settings. Clearing them will sign you out of Nyrava.
        </p>
      </Section>
    </LegalPage>
  );
}
