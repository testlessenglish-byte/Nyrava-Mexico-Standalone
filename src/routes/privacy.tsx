import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Nyrava" },
      { name: "description", content: "How Nyrava collects, uses, stores, and protects information." },
      { property: "og:title", content: "Privacy Policy \u2014 Nyrava" },
      { property: "og:description", content: "How Nyrava collects, uses, stores, and protects information." },
      { property: "og:url", content: "https://mexico.nyrava.com/privacy" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/privacy" },
      { name: "robots", content: "index,follow" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      updated="2026-07-18"
      intro={
        <p>
          This page is maintained by the Nyrava team to describe how Nyrava
          handles information provided by its users. This document is a starting
          point and should be reviewed by qualified counsel before being relied
          on as a final legal notice.
        </p>
      }
    >
      <Section heading="Information We Collect">
        <p>Nyrava collects only the information necessary to operate the platform:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Account information</strong> — email address, name, and authentication identifiers used to sign in.</li>
          <li><strong>Case and document data</strong> — files, notes, and case metadata that you or members of your workspace upload.</li>
          <li><strong>Usage telemetry</strong> — routine logs (timestamps, error events, request identifiers) used to keep the service running.</li>
        </ul>
      </Section>

      <Section heading="How We Use Information">
        <p>
          Your case data is used to power the analysis features you invoke —
          extraction, timeline building, witness analysis, motion drafting, and
          report generation. We do not use your case content to train
          general-purpose models.
        </p>
      </Section>

      <Section heading="AI-Assisted Processing">
        <p>
          When you run an analysis, the relevant documents may be sent to
          large-language-model providers under contract to Nyrava (or, if you
          bring your own API key, directly to the provider you selected). See
          our <a href="/ai-transparency" className="text-primary hover:underline">AI Transparency</a> page for a
          full description of how AI is used.
        </p>
      </Section>

      <Section heading="Data Storage & Security">
        <p>
          Data is stored in managed cloud infrastructure with encryption in
          transit and at rest, per the underlying provider's controls. Access
          inside the app is scoped to your workspace using row-level security.
          See our <a href="/security" className="text-primary hover:underline">Security Practices</a> for the
          controls that are currently implemented.
        </p>
      </Section>

      <Section heading="Data Retention & Deletion">
        <p>
          Case data is retained for as long as your workspace exists. You can
          delete individual cases and documents at any time from the app. To
          request permanent deletion of your account and all associated data,
          contact us via the <a href="/contact" className="text-primary hover:underline">Contact</a> page.
        </p>
      </Section>

      <Section heading="Your Rights">
        <p>
          Depending on your jurisdiction, you may have rights to access,
          correct, export, or delete your personal information. Submit requests
          through the Contact page and we will respond within a reasonable
          period.
        </p>
      </Section>

      <Section heading="Third-Party Services">
        <p>
          Nyrava relies on infrastructure and model providers to operate. When
          you add your own provider API keys in the app, requests from your
          workspace may be routed directly to the provider you selected under
          that provider's terms.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about this policy can be sent through the
          <a href="/contact" className="text-primary hover:underline"> Contact</a> page.
        </p>
      </Section>
    </LegalPage>
  );
}
