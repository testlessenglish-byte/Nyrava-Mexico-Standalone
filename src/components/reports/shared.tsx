// Shared table/list infrastructure for the Reports page sections: sorting,
// pagination, archive/delete row actions, and the item-flags mutation used
// by every generated-analysis section (report.item_flags).
import { useState, useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { setReportItemFlag } from "@/lib/cases.functions";
import { toast } from "sonner";
import { useI18n } from "@/i18n";

export type SortDir = "asc" | "desc";

export function useSort<T>(rows: T[], initial: keyof T) {
  const [key, setKey] = useState<keyof T>(initial);
  const [dir, setDir] = useState<SortDir>("asc");
  const sorted = [...rows].sort((a, b) => {
    const av = a[key] as unknown as string | number;
    const bv = b[key] as unknown as string | number;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
  const toggle = (k: keyof T) => {
    if (k === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setKey(k);
      setDir("asc");
    }
  };
  return { rows: sorted, key, dir, toggle };
}

export function Th({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th
      onClick={onClick}
      className="cursor-pointer border-b border-border px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
    >
      {label}
      {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}

// Real DB row for Evidence Map (documents table has real ids + archived_at).
export type DocumentRow = { id: string; filename: string; archived_at: string | null };

// The other report tables (Evidence Inventory, Legal Issues, Contradictions,
// Agent Stats, Witness Profiles) are generated analysis text inside
// report.full_report — there is no row of their own to key off. itemFlags
// comes straight from reports.item_flags (server-persisted, shared by every
// user viewing the case) and is keyed by a stable hash of each item's
// identifying fields, computed the same way on every render.
export type ItemFlags = Record<string, Record<string, "archived" | "deleted">> | null | undefined;

export function stableKey(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => String(p ?? "")).join("||");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// Cross-examination outlines are generated per witness mention, so the same
// person can show up multiple times under slightly different strings
// ("Detective Raymond Ortiz", "Detective Ortiz", "Detective Ortiz's"). Group
// those under one card instead of rendering near-duplicate blocks: strip a
// trailing possessive, collapse whitespace, and compare case-insensitively.
export function normalizeWitnessKey(name: string): string {
  return name
    .trim()
    .replace(/['’]s$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function dedupeCrossExams(
  list: Array<{ witness: string; topics: string[] }>,
): Array<{ witness: string; topics: string[] }> {
  const groups = new Map<string, { witness: string; topics: string[] }>();
  for (const c of list) {
    const key = normalizeWitnessKey(c.witness);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { witness: c.witness, topics: [...c.topics] });
      continue;
    }
    // Prefer the fuller name (e.g. "Detective Raymond Ortiz" over "Detective Ortiz's") for display.
    if (c.witness.length > existing.witness.length) existing.witness = c.witness;
    for (const t of c.topics) {
      if (!existing.topics.includes(t)) existing.topics.push(t);
    }
  }
  return Array.from(groups.values());
}

// Mutation helper for the generic item_flags sections. Calls the server,
// then invalidates the case query so `report.item_flags` (and therefore
// every table reading it) refreshes from the source of truth.
export function useItemFlagActions(caseId: string | null | undefined) {
  const { t } = useI18n();
  const setFlag = useServerFn(setReportItemFlag);
  const queryClient = useQueryClient();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const apply = async (
    section:
      | "evidence_inventory"
      | "legal_issues"
      | "contradictions"
      | "agent_statistics"
      | "witness_profiles"
      | "case_opportunities"
      | "attorney_work_product",
    itemKey: string,
    flag: "active" | "archived" | "deleted",
  ) => {
    if (!caseId) return;
    const pk = `${section}:${itemKey}`;
    setPendingKey(pk);
    try {
      await setFlag({ data: { caseId, section, itemKey, flag } });
      await queryClient.invalidateQueries({ queryKey: ["case", caseId] });
    } catch (e) {
      toast.error(t("reports.toast.updateFailed", { error: e instanceof Error ? e.message : t("reports.error.unknown") }));
    } finally {
      setPendingKey(null);
    }
  };

  return { apply, pendingKey };
}

export function ViewToggle({
  view,
  onChange,
  activeCount,
  archivedCount,
}: {
  view: "active" | "archived";
  onChange: (v: "active" | "archived") => void;
  activeCount: number;
  archivedCount: number;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-background/60 p-0.5 text-xs">
      <button
        onClick={() => onChange("active")}
        className={`rounded-md px-2 py-1 ${view === "active" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >
        {t("reports.view.active", { count: activeCount })}
      </button>
      <button
        onClick={() => onChange("archived")}
        className={`rounded-md px-2 py-1 ${view === "archived" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >
        {t("reports.view.archived", { count: archivedCount })}
      </button>
    </div>
  );
}

export function RowActions({
  view,
  pending,
  onArchive,
  onDelete,
}: {
  view: "active" | "archived";
  pending: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={onArchive}
        className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-background/60 disabled:opacity-40"
      >
        {view === "archived" ? t("reports.action.unarchive") : t("reports.action.archive")}
      </button>
      <button
        disabled={pending}
        onClick={onDelete}
        className="rounded border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-40"
      >
        {t("reports.action.delete")}
      </button>
    </div>
  );
}

export function Pager({
  page,
  setPage,
  pageSize,
  setPageSize,
  total,
}: {
  page: number;
  setPage: (n: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  total: number;
}) {
  const { t } = useI18n();
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>{t("reports.pager.rowsPerPage")}</span>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded border border-border bg-background/60 px-1.5 py-1 text-xs"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span>
          {t("reports.pager.range", { start: start + 1, end: Math.min(start + pageSize, total), total })}
        </span>
        <button
          onClick={() => setPage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          {t("reports.pager.prev")}
        </button>
        <span>{t("reports.pager.page", { page: currentPage, total: totalPages })}</span>
        <button
          onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="rounded border border-border px-2 py-1 disabled:opacity-40"
        >
          {t("reports.pager.next")}
        </button>
      </div>
    </div>
  );
}

// ---------- Shared list variant of the archive/delete + pagination pattern ----------
// Used by sections (Case Opportunities, Attorney Work Product) that render several
// independent sub-lists rather than one table. Each sub-list gets its own
// Active/Archived toggle and its own pager, but all persist through the same
// report.item_flags[section] map — callers must give each item a __key that's
// unique within that section (prefix by sub-list name if needed).
export function ArchivableList<T extends { __key: string }>({
  title,
  items,
  section,
  caseId,
  flags,
  renderItem,
  emptyText,
  pageSize: initialPageSize = 10,
}: {
  title: string;
  items: T[];
  section: "case_opportunities" | "attorney_work_product";
  caseId?: string | null;
  flags: Record<string, "archived" | "deleted">;
  renderItem: (item: T) => ReactNode;
  emptyText: string;
  pageSize?: number;
}) {
  const { t } = useI18n();
  const { apply, pendingKey } = useItemFlagActions(caseId);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const notDeleted = items.filter((i) => flags[i.__key] !== "deleted");
  const viewItems = notDeleted.filter((i) =>
    view === "archived" ? flags[i.__key] === "archived" : flags[i.__key] !== "archived",
  );
  const archivedCount = notDeleted.filter((i) => flags[i.__key] === "archived").length;
  const activeCount = notDeleted.length - archivedCount;

  useEffect(() => {
    setPage(1);
  }, [view, pageSize, items.length]);

  if (!items.length) return null;

  const totalPages = Math.max(1, Math.ceil(viewItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = viewItems.slice(start, start + pageSize);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
          {title} ({notDeleted.length})
        </p>
        <ViewToggle view={view} onChange={setView} activeCount={activeCount} archivedCount={archivedCount} />
      </div>
      <ul className="mt-1 space-y-2">
        {pageItems.map((item) => (
          <li key={item.__key} className="rounded border border-border bg-background/40 p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">{renderItem(item)}</div>
              <RowActions
                view={view}
                pending={pendingKey === `${section}:${item.__key}`}
                onArchive={() => apply(section, item.__key, view === "archived" ? "active" : "archived")}
                onDelete={() => {
                  if (window.confirm(t("reports.confirm.removeItem"))) apply(section, item.__key, "deleted");
                }}
              />
            </div>
          </li>
        ))}
        {!pageItems.length ? (
          <li className="list-none text-xs text-muted-foreground">
            {view === "archived" ? t("reports.empty.archivedItems") : emptyText}
          </li>
        ) : null}
      </ul>
      <Pager page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={viewItems.length} />
    </div>
  );
}

export function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function StatusPill({ s }: { s: "complete" | "partial" | "missing" }) {
  const { t } = useI18n();
  const cfg =
    s === "complete"
      ? { icon: "✅", label: t("reports.status.complete"), cls: "border-primary/40 bg-primary/10 text-primary" }
      : s === "partial"
        ? {
            icon: "⚠️",
            label: t("reports.status.partial"),
            cls: "border-yellow-500/40 bg-yellow-500/10 text-yellow-600",
          }
        : { icon: "❌", label: t("reports.status.missing"), cls: "border-destructive/40 bg-destructive/10 text-destructive" };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}
    >
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

// Skipped-section / skipped-agent notice: instead of a bare "Skipped" badge,
// always pair it with a localized human-readable reason.
export function SkippedNotice({ reason }: { reason?: string | null }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-col gap-0.5 rounded border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wide">{t("reports.badge.skipped")}</span>
      <span>{reason || t("reports.badge.skippedReason.default")}</span>
    </span>
  );
}
