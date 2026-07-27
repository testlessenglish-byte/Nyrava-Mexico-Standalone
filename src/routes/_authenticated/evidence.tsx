import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { FileSearch, Search } from "lucide-react";
import { getCase } from "@/lib/cases.functions";
import { CasePicker, useActiveCase } from "@/components/modules/CasePicker";
import { ModuleHeader, ModuleEmpty } from "@/components/modules/SuppressedNotice";
import { EvidenceCitation } from "@/components/modules/EvidenceCitation";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/evidence")({
  head: () => ({ meta: [{ title: "Explorador de Evidencia — Nyrava" }] }),
  component: EvidencePage,
});

type Finding = {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  confidence: number;
  source_quote?: string | null;
  source_page?: number | null;
  source_document_id?: string | null;
  source_doc_ids?: string[] | null;
  finding_type?: string | null;
  evidence_type?: string | null;
};

function EvidencePage() {
  const { t } = useI18n();
  const { cases, activeId, isLoading } = useActiveCase();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [severity, setSeverity] = useState<string>("all");

  const caseId = selected ?? activeId;
  const fetchCase = useServerFn(getCase);
  const { data, isLoading: caseLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { caseId: caseId! } }),
    enabled: !!caseId,
  });

  const docMap = useMemo(() => {
    const m = new Map<string, string>();
    (data?.documents ?? []).forEach((d: any) => m.set(d.id, d.filename));
    return m;
  }, [data]);

  const findings = (data?.findings ?? []) as Finding[];
  const filtered = findings.filter((f) => {
    if (severity !== "all" && f.severity !== severity) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      f.title.toLowerCase().includes(q) ||
      f.description?.toLowerCase().includes(q) ||
      f.source_quote?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <ModuleHeader
        icon={<FileSearch className="h-5 w-5" />}
        title={t("mod.evidence.title")}
        subtitle={t("mod.evidence.subtitle")}
      />
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.loadingCases")}</div>
      ) : (
        <div className="space-y-5">
          <CasePicker cases={cases} activeId={caseId} onChange={setSelected} />
          {caseId ? (
            <>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    placeholder={t("mod.evidence.search")}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
                  />
                </div>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm"
                >
                  <option value="all">{t("mod.evidence.sev.all")}</option>
                  <option value="critical">{t("mod.evidence.sev.critical")}</option>
                  <option value="high">{t("mod.evidence.sev.high")}</option>
                  <option value="medium">{t("mod.evidence.sev.medium")}</option>
                  <option value="low">{t("mod.evidence.sev.low")}</option>
                </select>
              </div>

              {caseLoading ? (
                <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">{t("mod.evidence.loading")}</div>
              ) : filtered.length === 0 ? (
                <ModuleEmpty title={t("mod.evidence.empty.title")} hint={t("mod.evidence.empty.hint")} />
              ) : (
                <div className="grid gap-3">
                  {filtered.map((f) => (
                    <article key={f.id} className="rounded-xl border border-border bg-card/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold leading-tight">{f.title}</h3>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{f.category}</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{f.severity}</span>
                            {f.finding_type ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{f.finding_type.replace(/_/g, " ").toLowerCase()}</span>
                            ) : null}
                            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{t("mod.conf")} {Math.round((f.confidence ?? 0) * 100)}%</span>
                          </div>
                        </div>
                      </div>
                      {f.description ? (
                        <p className="mt-2 text-sm text-foreground/90">{f.description}</p>
                      ) : null}
                      {f.source_quote || f.source_document_id ? (
                        <div className="mt-3">
                          <EvidenceCitation
                            documentName={f.source_document_id ? docMap.get(f.source_document_id) : null}
                            page={f.source_page ?? null}
                            quote={f.source_quote ?? null}
                          />
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
