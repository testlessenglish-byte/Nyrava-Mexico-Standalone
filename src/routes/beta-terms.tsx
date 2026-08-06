import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout } from "@/components/DocsLayout";

export const Route = createFileRoute("/beta-terms")({
  head: () => ({
    meta: [
      { title: "Beta Program Terms — Nyrava" },
      { name: "description", content: "Terms governing participation in the Nyrava beta program." },
      { property: "og:url", content: "https://mexico.nyrava.com/beta-terms" },
      { name: "twitter:url", content: "https://mexico.nyrava.com/beta-terms" },
      { property: "og:title", content: "Beta Program Terms — Nyrava" },
      { property: "og:description", content: "Rules and expectations for beta participants." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Legal"
      title="Beta Program Terms"
      description="Terms specific to features and workspaces enrolled in the Nyrava beta program."
      crumbs={[{ label: "Legal" }, { label: "Beta Terms" }]}
      updated="2026-07-22"
      toc={[
        { id: "scope", label: "Scope" },
        { id: "expectations", label: "Expectations" },
        { id: "feedback", label: "Feedback" },
        { id: "termination", label: "Termination" },
      ]}
    >
      <DocsSection id="scope" heading="Scope">
        <p>
          These terms apply to features Nyrava marks as beta and to workspaces enrolled in the beta
          program. They supplement the Terms of Service.
        </p>
      </DocsSection>

      <DocsSection id="expectations" heading="Expectations">
        <Callout variant="warning" title="Beta software">
          Beta features may change, break, or be removed with limited notice. Beta output should be
          treated with additional attorney scrutiny before use in a matter.
        </Callout>
        <ul className="list-disc space-y-1 pl-5">
          <li>No availability commitments apply to beta features.</li>
          <li>Data produced by beta engines may not be preserved across schema changes.</li>
          <li>Pricing for beta features may change when they graduate to general availability.</li>
        </ul>
      </DocsSection>

      <DocsSection id="feedback" heading="Feedback">
        <p>
          Feedback you submit about beta features may be used to improve Nyrava without obligation
          or attribution. You retain ownership of your case content.
        </p>
      </DocsSection>

      <DocsSection id="termination" heading="Termination">
        <p>
          Nyrava may end the beta program at any time. Where reasonable, we will migrate
          participating workspaces to a general-availability equivalent.
        </p>
      </DocsSection>
    </DocsLayout>
  ),
});
