import { describe, it, expect } from "vitest";

// Mirror of buildCitationAudit's row-partitioning logic. Runs against a fake
// row set so we can lock the supported/quarantined split without hitting DB.
type Row = {
  id: string;
  canonical_finding_id: string | null;
  title: string;
  category: string | null;
  source_document_id: string | null;
  source_page: number | null;
  source_quote: string | null;
  evidence_refs: unknown[];
};

function partition(rows: Row[]) {
  const supported: string[] = [];
  const quarantined: Array<{ id: string; reason: string }> = [];
  for (const r of rows) {
    const hasDoc = typeof r.source_document_id === "string" && r.source_document_id.length > 0;
    const hasQuote = typeof r.source_quote === "string" && r.source_quote.trim().length > 0;
    const hasPage = typeof r.source_page === "number" && r.source_page > 0;
    const hasRefs = Array.isArray(r.evidence_refs) && r.evidence_refs.length > 0;
    const complete = hasDoc && hasQuote && (hasPage || hasRefs);
    if (complete) supported.push(r.id);
    else {
      let reason: string;
      if (!hasDoc && !hasQuote && !hasPage && !hasRefs) reason = "missing_all";
      else if (!hasDoc) reason = "missing_document";
      else if (!hasQuote) reason = "missing_quote";
      else reason = "missing_page_and_refs";
      quarantined.push({ id: r.id, reason });
    }
  }
  return { supported, quarantined };
}

const mkRow = (over: Partial<Row>): Row => ({
  id: "r",
  canonical_finding_id: null,
  title: "t",
  category: null,
  source_document_id: null,
  source_page: null,
  source_quote: null,
  evidence_refs: [],
  ...over,
});

describe("citation audit stage (Priority 0)", () => {
  it("renders complete findings, quarantines incomplete ones, never blocks", () => {
    const rows: Row[] = [
      // supported: full citation
      mkRow({ id: "a", source_document_id: "d1", source_quote: "q", source_page: 2 }),
      // supported: doc + quote + refs (page missing but refs present)
      mkRow({ id: "b", source_document_id: "d1", source_quote: "q", evidence_refs: [{ quote: "q", doc_id: "d1" }] }),
      // quarantined: missing quote
      mkRow({ id: "c", source_document_id: "d1", source_page: 3 }),
      // quarantined: missing document
      mkRow({ id: "d", source_quote: "q", source_page: 3 }),
      // quarantined: has doc+quote but no page and no refs
      mkRow({ id: "e", source_document_id: "d1", source_quote: "q" }),
      // quarantined: nothing at all
      mkRow({ id: "f" }),
    ];
    const { supported, quarantined } = partition(rows);
    expect(supported.sort()).toEqual(["a", "b"]);
    expect(quarantined.map((q) => q.id).sort()).toEqual(["c", "d", "e", "f"]);
    // Reason mapping
    const byId = Object.fromEntries(quarantined.map((q) => [q.id, q.reason]));
    expect(byId.c).toBe("missing_quote");
    expect(byId.d).toBe("missing_document");
    expect(byId.e).toBe("missing_page_and_refs");
    expect(byId.f).toBe("missing_all");
  });

  it("all-supported case yields empty quarantine", () => {
    const rows = [mkRow({ id: "x", source_document_id: "d", source_quote: "q", source_page: 1 })];
    const { supported, quarantined } = partition(rows);
    expect(supported).toEqual(["x"]);
    expect(quarantined).toEqual([]);
  });

  it("all-unsupported case still partitions cleanly (no throw, no block)", () => {
    const rows = [mkRow({ id: "u1" }), mkRow({ id: "u2" })];
    const { supported, quarantined } = partition(rows);
    expect(supported).toEqual([]);
    expect(quarantined.map((q) => q.id)).toEqual(["u1", "u2"]);
  });
});
