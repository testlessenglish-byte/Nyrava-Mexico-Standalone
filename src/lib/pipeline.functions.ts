/**
 * Document processing pipeline (Phase 3).
 *
 * Runs one job at a time under the caller's session; RLS enforces org access
 * end-to-end. Stages:
 *   extract → classify → entities → knowledge
 *
 * Text extraction:
 *   - text/*         : decoded as UTF-8
 *   - image/*        : sent to Gemini via base64 image_url for OCR
 *   - application/pdf: sent to Gemini via base64 for text extraction
 *   - others (docx, spreadsheet, email, audio, video): flagged as
 *     "coming soon" — pipeline marks the document `failed` with a clear
 *     message so the UI can surface it.
 *
 * Every stage writes to `document_processing_jobs` and `matter_documents`
 * so the UI can observe progress and errors.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getAIProvider } from "./ai/provider.server";

const RunInput = z.object({ jobId: z.string().uuid() });

const EXTRACT_SYSTEM = `Eres un extractor de texto para documentos legales mexicanos.
Devuelve JSON: { "text": "...", "page_count": N|null, "language": "es"|"en" }.
Preserva estructura básica (encabezados con "# ", listas con "- ").
Nunca inventes contenido.`;

type ExtractResult = { text: string; page_count?: number | null; language?: "es" | "en" };

const CLASSIFY_SYSTEM = `Eres un clasificador de documentos legales mexicanos.
Devuelve JSON: {
  "doc_type": "demanda|contestacion|contrato|sentencia|amparo|acuerdo|prueba|correspondencia|identificacion|otro",
  "summary": "...",
  "keywords": ["..."],
  "confidence": 0-1
}. No inventes.`;

type ClassifyResult = { doc_type: string; summary: string; keywords: string[]; confidence: number };

const ENTITY_SYSTEM = `Extrae entidades de un documento legal mexicano y devuelve JSON:
{
  "people": [{ "name": "...", "role": "..." }],
  "organizations": [{ "name": "...", "role": "..." }],
  "dates": [{ "label": "...", "date": "YYYY-MM-DD|null" }],
  "locations": [{ "name": "..." }],
  "authorities": [{ "citation": "...", "type": "law|article|jurisprudencia|tesis|otro" }]
}
Solo entidades presentes en el texto.`;

type EntityResult = {
  people: { name: string; role?: string }[];
  organizations: { name: string; role?: string }[];
  dates: { label: string; date?: string | null }[];
  locations: { name: string }[];
  authorities: { citation: string; type: string }[];
};

async function fileToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.byteLength; i++) bin += String.fromCharCode(buf[i]);
  // btoa is available in the Worker/Edge runtime.
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

export const processDocumentJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load job + doc.
    const { data: job, error: jobErr } = await supabase
      .from("document_processing_jobs")
      .select("id, document_id, org_id, stage, status, attempts")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) throw new Error("Job not found.");

    const { data: doc, error: docErr } = await supabase
      .from("matter_documents")
      .select("id, matter_id, org_id, title, storage_path, mime_type, media_kind, text_content")
      .eq("id", job.document_id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc?.storage_path) throw new Error("Document has no storage path.");

    const updateJob = async (patch: Record<string, unknown>) => {
      await supabase.from("document_processing_jobs").update(patch as never).eq("id", job.id);
    };
    const updateDoc = async (patch: Record<string, unknown>) => {
      await supabase.from("matter_documents").update(patch as never).eq("id", doc.id);
    };


    await updateJob({
      status: "extracting",
      started_at: new Date().toISOString(),
      attempts: (job.attempts ?? 0) + 1,
      progress: 5,
    });
    await updateDoc({ processing_status: "extracting", processing_error: null });


    try {
      // === Stage 1: download ===
      const { data: fileBlob, error: dlErr } = await supabase.storage
        .from("matter-documents")
        .download(doc.storage_path);
      if (dlErr || !fileBlob) throw new Error(`No se pudo descargar el archivo: ${dlErr?.message ?? "sin datos"}`);

      const mime = doc.mime_type ?? "application/octet-stream";
      const provider = getAIProvider();
      // Routed through the single provider manager using THIS user's keys.
      const aiOpts = { userId };

      // === Stage 2: extract ===
      await updateJob({ stage: "extract", progress: 15 });
      let extractedText = "";
      let pageCount: number | null = null;
      let lang: "es" | "en" = "es";

      if (mime.startsWith("text/") || doc.media_kind === "txt") {
        extractedText = await fileBlob.text();
      } else if (mime.startsWith("image/") || mime === "application/pdf") {
        const b64 = await fileToBase64(fileBlob);
        const dataUrl = `data:${mime};base64,${b64}`;
        const { content } = await provider.chatJSON<ExtractResult>(
          [
            { role: "system", content: EXTRACT_SYSTEM },
            {
              role: "user",
              content: [
                { type: "text", text: `Extrae el texto de este documento (${doc.title}).` },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          { ...aiOpts, temperature: 0 },
        );
        extractedText = content.text ?? "";
        pageCount = content.page_count ?? null;
        lang = content.language === "en" ? "en" : "es";
      } else {
        throw new Error(
          `Formato "${mime}" aún no soportado por el pipeline. Formatos activos: PDF, imagen, texto plano. DOCX/XLSX/email/audio/video llegan en fases próximas.`,
        );
      }

      await updateDoc({ text_content: extractedText, language: lang, page_count: pageCount, processing_status: "extracted" });
      await updateJob({ stage: "classify", progress: 40 });

      // === Stage 3: classify ===
      const classifyText = extractedText.slice(0, 12000);
      const { content: cls } = await provider.chatJSON<ClassifyResult>(
        [
          { role: "system", content: CLASSIFY_SYSTEM },
          { role: "user", content: `Título: ${doc.title}\nTexto:\n${classifyText}` },
        ],
        { ...aiOpts, temperature: 0.1 },
      );
      await updateDoc({
        classification: cls,
        doc_type: cls.doc_type,
        processing_status: "classified",
      });
      await updateJob({ stage: "entities", progress: 65 });

      // === Stage 4: entities → knowledge base ===
      const { content: ents } = await provider.chatJSON<EntityResult>(
        [
          { role: "system", content: ENTITY_SYSTEM },
          { role: "user", content: classifyText || `Título: ${doc.title}` },
        ],
        { ...aiOpts, temperature: 0.1 },
      );

      // Persist entities as matter_knowledge rows (engine="case", kind varies).
      const rows: Record<string, unknown>[] = [];
      const now = new Date().toISOString();
      (ents.people ?? []).forEach((p) =>
        rows.push({
          org_id: doc.org_id,
          matter_id: doc.matter_id,
          engine: "case",
          kind: "party",
          title: p.name,
          data: { role: p.role ?? null, extracted_at: now },
          source_document_id: doc.id,
          confidence: 0.5,
          language: lang,
        }),
      );
      (ents.organizations ?? []).forEach((o) =>
        rows.push({
          org_id: doc.org_id,
          matter_id: doc.matter_id,
          engine: "case",
          kind: "entity",
          title: o.name,
          data: { entity_type: "organization", role: o.role ?? null },
          source_document_id: doc.id,
          confidence: 0.5,
          language: lang,
        }),
      );
      (ents.dates ?? []).forEach((d) =>
        rows.push({
          org_id: doc.org_id,
          matter_id: doc.matter_id,
          engine: "case",
          kind: "date",
          title: d.label,
          data: { date: d.date ?? null },
          source_document_id: doc.id,
          confidence: 0.5,
          language: lang,
        }),
      );
      (ents.locations ?? []).forEach((l) =>
        rows.push({
          org_id: doc.org_id,
          matter_id: doc.matter_id,
          engine: "case",
          kind: "entity",
          title: l.name,
          data: { entity_type: "location" },
          source_document_id: doc.id,
          confidence: 0.45,
          language: lang,
        }),
      );
      (ents.authorities ?? []).forEach((a) =>
        rows.push({
          org_id: doc.org_id,
          matter_id: doc.matter_id,
          engine: "legal",
          kind: "authority",
          title: a.citation,
          data: { authority_type: a.type, verified: false, extracted_from_document: true },
          source_document_id: doc.id,
          confidence: 0.35,
          language: lang,
        }),
      );

      // Baseline knowledge guarantee: a document that yields zero discrete
      // entities would otherwise leave the matter knowledge base empty, and
      // every downstream engine then skips instantly (0 ms). Persist a summary
      // row so the analysis stages always have something to reason over.
      if (rows.length === 0 && extractedText) {
        rows.push({
          org_id: doc.org_id,
          matter_id: doc.matter_id,
          engine: "case",
          kind: "summary",
          title: doc.title,
          data: { summary: classifyText, doc_type: cls.doc_type, fallback: true },
          source_document_id: doc.id,
          confidence: 0.5,
          language: lang,
        });
      }

      if (rows.length) {
        const { error: kErr } = await supabase.from("matter_knowledge").insert(rows as never);
        if (kErr) throw kErr;
      }

      await updateJob({
        stage: "done",
        status: "analyzed",
        progress: 100,
        completed_at: new Date().toISOString(),
        error: null,
        payload: { entities: rows.length, classification: cls.doc_type },
      });

      await updateDoc({ processing_status: "analyzed", metadata: { entities_extracted: rows.length } });

      return { ok: true, entities: rows.length, classification: cls.doc_type };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJob({ status: "failed", error: message, completed_at: new Date().toISOString() });
      await updateDoc({ processing_status: "failed", processing_error: message });
      return { ok: false, error: message };
    }
  });
