import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, Section } from "@/components/LegalPage";

export const Route = createFileRoute("/ai-transparency")({
  head: () => ({
    meta: [
      { title: "AI Transparency — Nyrava" },
      { name: "description", content: "How Nyrava uses AI, and the limitations users should understand." },
      { property: "og:title", content: "AI Transparency \u2014 Nyrava" },
      { property: "og:description", content: "How Nyrava uses AI, and the limitations users should understand." },
      { property: "og:url", content: "https://mexico.nyrava.com/ai-transparency" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/ai-transparency" },
    ],
    links: [{ rel: "canonical", href: "https://mexico.nyrava.com/ai-transparency" }],
  }),
  component: AITransparencyPage,
});

function AITransparencyPage() {
  return (
    <LegalPage
      eyebrow="Trust"
      title="AI Transparency"
      updated="2026-07-18"
      intro={
        <p>
          Nyrava uses AI-assisted analysis to accelerate legal workflows. This
          page describes how AI is used inside the platform and the
          limitations every user should understand before relying on any
          AI-generated output.
        </p>
      }
    >
      <Section heading="Where AI Is Used">
        <p>
          AI is used to extract structured facts from documents, build
          timelines, cluster witness statements, surface potential
          contradictions, draft motions, and assemble reports. Each of these
          steps is a starting point for professional review — never a final
          product.
        </p>
      </Section>

      <Section heading="Evidence Grounding">
        <p>
          Analyses are anchored to the documents you upload. Findings are
          presented alongside citations back to the source text so that a
          reviewer can verify each claim. When a finding cannot be grounded
          in the corpus, it is suppressed or gated rather than surfaced as
          fact.
        </p>
      </Section>

      <Section heading="Known Limitations">
        <ul className="list-disc space-y-1 pl-5">
          <li>AI models can make mistakes, miss context, or produce plausible-sounding but incorrect statements.</li>
          <li>Automated analysis is not a substitute for professional legal judgment.</li>
          <li>Users must verify all output against source documents and applicable law before relying on it.</li>
          <li>The system aims to avoid fabricating evidence or citations — if you encounter one, please report it.</li>
        </ul>
      </Section>

      <Section heading="Bring-Your-Own Provider Keys">
        <p>
          You can configure API keys for AI providers you already use (OpenAI,
          Anthropic, Google, Groq, OpenRouter). When a personal key is
          active, requests for your workspace are routed directly to that
          provider under that provider's terms.
        </p>
      </Section>

      <Section heading="No Training on Your Content">
        <p>
          Nyrava does not use your case content to train general-purpose
          models. When third-party providers process a request, their
          contractual data-handling terms apply to that request.
        </p>
      </Section>

      <Section heading="Reviewer Responsibility">
        <p>
          Every output — timelines, motions, findings, reports — must be
          reviewed by a qualified legal professional before use in an actual
          matter. Nyrava is a tool for professionals, not a replacement for
          them.
        </p>
      </Section>
    </LegalPage>
  );
}
