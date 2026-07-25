import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection } from "@/components/DocsLayout";

export const Route = createFileRoute("/dmca")({
  head: () => ({
    meta: [
      { title: "DMCA Policy — Nyrava" },
      { name: "description", content: "How to submit and counter a copyright takedown notice for Nyrava." },
      { property: "og:url", content: "https://nyrava.com/dmca" },
      { name: "twitter:url", content: "https://nyrava.com/dmca" },
      { property: "og:title", content: "DMCA Policy — Nyrava" },
      { property: "og:description", content: "Notice-and-takedown procedure under the DMCA." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: () => (
    <DocsLayout
      eyebrow="Legal"
      title="DMCA Policy"
      description="Notice-and-takedown procedure for claims of copyright infringement."
      crumbs={[{ label: "Legal" }, { label: "DMCA" }]}
      updated="2026-07-22"
      toc={[
        { id: "notice", label: "Filing a notice" },
        { id: "counter", label: "Counter-notice" },
        { id: "repeat", label: "Repeat infringers" },
      ]}
    >
      <DocsSection id="notice" heading="Filing a notice">
        <p>To submit a takedown notice under 17 U.S.C. § 512(c), include:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your physical or electronic signature.</li>
          <li>Identification of the copyrighted work claimed to be infringed.</li>
          <li>Identification of the material to be removed, with enough detail to locate it.</li>
          <li>Your contact information.</li>
          <li>A statement of good-faith belief that the use is not authorized.</li>
          <li>A statement under penalty of perjury that the information is accurate and that you are authorized to act on behalf of the copyright owner.</li>
        </ul>
        <p>Submit the notice through the <a href="/contact" className="text-primary hover:underline">Contact</a> page.</p>
      </DocsSection>

      <DocsSection id="counter" heading="Counter-notice">
        <p>
          If material of yours was removed and you believe the removal was in error, you may submit
          a counter-notice containing the elements required by 17 U.S.C. § 512(g).
        </p>
      </DocsSection>

      <DocsSection id="repeat" heading="Repeat infringers">
        <p>
          Accounts that repeatedly infringe the copyrights of others may be terminated in
          appropriate circumstances.
        </p>
      </DocsSection>
    </DocsLayout>
  ),
});
