// Regression tests for the two states of the Phase 1 item #4 upgrade
// (findings.server.ts's classifyRemedyAuthority) that procedural-type-
// gate.test.ts's stub can't reach: AUTHORITY_VERIFIED and
// AUTHORITY_INAPPLICABLE. Both require an actual matched legal_authorities /
// legal_articles row PLUS a caseDate (without a caseDate, authorityValidity()
// always returns "unknown_date" and temporal_status can never resolve to
// "in_force" — see the comment on classifyRemedyAuthority), so this file
// builds a fuller fake db that answers all three query shapes
// (cases/legal_authorities/legal_articles) with configurable rows.
import { describe, it, expect } from "vitest";
import {
  enforceRemedyLegalAuthorityGate,
  normalizeLlmFindings,
} from "@/lib/intelligence/findings.server";

type Article = {
  id: string;
  article_number: string;
  body: string | null;
  effective_at: string | null;
  repealed_at: string | null;
  verification_status: string;
};

function makeCitationDb(opts: { createdAt: string | null; article: Article | null }) {
  const authority = {
    id: "authority-1",
    title: "Ley de Amparo",
    short_title: "Ley de Amparo",
    citation: "LA",
    jurisdiction: "federal",
  };
  return {
    from: (table: string) => {
      if (table === "cases") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _id: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: { created_at: opts.createdAt }, error: null }),
            }),
          }),
        };
      }
      if (table === "legal_authorities") {
        return {
          select: (_cols: string) => ({
            or: (_filter: string) => ({
              limit: (_n: number) => Promise.resolve({ data: [authority], error: null }),
            }),
          }),
        };
      }
      if (table === "legal_articles") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              eq: (_col2: string, _val2: string) => ({
                maybeSingle: () => Promise.resolve({ data: opts.article, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in test stub: ${table}`);
    },
  };
}

function remedyRows() {
  return normalizeLlmFindings({
    caseId: "case-1",
    userId: "user-1",
    sourceModule: "agent:ways_out_analysis",
    defaultCategory: "ways_out_analysis",
    items: [
      {
        title: "Posible recurso de reclamación contra el acuerdo de trámite.",
        description: "Posible recurso de reclamación contra el acuerdo de trámite.",
        remedy_type: "recurso_de_reclamacion",
        evidence_refs: [{ doc_n: "1", quote: "acuerdo de trámite impugnado" }],
        audit_classification: "POTENTIAL_ISSUE",
        legal_authority: "Artículo 104 de la Ley de Amparo (recurso de reclamación).",
      },
    ],
  });
}

describe("enforceRemedyLegalAuthorityGate: AUTHORITY_VERIFIED / AUTHORITY_INAPPLICABLE", () => {
  it("marks AUTHORITY_VERIFIED and does not downgrade when the citation is matched, source-confirmed, and in force on the case date", async () => {
    const db = makeCitationDb({
      createdAt: "2020-06-01",
      article: {
        id: "article-1",
        article_number: "104",
        body: "Texto del artículo 104.",
        effective_at: "2010-01-01",
        repealed_at: null,
        verification_status: "verified",
      },
    });
    const gated = await enforceRemedyLegalAuthorityGate(db as never, remedyRows(), "es");
    expect(gated[0].audit_classification).toBe("POTENTIAL_ISSUE");
    expect(gated[0].description).not.toMatch(/REQUIERE VERIFICACIÓN/);
    expect((gated[0].metadata as Record<string, unknown>).remedy_authority_status).toBe(
      "AUTHORITY_VERIFIED",
    );
  });

  it("downgrades to EVIDENCE_GAP as AUTHORITY_INAPPLICABLE when the matched article was repealed before the case's relevant date", async () => {
    const db = makeCitationDb({
      createdAt: "2020-06-01",
      article: {
        id: "article-1",
        article_number: "104",
        body: "Texto del artículo 104 (versión histórica).",
        effective_at: "2000-01-01",
        repealed_at: "2015-01-01",
        verification_status: "verified",
      },
    });
    const gated = await enforceRemedyLegalAuthorityGate(db as never, remedyRows(), "es");
    expect(gated[0].audit_classification).toBe("EVIDENCE_GAP");
    expect(gated[0].description).toMatch(/REQUIERE VERIFICACIÓN/);
    expect((gated[0].metadata as Record<string, unknown>).remedy_authority_status).toBe(
      "AUTHORITY_INAPPLICABLE",
    );
  });

  it("does not downgrade AUTHORITY_NOT_VERIFIED when the article exists but the source is not yet human-confirmed", async () => {
    const db = makeCitationDb({
      createdAt: "2020-06-01",
      article: {
        id: "article-1",
        article_number: "104",
        body: "Texto del artículo 104.",
        effective_at: "2010-01-01",
        repealed_at: null,
        verification_status: "pending",
      },
    });
    const gated = await enforceRemedyLegalAuthorityGate(db as never, remedyRows(), "es");
    expect(gated[0].audit_classification).toBe("POTENTIAL_ISSUE");
    expect((gated[0].metadata as Record<string, unknown>).remedy_authority_status).toBe(
      "AUTHORITY_NOT_VERIFIED",
    );
  });
});
