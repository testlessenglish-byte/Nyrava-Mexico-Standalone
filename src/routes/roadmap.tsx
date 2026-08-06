import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout } from "@/components/DocsLayout";

export const Route = createFileRoute("/roadmap")({
  head: () => ({
    meta: [
      { title: "Roadmap — Nyrava Intelligence OS" },
      { name: "description", content: "What Nyrava is building next." },
      { property: "og:url", content: "https://mexico.nyrava.com/roadmap" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/roadmap" },
      { property: "og:title", content: "Roadmap — Nyrava" },
      { property: "og:description", content: "Public roadmap for the Nyrava Intelligence OS." },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/roadmap" }],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Company"
      title="Roadmap"
      description="What Nyrava is working on now, next, and later. Roadmap items are directional, not commitments."
      crumbs={[{ label: "Company" }, { label: "Roadmap" }]}
      toc={[
        { id: "shipped", label: "Recently shipped" },
        { id: "now", label: "Now" },
        { id: "next", label: "Next" },
        { id: "later", label: "Later" },
      ]}
    >
      <Callout variant="info" title="Roadmap policy">
        The Report Engine v1.0 is frozen. New report sections require documented business
        justification and explicit approval before implementation.
      </Callout>

      <DocsSection id="shipped" heading="Recently shipped">
        <ul className="list-disc space-y-1 pl-5">
          <li>Canonical Case Analysis schema (17 sections, version-locked at 1.0.0).</li>
          <li>Bring-your-own-key support for OpenAI, Anthropic, Gemini, Groq, and OpenRouter.</li>
          <li>Automatic provider failover with cooldowns.</li>
          <li>Enterprise Trust Center and documentation portal.</li>
          <li>PDF export with orphan prevention and paginated work-product cards.</li>
        </ul>
      </DocsSection>

      <DocsSection id="now" heading="Now">
        <ul className="list-disc space-y-1 pl-5">
          <li>Deeper witness clustering and cross-witness contradiction views.</li>
          <li>Expanded motion library beyond the current supported types.</li>
          <li>Improved OCR for handwritten notes and low-quality scans.</li>
        </ul>
      </DocsSection>

      <DocsSection id="next" heading="Next">
        <ul className="list-disc space-y-1 pl-5">
          <li>Workspace collaboration with role-based permissions.</li>
          <li>Deposition preparation workspace.</li>
          <li>Native integrations with common case-management systems.</li>
        </ul>
      </DocsSection>

      <DocsSection id="later" heading="Later">
        <ul className="list-disc space-y-1 pl-5">
          <li>Appellate-record workflows.</li>
          <li>Custom pattern libraries for firm-specific analysis.</li>
          <li>SOC 2 Type II readiness.</li>
        </ul>
      </DocsSection>
    </DocsLayout>
  ),
});
