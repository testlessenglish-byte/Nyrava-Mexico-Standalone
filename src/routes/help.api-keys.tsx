import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";

export const Route = createFileRoute("/help/api-keys")({
  head: () => {
    const url = `${CANONICAL_BASE}/help/api-keys`;
    const desc = "Bring your own AI provider keys to Nyrava — OpenAI, Anthropic, Gemini, Groq, and OpenRouter. Configuration, failover, and cost.";
    return {
      meta: [
        { title: "API keys & providers — Nyrava Help" },
        { name: "description", content: desc },
        { property: "og:title", content: "API keys & providers — Nyrava" },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: breadcrumbJsonLd(CANONICAL_BASE, [
          { label: "Help", to: "/help" },
          { label: "API keys", to: "/help/api-keys" },
        ]),
      }],
    };
  },
  component: () => (
    <DocsLayout
      eyebrow="Getting Started"
      title="API keys & bring-your-own providers"
      description="Route Nyrava analysis through your own OpenAI, Anthropic, Gemini, Groq, or OpenRouter keys."
      crumbs={[{ label: "Help", to: "/help" }, { label: "API keys" }]}
      toc={[
        { id: "supported", label: "Supported providers" },
        { id: "configure", label: "Configuring keys" },
        { id: "failover", label: "Automatic failover" },
        { id: "cost", label: "Cost & billing" },
        { id: "security", label: "Security of your keys" },
      ]}
      related={[
        { label: "Trust Center", to: "/trust" },
        { label: "AI Transparency", to: "/ai-transparency" },
        { label: "Responsible AI", to: "/responsible-ai" },
      ]}
    >
      <DocsSection id="supported" heading="Supported providers">
        <ul className="list-disc space-y-1 pl-5">
          <li>OpenAI (GPT-4 class)</li>
          <li>Anthropic (Claude 3.5+ class)</li>
          <li>Google Gemini (Pro class)</li>
          <li>Groq (fast inference)</li>
          <li>OpenRouter (as a gateway to further models)</li>
        </ul>
      </DocsSection>

      <DocsSection id="configure" heading="Configuring keys">
        <p>
          Open <strong>Settings → API Keys</strong>. Paste your provider key; Nyrava validates it and
          encrypts it before storage using AES-256-GCM. You can rotate, disable, or delete a key at any
          time.
        </p>
      </DocsSection>

      <DocsSection id="failover" heading="Automatic failover">
        <p>
          Nyrava's router selects a provider per engine based on availability and cooldown state. If a
          provider errors or throttles, the router transparently falls back to the next configured
          provider so pipeline runs don't stall.
        </p>
      </DocsSection>

      <DocsSection id="cost" heading="Cost & billing">
        <Callout variant="info" title="Direct billing">
          When you configure your own key, provider costs are billed directly to your account with that
          provider under their pricing. Nyrava's subscription covers the platform, not model tokens.
        </Callout>
      </DocsSection>

      <DocsSection id="security" heading="Security of your keys">
        <ul className="list-disc space-y-1 pl-5">
          <li>Keys are encrypted at rest with AES-256-GCM.</li>
          <li>The plaintext key never leaves the server-side gateway during a request.</li>
          <li>Keys are scoped to your workspace and never shared across workspaces.</li>
        </ul>
      </DocsSection>
    </DocsLayout>
  ),
});
