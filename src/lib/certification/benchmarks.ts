// Production Certification — benchmark fixture set.
// Version-controlled. Each entry is a synthetic case profile spanning the
// matter types Nyrava must handle. The runner uses these to drive pure-helper
// certification (ESS, classifier, render gates) without requiring live LLM
// calls or real client documents.

export type CaseProfile = {
  id: string;
  case_type:
    | "criminal"
    | "civil"
    | "appellate"
    | "family"
    | "contracts"
    | "multi_doc"
    | "ocr_heavy"
    | "poor_scan"
    | "mixed";
  description: string;
  documentCount: number;
  pageCount: number;
  extractedChars: number;
  factCount: number;
  contradictionCount: number;
  corroboratedCount: number;
  /** Expected ESS bin (frozen — drift here is a regression). */
  expectedBin: "minimal" | "low" | "medium" | "high";
  /** Whether quantitative scores must be allowed for this corpus. */
  expectScores: boolean;
  /** Whether motion generation must be allowed. */
  expectMotions: boolean;
};

export const BENCHMARKS: CaseProfile[] = [
  {
    id: "B01-criminal-suppression",
    case_type: "criminal",
    description: "Single defendant, traffic stop, body-cam + police report.",
    documentCount: 6, pageCount: 48, extractedChars: 38_000,
    factCount: 22, contradictionCount: 3, corroboratedCount: 5,
    expectedBin: "medium", expectScores: true, expectMotions: true,
  },
  {
    id: "B02-civil-breach",
    case_type: "civil",
    description: "Commercial contract dispute with 3 declarations.",
    documentCount: 9, pageCount: 120, extractedChars: 72_000,
    factCount: 31, contradictionCount: 2, corroboratedCount: 8,
    expectedBin: "high", expectScores: true, expectMotions: true,
  },
  {
    id: "B03-appellate-brief",
    case_type: "appellate",
    description: "Compact appellate record, dense citations, no exhibits.",
    documentCount: 3, pageCount: 42, extractedChars: 24_000,
    factCount: 14, contradictionCount: 1, corroboratedCount: 2,
    expectedBin: "medium", expectScores: true, expectMotions: true,
  },
  {
    id: "B04-family-custody",
    case_type: "family",
    description: "Custody, conflicting parent declarations, two orders.",
    documentCount: 7, pageCount: 60, extractedChars: 41_000,
    factCount: 18, contradictionCount: 4, corroboratedCount: 4,
    expectedBin: "medium", expectScores: true, expectMotions: true,
  },
  {
    id: "B05-contracts-msa",
    case_type: "contracts",
    description: "Master agreement, two amendments, no disputes yet.",
    documentCount: 4, pageCount: 88, extractedChars: 60_000,
    factCount: 12, contradictionCount: 0, corroboratedCount: 3,
    expectedBin: "medium", expectScores: true, expectMotions: true,
  },
  {
    id: "B06-multi-doc-litigation",
    case_type: "multi_doc",
    description: "Large discovery production, 40+ documents.",
    documentCount: 42, pageCount: 1200, extractedChars: 580_000,
    factCount: 140, contradictionCount: 12, corroboratedCount: 38,
    expectedBin: "high", expectScores: true, expectMotions: true,
  },
  {
    id: "B07-ocr-heavy",
    case_type: "ocr_heavy",
    description: "Scanned police records, bates-stamped, OCR full pipeline.",
    documentCount: 18, pageCount: 520, extractedChars: 210_000,
    factCount: 60, contradictionCount: 5, corroboratedCount: 15,
    expectedBin: "high", expectScores: true, expectMotions: true,
  },
  {
    id: "B08-poor-scan",
    case_type: "poor_scan",
    description: "Faxed, low-quality scans — short usable extraction.",
    documentCount: 5, pageCount: 30, extractedChars: 850,
    factCount: 2, contradictionCount: 0, corroboratedCount: 0,
    expectedBin: "minimal", expectScores: false, expectMotions: false,
  },
  {
    id: "B09-mixed-pdf-docx",
    case_type: "mixed",
    description: "Mixed native PDF + DOCX pleadings + scanned exhibits.",
    documentCount: 11, pageCount: 180, extractedChars: 95_000,
    factCount: 36, contradictionCount: 3, corroboratedCount: 9,
    expectedBin: "high", expectScores: true, expectMotions: true,
  },
  {
    id: "B10-sparse-intake",
    case_type: "civil",
    description: "Initial intake — one short narrative, no exhibits.",
    documentCount: 1, pageCount: 2, extractedChars: 600,
    factCount: 1, contradictionCount: 0, corroboratedCount: 0,
    expectedBin: "minimal", expectScores: false, expectMotions: false,
  },
];

export const BENCHMARK_VERSION = "cert-v1.0.0";
