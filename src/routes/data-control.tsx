import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";

export const Route = createFileRoute("/data-control")({
  head: () => ({
    meta: [
      { title: "Data Control — Nyrava" },
      { name: "description", content: "Controls available to Nyrava users over their data." },
      { property: "og:title", content: "Data Control \u2014 Nyrava" },
      { property: "og:description", content: "Controls available to Nyrava users over their data." },
      { property: "og:url", content: "https://mexico.nyrava.com/data-control" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/data-control" },
    ],
  }),
  component: DataControlPage,
});

function DataControlPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title="Data Control"
      updated="2026-07-18"
      intro={
        <p>
          You control the case data you put into Nyrava. This page summarizes
          the controls currently available inside the application.
        </p>
      }
    >
      <Section heading="Uploaded Documents">
        <p>
          Documents you upload live inside the case you attach them to. You
          can delete individual documents at any time from the case view. When
          a document is deleted, downstream extractions tied to it are
          invalidated on the next pipeline run.
        </p>
      </Section>

      <Section heading="Case Data">
        <p>
          Cases can be deleted from the Cases screen. Deleting a case removes
          the case record and its documents, findings, and analyses from your
          active workspace.
        </p>
      </Section>

      <Section heading="Account Data">
        <p>
          Your profile fields (name, contact information) can be edited from
          the Account screen. To close your account and request deletion of
          all associated data, use the <a href="/contact" className="text-primary hover:underline">Contact</a> page.
        </p>
      </Section>

      <Section heading="Access Permissions">
        <p>
          Data in your workspace is isolated by row-level security. See the
          <a href="/security" className="text-primary hover:underline"> Security Practices</a> page for the
          controls that enforce this isolation.
        </p>
      </Section>

      <Section heading="Provider Keys">
        <p>
          API keys you add in Settings are encrypted at rest and can be
          removed at any time from the API Keys screen.
        </p>
      </Section>

      <Section heading="Retention">
        <p>
          Nyrava does not automatically delete case data. Data persists until
          you delete it or close your account. Contact us if you need a
          custom retention policy for a specific engagement.
        </p>
      </Section>
    </LegalPage>
  );
}
