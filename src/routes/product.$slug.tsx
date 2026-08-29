import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsLayout, DocsSection, StepList, FAQ, Callout, FeatureGrid, breadcrumbJsonLd, productJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";
import { getLocalizedProduct, getProduct, type ProductPageContent } from "@/lib/docs/product-copy";
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/i18n";

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
  const baseProduct = Route.useLoaderData() as ProductPageContent;
  const { locale } = useI18n();
  const p = getLocalizedProduct(baseProduct, locale);
  const es = locale === "es";
  const careProduct = ["comprehensive-care", "community-support", "talk-to-cases"].includes(p.slug);
  const labels = {
    product: es ? "Producto" : "Product",
    what: es ? "Qué hace" : "What it does",
    how: es ? "Cómo funciona" : "How it works",
    benefits: es ? "Beneficios" : "Benefits",
    workflow: es ? "Flujo de trabajo" : "Workflow",
    typicalWorkflow: es ? "Flujo de trabajo habitual" : "Typical workflow",
    examples: es ? "Ejemplos" : "Examples",
    bestPractices: es ? "Buenas prácticas" : "Best practices",
    responsibilities: careProduct
      ? (es ? "Responsabilidades del equipo profesional" : "Professional case-team responsibilities")
      : (es ? "Responsabilidades del abogado" : "Attorney responsibilities"),
    scenarios: es ? "Escenarios frecuentes" : "Common scenarios",
    limitations: es ? "Limitaciones" : "Limitations",
    platformLimitations: es ? "Limitaciones de la plataforma" : "Platform limitations",
    faq: es ? "Preguntas frecuentes" : "Frequently asked questions",
    step: es ? "Paso" : "Step",
  };
  return (
    <DocsLayout
      eyebrow={p.eyebrow}
      title={p.title}
      description={p.description}
      crumbs={[{ label: labels.product }, { label: p.title }]}
      toc={[
        { id: "what", label: labels.what },
        { id: "how", label: labels.how },
        { id: "benefits", label: labels.benefits },
        { id: "workflow", label: labels.workflow },
        { id: "examples", label: labels.examples },
        { id: "best-practices", label: labels.bestPractices },
        { id: "professional-responsibilities", label: labels.responsibilities },
        { id: "scenarios", label: labels.scenarios },
        { id: "limitations", label: labels.limitations },
        { id: "faq", label: labels.faq },
      ]}
      next={p.next}
      related={p.related}
    >
      <DocsSection id="what" heading={labels.what}>
        <p>{p.what}</p>
      </DocsSection>

      <DocsSection id="how" heading={labels.how}>
        <StepList steps={p.how.map((h, i) => ({ title: `${labels.step} ${i + 1}`, description: h }))} />
        {careProduct ? (
          <Callout variant="info" title={es ? "Salvaguardas de los registros de atención" : "Care-record safeguards"}>
            {es
              ? "Las respuestas, resúmenes y formatos se limitan a los registros autorizados para la función y nivel de confidencialidad del usuario. El sistema verifica consentimiento y conserva la revisión profesional antes de una canalización, divulgación o decisión de atención."
              : "Answers, summaries, and forms are limited to records authorized for the user's role and confidentiality tier. The system checks consent and preserves professional review before a referral, disclosure, or care decision."}
          </Callout>
        ) : (
          <Callout variant="info" title={es ? "Compuerta de evidencia" : "Evidence gate"}>
            {es
              ? "Cada motor de inteligencia suprime resultados no fundamentados. Nada llega a un informe si no puede vincularse con un pasaje del expediente."
              : "Every intelligence engine writes through an evidence gate that suppresses ungrounded output. Nothing reaches a report unless it can be traced to a passage in your corpus."}
          </Callout>
        )}
      </DocsSection>

      <DocsSection id="benefits" heading={labels.benefits}>
        <FeatureGrid
          items={p.benefits.map((b) => ({
            icon: <CheckCircle2 className="h-4 w-4" />,
            title: b,
            description: "",
          }))}
        />
      </DocsSection>

      <DocsSection id="workflow" heading={labels.typicalWorkflow}>
        <StepList steps={p.workflow} />
      </DocsSection>

      <DocsSection id="examples" heading={labels.examples}>
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

      <DocsSection id="best-practices" heading={labels.bestPractices}>
        <ul className="list-disc space-y-2 pl-5">
          {p.bestPractices.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </DocsSection>

      <DocsSection id="professional-responsibilities" heading={labels.responsibilities}>
        <Callout
          variant="warning"
          title={careProduct
            ? (es ? "Supervisión profesional humana" : "Human professional oversight")
            : (es ? "El abogado conserva el control" : "Attorney in control")}
        >
          {careProduct
            ? (es
                ? "Nyrava estructura y señala información; el equipo profesional autorizado evalúa, decide, documenta y supervisa cada actuación."
                : "Nyrava structures and flags information; the authorized professional team assesses, decides, documents, and supervises every action.")
            : (es
                ? "Nyrava propone. El abogado decide. Todo resultado debe ser revisado por un profesional jurídico calificado antes de utilizarse."
                : "Nyrava proposes. Attorneys decide. Every output must be reviewed by qualified counsel before use.")}
        </Callout>
        <ul className="list-disc space-y-2 pl-5">
          {p.attorneyResponsibilities.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </DocsSection>

      <DocsSection id="scenarios" heading={labels.scenarios}>
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

      <DocsSection id="limitations" heading={labels.platformLimitations}>
        <ul className="list-disc space-y-2 pl-5">
          {p.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </DocsSection>

      <DocsSection id="faq" heading={labels.faq}>
        <FAQ items={p.faqs.map((f) => ({ q: f.q, a: f.a }))} />
      </DocsSection>
    </DocsLayout>
  );
}
