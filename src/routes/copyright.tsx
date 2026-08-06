import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection } from "@/components/DocsLayout";

export const Route = createFileRoute("/copyright")({
  head: () => ({
    meta: [
      { title: "Copyright Policy — Nyrava" },
      { name: "description", content: "Ownership of content uploaded to and produced by Nyrava." },
      { property: "og:url", content: "https://mexico.nyrava.com/copyright" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/copyright" },
      { property: "og:title", content: "Copyright Policy — Nyrava" },
      { property: "og:description", content: "Ownership, licenses, and third-party rights." },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/copyright" }],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Legal"
      title="Copyright Policy"
      description="Ownership of the content you upload, the analysis Nyrava produces, and third-party rights."
      crumbs={[{ label: "Legal" }, { label: "Copyright" }]}
      updated="2026-07-22"
      toc={[
        { id: "your-content", label: "Your content" },
        { id: "analysis", label: "Analysis output" },
        { id: "third-party", label: "Third-party rights" },
        { id: "reports", label: "Copyright of reports" },
      ]}
    >
      <DocsSection id="your-content" heading="Your content">
        <p>
          You retain ownership of everything you upload. By uploading, you grant Nyrava a limited
          license to process that content for the sole purpose of providing the service to you.
        </p>
      </DocsSection>

      <DocsSection id="analysis" heading="Analysis output">
        <p>
          Outputs produced by Nyrava from your content — timelines, findings, drafts, reports — are
          yours to use in your practice, subject to the acceptable-use policy.
        </p>
      </DocsSection>

      <DocsSection id="third-party" heading="Third-party rights">
        <p>
          Nyrava's software, brand, and documentation are the intellectual property of Nyrava. You
          may not copy, redistribute, or reverse-engineer them.
        </p>
      </DocsSection>

      <DocsSection id="reports" heading="Copyright of reports">
        <p>
          Analysis reports may embed short excerpts from your source documents to support cited
          findings. The rights to those excerpts remain with the original rights-holder; Nyrava does
          not claim ownership.
        </p>
      </DocsSection>
    </DocsLayout>
  ),
});
