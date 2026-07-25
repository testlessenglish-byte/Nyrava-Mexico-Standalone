import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { listCases } from "@/lib/cases.functions";
import { FolderOpen, Plus, Archive as ArchiveIcon, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { CaseActionsMenu } from "@/components/CaseActionsMenu";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/cases/")({
  head: () => ({ meta: [{ title: "Cases — Nyrava" }] }),
  component: CasesPage,
});

const RUNNING = new Set(["extracting","analyzing","agents_running","scoring","reporting","intelligence_running"]);

const STATUS_FILTERS = [
  { value: "all",        labelKey: "cases.filter.all" },
  { value: "running",    labelKey: "cases.filter.running" },
  { value: "complete",   labelKey: "cases.filter.complete" },
  { value: "intelligence_complete", labelKey: "cases.filter.intelligenceComplete" },
  { value: "uploaded",   labelKey: "cases.filter.uploaded" },
  { value: "failed",     labelKey: "cases.filter.failed" },
  { value: "cancelled",  labelKey: "cases.filter.cancelled" },
] as const;

const SORTS = [
  { value: "newest", labelKey: "cases.sort.newest" },
  { value: "oldest", labelKey: "cases.sort.oldest" },
  { value: "name",   labelKey: "cases.sort.name" },
  { value: "status", labelKey: "cases.sort.status" },
] as const;

const PAGE_SIZE = 8;

function fmtDate(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  } catch { return ""; }
}

function CasesPage() {
  const { t, locale } = useI18n();
  const fetchCases = useServerFn(listCases);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("newest");
  const [page, setPage] = useState(1);

  const { data: cases, isLoading } = useQuery({
    queryKey: ["cases"],
    queryFn: () => fetchCases(),
    refetchInterval: 4000,
  });

  const filtered = useMemo(() => {
    let arr = (cases ?? []).filter((c) => showArchived ? !!c.archived_at : !c.archived_at);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      if (statusFilter === "running") arr = arr.filter((c) => RUNNING.has(c.status));
      else arr = arr.filter((c) => c.status === statusFilter);
    }
    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case "oldest": return +new Date(a.created_at) - +new Date(b.created_at);
        case "name":   return a.name.localeCompare(b.name);
        case "status": return a.status.localeCompare(b.status);
        default:       return +new Date(b.created_at) - +new Date(a.created_at);
      }
    });
    return arr;
  }, [cases, showArchived, query, statusFilter, sort]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [query, statusFilter, sort, showArchived]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold sm:text-3xl">{t("cases.title")}</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t("cases.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs sm:text-sm ${showArchived ? "border-accent text-accent" : "border-border text-muted-foreground hover:bg-secondary"}`}
            aria-label={showArchived ? t("cases.toggle.showActive") : t("cases.toggle.showArchived")}
          >
            <ArchiveIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{showArchived ? t("cases.toggle.active") : t("cases.toggle.archived")}</span>
          </button>
          <Link
            to="/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-90 sm:text-sm"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("cases.new")}</span>
            <span className="sm:hidden">{t("cases.new.short")}</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("cases.search.placeholder")}
            className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 rounded-md border border-border bg-card px-2 py-2 text-sm sm:flex-none"
          >
            {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{t(s.labelKey)}</option>)}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="flex-1 rounded-md border border-border bg-card px-2 py-2 text-sm sm:flex-none"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{t(s.labelKey)}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">
            {cases && cases.length > 0
              ? t("cases.empty.noMatches")
              : showArchived
                ? t("cases.empty.archived")
                : t("cases.empty.none")}
          </h2>
          {(!cases || cases.length === 0) && !showArchived && (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("cases.empty.hint")}
              </p>
              <Link
                to="/new"
                className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                {t("cases.empty.cta")}
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3">
            <CasesPager
              page={safePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              onPage={setPage}
            />
          </div>

          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {pageItems.map((c) => (
              <div
                key={c.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 hover:bg-secondary/60 sm:px-5 sm:py-4"
              >
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: c.id }}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground sm:text-base">{c.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {fmtDate(c.created_at, locale)}{c.status_message ? ` · ${c.status_message}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={c.status} progress={c.progress} />
                  </div>
                </Link>
                <div className="shrink-0">
                  <CaseActionsMenu
                    caseId={c.id}
                    name={c.name}
                    archived={!!c.archived_at}
                    running={RUNNING.has(c.status)}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-4">
            <CasesPager
              page={safePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              onPage={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CasesPager({
  page,
  totalPages,
  totalItems,
  onPage,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  const start = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-2">
      <div className="text-xs tabular-nums text-muted-foreground">
        {t("cases.pager.range", { start, end, total: totalItems })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-sm disabled:opacity-40"
            aria-label={t("common.pager.prev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-12 px-2 text-center text-sm tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-sm disabled:opacity-40"
            aria-label={t("common.pager.next")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
