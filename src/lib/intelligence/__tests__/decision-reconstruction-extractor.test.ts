// Regression tests for Phase 3's decision-reconstruction extraction pass
// (decision-reconstruction-extractor.server.ts). callGroq and
// resolveProviderKeys are mocked (same convention as case-state-
// reconciliation.test.ts) so the LLM output is deterministic; everything
// downstream of that — quote verification against the real corpus,
// judicial-hierarchy normalization, and deterministic citation derivation
// — is exercised for real.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/groq.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/groq.server")>();
  return { ...actual, callGroq: vi.fn() };
});
vi.mock("@/lib/ai-key-router.server", () => ({
  resolveProviderKeys: vi.fn().mockResolvedValue({ keys: ["fake-key"] }),
}));

import { callGroq } from "@/lib/groq.server";

const HOLDING_QUOTE =
  "este Tribunal Colegiado determina que el acto reclamado viola el derecho de audiencia previa";
const ARGUMENT_QUOTE =
  "el quejoso sostiene que la autoridad responsable omitió fundar y motivar debidamente su resolución";
const STATUTE_TEXT =
  "conforme al Artículo 14 de la Constitución Política de los Estados Unidos Mexicanos";

function makeFakeDb(inserts: { table: string; row: Record<string, unknown> }[]) {
  const docText = `${HOLDING_QUOTE}. ${ARGUMENT_QUOTE}. ${STATUTE_TEXT}.`;
  return {
    from(table: string) {
      return {
        select(_cols: string) {
          const chain = {
            eq: () => chain,
            order: () => chain,
            or: () => chain,
            limit: () => Promise.resolve({ data: [], error: null }),
            maybeSingle: () => {
              if (table === "cases") {
                return Promise.resolve({ data: { created_at: "2020-01-01" }, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            },
            then: (resolve: (v: unknown) => void) => {
              if (table === "documents") {
                resolve({
                  data: [{ id: "doc-1", filename: "sentencia.pdf", extracted_text: docText }],
                  error: null,
                });
                return;
              }
              resolve({ data: [], error: null });
            },
          };
          return chain;
        },
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return {
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: "row-1" }, error: null }),
            }),
          };
        },
      };
    },
  };
}

beforeEach(() => {
  vi.mocked(callGroq).mockReset();
});

