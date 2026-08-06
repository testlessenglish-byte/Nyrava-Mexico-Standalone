import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Gavel, Copy, FileText, FileDown, Printer, Pencil, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { getCase, draftMotion, getMotionDrafts } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader, SuppressedNotice } from "@/components/modules/SuppressedNotice";
import { ModuleStateNotice } from "@/components/modules/ModuleStatus";
import { computeModuleStates, selectMotionOpportunities } from "@/lib/modules/applicability";
import { isDeterministicFallback } from "@/lib/intelligence/canonical";
import { MotionPreview, downloadMotionPdf, printMotion } from "@/lib/motion-markdown";
import { MotionEditor } from "@/components/MotionEditor";
import { buildSupportingAuthority } from "@/lib/intelligence/authority";
import { SupportingAuthorityCard } from "@/components/SupportingAuthorityCard";
import { CaseDetailPanel, type CaseDetailContext } from "@/components/CaseDetailPanel";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/motion")({
  head: () => ({
    meta: [
      { title: "Centro de Promociones — Nyrava Intelligence México" },
      {
        name: "description",
        content:
          "Promociones y escritos respaldados por evidencia verificada, con validación de suficiencia probatoria.",
      },
      { property: "og:title", content: "Centro de Promociones — Nyrava México" },
      {
        property: "og:description",
        content: "Promociones legales generadas a partir de evidencia verificada del expediente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MotionPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Draft = any;

function MotionPage() {
  const { t } = useI18n();
  const { cases, activeId, isLoading } = useActiveCase();
  const [selected, setSelected] = useState<string | null>(null);
  const caseId = selected ?? activeId;
  const fetchCase = useServerFn(getCase);
  const { data, isLoading: caseLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { caseId: caseId! } }),
    enabled: !!caseId,
  });

  const report = data?.report as any;
  const jurisdiction = data?.case?.jurisdiction ?? null;
  const [caseDetail, setCaseDetail] = useState<CaseDetailContext | null>(null);
  const motionsSuppressed = report?.motions_suppressed === true;
  const detFallback = isDeterministicFallback(report);
  const opps = selectMotionOpportunities(data);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t("motion.toast.copied")),
      () => toast.error(t("motion.toast.copyFailed")),
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader icon={<Gavel className="h-5 w-5" />} title={t("motion.title")} subtitle={t("motion.subtitle")} />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
          {t("motion.loadingCases")}
        </div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            caseLoading ? (
              <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
                {t("motion.loadingMotions")}
              </div>
            ) : motionsSuppressed ? (
              <SuppressedNotice title={t("motion.suppressed.title")} detail={t("motion.suppressed.detail")} />
            ) : opps.length === 0 ? (
              <ModuleStateNotice state={computeModuleStates(data).find((m) => m.key === "motion")!} />
            ) : (
              <>
                {detFallback ? <SuppressedNotice title={t("motion.limited")} /> : null}
                <div className="grid gap-3">
                  {opps.map((o) => (
                    <OpportunityCard
                      key={o.id}
                      o={o}
                      caseId={caseId}
                      copy={copy}
                      report={report}
                      jurisdiction={jurisdiction}
                      onSelectCase={setCaseDetail}
                    />
                  ))}
                </div>
              </>
            )
          ) : null}
        </div>
      )}
      <CaseDetailPanel open={!!caseDetail} onOpenChange={(o) => !o && setCaseDetail(null)} context={caseDetail} />
    </div>
  );
}

function OpportunityCard({
  o,
  caseId,
  copy,
  report,
  jurisdiction,
  onSelectCase,
}: {
  o: any;
  caseId: string;
  copy: (t: string) => void;
  report: any;
  jurisdiction: string | null;
  onSelectCase: (ctx: CaseDetailContext) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const fetchDrafts = useServerFn(getMotionDrafts);
  const { data: draftsData } = useQuery({
    queryKey: ["motion-drafts", caseId],
    queryFn: () => fetchDrafts({ data: { caseId } }),
    enabled: !!caseId,
  });
  const drafts: Draft[] = draftsData?.drafts ?? [];
  const draftByTitle = new Map(drafts.map((d) => [d.motion_title, d]));

  return (
    <article className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{o.title}</h3>
        <span className="text-[11px] uppercase text-muted-foreground">
          {o.side} · {o.severity}
        </span>
      </div>
      <p className="mt-1.5 text-sm">{o.description}</p>
      {Array.isArray(o.recommended_motions) && o.recommended_motions.length > 0 ? (
        <div className="mt-3 space-y-2">
          {o.recommended_motions.map((m: any, i: number) => {
            const text = typeof m === "string" ? m : (m.title ?? m.name ?? JSON.stringify(m));
            const existing = draftByTitle.get(text);
            return (
              <MotionRow
                key={i}
                motionTitle={text}
                caseId={caseId}
                opportunityDescription={o.description ?? null}
                opportunitySeverity={o.severity ?? null}
                opportunityCitations={Array.isArray(o.citations) ? o.citations : []}
                report={report}
                jurisdiction={jurisdiction}
                onSelectCase={onSelectCase}
                existing={existing}
                copy={copy}
                onDrafted={() => qc.invalidateQueries({ queryKey: ["motion-drafts", caseId] })}
              />
            );
          })}
        </div>
      ) : null}
      {Array.isArray(o.citations) && o.citations.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("motion.citations", { n: o.citations.length })}</p>
      ) : null}
    </article>
  );
}

