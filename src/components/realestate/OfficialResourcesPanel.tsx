// "Official Mexican Resources" sidebar — one-click access to the government
// portals a property transaction actually depends on. Presentation only: the
// link set lives in src/lib/realestate/official-resources.ts.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n";
import { OFFICIAL_RESOURCES, notaryDirectorySearchUrl } from "@/lib/realestate/official-resources";

export function OfficialResourcesPanel({ place }: { place?: string | null }) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("re.res.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("re.res.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {OFFICIAL_RESOURCES.map((r) => {
          const href =
            r.id === "notarios_nacionales" ? notaryDirectorySearchUrl(place) : r.url;
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
      </CardContent>
    </Card>
  );
}
