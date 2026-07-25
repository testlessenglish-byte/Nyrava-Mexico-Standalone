import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";

const SECTIONS = [
  "Case summary",
  "Parties & counsel",
  "Procedural posture",
  "Factual chronology",
  "Evidence inventory",
  "Witness matrix",
  "Contradictions & credibility",
  "Constitutional issues",
  "Substantive legal issues",
  "Damages / relief analysis",
  "Opposing case analysis",
  "Motion opportunities",
  "Discovery gaps",
  "Strategy recommendations",
  "Risk register",
  "Engines summary",
  "Appendices & citations",
];

export const Route = createFileRoute("/help/reports")({
  head: () => {
    const url = `${CANONICAL_BASE}/help/reports`;
    const desc = "Nyrava reports use a version-locked 17-section canonical structure. Learn what each section contains and how to read the citations.";
    return {
      meta: [
        { title: "Understanding reports — Nyrava Help" },
        { name: "description", content: desc },
        { property: "og:title", content: "Understanding reports — Nyrava" },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: breadcrumbJsonLd(CANONICAL_BASE, [
          { label: "Help", to: "/help" },
          { label: "Understanding reports", to: "/help/reports" },
        ]),
      }],
    };
  },
  component: () => (
    <DocsLayout
      eyebrow="Getting Started"
      title="Understanding reports"
      description="Nyrava reports follow a version-locked 17-section structure. Every claim is grounded to a source document."
      crumbs={[{ label: "Help", to: "/help" }, { label: "Understanding reports" }]}
      toc={[
        { id: "structure", label: "17-section structure" },
        { id: "citations", label: "Reading citations" },
        { id: "scores", label: "Scores & confidence" },
        { id: "export", label: "Export formats" },
        { id: "frozen", label: "Why the schema is frozen" },
      ]}
      related={[
        { label: "Report Intelligence", to: "/product/report-intelligence" },
        { label: "Evidence Intelligence", to: "/product/evidence-intelligence" },
        { label: "AI Transparency", to: "/ai-transparency" },
      ]}
    >
      <DocsSection id="structure" heading="17-section structure">
        <p>Every canonical report contains the following sections in order:</p>
        <ol className="mt-4 grid list-decimal gap-1 pl-5 sm:grid-cols-2">
          {SECTIONS.map((s, i) => (
            <li key={i} className="text-[13px] text-muted-foreground">{s}</li>
          ))}
        </ol>
      </DocsSection>

      <DocsSection id="citations" heading="Reading citations">
        <p>
          Every factual assertion carries a citation of the form <code>[Doc: filename, p.12 ¶3]</code>.
          Click the citation in the app to jump to the source passage. In exports, citations remain
          visible as inline annotations so a reviewer can trace them.
        </p>
      </DocsSection>

      <DocsSection id="scores" heading="Scores & confidence">
        <p>
          Some sections include internal scores (strength of contradictions, gaps in discovery, motion
          viability). These are heuristics to prioritize attorney attention, not assessments of case
          value.
        </p>
      </DocsSection>

      <DocsSection id="export" heading="Export formats">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>PDF</strong> — paginated for court binders, with orphan prevention and a compact scorecard.</li>
          <li><strong>DOCX</strong> — for further editing before filing.</li>
          <li><strong>JSON</strong> — canonical schema for downstream tooling.</li>
        </ul>
      </DocsSection>

      <DocsSection id="frozen" heading="Why the schema is frozen">
        <Callout variant="info" title="Report Engine v1.0 is frozen">
          The 17-section schema is version-locked at 1.0.0 so downstream tooling, exports, and reviewer
          workflows can rely on it. New sections require documented business justification and explicit
          approval before implementation.
        </Callout>
      </DocsSection>
    </DocsLayout>
  ),
});
