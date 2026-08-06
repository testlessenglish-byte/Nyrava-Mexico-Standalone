import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection } from "@/components/DocsLayout";

export const Route = createFileRoute("/acceptable-use")({
  head: () => ({
    meta: [
      { title: "Acceptable Use Policy — Nyrava" },
      { name: "description", content: "How Nyrava Intelligence OS may and may not be used." },
      { property: "og:url", content: "https://mexico.nyrava.com/acceptable-use" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/acceptable-use" },
      { property: "og:title", content: "Acceptable Use Policy — Nyrava" },
      { property: "og:description", content: "Prohibited uses and account conduct rules." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Legal"
      title="Acceptable Use Policy"
      description="What Nyrava may be used for, and what it may not."
      crumbs={[{ label: "Legal" }, { label: "Acceptable Use" }]}
      updated="2026-07-22"
      toc={[
        { id: "intended", label: "Intended use" },
        { id: "prohibited", label: "Prohibited uses" },
        { id: "content", label: "Content responsibility" },
        { id: "enforcement", label: "Enforcement" },
      ]}
    >
      <DocsSection id="intended" heading="Intended use">
        <p>
          Nyrava is intended for use by legal professionals — attorneys, paralegals, investigators,
          litigation-support staff, prosecutors, public defenders, and corporate legal teams — to
          analyze and organize case material for legitimate legal work.
        </p>
      </DocsSection>

      <DocsSection id="prohibited" heading="Prohibited uses">
        <p>You may not use Nyrava to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Violate any applicable law, regulation, or court order.</li>
          <li>Upload content you do not have the right to process.</li>
          <li>Attempt to identify individuals from data lawfully deidentified for research.</li>
          <li>Generate content intended to harass, defame, or deceive a court or opposing party.</li>
          <li>Circumvent, disable, or attempt to reverse-engineer security controls.</li>
          <li>Use the service to build a competing legal-intelligence product.</li>
          <li>Attempt to access data belonging to another workspace.</li>
          <li>Use Nyrava to make final legal decisions without qualified attorney review.</li>
        </ul>
      </DocsSection>

      <DocsSection id="content" heading="Content responsibility">
        <p>
          You are responsible for the content you upload and for verifying that you have the
          authority to process it. Nyrava does not screen the contents of your matters and does not
          exercise editorial control over your workspace.
        </p>
      </DocsSection>

      <DocsSection id="enforcement" heading="Enforcement">
        <p>
          We may suspend or terminate accounts that violate this policy. For serious violations we
          may cooperate with law enforcement. Reports of suspected abuse can be sent through the{" "}
          <a href="/contact" className="text-primary hover:underline">Contact</a> page.
        </p>
      </DocsSection>
    </DocsLayout>
  ),
});
