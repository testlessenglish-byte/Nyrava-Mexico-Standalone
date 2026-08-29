import { createFileRoute } from "@tanstack/react-router";
import { DocsLayout, DocsSection, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";
import { DOCS_VERSION } from "@/lib/docs/manifest";

type Release = {
  version: string;
  channel: string;
  date: string;
  new?: string[];
  improved?: string[];
  fixed?: string[];
  known?: string[];
  upcoming?: string[];
};

const RELEASES: Release[] = [
  {
    version: "1.0.0",
    channel: "Beta",
    date: "2026-07-23",
    new: [
      "Enterprise Documentation Portal with persistent sidebar, Cmd+K search, breadcrumbs, and version-locked docs shell.",
      "Trust Center rebuilt as the central hub for security, privacy, AI transparency, and compliance topics.",
      "Six dedicated Product pages (Evidence, Timeline, Witness, Constitutional, Motion, Report Intelligence) with best-practices, attorney-responsibilities, and limitations sections.",
      "Full legal-document coverage: Responsible AI, Acceptable Use, DPA, DMCA, Copyright, Accessibility, Beta Program Terms.",
      "Resources library and Release Notes.",
    ],
    improved: [
      "SEO — every documentation route now emits canonical URLs, og:url, and BreadcrumbList JSON-LD; product pages also emit FAQPage schema.",
      "Sitemap coverage expanded to include all product, help, and legal pages.",
    ],
  },
  {
    version: "0.9.0",
    channel: "Beta",
    date: "2026-07-22",
    new: [
      "Canonical Case Analysis schema (17 sections) version-locked at 1.0.0.",
      "Bring-your-own-key support for OpenAI, Anthropic, Gemini, Groq, and OpenRouter with automatic failover.",
      "Admin cooldown management surface on the System Health page.",
    ],
    improved: [
      "PDF export: orphan prevention, compact score strip, paginated work-product cards.",
      "Evidence gate now returns audit details logged into `pipeline_engine_runs.meta` on every run.",
    ],
    fixed: [
      "Groq cooldown lock-out on `analyzers_batch` engine runs.",
      "Reports failing to persist when narrative columns were absent after schema cutover.",
    ],
  },
  {
    version: "0.8.0",
    channel: "Beta",
    date: "2026-07-18",
    new: [
      "Row-level security across all workspace tables.",
      "AES-256-GCM encryption of provider API keys at rest.",
      "Truthful-marketing overhaul: removed fictional certifications and placeholder credibility content.",
    ],
    improved: [
      "Rebranded user-facing 'AI' to 'Nyrava Intelligence' across the app.",
      "Global UX: scroll-to-top, universal back button, sticky navigation, persistent user menu.",
    ],
  },
];

const KNOWN = [
  "Speaker attribution on transcripts with heavy speaker-tag noise can require attorney correction.",
  "Very low-quality scans may need re-scanning before OCR-derived text is trusted.",
  "The supported motion library covers common types; additional types are on the roadmap.",
];

const UPCOMING = [
  "Workspace collaboration with role-based permissions.",
  "Deposition preparation workspace.",
  "Native case-management system integrations.",
  "SOC 2 Type II readiness.",
];

export const Route = createFileRoute("/release-notes")({
  head: () => {
    const url = `${CANONICAL_BASE}/release-notes`;
    const desc = "Novedades, mejoras, correcciones y actualizaciones del sistema operativo de inteligencia jurídica Nyrava México.";
    return {
      meta: [
        { title: "Notas de Versión — Nyrava México" },
        { name: "description", content: desc },
        { property: "og:title", content: "Notas de Versión — Nyrava México" },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: breadcrumbJsonLd(CANONICAL_BASE, [{ label: "Notas de versión", to: "/release-notes" }]),
      }],
    };
  },
  component: ReleaseNotes,
});

function ReleaseNotes() {
  return (
    <DocsLayout
      eyebrow="Company"
      title="Release Notes"
      description={`Documentation version ${DOCS_VERSION.version} · ${DOCS_VERSION.channel} · Updated ${DOCS_VERSION.updated}.`}
      crumbs={[{ label: "Company" }, { label: "Release Notes", to: "/release-notes" }]}
    >
      {RELEASES.map((r) => (
        <DocsSection key={r.version} heading={`v${r.version} · ${r.channel}`}>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Released {r.date}</div>
          {r.new && (
            <div>
              <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">New</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">{r.new.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {r.improved && (
            <div>
              <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">Improved</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">{r.improved.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {r.fixed && (
            <div>
              <div className="mt-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">Fixed</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">{r.fixed.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
        </DocsSection>
      ))}

      <DocsSection heading="Known issues">
        <ul className="list-disc space-y-1 pl-5">{KNOWN.map((k, i) => <li key={i}>{k}</li>)}</ul>
      </DocsSection>

      <DocsSection heading="Upcoming">
        <ul className="list-disc space-y-1 pl-5">{UPCOMING.map((u, i) => <li key={i}>{u}</li>)}</ul>
      </DocsSection>
    </DocsLayout>
  );
}
