// AI Property Assistant — context-aware next-step recommendations derived from
// the case's own property record, verification items and uploaded documents.
// Each row links either to the verification item that resolves it or straight
// to the official Mexican portal where the attorney obtains the missing piece.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Lightbulb } from "lucide-react";
import { useI18n } from "@/i18n";
import type { Recommendation } from "@/lib/realestate/recommendations";
import { resourceById } from "@/lib/realestate/official-resources";
import type { VerificationCategory } from "@/lib/real-estate.functions";

const SEVERITY_META = {
  critical: { icon: AlertTriangle, className: "text-red-600 bg-red-50 border-red-200" },
  warning: { icon: AlertTriangle, className: "text-amber-600 bg-amber-50 border-amber-200" },
  info: { icon: Info, className: "text-muted-foreground bg-muted border-border" },
} as const;

export function PropertyRecommendationsPanel({
  recommendations,
  onOpenCategory,
}: {
  recommendations: Recommendation[];
  onOpenCategory: (cat: VerificationCategory) => void;
}) {
  const { t } = useI18n();
  const recs = recommendations;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-primary" />
          {t("re.rec.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("re.rec.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {recs.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {t("re.rec.none")}
          </div>
        ) : (
          recs.map((r) => {
            const meta = SEVERITY_META[r.severity];
            const Icon = meta.icon;
            const href = r.url ?? (r.resource ? resourceById(r.resource).url : null);
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                    <Icon className="h-3 w-3" />
                    {t(`re.rec.severity.${r.severity}`)}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm">{t(r.messageKey, r.values)}</p>
                    {r.whyKey && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{t(r.whyKey)}</p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  {r.category && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpenCategory(r.category!)}>
                      {t("re.rec.openItem")}
                    </Button>
                  )}
                  {href && (
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" asChild>
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {t("re.rec.openSource")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
