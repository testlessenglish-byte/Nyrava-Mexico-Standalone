import type { Database } from "@/integrations/supabase/types";
import { useI18n } from "@/i18n";

type Status = Database["public"]["Enums"]["case_status"];

const STYLES: Record<Status, string> = {
  uploaded: "bg-secondary text-secondary-foreground",
  queued: "bg-secondary text-secondary-foreground",
  extracting: "bg-warning/15 text-warning",
  extracted: "bg-success/15 text-success",
  analyzing: "bg-warning/15 text-warning",
  analyzed: "bg-success/15 text-success",
  agents_running: "bg-warning/15 text-warning",
  agents_complete: "bg-success/15 text-success",
  scoring: "bg-warning/15 text-warning",
  scored: "bg-success/15 text-success",
  reporting: "bg-warning/15 text-warning",
  intelligence_running: "bg-warning/15 text-warning",
  intelligence_complete: "bg-success/15 text-success",
  complete: "bg-success/15 text-success",
  released: "bg-success/15 text-success",
  needs_revision: "bg-warning/15 text-warning",
  stalled: "bg-destructive/15 text-destructive",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};


const IN_PROGRESS = new Set<Status>(["extracting", "analyzing", "agents_running", "scoring", "reporting", "intelligence_running"]);

export function StatusBadge({ status, progress }: { status: Status; progress?: number }) {
  const { t } = useI18n();
  const inProgress = IN_PROGRESS.has(status);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}>
      {inProgress && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {t(`cases.status.${status}`)}{inProgress && progress != null ? ` · ${progress}%` : ""}
    </span>
  );
}
