// Transaction Center — the inmobiliario materia's native workspace tab.
// Deliberately matches the existing case workspace's visual language
// (Card/Badge/Progress primitives, same spacing/typography scale as
// ScorecardTab/WitnessesTab in cases.$caseId.tsx) rather than introducing a
// new visual identity — the goal stated throughout this build is that an
// attorney can't tell where the platform ends and this practice area
// begins, so this intentionally does not look like a separate product.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Clock, AlertTriangle, XCircle, Paperclip } from "lucide-react";
import { VerificationItemWorkspace } from "@/components/realestate/VerificationItemWorkspace";
import { OfficialResourcesPanel } from "@/components/realestate/OfficialResourcesPanel";
import { PropertyRecommendationsPanel } from "@/components/realestate/PropertyRecommendationsPanel";
import { PropertySummaryPanel } from "@/components/realestate/PropertySummaryPanel";
import { ClosingProgressPanel } from "@/components/realestate/ClosingProgressPanel";
import { detectDocuments } from "@/lib/realestate/document-detection";
import { buildClosingProgress } from "@/lib/realestate/closing-checklist";
import { buildPropertySummary } from "@/lib/realestate/summary";
import { buildRecommendations, relevantResources } from "@/lib/realestate/recommendations";
import { CasePartiesPanel } from "@/components/casework/CasePartiesPanel";
import { useI18n } from "@/i18n";
import {
  getTransactionCenter,
  updateClosingMilestone,
  listPropertyDocumentSignals,
  type VerificationCategory,
  type VerificationItem,
} from "@/lib/real-estate.functions";

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
      {msg}
    </div>
  );
}

const STATUS_META: Record<
  VerificationItem["status"],
  { icon: typeof CheckCircle2; className: string }
