import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeTimelineDate } from "./canonical-timeline.server";
import { resolveCaseIdentity } from "./case-classification.server";

type Db = SupabaseClient<Database>;

export interface PenalDisposition {
  court: string | null;
  decision_date: string | null;
  status: string | null;
  result: string | null;
  operative_orders: string[];
  conviction_status: string | null;
  sentence_status: string | null;
  amparo_result: string | null;
  remand: boolean;
  remand_court: string | null;
  remand_instructions: string[];
  procedure_reopened: boolean | null;
  source_document_id: string;
  source_page: number | null;
  source_quote: string;
  confidence: number;
}

export type DispositionDocument = {
  id: string;
  filename?: string | null;
  extracted_text: string | null;
};

const DISPOSITIVE_HEADING =
  /(?:^|\n)\s*(?:PUNTOS?\s+RESOLUTIVOS?|R\s*E\s*S\s*U\s*E\s*L\s*V\s*E|RESOLUTIVOS?)\s*[:.]?/i;
const ORDER_LINE =
  /(?:^|\n)\s*(?:PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|SÉPTIMO|SEPTIMO|OCTAVO|NOVENO|DÉCIMO|DECIMO)[.:\-\s]+([^\n]{8,900})/gi;
const OPERATIVE_VERB =
  /\b(se\s+confirma|se\s+revoca|se\s+modifica|se\s+concede|concede\s+el\s+amparo|se\s+niega|niega\s+el\s+amparo|se\s+sobresee|se\s+absuelve|se\s+condena|se\s+repone|devu[ée]lvanse\s+los\s+autos|rem[íi]tanse\s+los\s+autos|d[ée]jese\s+insubsistente|d[íi]ctese\s+nueva\s+sentencia|se\s+ordena\s+la\s+libertad|se\s+excluye)\b/i;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dispositiveSlice(text: string): { text: string; offset: number; headed: boolean } | null {
  const heading = DISPOSITIVE_HEADING.exec(text);
  if (heading) {
    const offset = heading.index;
    return { text: text.slice(offset, offset + 12_000), offset, headed: true };
  }

  // Ordinal orders are accepted only in the final 40% of the decision and
  // only when at least two operative orders appear. This prevents a quoted
  // precedent's resolutivos in the merits from becoming this case's result.
  const start = Math.floor(text.length * 0.6);
  const tail = text.slice(start);
  const orders = [...tail.matchAll(ORDER_LINE)].filter((m) => OPERATIVE_VERB.test(m[1] ?? ""));
  if (orders.length < 2) return null;
  return { text: tail, offset: start, headed: false };
}

function extractOrders(block: string): string[] {
  const ordinal = [...block.matchAll(ORDER_LINE)]
    .map((match) => clean(match[1] ?? ""))
    .filter((line) => OPERATIVE_VERB.test(line));
  if (ordinal.length > 0) return [...new Set(ordinal)].slice(0, 12);

  return block
    .split(/(?<=[.;])\s+/)
    .map(clean)
    .filter((line) => OPERATIVE_VERB.test(line))
    .slice(0, 12);
}

