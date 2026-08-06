import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowRight, ArrowLeft, FileText, ExternalLink } from "lucide-react";
import { NyravaLogo } from "@/components/NyravaLogo";
import { SiteFooter } from "@/components/SiteFooter";
import { getPublishedDemoCase, DEMO_DOC_TYPE_LABELS, type DemoDocType } from "@/lib/demo-cases.functions";

export const Route = createFileRoute("/demo/$slug")({
  head: ({ params }) => {
    const url = `https://mexico.nyrava.com/demo/${params.slug}`;
    const title = `Demo — ${params.slug} — Nyrava`;
    const desc = "Explore a full Nyrava case analysis: evidence, timeline, witnesses, motions, and the final report.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };

  },
  component: DemoCasePage,
});

function DemoCasePage() {
  const { slug } = Route.useParams();
  const fetchDemo = useServerFn(getPublishedDemoCase);
  const { data, isLoading, error } = useQuery({
    queryKey: ["published-demo-case", slug],
    queryFn: () => fetchDemo({ data: { slug } }),
  });
  const [activeDoc, setActiveDoc] = useState<string | null>(null);

  const docs = data?.documents ?? [];
  const active = docs.find((d) => d.id === activeDoc) ?? docs[0];

  return (
    <div className="min-h-screen text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-[100rem] items-center justify-between px-6 py-5">
          <Link to="/">
            <NyravaLogo size={38} withWordmark />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="hidden items-center gap-1 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground hover:text-foreground sm:flex"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> ALL DEMOS
            </Link>
            <Link
              to="/auth"
              className="rounded-md border border-primary/60 bg-primary/15 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-primary hover:bg-primary/25"
              style={{ boxShadow: "var(--shadow-glow-cyan)" }}
            >
              LAUNCH PLATFORM
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[100rem] px-6 py-10">
        {isLoading && <div className="py-20 text-center text-muted-foreground">Loading demo…</div>}

        {error && (
          <div className="py-20 text-center">
            <p className="text-lg font-semibold">This demo isn't available.</p>
            <p className="mt-2 text-sm text-muted-foreground">It may have been unpublished or removed.</p>
            <Link to="/" className="mt-6 inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" /> Back to homepage
            </Link>
          </div>
        )}

        {data && (
          <>
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-3 text-[11px] font-semibold tracking-[0.28em] tag-bracket text-amber">
                  {data.case_type_label.toUpperCase()} DEMO
                </div>
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{data.name}</h1>
                {data.summary && <p className="mt-2 text-base text-muted-foreground">{data.summary}</p>}
                {data.description && (
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{data.description}</p>
                )}
              </div>
              <Link
                to="/auth"
                className="inline-flex shrink-0 items-center gap-2 rounded-md border border-primary/50 bg-primary/15 px-5 py-3 text-[12px] font-semibold tracking-[0.18em] text-primary hover:bg-primary/25"
                style={{ boxShadow: "var(--shadow-glow-cyan)" }}
              >
                ANALYZE YOUR OWN CASE <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {docs.length === 0 ? (
              <div className="panel p-10 text-center text-muted-foreground">
                This demo doesn't have any files uploaded yet.
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <nav className="space-y-1.5">
                  {docs.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setActiveDoc(d.id)}
                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-sm transition ${
                        active?.id === d.id
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border bg-card/40 text-muted-foreground hover:bg-card hover:text-foreground"
                      }`}
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">{DEMO_DOC_TYPE_LABELS[d.doc_type as DemoDocType] ?? d.file_name}</span>
                    </button>
                  ))}
                </nav>

                <div className="panel min-h-[70vh] overflow-hidden p-0">
                  {active && (
                    <>
                      <div className="flex items-center justify-between border-b border-border px-4 py-3">
                        <div className="truncate text-sm font-medium">{active.file_name}</div>
                        <a
                          href={active.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Open in new tab <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <iframe title={active.file_name} src={active.url} className="h-[70vh] w-full" />
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
