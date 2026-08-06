import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo } from "react";
import { listCases } from "@/lib/cases.functions";
import { ChevronDown, FolderOpen, Plus } from "lucide-react";
import { useI18n } from "@/i18n";


const LS_KEY = "nyrava.module.activeCase";

// Recency key used to pick the default case: most recently *run* first
// (completed_at — when its last analysis pipeline finished), falling back to
// most recently *created* for cases that haven't completed a run yet.
function lastRunRank(c: { completed_at?: string | null; created_at?: string | null }): string {
  return c.completed_at ?? c.created_at ?? "";
}

export function useActiveCase(initial: string | null = null) {
  const fetchCases = useServerFn(listCases);
  const { data, isLoading } = useQuery({
    queryKey: ["cases"],
    queryFn: () => fetchCases(),
    refetchInterval: 15000,
  });
  const cases = useMemo(() => (data ?? []).filter((c) => !c.archived_at), [data]);
  // Default target: the case whose analysis most recently finished running,
  // not just whichever one listCases() happened to return first.
  const mostRecentlyRunId = useMemo(() => {
    if (cases.length === 0) return null;
    return [...cases].sort((a, b) => lastRunRank(b).localeCompare(lastRunRank(a)))[0].id;
  }, [cases]);

  // Session-scoped only: an explicit pick should follow the attorney across
  // module pages for the rest of this browsing session, but a new session
  // (new tab, next day) must default to the most recently run case again
  // instead of resurrecting a pick from days ago (localStorage never expired).
  const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(LS_KEY) : null;
  const initialId = initial ?? stored ?? null;

  const exists = initialId && cases.some((c) => c.id === initialId);
  const activeId = exists ? initialId : mostRecentlyRunId;

  useEffect(() => {
    if (activeId && typeof window !== "undefined") {
      window.sessionStorage.setItem(LS_KEY, activeId);
    }
  }, [activeId]);

  return { cases, activeId, isLoading };
}

export function CasePicker({
  cases,
  activeId,
  onChange,
}: {
  cases: Array<{ id: string; name: string; status: string; status_message: string | null }>;
  activeId: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  if (cases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center">
        <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          {t("cases.picker.empty")}
        </p>
        <Link
          to="/new"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> {t("cases.new")}
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <label className="mb-1.5 block px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("cases.picker.label")}
      </label>

      <div className="relative">
        <select
          value={activeId ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 pr-9 text-sm outline-none focus:border-primary"
        >
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.status_message ?? c.status}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}
