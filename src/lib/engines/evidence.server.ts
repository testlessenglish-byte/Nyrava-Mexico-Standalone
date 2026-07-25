/**
 * Evidence Intelligence Engine.
 *
 * Classifies evidence items, links them to documents and events, and surfaces
 * missing evidence + contradictions across the corpus.
 */
import { getAIProvider } from "../ai/provider.server";
import { mexicoLock } from "./mexico-lock";
import type {
  EngineInput,
  EngineOutput,
  IntelligenceEngine,
  KnowledgeDraft,
  RelationshipDraft,
} from "./types";

type ModelResult = {
  evidence: {
    ref: string;
    title: string;
    body?: string;
    evidence_type?: string;
    strength?: "low" | "medium" | "high";
    source_document_id?: string | null;
    supports_issue_refs?: string[];
  }[];
  contradictions: {
    ref: string;
    title: string;
    body?: string;
    evidence_refs?: string[];
  }[];
  missing_evidence: { ref: string; title: string; body?: string }[];
  recommendations?: string[];
};

const SYSTEM_ES = `Eres el motor "Evidence Intelligence" de Nyrava Intelligence México.
Identifica evidencias, contradicciones y evidencia faltante en el asunto.
Reglas: no inventes; ancla cada evidencia a un document_id cuando exista; JSON válido; español.`;

const SYSTEM_EN = `You are the "Evidence Intelligence" engine. Identify evidence, contradictions, and gaps. Never invent. JSON only.`;

const SCHEMA_HINT = `{
  "evidence": [ { "ref": "ev-1", "title": "...", "body": "...", "evidence_type": "documental|testimonial|pericial|material", "strength": "low|medium|high", "source_document_id": "uuid|null", "supports_issue_refs": ["issue-1"] } ],
  "contradictions": [ { "ref": "con-1", "title": "...", "body": "...", "evidence_refs": ["ev-1","ev-2"] } ],
  "missing_evidence": [ { "ref": "miss-1", "title": "...", "body": "..." } ],
  "recommendations": [ "..." ]
}`;

function buildPrompt(input: EngineInput): string {
  const { documents, knowledge, matter } = input.context;
  const docs = documents
    .map((d) => `- id:${d.id} · ${d.title} (${d.media_kind ?? "?"})${d.text_content ? "\n  " + d.text_content.slice(0, 1500) : ""}`)
    .join("\n");
  const issues = knowledge
    .filter((k) => k.kind === "issue")
    .map((k) => `- ${k.title}`)
    .join("\n");
  return `ASUNTO: ${matter.title} · ${matter.matter_type}
DOCUMENTOS:
${docs || "(ninguno)"}
TEMAS JURÍDICOS:
${issues || "(ninguno)"}

Analiza la evidencia disponible. Devuelve JSON:
${SCHEMA_HINT}`;
}

export const evidenceEngine: IntelligenceEngine = {
  code: "evidence",
  label: "Evidence Intelligence",
  async run(input: EngineInput): Promise<EngineOutput> {
    const provider = getAIProvider();
    const { content, model, tokens_used } = await provider.chatJSON<ModelResult>(
      [
        { role: "system", content: input.language === "en" ? SYSTEM_EN : SYSTEM_ES },
        { role: "user", content: buildPrompt(input) },
      ],
      { temperature: 0.2 },
    );

    const knowledge: KnowledgeDraft[] = [];
    const relationships: RelationshipDraft[] = [];

    (content.evidence ?? []).forEach((e) => {
      knowledge.push({
        ref: e.ref,
        kind: "evidence",
        title: e.title,
        body: e.body,
        language: input.language,
        source_document_id: e.source_document_id ?? null,
        data: { evidence_type: e.evidence_type ?? null, strength: e.strength ?? null },
        confidence: e.strength === "high" ? 0.8 : e.strength === "medium" ? 0.55 : 0.35,
      });
      (e.supports_issue_refs ?? []).forEach((iref) =>
        relationships.push({ subject_ref: e.ref, object_ref: iref, relation: "supports_issue" }),
      );
    });
    (content.contradictions ?? []).forEach((c) => {
      knowledge.push({
        ref: c.ref,
        kind: "contradiction",
        title: c.title,
        body: c.body,
        language: input.language,
        confidence: 0.5,
      });
      (c.evidence_refs ?? []).forEach((er) =>
        relationships.push({ subject_ref: c.ref, object_ref: er, relation: "contradicts" }),
      );
    });
    (content.missing_evidence ?? []).forEach((m) =>
      knowledge.push({
        ref: m.ref,
        kind: "recommendation",
        title: m.title,
        body: m.body,
        language: input.language,
        data: { category: "missing_evidence" },
        confidence: 0.4,
      }),
    );

    return {
      knowledge,
      relationships,
      recommendations: content.recommendations ?? [],
      model,
      tokens_used,
    };
  },
};
