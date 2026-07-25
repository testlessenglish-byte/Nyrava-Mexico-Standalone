import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";

export const Route = createFileRoute("/help/uploading")({
  head: () => {
    const url = `${CANONICAL_BASE}/help/uploading`;
    const desc = "How to upload documents to Nyrava — supported file types, OCR behavior, batching, and best practices.";
    return {
      meta: [
        { title: "Uploading documents — Nyrava Help" },
        { name: "description", content: desc },
        { property: "og:title", content: "Uploading documents — Nyrava" },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: breadcrumbJsonLd(CANONICAL_BASE, [
          { label: "Help", to: "/help" },
          { label: "Uploading documents", to: "/help/uploading" },
        ]),
      }],
    };
  },
  component: () => (
    <DocsLayout
      eyebrow="Getting Started"
      title="Uploading documents"
      description="What Nyrava accepts, how OCR works, and how to structure large productions."
      crumbs={[{ label: "Help", to: "/help" }, { label: "Uploading documents" }]}
      toc={[
        { id: "types", label: "Supported file types" },
        { id: "ocr", label: "OCR behavior" },
        { id: "batching", label: "Batching large productions" },
        { id: "labeling", label: "Labeling & bates" },
        { id: "reruns", label: "Rerunning after supplements" },
      ]}
      related={[
        { label: "Running your first case", to: "/help/first-case" },
        { label: "Understanding reports", to: "/help/reports" },
        { label: "Evidence Intelligence", to: "/product/evidence-intelligence" },
      ]}
    >
      <DocsSection id="types" heading="Supported file types">
        <ul className="list-disc space-y-1 pl-5">
          <li>PDF (searchable or scanned)</li>
          <li>Microsoft Word (.docx)</li>
          <li>Plain text (.txt) and Markdown (.md)</li>
          <li>Images with legible text (PNG, JPG, TIFF)</li>
          <li>CSV — parsed as tabular data</li>
        </ul>
      </DocsSection>

      <DocsSection id="ocr" heading="OCR behavior">
        <p>
          Scanned PDFs and images pass through OCR automatically. Extraction quality is very good on
          typed documents and moderate on legible handwriting. Very poor scans should be re-scanned or
          reviewed before extraction is trusted.
        </p>
      </DocsSection>

      <DocsSection id="batching" heading="Batching large productions">
        <p>
          Productions over a few hundred documents should be uploaded in batches. Each batch triggers
          incremental indexing so downstream engines can start earlier. There is no hard cap on total
          corpus size, but per-batch uploads should stay under roughly 500 documents for responsive UX.
        </p>
      </DocsSection>

      <DocsSection id="labeling" heading="Labeling & bates">
        <p>
          Keep filenames descriptive and include bates ranges when applicable. Nyrava uses filenames as
          part of the citation surface, so <code>SMITH000123-000145_Dep_Chen.pdf</code> resolves cleaner
          than <code>doc7.pdf</code>.
        </p>
      </DocsSection>

      <DocsSection id="reruns" heading="Rerunning after supplemental productions">
        <Callout variant="tip" title="Re-run extraction">
          After a supplemental production, rerun Evidence Intelligence to fold the new documents into
          the index. Prior citations remain valid; new findings are appended.
        </Callout>
      </DocsSection>
    </DocsLayout>
  ),
});
