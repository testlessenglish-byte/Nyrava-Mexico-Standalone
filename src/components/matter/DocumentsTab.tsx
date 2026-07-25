/**
 * DocumentsTab — upload + processing status for a matter.
 *
 * Uploads go directly to the "matter-documents" storage bucket under the
 * RLS-scoped path {orgId}/{matterId}/{documentId}/v1/{filename}. The server
 * then records metadata + enqueues processing.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listMatterDocuments,
  listDocumentJobs,
  registerDocument,
} from "@/lib/documents.functions";
import { processDocumentJob } from "@/lib/pipeline.functions";
import { useI18n } from "@/i18n";
import { Upload, Loader2, CheckCircle2, AlertCircle, PlayCircle, FileText } from "lucide-react";

type MediaKind = "pdf" | "docx" | "txt" | "image" | "spreadsheet" | "email" | "audio" | "video" | "other";

function inferMediaKind(mime: string, name: string): MediaKind {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/") || name.endsWith(".txt")) return "txt";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (name.endsWith(".docx") || mime.includes("word")) return "docx";
  if (name.endsWith(".xlsx") || name.endsWith(".csv") || mime.includes("sheet")) return "spreadsheet";
  if (name.endsWith(".eml") || name.endsWith(".msg")) return "email";
  return "other";
}

function statusTone(s: string) {
  if (s === "analyzed" || s === "completed") return "text-emerald-400";
  if (s === "failed") return "text-red-400";
  return "text-primary";
}

export function DocumentsTab({ matterId, orgId }: { matterId: string; orgId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const list = useServerFn(listMatterDocuments);
  const jobs = useServerFn(listDocumentJobs);
  const register = useServerFn(registerDocument);
  const process = useServerFn(processDocumentJob);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const docsQ = useQuery({
    queryKey: ["matter-documents", matterId],
    queryFn: () => list({ data: { matterId } }),
    refetchInterval: 5000,
  });
  const jobsQ = useQuery({
    queryKey: ["doc-jobs", matterId],
    queryFn: () => jobs({ data: { matterId } }),
    refetchInterval: 5000,
  });

  const runJob = useMutation({
    mutationFn: (jobId: string) => process({ data: { jobId } }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["matter-documents", matterId] });
      qc.invalidateQueries({ queryKey: ["doc-jobs", matterId] });
      qc.invalidateQueries({ queryKey: ["matter-knowledge", matterId] });
    },
  });

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    setErr(null);
    try {
      for (const file of Array.from(files)) {
        const documentId = crypto.randomUUID();
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        const storagePath = `${orgId}/${matterId}/${documentId}/v1/${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("matter-documents")
          .upload(storagePath, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (upErr) throw upErr;
        const reg = await register({
          data: {
            orgId,
            matterId,
            documentId,
            title: file.name,
            storagePath,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            mediaKind: inferMediaKind(file.type || "", file.name.toLowerCase()),
          },
        });
        // Auto-run pipeline (fire and forget; UI polls).
        void process({ data: { jobId: reg.jobId } }).catch(() => undefined);
      }
      qc.invalidateQueries({ queryKey: ["matter-documents", matterId] });
      qc.invalidateQueries({ queryKey: ["doc-jobs", matterId] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const docs = docsQ.data ?? [];
  const jobList = jobsQ.data ?? [];
  const jobByDoc = new Map(jobList.map((j) => [j.document_id, j]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">{t("docs.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("docs.subtitle")}</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary hover:bg-primary/20">
          <Upload className="h-4 w-4" />
          {busy ? t("docs.uploading") : t("docs.upload")}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,image/*,application/pdf,text/plain"
          />
        </label>
      </div>

      {err && <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{err}</div>}

      {docs.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-muted-foreground">
          <FileText className="mx-auto mb-2 h-6 w-6 opacity-60" />
          {t("docs.empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/50">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("docs.col.title")}</th>
                <th className="px-3 py-2">{t("docs.col.kind")}</th>
                <th className="px-3 py-2">{t("docs.col.status")}</th>
                <th className="px-3 py-2">{t("docs.col.progress")}</th>
                <th className="px-3 py-2 text-right">{t("docs.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const j = jobByDoc.get(d.id);
                return (
                  <tr key={d.id} className="border-t border-border/40 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{d.title}</div>
                      {d.processing_error && (
                        <div className="mt-1 text-[11px] text-red-300">{d.processing_error}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs uppercase text-muted-foreground">{d.media_kind ?? "?"}</td>
                    <td className={`px-3 py-2 text-xs font-mono uppercase ${statusTone(d.processing_status)}`}>
                      {d.processing_status === "analyzed" && <CheckCircle2 className="inline h-3.5 w-3.5" />}
                      {d.processing_status === "failed" && <AlertCircle className="inline h-3.5 w-3.5" />}
                      {["processing", "extracting", "classifying", "analyzing", "pending"].includes(
                        d.processing_status,
                      ) && <Loader2 className="inline h-3.5 w-3.5 animate-spin" />}{" "}
                      {d.processing_status}
                    </td>
                    <td className="px-3 py-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${j?.progress ?? 0}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {j && j.status !== "analyzed" && d.processing_status !== "analyzed" && (
                        <button
                          onClick={() => runJob.mutate(j.id)}
                          disabled={runJob.isPending}
                          className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] uppercase tracking-[0.12em] hover:border-primary hover:text-primary"
                        >
                          <PlayCircle className="h-3.5 w-3.5" /> {t("docs.retry")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
