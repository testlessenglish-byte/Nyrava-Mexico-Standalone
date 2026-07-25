// Multi-agent common API types.
// Shared between server-side orchestrator and client status views.

export type AgentStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "blocked";

export type AgentJson =
  | null
  | string
  | number
  | boolean
  | AgentJson[]
  | { [k: string]: AgentJson };

export interface AgentResult {
  status: AgentStatus;
  confidence: number; // 0..1
  processingTime: number; // ms
  tokensUsed: number;
  outputFile: string; // logical artifact name, e.g. "case_manifest.json"
  errors: string[];
  output?: AgentJson; // JSON-serializable summary persisted to agent_logs.output
}

export interface AgentDefinition {
  key: string; // stable machine key
  index: number; // 1..13 per blueprint
  name: string; // display name
  outputFile: string; // logical artifact filename
  description: string;
}

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  { key: "intake",          index: 1,  name: "Intake & File Manager",   outputFile: "case_manifest.json",     description: "Prepare uploads, detect file types, metadata, deduplicate, assign evidence IDs." },
  { key: "ocr",             index: 2,  name: "OCR & Document Extraction", outputFile: "ocr_output.json",       description: "OCR PDFs/images, transcribe audio/video, preserve pages, tables, signatures." },
  { key: "entities",        index: 3,  name: "Entity Extraction",       outputFile: "entities.json",           description: "Extract people, orgs, dates, money, statutes, witnesses, judges, attorneys, evidence IDs." },
  { key: "timeline",        index: 4,  name: "Timeline Reconstruction", outputFile: "timeline.json",           description: "Build chronological timeline, detect gaps and conflicts." },
  { key: "evidence",        index: 5,  name: "Evidence Analysis",       outputFile: "evidence_analysis.json",  description: "Correlate evidence across all sources, detect missing/duplicate/broken chains." },
  { key: "contradictions",  index: 6,  name: "Contradiction Detection", outputFile: "contradictions.json",     description: "Compare statements and detect contradictions." },
  { key: "legal",           index: 7,  name: "Legal Research",          outputFile: "legal_research.json",     description: "Research statutes, regulations, case law, legal standards." },
  { key: "risk",            index: 8,  name: "Risk Assessment",         outputFile: "risk_analysis.json",      description: "Score risk, evidence strength, procedural issues." },
  { key: "report",          index: 9,  name: "Report Writer",           outputFile: "draft_report.md",         description: "Generate report only from verified outputs." },
  { key: "qa",              index: 10, name: "Quality Assurance",       outputFile: "qa_report.json",          description: "Validate formatting, references, consistency. PASS/FAIL." },
  { key: "judge",           index: 11, name: "Judge Agent",             outputFile: "judge_report.json",       description: "Independent review of logic and evidence. Approve/Reject/Needs Revision." },
  { key: "hallucination",   index: 12, name: "Hallucination Detection", outputFile: "hallucination_report.json", description: "Verify every factual statement against evidence; reject unsupported claims." },
  { key: "orchestrator",    index: 13, name: "Master Orchestrator",     outputFile: "orchestrator_log.json",   description: "Control workflow, retries, provider routing, caching, logging." },
] as const;

export type AgentKey = (typeof AGENT_DEFINITIONS)[number]["key"];
