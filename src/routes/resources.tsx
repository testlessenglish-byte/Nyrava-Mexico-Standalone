import { createFileRoute, Link } from "@tanstack/react-router";
import { DocsLayout, DocsSection, Callout, breadcrumbJsonLd, CANONICAL_BASE } from "@/components/DocsLayout";
import { FileText } from "lucide-react";

type Sample = {
  slug: string;
  practiceArea: string;
  title: string;
  summary: string;
  highlights: string[];
};

const SAMPLES: Sample[] = [
  {
    slug: "criminal-defense",
    practiceArea: "Criminal Defense",
    title: "People v. Ortega — alleged armed robbery",
    summary: "Fourth Amendment analysis of a warrantless vehicle search, Fifth Amendment analysis of post-invocation interrogation, and evidentiary reconstruction of the arrest.",
    highlights: [
      "Constitutional issues drafted with citations to arrest report and body-cam transcript.",
      "Contradictions between victim statement and body-cam audio surfaced automatically.",
      "Motion to suppress skeleton pulled from the constitutional analysis.",
    ],
  },
  {
    slug: "personal-injury",
    practiceArea: "Personal Injury",
    title: "Roadway collision — commercial vehicle vs. passenger",
    summary: "Reconstruction of the crash sequence from crash report, ELD logbook, trauma admission, and defendant deposition.",
    highlights: [
      "Minute-by-minute timeline anchored to ELD data.",
      "Life-care plan cross-referenced against trauma admission diagnoses.",
      "Damages framework outlined with supporting citations.",
    ],
  },
  {
    slug: "medical-malpractice",
    practiceArea: "Medical Malpractice",
    title: "ED presentation and delayed diagnosis",
    summary: "Assembly of a minute-by-minute ED timeline from records, RCA memo, and expert affidavit.",
    highlights: [
      "Standard-of-care analysis grounded in expert affidavit.",
      "Autopsy findings reconciled with charting sequence.",
      "Internal RCA memo cross-referenced with clinical timeline.",
    ],
  },
  {
    slug: "employment",
    practiceArea: "Employment",
    title: "Retaliation & hostile-environment claim",
    summary: "Three years of performance history, internal HR complaint, and email thread analyzed for retaliation timing and pretext.",
    highlights: [
      "Pretext analysis tied to specific performance-review passages.",
      "EEOC charge reconciled against internal complaint log.",
      "Timeline of protected activity vs. adverse action produced automatically.",
    ],
  },
  {
    slug: "family-law",
    practiceArea: "Family Law",
    title: "Dissolution with custody and DV allegations",
    summary: "Reconciliation of DV incident report, custody evaluation, and dueling financial affidavits.",
    highlights: [
      "Parent-statement cross-witness comparison across custody evaluation and affidavits.",
      "DV report timeline overlaid with financial-affidavit dates.",
      "Best-interest factors surfaced with supporting citations.",
    ],
  },
  {
    slug: "appellate",
    practiceArea: "Appellate",
    title: "Direct appeal — evidentiary and constitutional issues",
    summary: "Reconstruction of procedural history across opening brief, transcripts, respondent brief, and reply.",
    highlights: [
      "Procedural chronology extracted for the fact section.",
      "Preservation analysis anchored to reporter's transcript citations.",
      "Issue statements drafted with record cites and doctrinal framing.",
    ],
  },
  {
    slug: "civil-rights",
    practiceArea: "Civil Rights (§1983)",
    title: "Excessive force and municipal liability",
    summary: "§1983 claim analysis with officer statement clustering across arrest report, IA log, and deposition.",
    highlights: [
      "Cross-witness contradictions between IA log and deposition.",
      "Monell theory outlined with citations to the IA complaint history.",
      "Damages framework tied to ER records and witness accounts.",
    ],
  },
  {
    slug: "tax-law",
    practiceArea: "Tax Law",
    title: "Notice of Deficiency & Tax Court petition",
    summary: "Reconciliation of revenue-agent report, bank deposits, and CPA correspondence for a Tax Court petition.",
    highlights: [
      "Deposit reconciliation tied to invoice-level bank records.",
      "Home-office and vehicle substantiation cross-referenced with logs.",
      "Appeals determination integrated into the petition's factual reconstruction.",
    ],
  },
  {
    slug: "general-civil",
    practiceArea: "General Civil",
    title: "Contract dispute with counterclaim",
    summary: "Contract, payment ledger, email thread, and independent inspection reconciled for a breach and counterclaim analysis.",
    highlights: [
      "Payment-ledger analysis grounded in raw CSV.",
      "Inspection report cross-referenced against contract deliverables.",
      "Counterclaim theory outlined with responsive citations.",
    ],
  },
];

export const Route = createFileRoute("/resources")({
  head: () => {
    const url = `${CANONICAL_BASE}/resources`;
    const desc = "Redacted sample reports across practice areas — criminal defense, personal injury, medical malpractice, employment, family, appellate, civil rights, tax, and general civil.";
    return {
      meta: [
        { title: "Resources — Sample Reports by Practice Area | Nyrava" },
        { name: "description", content: desc },
        { property: "og:title", content: "Resources — Nyrava" },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: breadcrumbJsonLd(CANONICAL_BASE, [{ label: "Resources", to: "/resources" }]),
      }],
    };
  },
  component: Resources,
});

function Resources() {
  return (
    <DocsLayout
      eyebrow="Resources"
      title="Sample reports by practice area"
      description="Short summaries of Nyrava analysis across nine practice areas. Each summary describes the record analyzed and the highlights of the generated report — useful for evaluating fit."
      crumbs={[{ label: "Resources", to: "/resources" }]}
    >
      <Callout variant="info" title="Redacted synthetic material">
        Sample corpora are synthetic composites built for evaluation and training. They are not
        derived from any actual matter and do not represent any real party.
      </Callout>

      <DocsSection>
        <div className="my-4 grid gap-4 sm:grid-cols-2">
          {SAMPLES.map((s) => (
            <div key={s.slug} className="flex flex-col rounded-xl border border-border/60 bg-card/30 p-5">
              <div className="mb-3 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-primary">
                <FileText className="h-3.5 w-3.5" />
                {s.practiceArea}
              </div>
              <div className="text-[14px] font-semibold text-foreground">{s.title}</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{s.summary}</p>
              <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground">
                {s.highlights.map((h, i) => (
                  <li key={i} className="pl-4 -indent-4">→ {h}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DocsSection>

      <DocsSection heading="Want to see a report in your practice area?">
        <p>
          Request a walkthrough through the{" "}
          <Link to="/contact" className="text-primary hover:underline">Contact</Link> page and let us
          know which practice area you're evaluating. Firms enrolled in the beta can also run any of
          the sample corpora directly from the admin fixture tool.
        </p>
      </DocsSection>
    </DocsLayout>
  );
}
