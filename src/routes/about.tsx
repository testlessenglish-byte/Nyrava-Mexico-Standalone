import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection } from "@/components/DocsLayout";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Nyrava — Legal Intelligence OS" },
      { name: "description", content: "The mission, vision, and reason Nyrava Intelligence OS exists." },
      { property: "og:url", content: "https://nyrava.com/about" },
      { name: "twitter:url", content: "https://nyrava.com/about" },
      { property: "og:title", content: "About Nyrava — Legal Intelligence OS" },
      { property: "og:description", content: "Why Nyrava exists and who it's built for." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Company"
      title="About Nyrava"
      description="Nyrava is a Legal Intelligence Operating System built for attorneys who work on complex, high-stakes matters."
      crumbs={[{ label: "Company" }, { label: "About" }]}
      toc={[
        { id: "mission", label: "Mission" },
        { id: "vision", label: "Vision" },
        { id: "why", label: "Why Nyrava exists" },
        { id: "who", label: "Who we build for" },
        { id: "principles", label: "Operating principles" },
      ]}
    >
      <DocsSection id="mission" heading="Mission">
        <p>
          Give legal professionals a faster, more reliable way to understand what is actually in the
          record — without giving up the verification, confidentiality, and judgment that legal work
          demands.
        </p>
      </DocsSection>

      <DocsSection id="vision" heading="Vision">
        <p>
          Every attorney, in every practice area, working from a grounded, cited, machine-assisted
          view of their case. No missed contradictions. No forgotten exhibits. No fabricated
          citations. Every finding traceable to a source document in one click.
        </p>
      </DocsSection>

      <DocsSection id="why" heading="Why Nyrava exists">
        <p>
          Litigation is drowning in paper. A single mid-size matter can carry tens of thousands of
          pages of discovery, hours of transcripts, and years of correspondence. Attorneys are asked
          to hold all of it in their heads while opposing counsel does the same.
        </p>
        <p>
          General-purpose AI tools are not a solution — they hallucinate, they lose citations, and
          they don't understand what evidence-grounding means. Nyrava is built specifically for the
          legal workflow: evidence-first, cited by default, attorney in control.
        </p>
      </DocsSection>

      <DocsSection id="who" heading="Who we build for">
        <ul className="list-disc space-y-1 pl-5">
          <li>Attorneys in solo and small-firm practice handling complex matters.</li>
          <li>Prosecutors and public defenders working under caseload pressure.</li>
          <li>Litigation-support and paralegal teams inside larger firms.</li>
          <li>Investigators and expert witnesses reviewing case files.</li>
          <li>Corporate legal departments managing multi-matter litigation.</li>
        </ul>
      </DocsSection>

      <DocsSection id="principles" heading="Operating principles">
        <ol className="list-decimal space-y-2 pl-5">
          <li><strong>Attorney in control.</strong> The tool proposes; the attorney decides.</li>
          <li><strong>Evidence first.</strong> Every claim tied to a source passage.</li>
          <li><strong>Transparent.</strong> Every engine run auditable.</li>
          <li><strong>Verified.</strong> Authority citations checked before they reach a draft.</li>
          <li><strong>Private.</strong> Case content is not training data.</li>
          <li><strong>Honest.</strong> We don't claim certifications we haven't earned.</li>
        </ol>
      </DocsSection>
    </DocsLayout>
  ),
});
