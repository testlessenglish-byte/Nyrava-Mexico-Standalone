import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "Cómo Funciona — Nyrava" },
      {
        name: "description",
        content:
          "Cómo el pipeline de inteligencia jurídica de Nyrava convierte documentos en análisis estructurado, citado y revisable.",
      },
      { property: "og:title", content: "Cómo Funciona \u2014 Nyrava" },
      {
        property: "og:description",
        content:
          "Cómo el pipeline de inteligencia jurídica de Nyrava convierte documentos en análisis estructurado, citado y revisable.",
      },
      { property: "og:url", content: "https://mexico.nyrava.com/how-it-works" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/how-it-works" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/how-it-works" }],
  }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  return (
    <LegalPage
      eyebrow="Platform"
      title="How Nyrava Works"
      intro={
        <p>
          Nyrava turns raw case materials into a structured, cited, reviewable
          analysis. Every step is anchored to your documents.
        </p>
      }
    >
      <Section heading="1. Ingest">
        <p>
          You upload the case corpus — pleadings, discovery, transcripts,
          notes. Documents are extracted, normalized, and indexed inside
          your workspace.
        </p>
      </Section>
      <Section heading="2. Analyze">
        <p>
          Purpose-built engines build a timeline, identify witnesses, flag
          constitutional issues, surface potential contradictions, and score
          the evidence supporting each theory.
        </p>
      </Section>
      <Section heading="3. Ground">
        <p>
          Every finding carries citations back to the specific source text
          that supports it. Ungrounded output is suppressed rather than
          presented as fact.
        </p>
      </Section>
      <Section heading="4. Draft">
        <p>
          Motion Intelligence and Report Intelligence assemble
          attorney-review-ready drafts from the analysis, ready to be
          exported and refined by a qualified reviewer.
        </p>
      </Section>
      <Section heading="5. Review">
        <p>
          Every artifact produced by Nyrava is intended for professional
          review. Analysis is a starting point — never a substitute for
          judgment.
        </p>
      </Section>
    </LegalPage>
  );
}
