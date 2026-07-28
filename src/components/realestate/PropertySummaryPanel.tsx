// Property Intelligence Summary — the header read of a property file:
// what holds up, what is outstanding, and the transaction readiness figure.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Sparkles, ScanText } from "lucide-react";
import { useI18n } from "@/i18n";
import type { SummaryLine } from "@/lib/realestate/summary";
import type { DetectedDocument } from "@/lib/realestate/document-detection";

export function PropertySummaryPanel({
  lines,
  readiness,
  detected,
}: {
  lines: SummaryLine[];
  readiness: number;
  detected: DetectedDocument[];
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          {t("re.sum.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("re.sum.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {lines.map((l) => (
            <li key={l.id} className="flex items-start gap-2 text-sm">
              {l.tone === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              )}
              <span>{t(l.messageKey, l.values)}</span>
            </li>
          ))}
          <li className="flex items-start gap-2 text-sm font-medium">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{t("re.sum.readiness", { percent: String(readiness) })}</span>
          </li>
        </ul>

        {detected.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{t("re.sum.detectedTitle")}</p>
            <div className="flex flex-wrap gap-1.5">
              {detected.map((d) => (
                <Badge key={d.kind} variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
                  {d.matchedOn === "text" ? <ScanText className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                  {t(`re.kind.${d.kind}`)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
