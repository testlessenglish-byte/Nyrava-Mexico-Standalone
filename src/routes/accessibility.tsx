import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout } from "@/components/DocsLayout";

export const Route = createFileRoute("/accessibility")({
  head: () => ({
    meta: [
      { title: "Accessibility Statement — Nyrava" },
      { name: "description", content: "Nyrava's commitment to accessible legal technology." },
      { property: "og:url", content: "https://mexico.nyrava.com/accessibility" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/accessibility" },
      { property: "og:title", content: "Accessibility Statement — Nyrava" },
      { property: "og:description", content: "WCAG-aligned accessibility goals and feedback channel." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Legal"
      title="Accessibility Statement"
      description="Our commitment to keeping Nyrava usable by every legal professional."
      crumbs={[{ label: "Legal" }, { label: "Accessibility" }]}
      updated="2026-07-22"
      toc={[
        { id: "commitment", label: "Commitment" },
        { id: "standards", label: "Standards" },
        { id: "current", label: "Current state" },
        { id: "feedback", label: "Feedback" },
      ]}
    >
      <DocsSection id="commitment" heading="Commitment">
        <p>
          Nyrava is designed to be usable by legal professionals with a range of abilities. We
          target conformance with WCAG 2.1 Level AA and treat accessibility issues as functional
          bugs, not cosmetic ones.
        </p>
      </DocsSection>

      <DocsSection id="standards" heading="Standards">
        <p>Design and engineering practices we follow:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Semantic HTML with correct heading structure.</li>
          <li>Keyboard-navigable UI throughout the application.</li>
          <li>Sufficient color contrast in the dark theme.</li>
          <li>Visible focus indicators on all interactive elements.</li>
          <li>ARIA labels on icon-only controls.</li>
          <li>Screen-reader-friendly modal and drawer components (Radix primitives).</li>
        </ul>
      </DocsSection>

      <DocsSection id="current" heading="Current state">
        <Callout variant="info">
          Accessibility is a moving target. We are honest that some workflows — for example
          drag-and-drop uploads and dense data tables — need continued improvement. Reports of
          specific issues receive prioritized attention.
        </Callout>
      </DocsSection>

      <DocsSection id="feedback" heading="Feedback">
        <p>
          If you encounter an accessibility barrier, please tell us through the{" "}
          <a href="/contact" className="text-primary hover:underline">Contact</a> page. Include the
          page, the assistive technology you use, and what you were trying to accomplish.
        </p>
      </DocsSection>
    </DocsLayout>
  ),
});
