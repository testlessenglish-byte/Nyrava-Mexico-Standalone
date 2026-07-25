import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, StepList, Callout, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";

export const Route = createFileRoute("/help/first-case")({
  head: () => {
    const url = `${CANONICAL_BASE}/help/first-case`;
    const desc = "Step-by-step guide to running your first case on Nyrava — create the matter, upload the record, run analysis, review findings, export the report.";
    return {
      meta: [
        { title: "Running your first case — Nyrava Help" },
        { name: "description", content: desc },
        { property: "og:title", content: "Running your first case — Nyrava" },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: breadcrumbJsonLd(CANONICAL_BASE, [
          { label: "Help", to: "/help" },
          { label: "Running your first case", to: "/help/first-case" },
        ]),
      }],
    };
  },
  component: () => (
    <DocsLayout
      eyebrow="Getting Started"
      title="Running your first case"
      description="Create a matter, upload the record, run the pipeline, review findings, and export a report."
      crumbs={[{ label: "Help", to: "/help" }, { label: "Running your first case" }]}
      toc={[
        { id: "prereqs", label: "Prerequisites" },
        { id: "create", label: "Create the case" },
        { id: "upload", label: "Upload documents" },
        { id: "run", label: "Run analysis" },
        { id: "review", label: "Review findings" },
        { id: "export", label: "Export the report" },
      ]}
      related={[
        { label: "Uploading documents", to: "/help/uploading", description: "File types, OCR, batching." },
        { label: "Understanding reports", to: "/help/reports", description: "The 17 canonical sections." },
        { label: "API keys & providers", to: "/help/api-keys", description: "Bring your own AI keys." },
        { label: "Evidence Intelligence", to: "/product/evidence-intelligence", description: "The foundation of the pipeline." },
      ]}
    >
      <DocsSection id="prereqs" heading="Prerequisites">
        <ul className="list-disc space-y-1 pl-5">
          <li>A Nyrava account. Sign in from the top-right corner.</li>
          <li>The full case record you want analyzed. Partial uploads reduce the quality of contradiction detection.</li>
          <li>Optional: your own AI provider key configured in Settings — see <a href="/help/api-keys" className="text-primary hover:underline">API keys</a>.</li>
        </ul>
      </DocsSection>

      <DocsSection id="create" heading="1. Create the case">
        <StepList steps={[
          { title: "Open the Command Center", description: "From the dashboard, click New Case." },
          { title: "Name the matter", description: "Use an internal-facing name; the label is only visible inside your workspace." },
          { title: "Pick a case type", description: "The case type shapes which engines run (criminal, civil, appellate, family, tax, etc.)." },
        ]} />
      </DocsSection>

      <DocsSection id="upload" heading="2. Upload documents">
        <p>
          Drag the entire production into the upload panel. Scanned PDFs and photographed exhibits pass
          through OCR automatically. For very large productions, upload in batches — indexing runs
          incrementally.
        </p>
        <Callout variant="tip" title="Upload the full corpus">
          Contradiction detection, witness clustering, and timeline reconciliation all benefit from
          seeing the entire record. Curated excerpts reduce the quality of every downstream engine.
        </Callout>
      </DocsSection>

      <DocsSection id="run" heading="3. Run analysis">
        <p>
          Click Run Pipeline. The intelligence engines execute in sequence: Evidence → Timeline →
          Witness → Constitutional → Strategy → Motion (if requested) → Report. Progress is streamed to
          the Live Pipeline panel.
        </p>
      </DocsSection>

      <DocsSection id="review" heading="4. Review findings">
        <p>
          Open the Evidence, Timeline, Witness, and Constitutional panels. Every finding carries a
          citation you can click to see the source passage. Reject or refine findings that need attorney
          judgment.
        </p>
      </DocsSection>

      <DocsSection id="export" heading="5. Export the report">
        <p>
          Open the Report panel and export as PDF, DOCX, or JSON. The PDF is paginated for court binders;
          DOCX is for further editing; JSON is for downstream tooling.
        </p>
      </DocsSection>
    </DocsLayout>
  ),
});
