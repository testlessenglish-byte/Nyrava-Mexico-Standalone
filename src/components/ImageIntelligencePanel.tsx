import { useEffect, useState } from "react";
import { Image as ImageIcon, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  id: string;
  document_id: string | null;
  summary: string | null;
  objects: unknown;
  text_found: string | null;
  face_count: number | null;
  confidence: number | null;
  source_model: string | null;
  created_at: string;
};

export function ImageIntelligencePanel({
  caseId,
  documents,
}: {
  caseId: string;
  documents: { id: string; filename: string }[];
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const docName = new Map(documents.map((d) => [d.id, d.filename]));

  useEffect(() => {
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("image_intelligence")
        .select("id, document_id, summary, objects, text_found, face_count, confidence, source_model, created_at")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (alive) setRows((data as Row[]) ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  if (rows === null) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
        Loading image intelligence…
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Eye className="h-4 w-4 text-accent" />
        <div className="text-sm font-semibold">Image Intelligence</div>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
          Model inference — not verified fact
        </span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => {
          const objs = Array.isArray(r.objects) ? (r.objects as string[]) : [];
          return (
            <div key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {r.document_id ? docName.get(r.document_id) ?? "Image" : "Image"}
                  </div>
                  {r.summary && <div className="mt-1 text-xs text-muted-foreground">{r.summary}</div>}
                  {objs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {objs.slice(0, 20).map((o, i) => (
                        <span key={i} className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px]">
                          {String(o)}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.text_found && (
                    <div className="mt-2 rounded border border-border bg-background/40 p-2 text-[11px] font-mono text-muted-foreground">
                      {r.text_found.slice(0, 400)}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {typeof r.face_count === "number" && (
                      <span className="rounded-full bg-secondary/60 px-2 py-0.5">Faces: {r.face_count}</span>
                    )}
                    {typeof r.confidence === "number" && (
                      <span className="rounded-full bg-secondary/60 px-2 py-0.5">
                        Confidence: {(r.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                    {r.source_model && (
                      <span className="rounded-full bg-secondary/60 px-2 py-0.5">{r.source_model}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
