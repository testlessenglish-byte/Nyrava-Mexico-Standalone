import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsLayout, DocsSection, StepList, FAQ, Callout, FeatureGrid, breadcrumbJsonLd, productJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";
import { getProduct, type ProductPageContent } from "@/lib/docs/product-copy";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/product/$slug")({
  loader: ({ params }) => {
    const product = getProduct(params.slug);
    if (!product) throw notFound();
    return product;
  },
  head: ({ params, loaderData }) => {
    const p = loaderData;
    const url = `${CANONICAL_BASE}/product/${params.slug}`;
    if (!p) {
      return {
        meta: [
          { title: "Product not found — Nyrava" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    return {
      meta: [
        { title: `${p.title} — Nyrava Inteligencia Jurídica México` },
        { name: "description", content: p.description },
        { property: "og:title", content: `${p.title} — Nyrava México` },
        { property: "og:description", content: p.description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: `${p.title} — Nyrava México` },
        { name: "twitter:description", content: p.description },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: breadcrumbJsonLd(CANONICAL_BASE, [
            { label: "Módulos" },
            { label: p.title, to: `/product/${params.slug}` },
          ]),
        },
        {
          type: "application/ld+json",
          children: productJsonLd(CANONICAL_BASE, {
            slug: params.slug,
            title: p.title,
            description: p.description,
            category: "Legal Technology Software",
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: p.faqs.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Product not found</h1>
      <p className="mt-2 text-muted-foreground">The product page you're looking for doesn't exist.</p>
    </div>
  ),
  component: ProductPage,
});

function ProductPage() {
  const p = Route.useLoaderData() as ProductPageContent;
  return (
    <DocsLayout
      eyebrow={p.eyebrow}
      title={p.title}
      description={p.description}
      crumbs={[{ label: "Product" }, { label: p.title }]}
      toc={[
        { id: "what", label: "What it does" },
        { id: "how", label: "How it works" },
        { id: "benefits", label: "Benefits" },
        { id: "workflow", label: "Workflow" },
        { id: "examples", label: "Examples" },
        { id: "best-practices", label: "Best practices" },
        { id: "attorney-responsibilities", label: "Attorney responsibilities" },
        { id: "scenarios", label: "Common scenarios" },
        { id: "limitations", label: "Limitations" },
        { id: "faq", label: "FAQ" },
      ]}
      next={p.next}
      related={p.related}
    >
      <DocsSection id="what" heading="What it does">
        <p>{p.what}</p>
      </DocsSection>

      <DocsSection id="how" heading="How it works">
        <StepList steps={p.how.map((h, i) => ({ title: `Step ${i + 1}`, description: h }))} />
        <Callout variant="info" title="Evidence gate">
          Every intelligence engine writes through an evidence gate that suppresses ungrounded
          output. Nothing reaches a report unless it can be traced to a passage in your corpus.
        </Callout>
      </DocsSection>

      <DocsSection id="benefits" heading="Benefits">
        <FeatureGrid
          items={p.benefits.map((b) => ({
            icon: <CheckCircle2 className="h-4 w-4" />,
            title: b,
            description: "",
          }))}
        />
      </DocsSection>

      <DocsSection id="workflow" heading="Typical workflow">
        <StepList steps={p.workflow} />
      </DocsSection>

      <DocsSection id="examples" heading="Examples">
        <div className="my-4 grid gap-3 sm:grid-cols-2">
          {p.examples.map((ex) => (
            <div key={ex.title} className="rounded-lg border border-border/60 bg-card/30 p-4">
              <div className="text-[13.5px] font-semibold text-foreground">{ex.title}</div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {ex.description}
              </div>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="best-practices" heading="Best practices">
        <ul className="list-disc space-y-2 pl-5">
          {p.bestPractices.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </DocsSection>

      <DocsSection id="attorney-responsibilities" heading="Attorney responsibilities">
        <Callout variant="warning" title="Attorney in control">
          Nyrava proposes. Attorneys decide. Every output must be reviewed by qualified counsel
          before use.
        </Callout>
        <ul className="list-disc space-y-2 pl-5">
          {p.attorneyResponsibilities.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </DocsSection>

      <DocsSection id="scenarios" heading="Common scenarios">
        <div className="my-4 grid gap-3 sm:grid-cols-2">
          {p.scenarios.map((s) => (
            <div key={s.title} className="rounded-lg border border-border/60 bg-card/30 p-4">
              <div className="text-[13.5px] font-semibold text-foreground">{s.title}</div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                {s.description}
              </div>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection id="limitations" heading="Platform limitations">
        <ul className="list-disc space-y-2 pl-5">
          {p.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </DocsSection>

      <DocsSection id="faq" heading="Frequently asked questions">
        <FAQ items={p.faqs.map((f) => ({ q: f.q, a: f.a }))} />
      </DocsSection>
    </DocsLayout>
  );
}