describe("buildDecisionReconstruction", () => {
  it("marks a court holding PRESENT with a verified quote, and downgrades a holding wrongly attributed to a party", async () => {
    vi.mocked(callGroq).mockResolvedValue({
      text: JSON.stringify({
        court_holding: [
          {
            text: "El acto reclamado viola el derecho de audiencia previa",
            speaker_role: "tribunal_colegiado",
            proposition_type: "holding",
            adoption_status: "adopted",
            quote: HOLDING_QUOTE,
          },
          {
            // Same content, but wrongly attributed to a party — must be
            // downgraded to "argument", never persisted as a court holding.
            text: "El acto reclamado viola el derecho de audiencia previa",
            speaker_role: "quejoso",
            proposition_type: "holding",
            adoption_status: "adopted",
            quote: HOLDING_QUOTE,
          },
        ],
      }),
      model: "test-model",
    } as never);

    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const { buildDecisionReconstruction } =
      await import("@/lib/intelligence/decision-reconstruction-extractor.server");
    const result = await buildDecisionReconstruction(
      makeFakeDb(inserts) as never,
      "case-1",
      "user-1",
    );

    expect(result).not.toBeNull();
    expect(result!.court_holding).toHaveLength(2);
    expect(result!.court_holding[0].status).toBe("PRESENT");
    expect(result!.court_holding[0].value?.speaker_role).toBe("tribunal_colegiado");
    expect(result!.court_holding[0].value?.proposition_type).toBe("holding");
    // Downgraded, not dropped.
    expect(result!.court_holding[1].value?.speaker_role).toBe("quejoso");
    expect(result!.court_holding[1].value?.proposition_type).toBe("argument");

    const inserted = inserts.find((i) => i.table === "case_decision_reconstructions");
    expect(inserted).toBeDefined();
  });

  it("marks an item NOT_FOUND_IN_CORPUS when its quote does not verify against the documents", async () => {
    vi.mocked(callGroq).mockResolvedValue({
      text: JSON.stringify({
        material_facts: [
          {
            text: "Un hecho inventado",
            quote: "esta frase no existe en ningún documento del expediente",
          },
        ],
      }),
      model: "test-model",
    } as never);

    const { buildDecisionReconstruction } =
      await import("@/lib/intelligence/decision-reconstruction-extractor.server");
    const result = await buildDecisionReconstruction(makeFakeDb([]) as never, "case-1", "user-1");

    expect(result).not.toBeNull();
    expect(result!.material_facts).toHaveLength(1);
    expect(result!.material_facts[0].status).toBe("NOT_FOUND_IN_CORPUS");
    expect(result!.material_facts[0].value).toBeNull();
  });

  it("derives legal-authority citations deterministically from verified text, not from a model-supplied citation string", async () => {
    vi.mocked(callGroq).mockResolvedValue({
      text: JSON.stringify({
        court_reasoning: [
          {
            text: "El tribunal fundamenta su determinación en el artículo 14 constitucional",
            speaker_role: "tribunal_colegiado",
            proposition_type: "procedural_fact",
            quote: STATUTE_TEXT,
          },
        ],
      }),
      model: "test-model",
    } as never);

    const { buildDecisionReconstruction } =
      await import("@/lib/intelligence/decision-reconstruction-extractor.server");
    const result = await buildDecisionReconstruction(makeFakeDb([]) as never, "case-1", "user-1");

    expect(result).not.toBeNull();
    expect(result!.court_reasoning).toHaveLength(1);
    expect(result!.court_reasoning[0].status).toBe("PRESENT");
    // The citation was independently re-extracted and verified — never
    // trusted from a model-authored field.
    expect(result!.applicable_legal_authorities.length).toBeGreaterThan(0);
    expect(result!.applicable_legal_authorities[0].value?.article_number).toBe("14");
  });

  // Regression test for a real production bug on ADR-4640-2017-180212:
  // pipeline-runner.server.ts's caller gates buildDecisionReconstruction on
  // "does a case_decision_reconstructions row already exist for this
  // case" — with no client-side timeout and no failure marker, a call that
  // fails (or hangs past a platform-level kill timeout) never persists
  // anything, so the check stays false forever and this expensive AI call
  // re-fires on EVERY subsequent resume tick for a strict/completed-case
  // audit case, competing with the rest of that tick's time budget. Fixed
  // by recordFailedAttempt: a failed call must still leave a row behind so
  // the gate stops retrying on every tick.
  it("leaves a failed-attempt marker row behind when the AI call itself fails, so the caller's existence-check stops retrying on every tick", async () => {
    vi.mocked(callGroq).mockRejectedValue(new Error("simulated timeout"));

    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const { buildDecisionReconstruction } =
      await import("@/lib/intelligence/decision-reconstruction-extractor.server");
    const result = await buildDecisionReconstruction(makeFakeDb(inserts) as never, "case-1", "user-1");

    expect(result).toBeNull();
    const marker = inserts.find((i) => i.table === "case_decision_reconstructions");
    expect(marker).toBeDefined();
    expect(marker!.row.matter_identity_status).toBe("extraction_failed");
    expect(marker!.row.reconstruction).toEqual({});

    // The call is bounded by our own timeout signal — a slow/hanging
    // provider response can never block a resume tick indefinitely.
    const callArgs = vi.mocked(callGroq).mock.calls[0]?.[0] as { signal?: AbortSignal } | undefined;
    expect(callArgs?.signal).toBeInstanceOf(AbortSignal);
  });

  it("leaves a failed-attempt marker row behind when the model's JSON cannot be parsed", async () => {
    vi.mocked(callGroq).mockResolvedValue({
      text: "not valid json at all {{{",
      model: "test-model",
    } as never);

    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const { buildDecisionReconstruction } =
      await import("@/lib/intelligence/decision-reconstruction-extractor.server");
    const result = await buildDecisionReconstruction(makeFakeDb(inserts) as never, "case-1", "user-1");

    expect(result).toBeNull();
    const marker = inserts.find((i) => i.table === "case_decision_reconstructions");
    expect(marker).toBeDefined();
    expect(marker!.row.matter_identity_status).toBe("extraction_failed");
  });

  it("returns null when the case has no documents", async () => {
    const emptyDb = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ then: (r: (v: unknown) => void) => r({ data: [], error: null }) }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      },
    };
    const { buildDecisionReconstruction } =
      await import("@/lib/intelligence/decision-reconstruction-extractor.server");
    const result = await buildDecisionReconstruction(emptyDb as never, "case-1", "user-1");
    expect(result).toBeNull();
    expect(callGroq).not.toHaveBeenCalled();
  });
});
