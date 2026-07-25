/**
 * Case Intelligence Engine.
 *
 * Goal: understand the whole legal matter. Produces a matter summary, key
 * facts, parties, dates, timeline events, and initial legal issues, plus
 * relationships between them (party ↔ event, event ↔ document, etc.).
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
  summary: { title: string; body: string };
  facts: { ref: string; title: string; body?: string; source_document_id?: string | null }[];
  parties: { ref: string; name: string; role?: string }[];
  dates: { ref: string; label: string; date?: string; source_document_id?: string | null }[];
  timeline: {
    ref: string;
    label: string;
    date?: string;
    body?: string;
    party_refs?: string[];
    document_id?: string | null;
  }[];
  issues: { ref: string; title: string; body?: string }[];
  recommendations?: string[];
};

const SYSTEM_ES = `Eres el motor "Case Intelligence" de Nyrava Intelligence México.
Analiza un asunto legal mexicano y devuelves conocimiento ESTRUCTURADO en JSON.
Reglas:
- Nunca inventes hechos ni fechas: si un dato no aparece en el asunto o documentos, omítelo.
- Cada elemento debe llevar un "ref" único (kebab-case corto) que uses para relacionarlos.
- Idioma: responde en español, con precisión jurídica.
- Devuelve ÚNICAMENTE JSON válido con la estructura solicitada.`;

const SYSTEM_EN = `You are the "Case Intelligence" engine of Nyrava Intelligence México.
Analyze a Mexican legal matter and return STRUCTURED JSON knowledge.
Rules: never invent facts; give each item a unique short kebab-case "ref"; respond in English; JSON only.`;

const SCHEMA_HINT = `{
  "summary": { "title": "...", "body": "..." },
  "facts": [ { "ref": "fact-1", "title": "...", "body": "...", "source_document_id": "uuid|null" } ],
  "parties": [ { "ref": "party-actor", "name": "...", "role": "actor|demandado|testigo|..." } ],
  "dates": [ { "ref": "date-hechos", "label": "...", "date": "YYYY-MM-DD|null" } ],
  "timeline": [ { "ref": "ev-1", "label": "...", "date": "YYYY-MM-DD|null", "body": "...", "party_refs": ["party-actor"], "document_id": "uuid|null" } ],
  "issues": [ { "ref": "issue-1", "title": "...", "body": "..." } ],
  "recommendations": [ "..." ]
}`;

function buildPrompt(input: EngineInput): string {
  const { matter, documents, knowledge } = input.context;
  const docSummaries = documents
    .map((d) => {
      const text = (d.text_content ?? "").slice(0, 6000);
      return `- id:${d.id} title:${d.title} kind:${d.media_kind ?? "?"}\n${text ? "  TEXT:\n" + text : "  (sin texto extraído)"}`;
    })
    .join("\n");
  const prior = knowledge.slice(0, 40).map((k) => `- [${k.kind}] ${k.title}`).join("\n");

  return `ASUNTO:
- Título: ${matter.title}
- Tipo: ${matter.matter_type}
- Cliente: ${matter.client_name ?? "-"}
- Jurisdicción: ${matter.jurisdiction ?? "-"}
- Descripción: ${matter.description ?? "-"}

DOCUMENTOS (${documents.length}):
${docSummaries || "(ninguno)"}

CONOCIMIENTO PREVIO:
${prior || "(ninguno)"}

Devuelve JSON exactamente con esta forma:
${SCHEMA_HINT}`;
}

export const caseEngine: IntelligenceEngine = {
  code: "case",
  label: "Case Intelligence",
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
    const push = (k: KnowledgeDraft) => {
      knowledge.push({ ...k, language: input.language });
    };

    push({
      ref: "summary",
      kind: "summary",
      title: content.summary?.title ?? "Resumen del asunto",
      body: content.summary?.body ?? "",
      confidence: 0.7,
    });

    (content.facts ?? []).forEach((f) =>
      push({
        ref: f.ref,
        kind: "fact",
        title: f.title,
        body: f.body,
        source_document_id: f.source_document_id ?? null,
        confidence: 0.6,
      }),
    );
    (content.parties ?? []).forEach((p) =>
      push({
        ref: p.ref,
        kind: "party",
        title: p.name,
        data: { role: p.role },
        confidence: 0.7,
      }),
    );
    (content.dates ?? []).forEach((d) =>
      push({
        ref: d.ref,
        kind: "date",
        title: d.label,
        data: { date: d.date ?? null },
        confidence: 0.6,
      }),
    );
    (content.timeline ?? []).forEach((e) => {
      push({
        ref: e.ref,
        kind: "timeline_event",
        title: e.label,
        body: e.body,
        data: { date: e.date ?? null },
        source_document_id: e.document_id ?? null,
        confidence: 0.6,
      });
      (e.party_refs ?? []).forEach((pr) =>
        relationships.push({ subject_ref: e.ref, object_ref: pr, relation: "involves_party" }),
      );
    });
    (content.issues ?? []).forEach((i) =>
      push({ ref: i.ref, kind: "issue", title: i.title, body: i.body, confidence: 0.55 }),
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
