// Cross-Document Graph — Batch 4
// Builds an entity/party/date overlap graph across every extracted document
// in a case. Pure derivation from documents.entities, documents.extracted_text,
// and case_findings — no LLM call, fully deterministic.
//
// The graph powers:
//   • "Documents that mention the same parties/dates" in the UI
//   • Corroboration counting for ESS
//   • Contradiction triage when two docs disagree on the same fact
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type GraphNode = {
  document_id: string;
  filename: string;
  parties: string[];
  dates: string[];
  finding_count: number;
};
export type GraphEdge = {
  a: string;            // document_id
  b: string;            // document_id
  shared_parties: string[];
  shared_dates: string[];
  weight: number;       // parties.length*2 + dates.length
};
export type DocumentGraph = {
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  totals: {
    documents: number;
    edges: number;
    isolated: number;          // nodes with zero edges
    densest_pair?: { a: string; b: string; weight: number } | null;
  };
};

const PARTY_RE = /\b(Mr\.|Mrs\.|Ms\.|Dr\.|Officer|Detective|Judge|Plaintiff|Defendant|Petitioner|Respondent)\s+([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){0,2})/g;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/g;

function normParty(p: string): string {
  return p.replace(/\s+/g, " ").trim().toLowerCase();
}
function normDate(d: string): string {
  const s = d.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(s);
  if (us) {
    let y = us[3]; if (y.length === 2) y = (Number(y) >= 50 ? "19" : "20") + y;
    return `${y}-${us[1].padStart(2,"0")}-${us[2].padStart(2,"0")}`;
  }
  return s.toLowerCase();
}

export async function buildDocumentGraph(db: Db, caseId: string): Promise<DocumentGraph> {
  const [{ data: docs }, { data: findings }] = await Promise.all([
    db.from("documents")
      .select("id,filename,extracted_text,entities,status")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    db.from("case_findings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("source_document_id,source_doc_ids" as any)
      .eq("case_id", caseId)
      .not("source_module", "like", PROJECTION_LIKE),
  ]);

  const findingsByDoc = new Map<string, number>();
  for (const f of findings ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd = (f as any).source_document_id;
    if (typeof sd === "string") findingsByDoc.set(sd, (findingsByDoc.get(sd) ?? 0) + 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (f as any).source_doc_ids;
    if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") findingsByDoc.set(x, (findingsByDoc.get(x) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [];
  const partySets = new Map<string, Set<string>>();   // doc_id -> normalized parties
  const dateSets = new Map<string, Set<string>>();    // doc_id -> normalized dates
  const partyDisplay = new Map<string, string>();     // normalized -> display

  for (const d of docs ?? []) {
    if (d.status !== "extracted") continue;
    const id = d.id as string;
    const text = String(d.extracted_text ?? "");
    const parties: string[] = [];
    for (const m of text.matchAll(PARTY_RE)) {
      const disp = `${m[1]} ${m[2]}`;
      const k = normParty(disp);
      if (!partyDisplay.has(k)) partyDisplay.set(k, disp);
      parties.push(k);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ents = Array.isArray((d as any).entities) ? ((d as any).entities as Array<{ type?: string; value?: string }>) : [];
    for (const e of ents) {
      if (!e?.value) continue;
      if (!/person|party|witness|officer/i.test(String(e?.type ?? ""))) continue;
      const disp = String(e.value);
      const k = normParty(disp);
      if (!partyDisplay.has(k)) partyDisplay.set(k, disp);
      parties.push(k);
    }
    const dates = [...text.matchAll(DATE_RE)].map((m) => normDate(m[1]));

    const pSet = new Set(parties);
    const dSet = new Set(dates);
    partySets.set(id, pSet);
    dateSets.set(id, dSet);
    nodes.push({
      document_id: id,
      filename: String(d.filename ?? "Untitled"),
      parties: [...pSet].map((k) => partyDisplay.get(k) ?? k).slice(0, 25),
      dates: [...dSet].slice(0, 25),
      finding_count: findingsByDoc.get(id) ?? 0,
    });
  }

  const edges: GraphEdge[] = [];
  let densest: GraphEdge | null = null;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].document_id; const b = nodes[j].document_id;
      const pA = partySets.get(a)!; const pB = partySets.get(b)!;
      const dA = dateSets.get(a)!; const dB = dateSets.get(b)!;
      const sharedP = [...pA].filter((x) => pB.has(x));
      const sharedD = [...dA].filter((x) => dB.has(x));
      if (sharedP.length === 0 && sharedD.length === 0) continue;
      const e: GraphEdge = {
        a, b,
        shared_parties: sharedP.map((k) => partyDisplay.get(k) ?? k),
        shared_dates: sharedD,
        weight: sharedP.length * 2 + sharedD.length,
      };
      edges.push(e);
      if (!densest || e.weight > densest.weight) densest = e;
    }
  }

  const connected = new Set<string>();
  for (const e of edges) { connected.add(e.a); connected.add(e.b); }
  const isolated = nodes.filter((n) => !connected.has(n.document_id)).length;

  return {
    generated_at: new Date().toISOString(),
    nodes,
    edges: edges.sort((x, y) => y.weight - x.weight).slice(0, 500),
    totals: {
      documents: nodes.length,
      edges: edges.length,
      isolated,
      densest_pair: densest ? { a: densest.a, b: densest.b, weight: densest.weight } : null,
    },
  };
}