function MotionRow({
  motionTitle,
  caseId,
  opportunityDescription,
  opportunitySeverity,
  opportunityCitations,
  report,
  jurisdiction,
  onSelectCase,
  existing,
  copy,
  onDrafted,
}: {
  motionTitle: string;
  caseId: string;
  opportunityDescription: string | null;
  opportunitySeverity?: string | null;
  opportunityCitations?: unknown[];
  report?: any;
  jurisdiction?: string | null;
  onSelectCase?: (ctx: CaseDetailContext) => void;
  existing?: Draft;
  copy: (t: string) => void;
  onDrafted: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [liveBody, setLiveBody] = useState<string | null>(null);
  const authority = useMemo(
    () =>
      buildSupportingAuthority({
        report,
        motionTitle,
        opportunityDescription,
        opportunitySeverity: opportunitySeverity ?? null,
        opportunityCitations: opportunityCitations ?? [],
      }),
    [report, motionTitle, opportunityDescription, opportunitySeverity, opportunityCitations],
  );
  const draftFn = useServerFn(draftMotion);
  const mutation = useMutation({
    mutationFn: (opts: { regenerate?: boolean }) =>
      draftFn({
        data: {
          caseId,
          motionTitle,
          opportunityDescription,
          caseLawCitations: authority.cases.slice(0, 5).map((c) => ({
            case_name: c.case_name,
            citation: c.citation,
            court: c.court,
            url: c.url,
          })),
        },
      }),
    onMutate: (opts) => {
      toast.info(opts.regenerate ? t("motion.toast.redrafting") : t("motion.toast.drafting"));
    },
    onSuccess: () => {
      toast.success(t("motion.toast.ready"));
      setExpanded(true);
      onDrafted();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t("motion.toast.failed")),
  });

  useEffect(() => {
    setLiveBody(null);
    setEditing(false);
  }, [existing?.id]);

  const failed = existing?.status === "failed";
  const hasBody = !!existing && !failed && String(existing.body_markdown ?? "").trim().length > 0;

  return (
    <div className="rounded-lg bg-background/60 p-2.5">
      <SupportingAuthorityCard
        authority={authority}
        onSelectCase={(c) =>
          onSelectCase?.({
            case_: c,
            motionTitle,
            significance: authority.significance,
            jurisdiction: jurisdiction ?? null,
          })
        }
      />
      <div className="mt-2 flex items-start justify-between gap-2">
        <button
          className="flex items-center gap-1.5 text-left text-sm hover:underline disabled:no-underline"
          onClick={() => hasBody && setExpanded((v) => !v)}
          disabled={!hasBody}
        >
          {hasBody ? <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
          <span>{motionTitle}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {hasBody ? (
            <>
              <button
                title={t("motion.action.copy")}
                onClick={() => copy(liveBody ?? String(existing.body_markdown ?? ""))}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                title={t("motion.action.edit")}
                onClick={() => {
                  setExpanded(true);
                  setEditing((v) => !v);
                }}
                className={`rounded p-1 hover:text-foreground ${editing ? "text-foreground" : "text-muted-foreground"}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                title={t("motion.action.print")}
                onClick={() =>
                  printMotion(
                    String(existing.title ?? motionTitle),
                    liveBody ?? String(existing.body_markdown ?? ""),
                  ).catch((e) => toast.error(e instanceof Error ? e.message : t("motion.toast.exportFailed")))
                }
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Printer className="h-3.5 w-3.5" />
              </button>
              <button
                title={t("motion.action.pdf")}
                onClick={() =>
                  downloadMotionPdf(
                    String(existing.title ?? motionTitle),
                    liveBody ?? String(existing.body_markdown ?? ""),
                  ).catch((e) => toast.error(e instanceof Error ? e.message : t("motion.toast.exportFailed")))
                }
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <FileDown className="h-3.5 w-3.5" />
              </button>
              <button
                title={t("motion.action.regenerate")}
                onClick={() => mutation.mutate({ regenerate: true })}
                disabled={mutation.isPending}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCw className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          ) : (
            <button
              onClick={() => mutation.mutate({})}
              disabled={mutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50"
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {mutation.isPending ? t("motion.action.drafting") : t("motion.action.generate")}
            </button>
          )}
        </div>
      </div>
      {failed ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{existing?.error_message ?? t("motion.failed.retry")}</p>
      ) : null}
      {existing?.status === "unverified" || existing?.status === "rejected" ? (
        <p className="mt-1.5 text-xs text-amber-500">{existing.error_message}</p>
      ) : null}
      {hasBody && expanded ? (
        <>
          <p className="mt-2 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            {t("motion.disclaimer")}
          </p>
          {editing ? (
            <MotionEditor
              draftId={String(existing.id)}
              title={String(existing.title ?? motionTitle)}
              initialMarkdown={liveBody ?? String(existing.body_markdown ?? "")}
              initialNotes={String(existing.attorney_notes ?? "")}
              onSaved={setLiveBody}
            />
          ) : (
            <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-border bg-card/80 p-4">
              <MotionPreview markdown={liveBody ?? String(existing.body_markdown ?? "")} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
