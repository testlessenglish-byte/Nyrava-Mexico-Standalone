// Closing Progress — transaction completion, not document count.
// Every row flips on its own as evidence lands in the file; the percentage is
// the share of applicable requirements that are satisfied.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, FileText, ScanText } from "lucide-react";
import { useI18n } from "@/i18n";
import type { ClosingProgress } from "@/lib/realestate/closing-checklist";
import type { VerificationCategory } from "@/lib/real-estate.functions";

export function ClosingProgressPanel({
  progress,
  onOpenCategory,
}: {
  progress: ClosingProgress;
  onOpenCategory: (cat: VerificationCategory) => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("re.progress.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("re.progress.hint", { done: String(progress.satisfied), total: String(progress.total) })}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="text-3xl font-semibold tabular-nums">{progress.percent}%</div>
          <Progress value={progress.percent} className="h-2 flex-1" />
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {progress.rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex min-w-0 items-start gap-2">
                {r.satisfied ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t(`re.check.${r.key}`)}</div>
                  {r.satisfied && r.evidence ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {r.fromText ? <ScanText className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                      <span className="truncate">{r.evidence}</span>
                      {r.fromText && <span>· {t("re.progress.detectedByText")}</span>}
                    </div>
                  ) : !r.satisfied ? (
                    <p className="text-xs text-muted-foreground">{t(`re.check.why.${r.key}`)}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!r.satisfied && r.category && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => onOpenCategory(r.category!)}
                  >
                    {t("re.rec.openItem")}
                  </Button>
                )}
                <span
                  className={`text-xs font-medium ${r.satisfied ? "text-emerald-600" : "text-muted-foreground"}`}
                >
                  {r.satisfied ? t("re.progress.done") : t("re.progress.missing")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
