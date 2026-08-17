// Cross-Examination Impeachment Grounding — pure module (no I/O; callers
// pass in the real corpus already built from document extracted_text).
//
// WHY: cross_examination.lines[].impeachment_with is a specific factual
// claim ("declared X, contradicting their earlier statement that Y") backed
// by an optional citation ({doc_n, page, quote}). Unlike the rest of
// cross_examination — the interview questions themselves, which
// legitimately need no citation (pipeline.server.ts: "questions don't need
// quote-verification") — impeachment_with is an assertion about what the
// record actually shows, exactly the shape verifyAndLabel already
// quote-verifies for contradictions/motion_opportunities/constitutional_issues
// elsewhere in the same file. It was missed here because verifyAndLabel's
// generic .citations[]/.evidence_refs[] sweep only reaches fields on the
// TOP-LEVEL item it's called with — cross_examination's citation lives two
// levels deeper (item.lines[].citation), which that sweep never reaches.
//
// SCOPE: only impeachment_with + its citation are gated. topic/questions are
// deliberately left untouched — they are open questions for the deposing
// attorney to ask, not claims about the record.
import type { GroundingCorpus } from "./grounding.server";

export type CrossExaminationLine = {
  topic?: unknown;
  questions?: unknown;
  impeachment_with?: unknown;
  citation?: { doc_n?: unknown; page?: unknown; quote?: unknown } | null;
  [key: string]: unknown;
};

export type CrossExaminationItem = {
  witness?: unknown;
  objective?: unknown;
  lines?: CrossExaminationLine[];
  [key: string]: unknown;
};

/**
 * Nulls out impeachment_with (and its citation) on every line whose citation
 * quote does not verify against the real corpus. A line with no
 * impeachment_with at all, or whose citation already verifies, is untouched.
 * Never drops the line/topic itself — the questions remain useful either
 * way, and dropping the whole line would also lose an unrelated topic with
 * no impeachment claim attached.
 */
export function gateCrossExaminationImpeachment(
  items: CrossExaminationItem[],
  verifyQuote: (quote: string, corpus: GroundingCorpus) => boolean,
  corpus: GroundingCorpus,
): { items: CrossExaminationItem[]; droppedCount: number } {
  let droppedCount = 0;
  const out = items.map((item) => {
    if (!Array.isArray(item.lines)) return item;
    const lines = item.lines.map((line) => {
      const impeach = line?.impeachment_with;
      if (typeof impeach !== "string" || !impeach.trim()) return line;
      const quote = line.citation?.quote;
      const verified = typeof quote === "string" && quote.trim().length > 0 && verifyQuote(quote, corpus);
      if (verified) return line;
      droppedCount++;
      return { ...line, impeachment_with: null, citation: null };
    });
    return { ...item, lines };
  });
  return { items: out, droppedCount };
}