function firstDate(text: string): string | null {
  const raw =
    text.match(/\b\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}\b/i)?.[0] ??
    text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ??
    null;
  if (!raw) return null;
  const normalized = normalizeTimelineDate(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function courtName(text: string): string | null {
  return (
    text.match(
      /\b(SUPREMA CORTE DE JUSTICIA DE LA NACI[ÓO]N|TRIBUNAL COLEGIADO[^\n.]{0,100}|TRIBUNAL DE ALZADA[^\n.]{0,100}|TRIBUNAL DE ENJUICIAMIENTO[^\n.]{0,100}|JUZGADO DE CONTROL[^\n.]{0,100}|JUZGADO[^\n.]{0,40}DE DISTRITO[^\n.]{0,80})/i,
    )?.[1]?.trim() ?? null
  );
}

function resultFrom(orders: string[]): string | null {
  const text = orders.join(" ").toLowerCase();
  const results: string[] = [];
  if (/se revoca/.test(text)) results.push("revoked");
  if (/se modifica/.test(text)) results.push("modified");
  if (/se confirma/.test(text)) results.push("affirmed");
  if (/se concede|concede el amparo/.test(text)) results.push("amparo_granted");
  if (/se niega|niega el amparo/.test(text)) results.push("amparo_denied");
  if (/se sobresee/.test(text)) results.push("dismissed");
  if (/se absuelve/.test(text)) results.push("acquitted");
  if (/se condena/.test(text)) results.push("convicted");
  if (/se repone|nueva sentencia|devuelvanse|devuélvanse/.test(text)) results.push("remanded");
  return results.length ? [...new Set(results)].join("_and_") : null;
}

export function extractPenalDisposition(
  document: DispositionDocument,
): PenalDisposition | null {
  const text = String(document.extracted_text ?? "");
  if (!text.trim()) return null;
  const slice = dispositiveSlice(text);
  if (!slice) return null;
  const operativeOrders = extractOrders(slice.text);
  if (operativeOrders.length === 0) return null;

  const joined = operativeOrders.join(" ");
  const remand = /devu[ée]lvanse|rem[íi]tanse|nueva\s+sentencia|se\s+repone/i.test(joined);
  const reopened = /se\s+repone|reposici[oó]n\s+(?:del|de\s+la)\s+procedimiento/i.test(joined);
  const firstOrderOffset = text.indexOf(operativeOrders[0], slice.offset);
  const quote = clean(slice.text).slice(0, 1800);

  return {
    court: courtName(text.slice(0, Math.min(text.length, 20_000))),
    decision_date: firstDate(text.slice(0, Math.min(text.length, 8_000))),
    status: "concluded",
    result: resultFrom(operativeOrders),
    operative_orders: operativeOrders,
    conviction_status: /se\s+absuelve/i.test(joined)
      ? "acquitted"
      : /se\s+condena/i.test(joined)
        ? "convicted"
        : /se\s+revoca[^.]{0,120}(?:condena|sentencia)/i.test(joined)
          ? "conviction_reversed_or_modified"
          : null,
    sentence_status: /nueva\s+sentencia/i.test(joined)
      ? "new_sentence_ordered"
      : /se\s+modifica[^.]{0,120}(?:pena|sentencia)/i.test(joined)
        ? "modified"
        : null,
    amparo_result: /se\s+concede|concede\s+el\s+amparo/i.test(joined)
      ? "granted"
      : /se\s+niega|niega\s+el\s+amparo/i.test(joined)
        ? "denied"
        : /se\s+sobresee/i.test(joined)
          ? "dismissed"
          : null,
    remand,
    remand_court:
      joined.match(/(?:devu[ée]lvanse|rem[íi]tanse)[^.]{0,160}\b(?:tribunal|juzgado|sala)[^.]{0,100}/i)?.[0] ??
      null,
    remand_instructions: remand
      ? operativeOrders.filter((order) =>
          /devu[ée]lvanse|rem[íi]tanse|nueva\s+sentencia|se\s+repone|d[íi]ctese/i.test(order),
        )
      : [],
    procedure_reopened: reopened ? true : remand ? false : null,
    source_document_id: document.id,
    source_page: firstOrderOffset >= 0 ? Math.floor(firstOrderOffset / 3000) + 1 : null,
    source_quote: quote,
    confidence: slice.headed && operativeOrders.length >= 2 ? 0.98 : slice.headed ? 0.92 : 0.82,
  };
}

export function renderPenalDisposition(disposition: PenalDisposition): string {
  const lines = [
    "RESULTADO DEL CASO",
    disposition.court ? `Tribunal: ${disposition.court}` : null,
    disposition.decision_date ? `Fecha: ${disposition.decision_date}` : null,
    disposition.result ? `Resultado: ${disposition.result}` : null,
    disposition.conviction_status
      ? `Condena: ${disposition.conviction_status}`
      : null,
    disposition.sentence_status ? `Sentencia/pena: ${disposition.sentence_status}` : null,
    disposition.amparo_result ? `Amparo: ${disposition.amparo_result}` : null,
    `Remisión/reposición: ${disposition.remand ? "sí" : "no"}`,
    ...disposition.operative_orders.map((order) => `• ${order}`),
  ];
  return lines.filter(Boolean).join("\n");
}

export async function persistPenalDisposition(
  db: Db,
  caseId: string,
  userId: string,
): Promise<PenalDisposition | null> {
  const identity = await resolveCaseIdentity(db, caseId);
  if (identity.caseType !== "penal" && identity.underlyingMateria !== "penal") return null;

  const { data } = await db
    .from("documents")
    .select("id,filename,extracted_text")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const candidates = ((data ?? []) as DispositionDocument[])
    .map(extractPenalDisposition)
    .filter((value): value is PenalDisposition => value !== null)
    .sort((a, b) => b.confidence - a.confidence || b.operative_orders.length - a.operative_orders.length);

  await (db as any).from("case_penal_dispositions").delete().eq("case_id", caseId);
  const best = candidates[0] ?? null;
  if (!best) return null;

  const { error } = await (db as any).from("case_penal_dispositions").insert({
    case_id: caseId,
    user_id: userId,
    ...best,
  });
  if (error) throw new Error(`Failed to persist Penal disposition: ${error.message}`);
  return best;
}
