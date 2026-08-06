import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout } from "@/components/DocsLayout";

export const Route = createFileRoute("/dpa")({
  head: () => ({
    meta: [
      { title: "Data Processing Agreement — Nyrava" },
      { name: "description", content: "Standard data processing terms for Nyrava customers." },
      { property: "og:url", content: "https://mexico.nyrava.com/dpa" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/dpa" },
      { property: "og:title", content: "Data Processing Agreement — Nyrava" },
      { property: "og:description", content: "Contractual terms for processing customer data on Nyrava." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Legal"
      title="Data Processing Agreement"
      description="The terms under which Nyrava processes customer data on your behalf."
      crumbs={[{ label: "Legal" }, { label: "Data Processing Agreement" }]}
      updated="2026-07-22"
      toc={[
        { id: "scope", label: "Scope & roles" },
        { id: "processing", label: "Nature of processing" },
        { id: "subprocessors", label: "Sub-processors" },
        { id: "security", label: "Security measures" },
        { id: "rights", label: "Data-subject rights" },
        { id: "return", label: "Return & deletion" },
        { id: "execution", label: "Execution" },
      ]}
    >
      <Callout variant="info" title="Template document">
        This page describes the standard DPA Nyrava offers to customers. Customers requiring a
        countersigned DPA can request one through the Contact page. Regulated engagements (HIPAA
        BAA, US state privacy addenda) should be raised before onboarding.
      </Callout>

      <DocsSection id="scope" heading="Scope & roles">
        <p>
          For personal data uploaded by a customer to Nyrava, the customer acts as data controller
          and Nyrava acts as data processor. Nyrava processes personal data solely on the customer's
          documented instructions and for the purposes of providing the service.
        </p>
      </DocsSection>

      <DocsSection id="processing" heading="Nature of processing">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Subject matter:</strong> analysis and organization of legal case materials.</li>
          <li><strong>Categories of data:</strong> such personal data as the customer chooses to upload in the context of a matter.</li>
          <li><strong>Categories of data subjects:</strong> parties, witnesses, counsel, and other individuals identified in the matter.</li>
          <li><strong>Duration:</strong> for the duration of the customer's subscription and any retention period thereafter.</li>
        </ul>
      </DocsSection>

      <DocsSection id="subprocessors" heading="Sub-processors">
        <p>
          Nyrava uses managed infrastructure providers to operate the platform and, where the
          customer has not configured their own keys, contracted AI-model providers for analysis.
          A current sub-processor list is maintained and can be requested via the Contact page.
        </p>
      </DocsSection>

      <DocsSection id="security" heading="Security measures">
        <p>
          Nyrava implements technical and organizational measures appropriate to the risks of
          processing legal case data, including encryption in transit and at rest, workspace
          isolation via row-level security, restricted production access, audit logging, and secure
          storage of provider secrets. See <a className="text-primary hover:underline" href="/security">Security Practices</a>.
        </p>
      </DocsSection>

      <DocsSection id="rights" heading="Data-subject rights">
        <p>
          Nyrava assists the customer, to the extent reasonably possible, in responding to requests
          from data subjects to exercise their rights under applicable law.
        </p>
      </DocsSection>

      <DocsSection id="return" heading="Return & deletion">
        <p>
          Upon termination of the service, the customer may export workspace data through in-app
          tools. Nyrava will delete customer personal data within a reasonable period thereafter,
          subject to any legal retention obligations.
        </p>
      </DocsSection>

      <DocsSection id="execution" heading="Execution">
        <p>
          A countersigned copy of this DPA can be requested via the{" "}
          <a href="/contact" className="text-primary hover:underline">Contact</a> page.
        </p>
      </DocsSection>
    </DocsLayout>
  ),
});
