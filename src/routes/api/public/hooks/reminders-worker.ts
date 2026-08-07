// Background reminders worker. Called by pg_cron every 5 minutes (see
// migration 20260807120000_case_reminders_and_worker.sql). Same security
// pattern as pipeline-worker.ts: lives under /api/public/* but requires the
// internal worker secret in x-worker-secret.
//
// Finds case_events/case_tasks whose reminder is enabled, not yet fired, and
// whose (scheduled time / due date) minus its lead time has arrived, then
// emails the owner (when "email" is one of the chosen channels) and stamps
// reminder_fired_at so it is never sent twice. Desktop/browser notifications
// are handled separately, client-side, by polling listDueReminders while the
// app is open — this worker's job is the channel that must work even when
// nobody has a tab open.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function workerTrace(event: string, extra: Record<string, unknown> = {}) {
  console.info(
    `[reminders-worker] ${JSON.stringify({ t: new Date().toISOString(), event, ...extra })}`,
  );
}

type DueEventRow = {
  id: string;
  case_id: string;
  user_id: string;
  title: string;
  scheduled_at: string;
  reminder_lead_minutes: number;
  reminder_channels: string[];
};
type DueTaskRow = {
  id: string;
  case_id: string;
  user_id: string;
  title: string;
  due_date: string;
  reminder_lead_minutes: number;
  reminder_channels: string[];
};

const SITE_URL = "https://mexico.nyrava.com";

async function sendReminderEmail(
  admin: ReturnType<typeof createClient<Database>>,
  userId: string,
  itemTitle: string,
  caseId: string,
  caseName: string,
  whenLabel: string,
  itemKind: "hearing" | "task",
) {
  const { data: userResp } = await admin.auth.admin.getUserById(userId);
  const email = userResp?.user?.email;
  if (!email) {
    workerTrace("email.no_address_on_file", { userId });
    return;
  }
  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
  await sendTemplateEmail("case-reminder", email, {
    templateData: {
      itemTitle,
      caseName,
      whenLabel,
      itemKind,
      caseUrl: `${SITE_URL}/cases/${caseId}`,
    },
  });
}

export const Route = createFileRoute("/api/public/hooks/reminders-worker")({
  server: {
    handlers: {
      GET: async () => new Response("Method Not Allowed", { status: 405 }),
      POST: async ({ request }) => {
        const provided = request.headers.get("x-worker-secret");
        if (!provided) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) {
          return new Response(JSON.stringify({ error: "backend env unavailable" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const admin = createClient<Database>(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sec, error: secErr } = await (admin as any)
          .from("worker_secrets")
          .select("secret")
          .eq("name", "reminders_worker")
          .maybeSingle();
        if (secErr || !sec?.secret) {
          return new Response(JSON.stringify({ error: "worker not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const a = new TextEncoder().encode(provided);
        const b = new TextEncoder().encode(sec.secret);
        let ok = a.length === b.length;
        for (let i = 0; i < Math.min(a.length, b.length); i++) ok = ok && a[i] === b[i];
        if (!ok) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const now = new Date();
        const grace = new Date(now.getTime() - 24 * 3600000);
        const horizon = new Date(now.getTime() + 35 * 86400000);

        const [eventsRes, tasksRes] = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (admin as any)
            .from("case_events")
            .select(
              "id, case_id, user_id, title, scheduled_at, reminder_lead_minutes, reminder_channels",
            )
            .eq("reminder_enabled", true)
            .is("reminder_fired_at", null)
            .gte("scheduled_at", grace.toISOString())
            .lte("scheduled_at", horizon.toISOString()) as Promise<{ data: DueEventRow[] | null }>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (admin as any)
            .from("case_tasks")
            .select(
              "id, case_id, user_id, title, due_date, reminder_lead_minutes, reminder_channels",
            )
            .eq("reminder_enabled", true)
            .is("reminder_fired_at", null)
            .in("status", ["todo", "in_progress", "blocked"])
            .not("due_date", "is", null)
            .lte("due_date", horizon.toISOString().slice(0, 10)) as Promise<{
            data: DueTaskRow[] | null;
          }>,
        ]);

        const dueEvents = (eventsRes.data ?? []).filter(
          (e) =>
            new Date(e.scheduled_at).getTime() - e.reminder_lead_minutes * 60000 <= now.getTime(),
        );
        const dueTasks = (tasksRes.data ?? []).filter(
          (t) =>
            new Date(`${t.due_date}T15:00:00.000Z`).getTime() - t.reminder_lead_minutes * 60000 <=
            now.getTime(),
        );

        if (dueEvents.length === 0 && dueTasks.length === 0) {
          return new Response(JSON.stringify({ ok: true, processed: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        const caseIds = Array.from(
          new Set([...dueEvents.map((e) => e.case_id), ...dueTasks.map((t) => t.case_id)]),
        );
        const { data: casesData } = (await admin
          .from("cases")
          .select("id, name")
          .in("id", caseIds)) as {
          data: { id: string; name: string }[] | null;
        };
        const nameOf = new Map<string, string>((casesData ?? []).map((c) => [c.id, c.name]));

        let processed = 0;
        for (const e of dueEvents) {
          try {
            if (e.reminder_channels?.includes("email")) {
              await sendReminderEmail(
                admin,
                e.user_id,
                e.title,
                e.case_id,
                nameOf.get(e.case_id) ?? "—",
                `Programado para ${new Date(e.scheduled_at).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}`,
                "hearing",
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("case_events")
              .update({ reminder_fired_at: now.toISOString() })
              .eq("id", e.id);
            processed++;
          } catch (err) {
            workerTrace("event.reminder_failed", {
              id: e.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        for (const t of dueTasks) {
          try {
            if (t.reminder_channels?.includes("email")) {
              await sendReminderEmail(
                admin,
                t.user_id,
                t.title,
                t.case_id,
                nameOf.get(t.case_id) ?? "—",
                `Vence el ${new Date(`${t.due_date}T12:00:00`).toLocaleDateString("es-MX")}`,
                "task",
              );
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any)
              .from("case_tasks")
              .update({ reminder_fired_at: now.toISOString() })
              .eq("id", t.id);
            processed++;
          } catch (err) {
            workerTrace("task.reminder_failed", {
              id: t.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return new Response(JSON.stringify({ ok: true, processed }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
