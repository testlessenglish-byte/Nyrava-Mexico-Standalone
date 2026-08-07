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
    slug: "penal",
    practiceArea: "Derecho Penal",
    title: "Causa penal — robo calificado con violencia",
    summary: "Analysis of article 16 CPEUM on a detention without timely judicial control, article 20 on a declaración ministerial taken without defense counsel present, and evidentiary reconstruction of the detention.",
    highlights: [
      "Constitutional issues drafted with citations to the informe policial homologado and the audiencia de control de detención transcript.",
      "Contradictions between the victim's declaración and the body-worn camera audio surfaced automatically.",
      "Incidente de exclusión de prueba ilícita skeleton pulled from the constitutional analysis.",
    ],
  },
  {
    slug: "responsabilidad-civil",
    practiceArea: "Derecho Civil",
    title: "Accidente de tránsito — vehículo de carga vs. particular",
    summary: "Reconstruction of the crash sequence from the parte de tránsito, the vehicle's bitácora de viaje, emergency-room admission notes, and the demandado's declaración.",
    highlights: [
      "Minute-by-minute timeline anchored to the bitácora de viaje.",
      "Rehabilitation plan cross-referenced against the expediente clínico diagnoses.",
      "Damages framework (cuantificación del daño) outlined with supporting citations.",
    ],
  },
  {
    slug: "responsabilidad-medica",
    practiceArea: "Derecho Civil",
    title: "Mala práctica médica — urgencias y diagnóstico tardío",
    summary: "Assembly of a minute-by-minute emergency-room timeline from the expediente clínico, the internal acta de investigación, and the dictamen pericial.",
    highlights: [
      "Lex artis (standard-of-care) analysis grounded in the dictamen pericial.",
      "Autopsy findings reconciled with the charting sequence.",
      "Internal acta de investigación cross-referenced with the clinical timeline.",
    ],
  },
  {
    slug: "laboral",
    practiceArea: "Derecho Laboral",
    title: "Despido injustificado con reclamo de hostigamiento",
    summary: "Three years of performance history, an internal queja before Recursos Humanos, and an email thread analyzed for the despido's timing and pretext.",
    highlights: [
      "Pretext analysis tied to specific performance-review passages.",
      "Internal queja reconciled against the incident log.",
      "Timeline of protected activity vs. adverse action produced automatically.",
    ],
  },
  {
    slug: "familiar",
    practiceArea: "Derecho Familiar",
    title: "Divorcio con guarda y custodia y alegaciones de violencia familiar",
    summary: "Reconciliation of the denuncia de violencia familiar, the informe de trabajo social, and dueling declaraciones patrimoniales.",
    highlights: [
      "Parent-statement cross-witness comparison across the informe de trabajo social and declaraciones.",
      "Denuncia timeline overlaid with the declaración patrimonial dates.",
      "Interés superior del menor factors surfaced with supporting citations.",
    ],
  },
  {
    slug: "amparo",
    practiceArea: "Amparo",
    title: "Amparo directo — cuestiones probatorias y constitucionales",
    summary: "Reconstruction of procedural history across the demanda de amparo, actas de audiencia, the informe justificado, and the réplica.",
    highlights: [
      "Procedural chronology extracted for the antecedentes section.",
      "Definitividad analysis anchored to citations from the expediente.",
      "Conceptos de violación drafted with record cites and doctrinal framing.",
    ],
  },
  {
    slug: "constitucional",
    practiceArea: "Derecho Constitucional / Derechos Humanos",
    title: "Uso excesivo de la fuerza y responsabilidad de la autoridad",
    summary: "Article 1 CPEUM analysis with officer-statement clustering across the informe policial, the internal bitácora de asuntos internos, and the declaración ministerial.",
    highlights: [
      "Cross-witness contradictions between the bitácora de asuntos internos and the declaración ministerial.",
      "Institutional-liability theory outlined with citations to the internal complaint history.",
      "Reparación del daño framework tied to medical records and witness accounts.",
    ],
  },
  {
    slug: "fiscal",
    practiceArea: "Derecho Fiscal",
    title: "Resolución determinante y juicio de nulidad ante el TFJA",
    summary: "Reconciliation of the acta final de visita, bank statements, and correspondence with the contador público for a juicio de nulidad.",
    highlights: [
      "Deposit reconciliation tied to CFDI-level bank records.",
      "Home-office and vehicle expense substantiation cross-referenced with supporting logs.",
      "Recurso de revocación determination integrated into the demanda's factual reconstruction.",
    ],
  },
  {
    slug: "mercantil",
    practiceArea: "Derecho Mercantil",
    title: "Disputa contractual con reconvención",
    summary: "Compraventa mercantil contract, payment ledger, email thread, and an independent inspection reconciled for a breach-and-reconvención analysis.",
    highlights: [
      "Payment-ledger analysis grounded in the underlying accounting records.",
      "Inspection report cross-referenced against the contract's deliverables.",
      "Reconvención theory outlined with responsive citations.",
    ],
  },
];

export const Route = createFileRoute("/resources")({
  head: () => {
    const url = `${CANONICAL_BASE}/resources`;
    const desc = "Redacted sample reports across Mexican practice areas — penal, civil, laboral, familiar, amparo, derechos humanos, fiscal, and mercantil.";
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