> = {
  verified: { icon: CheckCircle2, className: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  pending: { icon: Clock, className: "text-amber-600 bg-amber-50 border-amber-200" },
  missing: { icon: XCircle, className: "text-muted-foreground bg-muted border-border" },
  issue_found: { icon: AlertTriangle, className: "text-red-600 bg-red-50 border-red-200" },
};

const VERIFICATION_CATEGORIES: VerificationCategory[] = [
  "ownership",
  "registry",
  "catastro",
  "predial",
  "water",
  "cfe",
  "hoa",
  "mortgage",
  "permits",
  "corporate_authority",
  "environmental",
];


export function TransactionCenterPanel({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const { t, locale } = useI18n();
  const queryKey = ["transaction-center", caseId];
  const [openCategory, setOpenCategory] = useState<VerificationCategory | null>(null);


  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getTransactionCenter({ data: { caseId } }),
  });

  const { data: caseDocuments } = useQuery({
    queryKey: ["transaction-center-docs", caseId],
    queryFn: () => listPropertyDocumentSignals({ data: { caseId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const setMilestoneFn = useServerFn(updateClosingMilestone);
  const milestoneM = useMutation({
    mutationFn: (args: { milestoneKey: string; percentComplete: number }) =>
      setMilestoneFn({ data: { caseId, milestoneKey: args.milestoneKey, percentComplete: args.percentComplete } }),
    onSuccess: invalidate,
  });




  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!data) return <Empty msg={t("re.loadError")} />;

  const byCategory = new Map(data.verification.map((v) => [v.category, v]));

  // One deterministic read of the file, shared by the summary, the closing
  // tracker and the assistant so they can never disagree with each other.
  const detected = detectDocuments(caseDocuments ?? []);
  const fileState = { property: data.property, verification: data.verification, detected };
  const progress = buildClosingProgress(fileState);
  const summaryLines = buildPropertySummary(fileState, progress);
  const recommendations = buildRecommendations(fileState);

  return (
    <div className="space-y-4">
      <PropertySummaryPanel lines={summaryLines} readiness={progress.percent} detected={detected} />
      <ClosingProgressPanel progress={progress} onOpenCategory={setOpenCategory} />

      {/* Closing Readiness — always visible, not buried in the report */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("re.center.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-3xl font-semibold tabular-nums">
              {data.readiness === null ? "—" : `${data.readiness}%`}
            </div>
            <Progress value={data.readiness ?? 0} className="h-2 flex-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.milestones.map((m) => (
              <div key={m.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{locale === "en" ? m.label_en || m.label_es : m.label_es}</span>
                  <span className="tabular-nums text-muted-foreground">{m.percent_complete}%</span>
                </div>
                <Progress value={m.percent_complete} className="h-1.5" />
                <div className="mt-2 flex gap-1">
                  {[0, 50, 100].map((pct) => (
                    <Button
                      key={pct}
                      size="sm"
                      variant={m.percent_complete === pct ? "default" : "outline"}
                      className="h-6 flex-1 px-1 text-xs"
                      disabled={milestoneM.isPending}
                      onClick={() => milestoneM.mutate({ milestoneKey: m.milestone_key, percentComplete: pct })}
                    >
                      {pct}%
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
      {/* Property Intelligence */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("re.property.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.property ? (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [t("re.property.address"), data.property.address],
                [t("re.property.municipality"), data.property.municipality],
                [t("re.property.state"), data.property.state],
                [t("re.property.folioReal"), data.property.folio_real],
                [t("re.property.cuentaPredial"), data.property.cuenta_predial],
                [t("re.property.catastro"), data.property.catastro_id],
                [t("re.property.buyer"), data.property.buyer_name],
                [t("re.property.seller"), data.property.seller_name],
                [t("re.property.notary"), data.property.notary],
                [t("re.property.closingDate"), data.property.closing_date],
                [t("re.property.foreignBuyer"), data.property.foreign_buyer ? t("re.yes") : t("re.no")],
                [t("re.property.fideicomiso"), data.property.fideicomiso ? t("re.yes") : t("re.no")],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Empty msg={t("re.property.empty")} />
          )}
        </CardContent>
      </Card>

      {/* Verification Center — every category, three-mode honest about how status was produced */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("re.verification.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("re.verification.hint")}</p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {VERIFICATION_CATEGORIES.map((cat) => {
            const item = byCategory.get(cat);
            const status = item?.status ?? "pending";
            const meta = STATUS_META[status];
            const Icon = meta.icon;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setOpenCategory(cat)}
                className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <div>
                  <div className="text-sm font-medium">{t(`re.cat.${cat}`)}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t(`re.mode.${item?.verification_mode ?? "manual"}`)}</span>
                    {item?.evidence_document_id && (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3 w-3" /> 1
                      </span>
                    )}
                    {item?.notes ? <span>{t("re.verification.withNotes")}</span> : null}
                  </div>
                </div>
                <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                  <Icon className="h-3 w-3" />
                  {t(`re.status.${status}`)}
                </Badge>
              </button>
            );
          })}
        </CardContent>
      </Card>

          <PropertyRecommendationsPanel
            recommendations={recommendations}
            onOpenCategory={setOpenCategory}
          />
        </div>

        <div className="space-y-4">
          <OfficialResourcesPanel
            place={data.property?.municipality || data.property?.state || null}
            relevant={relevantResources(recommendations)}
          />
        </div>
      </div>



      {openCategory && (
        <VerificationItemWorkspace
          key={`${openCategory}-${locale}`}
          caseId={caseId}
          category={openCategory}
          categoryLabel={t(`re.cat.${openCategory}`)}

          item={byCategory.get(openCategory)}
          open
          onOpenChange={(v) => !v && setOpenCategory(null)}
          onChanged={invalidate}
        />
      )}


      {/* Core Parties panel, second mount point (one component, no duplication). */}
      <Card>
        <CardContent className="pt-6">
          <CasePartiesPanel caseId={caseId} embedded />
        </CardContent>
      </Card>
    </div>
  );
}
