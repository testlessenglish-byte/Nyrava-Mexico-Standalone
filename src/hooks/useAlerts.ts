// SINGLE SOURCE OF TRUTH for notification/alert data, read-state, and
// dismiss-state ("delete").
//
// Both the header bell badge (src/routes/_app.tsx, mobile + desktop) and
// the /alerts page (src/routes/_app/alerts.tsx) MUST read through this
// hook. Previously the header badge rendered a hardcoded literal ("3")
// that was never wired to data at all, while the /alerts page had its own
// separate fetch + localStorage read-tracking. That's how the badge ended
// up permanently stuck at "3" regardless of actual alert state — fix it
// once, here, and never let count logic exist in two places again.
//
// "Delete" is implemented as a per-device dismiss list (localStorage),
// the same mechanism already used for read-state. There is no backend
// delete endpoint for alerts — dismissed alerts are simply filtered out
// of the list returned by this hook. If alerts need to stay dismissed
// across devices/browsers, that would require a server-side dismiss
// table + server fn instead of this client-only approach.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAlerts } from "@/lib/cases.functions";

export type AlertItem = {
  key: string;
  caseId: string;
  caseName: string;
  level: "info" | "warning" | "critical";
  title: string;
  detail?: string | null;
  at: string;
};

const READ_KEY = "nyrava.alerts.read";
const DISMISSED_KEY = "nyrava.alerts.dismissed";
// localStorage's native "storage" event only fires in OTHER tabs/windows,
// never in the tab that made the change. Dispatch this custom event too so
// every useAlerts() consumer in THIS tab (header badge + alerts page)
// re-renders the instant something is marked read or dismissed, without
// waiting on a refetch or a tab switch.
const READ_CHANGE_EVENT = "nyrava:alerts-read-changed";
const DISMISSED_CHANGE_EVENT = "nyrava:alerts-dismissed-changed";

function loadSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set();
  }
}

function persistSet(key: string, value: Set<string>, changeEvent: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify([...value]));
  window.dispatchEvent(new Event(changeEvent));
}

export function useAlerts() {
  const fetchAlerts = useServerFn(listAlerts);
  const { data, isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => fetchAlerts(),
    refetchInterval: 20000,
  });
  // Raw, unfiltered alerts as fetched from the server.
  const allAlerts = (data ?? []) as AlertItem[];

  const [read, setReadState] = useState<Set<string>>(() => loadSet(READ_KEY));
  const [dismissed, setDismissedState] = useState<Set<string>>(() => loadSet(DISMISSED_KEY));

  // Pick up read/dismiss changes made elsewhere: another tab (native
  // "storage" event) or another useAlerts() instance in this same tab
  // (custom events).
  useEffect(() => {
    const syncRead = () => setReadState(loadSet(READ_KEY));
    const syncDismissed = () => setDismissedState(loadSet(DISMISSED_KEY));
    const syncAll = () => {
      syncRead();
      syncDismissed();
    };
    window.addEventListener("storage", syncAll);
    window.addEventListener(READ_CHANGE_EVENT, syncRead);
    window.addEventListener(DISMISSED_CHANGE_EVENT, syncDismissed);
    return () => {
      window.removeEventListener("storage", syncAll);
      window.removeEventListener(READ_CHANGE_EVENT, syncRead);
      window.removeEventListener(DISMISSED_CHANGE_EVENT, syncDismissed);
    };
  }, []);

  const markRead = useCallback((key: string) => {
    setReadState((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      persistSet(READ_KEY, next, READ_CHANGE_EVENT);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setReadState((prev) => {
      const next = new Set(allAlerts.map((a) => a.key));
      if (next.size === prev.size && [...next].every((k) => prev.has(k))) return prev;
      persistSet(READ_KEY, next, READ_CHANGE_EVENT);
      return next;
    });
  }, [allAlerts]);

  // Dismiss ("delete") a single alert. Client-side only — see file header.
  const dismiss = useCallback((key: string) => {
    setDismissedState((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      persistSet(DISMISSED_KEY, next, DISMISSED_CHANGE_EVENT);
      return next;
    });
  }, []);

  // Dismiss every alert currently loaded ("Clear all").
  const dismissAll = useCallback(() => {
    setDismissedState((prev) => {
      const next = new Set([...prev, ...allAlerts.map((a) => a.key)]);
      if (next.size === prev.size) return prev;
      persistSet(DISMISSED_KEY, next, DISMISSED_CHANGE_EVENT);
      return next;
    });
  }, [allAlerts]);

  // Undo a dismiss (used by the "Undo" action on the delete toast).
  const restore = useCallback((key: string) => {
    setDismissedState((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      persistSet(DISMISSED_KEY, next, DISMISSED_CHANGE_EVENT);
      return next;
    });
  }, []);

  // Everything downstream (the page, the badge count) sees only the
  // non-dismissed alerts. Dismissed alerts are filtered out here, once,
  // so no consumer has to remember to apply the dismiss filter itself.
  const alerts = useMemo(() => allAlerts.filter((a) => !dismissed.has(a.key)), [allAlerts, dismissed]);

  const unread = useMemo(() => alerts.filter((a) => !read.has(a.key)), [alerts, read]);

  return {
    alerts,
    isLoading,
    read,
    unread,
    unreadCount: unread.length,
    markRead,
    markAllRead,
    dismissed,
    dismiss,
    dismissAll,
    restore,
  };
}
