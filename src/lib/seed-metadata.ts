// Structured court-file metadata carried by every seeded benchmark corpus.
//
// Each corpus under tests/fixtures/corpora/<area>/ ships a `_manifest.json`
// that follows this shape. The seeder copies it verbatim into
// cases.matter_metadata so an attorney opening a seeded matter sees a
// complete, internally consistent Mexican expediente — expediente number,
// juzgado, judge, parties, counsel, procedural stage, hearings and
// authorities — without editing a single field.
//
// All names, addresses, folios and authorities are FICTIONAL.

export type MatterParty = {
  role: string; // "Actora", "Imputado", "Quejoso", "Testigo", "Perito"…
  name: string;
  detail?: string; // capacity, employer, address, cédula, etc.
};

export type SeedMatterMetadata = {
  /** Case title as it should appear in the dashboard. */
  title: string;
  /** Attorney-style intake summary (Spanish). */
  description: string;
  /** Canonical Mexican materia key (see mx-case-classifier). */
  caseType: string;
  practiceArea: string;
  subPracticeArea?: string;
  /** Internal matter number used by the firm. */
  internalMatterNumber: string;
  /** Court/agency file number — expediente, toca, carpeta, amparo… */
  courtCaseNumber: string;
  relatedFileNumbers?: string[];
  jurisdiction: string; // "Estado de Chiapas", "Federal"…
  fuero: "comun" | "federal";
  state: string;
  municipality: string;
  judicialDistrict: string;
  courtName: string;
  courtType: string;
  competentAuthority: string;
  assignedJudge: string;
  courtClerk?: string;
  filingDate: string; // ISO date
  proceduralStage: string;
  nextHearingDate?: string | null;
  parties: MatterParty[];
  attorneysOfRecord: string[];
  opposingCounsel: string[];
  caseStatus: string;
  priority: "baja" | "media" | "alta" | "critica";
  riskLevel: "bajo" | "medio" | "alto" | "critico";
  estimatedValueMxn?: number | null;
  legalAuthorities: string[];
  /** Always true for bundled corpora — fictional data for testing. */
  fictional: true;
};

/** Narrow an unknown JSON blob to SeedMatterMetadata (shallow validation). */
export function parseSeedManifest(raw: unknown): SeedMatterMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<SeedMatterMetadata>;
  if (!m.title || !m.description || !m.courtCaseNumber || !m.caseType) return null;
  return m as SeedMatterMetadata;
}
