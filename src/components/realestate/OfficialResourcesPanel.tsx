// "Official Mexican Resources" — now relevance-driven: only the portals this
// property file actually needs right now are shown, with the rest one click
// away. Presentation only; the link set lives in
// src/lib/realestate/official-resources.ts.
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  OFFICIAL_RESOURCES,
  notaryDirectorySearchUrl,
  type OfficialResourceId,
} from "@/lib/realestate/official-resources";
import { CONNECTORS } from "@/lib/realestate/connectors";

export function OfficialResourcesPanel({
  place,
  relevant,
}: {
  place?: string | null;
  relevant?: OfficialResourceId[];
}) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);

  const relevantSet = new Set(relevant ?? []);
  const filtered =
    showAll || relevantSet.size === 0
      ? OFFICIAL_RESOURCES
      : OFFICIAL_RESOURCES.filter((r) => relevantSet.has(r.id));
  const hidden = OFFICIAL_RESOURCES.length - filtered.length;

  const plannedConnectors = CONNECTORS.filter((c) => c.status === "planned");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("re.res.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {relevantSet.size > 0 && !showAll ? t("re.res.relevantHint") : t("re.res.hint")}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtered.map((r) => {
          const href = r.id === "notarios_nacionales" ? notaryDirectorySearchUrl(place) : r.url;
          return (
            <div key={r.id} className="rounded-lg border border-border p-3">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 text-sm font-medium hover:text-primary"
              >
                <span>{t(`re.res.${r.id}.name`)}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <p className="mt-1 text-xs text-muted-foreground">{t(`re.res.${r.id}.desc`)}</p>
              {r.secondaryUrl && (
                <a
                  href={r.secondaryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t(`re.res.${r.id}.secondary`)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          );
        })}

        {hidden > 0 && !showAll && (
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowAll(true)}>
            {t("re.res.showAll", { count: String(hidden) })}
          </Button>
        )}
        {showAll && relevantSet.size > 0 && (
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowAll(false)}>
            {t("re.res.showRelevant")}
          </Button>
        )}

        {plannedConnectors.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{t("re.conn.title")}</p>
            <p className="text-xs text-muted-foreground">{t("re.conn.hint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {plannedConnectors.map((c) => (
                <Badge key={c.id} variant="outline" className="text-[11px] font-normal">
                  {t(`re.conn.${c.id}`)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
