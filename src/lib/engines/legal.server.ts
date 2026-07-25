/**
 * Legal Intelligence Engine.
 *
 * Identifies legal topics and points to relevant Mexican authorities (leyes,
 * códigos, jurisprudencia). CRITICAL: never fabricates authorities — every
 * proposed citation is either matched against `legal_authorities` at persist
 * time, or stored as an unverified suggestion for human review.
 */
import { getAIProvider } from "../ai/provider.server";
import { mexicoLock } from "./mexico-lock";
import type {
  EngineInput,
  EngineOutput,
  IntelligenceEngine,
  KnowledgeDraft,
} from "./types";

type ModelResult = {
  topics: { ref: string; title: string; body?: string }[];
  suggested_authorities: {
    ref: string;
    citation: string;
    authority_type: "law" | "code" | "article" | "regulation" | "jurisprudencia" | "tesis" | "decision" | "concept";
    body?: string;
    verified?: false;
    linked_topic_refs?: string[];
  }[];
  recommendations?: string[];
};

const SYSTEM_ES = `Eres el motor "Legal Intelligence" de Nyrava Intelligence México.
Analizas un asunto legal mexicano e identificas temas jurídicos y autoridades relevantes.
Reglas críticas:
- NUNCA inventes citas ni autoridades. Si no estás seguro, marca "verified": false y describe la autoridad de forma genérica.
- Prefiere referencias a normativa federal mexicana: CPEUM, códigos federales, LFT, LFPDPPP, jurisprudencia SCJN, DOF.
- Idioma: español, precisión jurídica.
- Devuelve ÚNICAMENTE JSON válido.`;

const SYSTEM_EN = `You are the "Legal Intelligence" engine of Nyrava Intelligence México.
Never fabricate citations. Prefer Mexican federal sources. Respond in English. JSON only.`;

const SCHEMA_HINT = `{
  "topics": [ { "ref": "topic-1", "title": "...", "body": "..." } ],
  "suggested_authorities": [
    { "ref": "auth-1", "citation": "Art. 123 CPEUM", "authority_type": "article", "body": "...", "verified": false, "linked_topic_refs": ["topic-1"] }
  ],
  "recommendations": [ "..." ]
}`;

function buildPrompt(input: EngineInput): string {
  const { matter, knowledge } = input.context;
  const facts = knowledge
    .filter((k) => k.kind === "fact" || k.kind === "summary" || k.kind === "issue")
    .slice(0, 30)
    .map((k) => `- [${k.kind}] ${k.title}${k.body ? ": " + k.body : ""}`)
    .join("\n");
  return `ASUNTO: ${matter.title} · Tipo: ${matter.matter_type} · Jurisdicción: ${matter.jurisdiction ?? "-"}
DESCRIPCIÓN: ${matter.description ?? "-"}

CONOCIMIENTO DEL ASUNTO:
${facts || "(ninguno)"}

Identifica los temas jurídicos aplicables y sugiere autoridades relevantes (leyes, artículos, jurisprudencia).
Todas las autoridades sugeridas deben marcarse "verified": false; el sistema las validará contra la base "legal_authorities".

Devuelve JSON:
${SCHEMA_HINT}`;
}

export const legalEngine: IntelligenceEngine = {
  code: "legal",
  label: "Legal Intelligence",
  async run(input: EngineInput): Promise<EngineOutput> {
    const provider = getAIProvider();
    const { content, model, tokens_used } = await provider.chatJSON<ModelResult>(
      [
        { role: "system", content: input.language === "en" ? SYSTEM_EN : SYSTEM_ES },
        { role: "user", content: buildPrompt(input) },
      ],
      { temperature: 0.15 },
    );

    const knowledge: KnowledgeDraft[] = [];
    (content.topics ?? []).forEach((t) =>
      knowledge.push({
        ref: t.ref,
        kind: "issue",
        title: t.title,
        body: t.body,
        language: input.language,
        confidence: 0.55,
      }),
    );
    (content.suggested_authorities ?? []).forEach((a) =>
      knowledge.push({
        ref: a.ref,
        kind: "authority",
        title: a.citation,
        body: a.body,
        language: input.language,
        data: {
          authority_type: a.authority_type,
          verified: false,
          linked_topic_refs: a.linked_topic_refs ?? [],
        },
        confidence: 0.4,
      }),
    );

    const relationships = (content.suggested_authorities ?? []).flatMap((a) =>
      (a.linked_topic_refs ?? []).map((tref) => ({
        subject_ref: a.ref,
        object_ref: tref,
        relation: "supports_topic",
      })),
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
