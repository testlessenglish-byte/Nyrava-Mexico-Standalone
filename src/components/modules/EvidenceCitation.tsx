import { FileText } from "lucide-react";

export function EvidenceCitation({
  documentName,
  page,
  quote,
}: {
  documentName?: string | null;
  page?: number | null;
  quote?: string | null;
}) {
  if (!documentName && !quote) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        <span className="font-medium">{documentName ?? "Source"}</span>
        {page ? <span>· p. {page}</span> : null}
      </div>
      {quote ? (
        <p className="mt-1.5 italic text-foreground/90 line-clamp-3">
          “{quote}”
        </p>
      ) : null}
    </div>
  );
}
