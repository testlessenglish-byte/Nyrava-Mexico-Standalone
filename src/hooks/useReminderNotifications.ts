// Fires browser/desktop notifications for due case reminders while the app
// is open. Email delivery (works even with no tab open) is handled
// server-side by the reminders-worker cron job — this hook only covers the
// "notify me on this computer" channel, which by nature only works while
// the browser is running.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDueReminders, type DueReminder } from "@/lib/casework.functions";

const FIRED_KEY = "nyrava.remindersFired";

function loadFired(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveFired(ids: Set<string>) {
  try {
    // Cap growth — keep the most recent 500 fired ids.
    const arr = Array.from(ids).slice(-500);
    localStorage.setItem(FIRED_KEY, JSON.stringify(arr));
  } catch {
    /* best-effort */
  }
}

export function useReminderNotifications(enabled: boolean) {
  const fetchDue = useServerFn(listDueReminders);
  const firedRef = useRef<Set<string> | null>(null);

  const { data } = useQuery({
    queryKey: ["due-reminders"],
    queryFn: () => fetchDue(),
    refetchInterval: 60000,
    enabled,
  });

  useEffect(() => {
    if (!enabled || !data || typeof window === "undefined" || !("Notification" in window)) return;
    if (!firedRef.current) firedRef.current = loadFired();
    const fired = firedRef.current;

    const due = (data as DueReminder[]).filter((r) =>
      !r.channels.includes("browser") ? false : !fired.has(`${r.type}:${r.id}`),
    );
    if (due.length === 0) return;

    if (Notification.permission === "default") {
      void Notification.requestPermission();
      return;
    }
    if (Notification.permission !== "granted") return;

    for (const r of due) {
      const key = `${r.type}:${r.id}`;
      try {
        new Notification(
          r.type === "event" ? "Recordatorio de audiencia/evento" : "Recordatorio de vencimiento",
          {
            body: `${r.title} — ${r.case_name}`,
            tag: key,
          },
        );
      } catch {
        /* Notification constructor can throw in some contexts; best-effort */
      }
      fired.add(key);
    }
    saveFired(fired);
  }, [data, enabled]);
}

/** Call once (e.g. from the reminder toggle UI) to prompt for permission
 * in response to a user gesture, since browsers block silent auto-prompts. */
export function requestDesktopNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window))
    return Promise.resolve("unsupported" as const);
  return Notification.requestPermission();
}
