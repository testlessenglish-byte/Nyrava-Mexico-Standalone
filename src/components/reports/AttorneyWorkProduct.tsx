// Attorney work product — case strategy, strengths/weaknesses, motion
// opportunities, thematic lines for hearings, and cross-examination outlines.
// Mexican procedural terminology throughout (no jury/voir dire/discovery).
import { useI18n } from "@/i18n";
import { ArchivableList, dedupeCrossExams, stableKey, type ItemFlags } from "./shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AttorneyWorkProduct({
  fullReport,
  caseId,
  itemFlags,
}: {
  fullReport: any;
  caseId?: string | null;
  itemFlags?: ItemFlags;
}) {
  const { t } = useI18n();
  const section = "attorney_work_product" as const;
  const flags = itemFlags?.[section] ?? {};
  const wp = fullReport?.attorney_work_product as
    | {
        case_strategy?: string;
        strengths?: Array<{ text: string; citation: string }>;
        weaknesses?: Array<{ text: string; citation: string }>;
        motion_opportunities?: Array<{ motion: string; basis: string; source_document: string }>;
        trial_themes?: string[];
        cross_examination_outlines?: Array<{ witness: string; topics: string[] }>;
        jury_themes?: string[];
      }
    | undefined;
  if (!wp) return null;

  const strengths = (wp.strengths ?? []).map((s) => ({ ...s, __key: `strength:${stableKey([s.text, s.citation])}` }));
  const weaknesses = (wp.weaknesses ?? []).map((s) => ({ ...s, __key: `weakness:${stableKey([s.text, s.citation])}` }));
  const motions = (wp.motion_opportunities ?? []).map((m) => ({
    ...m,
    __key: `motion:${stableKey([m.motion, m.basis, m.source_document])}`,
  }));
  const crossExams = dedupeCrossExams(wp.cross_examination_outlines ?? []).map((c) => ({
    ...c,
    __key: `xexam:${stableKey([c.witness, ...c.topics])}`,
  }));
  const trialThemes = wp.trial_themes ?? [];
  const hearingThemes = wp.jury_themes ?? [];

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{t("reports.workProduct.title")}</p>
      <div className="mt-3 space-y-4 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.workProduct.caseStrategy")}</p>
          <p className="mt-1 text-sm">{wp.case_strategy}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ArchivableList
            title={t("reports.workProduct.strengths")}
            items={strengths}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText={t("reports.workProduct.strengths.empty")}
            renderItem={(s) => (
              <div className="text-xs">
                {s.text} <span className="text-muted-foreground">{s.citation}</span>
              </div>
            )}
          />
          <ArchivableList
            title={t("reports.workProduct.weaknesses")}
            items={weaknesses}
            section={section}
            caseId={caseId}
            flags={flags}
            emptyText={t("reports.workProduct.weaknesses.empty")}
            renderItem={(s) => (
              <div className="text-xs">
                {s.text} <span className="text-muted-foreground">{s.citation}</span>
              </div>
            )}
          />
        </div>
        <ArchivableList
          title={t("reports.workProduct.motions")}
          items={motions}
          section={section}
          caseId={caseId}
          flags={flags}
          emptyText={t("reports.workProduct.motions.empty")}
          renderItem={(m) => (
            <>
              <div className="font-medium text-xs">{m.motion}</div>
              <div className="text-xs text-muted-foreground">{m.basis}</div>
              <div className="text-[10px] text-muted-foreground">
                {t("reports.workProduct.motions.source", { source: m.source_document })}
              </div>
            </>
          )}
        />
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.workProduct.trialThemes")}</p>
          {trialThemes.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
              {trialThemes.map((th, i) => (
                <li key={i}>{th}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("reports.workProduct.trialThemes.empty")}</p>
          )}
        </div>
        <ArchivableList
          title={t("reports.workProduct.crossExam")}
          items={crossExams}
          section={section}
          caseId={caseId}
          flags={flags}
          emptyText={t("reports.workProduct.crossExam.empty")}
          renderItem={(c) => (
            <>
              <div className="font-medium text-xs">{c.witness}</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {c.topics.map((tp, j) => (
                  <li key={j}>{tp}</li>
                ))}
              </ul>
            </>
          )}
        />
        <div>
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">{t("reports.workProduct.hearingThemes")}</p>
          {hearingThemes.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
              {hearingThemes.map((th, i) => (
                <li key={i}>{th}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("reports.workProduct.hearingThemes.empty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
