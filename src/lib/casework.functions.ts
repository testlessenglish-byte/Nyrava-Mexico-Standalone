// Core Platform data layer — Parties, Tasks, Calendar and the attorney-facing
// lifecycle status. These are CORE capabilities: they exist for every Mexican
// materia. Practice-area specificity enters only through the registry
// (mexico-modules.ts): allowed party roles, seeded task templates and the
// lifecycle status vocabulary.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  getApplicableLifecycleStatuses,
  getApplicablePartyRoles,
  getTaskTemplates,
} from "@/lib/intelligence/practice-areas";
import { PROJECTION_LIKE } from "@/lib/intelligence/finding-selection";

const uuid = z.string().uuid();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCaseAccess(supabase: any, caseId: string) {
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_type, additional_domains, lifecycle_status")
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Expediente no encontrado o sin acceso");
  return data as {
    id: string;
    case_type: string | null;
    additional_domains: string[] | null;
    lifecycle_status: string | null;
  };
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

export const listCaseParties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caseId: string }) => z.object({ caseId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await assertCaseAccess(context.supabase, data.caseId);
    const { data: rows, error } = await context.supabase
      .from("case_parties")
      .select("*")
      .eq("case_id", data.caseId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      parties: rows ?? [],
      allowedRoles: getApplicablePartyRoles(c.case_type, c.additional_domains ?? []),
    };
  });

const partyInput = z.object({
  caseId: uuid,
  id: uuid.optional(),
  party_role: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  role_description: z.string().max(1000).nullable().optional(),
  contact: z.record(z.string(), z.string()).optional(),
});

export const upsertCaseParty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof partyInput>) => partyInput.parse(d))
  .handler(async ({ data, context }) => {
    const c = await assertCaseAccess(context.supabase, data.caseId);
    const allowed = getApplicablePartyRoles(c.case_type, c.additional_domains ?? []);
    if (!allowed.includes(data.party_role)) {
      throw new Error(`Rol no aplicable a esta materia: ${data.party_role}`);
    }
    const row = {
      case_id: data.caseId,
      user_id: context.userId,
      party_role: data.party_role,
      name: data.name,
      role_description: data.role_description ?? null,
      contact: data.contact ?? {},
    };
    const q = data.id
      ? context.supabase.from("case_parties").update(row).eq("id", data.id).select("*").single()
      : context.supabase.from("case_parties").insert(row).select("*").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteCaseParty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("case_parties").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const listCaseTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caseId: string }) => z.object({ caseId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await assertCaseAccess(context.supabase, data.caseId);
    const { data: rows, error } = await context.supabase
      .from("case_tasks")
      .select("*")
      .eq("case_id", data.caseId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const existing = new Set((rows ?? []).map((r) => r.template_key).filter(Boolean) as string[]);
    const templates = getTaskTemplates(c.case_type, c.additional_domains ?? []).filter(
      (t) => !existing.has(t.key),
    );
    return { tasks: rows ?? [], templates };
  });

const taskInput = z.object({
  caseId: uuid,
  id: uuid.optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).default("todo"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  assignee_hint: z.string().max(200).nullable().optional(),
  template_key: z.string().max(120).nullable().optional(),
});

export const upsertCaseTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof taskInput>) => taskInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertCaseAccess(context.supabase, data.caseId);
    const row = {
      case_id: data.caseId,
      user_id: context.userId,
      title: data.title,
      description: data.description ?? null,
      due_date: data.due_date || null,
      status: data.status,
      priority: data.priority,
      assignee_hint: data.assignee_hint ?? null,
      template_key: data.template_key ?? null,
    };
    const q = data.id
      ? context.supabase.from("case_tasks").update(row).eq("id", data.id).select("*").single()
      : context.supabase.from("case_tasks").insert(row).select("*").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteCaseTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("case_tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Seeds the practice-area task checklist for a case (idempotent by template_key). */
export const seedCaseTaskTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caseId: string; locale?: "es" | "en" }) =>
    z.object({ caseId: uuid, locale: z.enum(["es", "en"]).default("es") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await assertCaseAccess(context.supabase, data.caseId);
    const { data: rows } = await context.supabase
      .from("case_tasks")
      .select("template_key")
      .eq("case_id", data.caseId);
    const existing = new Set((rows ?? []).map((r) => r.template_key).filter(Boolean) as string[]);
    const today = new Date();
    const pending = getTaskTemplates(c.case_type, c.additional_domains ?? [])
      .filter((t) => !existing.has(t.key))
      .map((t) => {
        const due = t.dueInDays != null ? new Date(today) : null;
        if (due && t.dueInDays != null) due.setDate(due.getDate() + t.dueInDays);
        return {
          case_id: data.caseId,
          user_id: context.userId,
          title: t.title[data.locale],
          priority: t.priority,
          status: "todo",
          template_key: t.key,
          due_date: due ? due.toISOString().slice(0, 10) : null,
        };
      });
    if (pending.length === 0) return { inserted: 0 };
    const { error } = await context.supabase.from("case_tasks").insert(pending);
    if (error) throw new Error(error.message);
    return { inserted: pending.length };
  });

// ---------------------------------------------------------------------------
// Calendar events
// ---------------------------------------------------------------------------

export const listCaseEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caseId: string }) => z.object({ caseId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCaseAccess(context.supabase, data.caseId);
    const { data: rows, error } = await context.supabase
      .from("case_events")
      .select("*")
      .eq("case_id", data.caseId)
      .order("scheduled_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const eventInput = z.object({
  caseId: uuid,
  id: uuid.optional(),
  title: z.string().min(1).max(300),
  event_type: z.string().min(1).max(64).default("other"),
  scheduled_at: z.string().min(1),
  location: z.string().max(300).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const upsertCaseEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof eventInput>) => eventInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertCaseAccess(context.supabase, data.caseId);
    const row = {
      case_id: data.caseId,
      user_id: context.userId,
      title: data.title,
      event_type: data.event_type,
      scheduled_at: new Date(data.scheduled_at).toISOString(),
      location: data.location ?? null,
      notes: data.notes ?? null,
    };
    const q = data.id
      ? context.supabase.from("case_events").update(row).eq("id", data.id).select("*").single()
      : context.supabase.from("case_events").insert(row).select("*").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteCaseEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("case_events").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Reminders — a lightweight on/off + lead-time control layered onto existing
// events and tasks (no new table). A background worker (reminders-worker)
// emails due reminders; browser/desktop notifications are fired client-side
// by polling listDueReminders while the app is open.
// ---------------------------------------------------------------------------

const REMINDER_CHANNEL = z.enum(["browser", "email"]);

const reminderInput = z.object({
  id: uuid,
  enabled: z.boolean(),
  leadMinutes: z.number().int().min(5).max(43200).default(60),
  channels: z.array(REMINDER_CHANNEL).min(1).max(2).default(["browser"]),
});

// The reminder_* columns are new (see migration
// 20260807120000_case_reminders_and_worker.sql) and not yet in the generated
// Supabase types, so these queries go through `as any` — same pattern used
// for other freshly-added tables/columns elsewhere in this codebase.

export const setEventReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof reminderInput>) => reminderInput.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase.from("case_events") as any)
      .update({
        reminder_enabled: data.enabled,
        reminder_lead_minutes: data.leadMinutes,
        reminder_channels: data.channels,
        reminder_fired_at: null,
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setTaskReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof reminderInput>) => reminderInput.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase.from("case_tasks") as any)
      .update({
        reminder_enabled: data.enabled,
        reminder_lead_minutes: data.leadMinutes,
        reminder_channels: data.channels,
        reminder_fired_at: null,
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type DueReminder = {
  id: string;
  case_id: string;
  case_name: string;
  title: string;
  type: "event" | "task";
  triggerAt: string;
  channels: string[];
};

/** Reminders whose trigger time has arrived (or is within 5 min), for
 * client-side desktop-notification polling. Email delivery is handled
 * separately by the reminders-worker cron job. */
export const listDueReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const horizon = new Date(now.getTime() + 24 * 3600000);

    type ReminderEventRow = {
      id: string;
      case_id: string;
      title: string;
      scheduled_at: string;
      reminder_lead_minutes: number | null;
      reminder_channels: string[] | null;
    };
    type ReminderTaskRow = {
      id: string;
      case_id: string;
      title: string;
      due_date: string | null;
      reminder_lead_minutes: number | null;
      reminder_channels: string[] | null;
    };

    const [eventsRes, tasksRes, casesRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("case_events") as any)
        .select("id, case_id, title, scheduled_at, reminder_lead_minutes, reminder_channels")
        .eq("user_id", userId)
        .eq("reminder_enabled", true)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", horizon.toISOString()) as Promise<{ data: ReminderEventRow[] | null }>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("case_tasks") as any)
        .select("id, case_id, title, due_date, reminder_lead_minutes, reminder_channels")
        .eq("user_id", userId)
        .eq("reminder_enabled", true)
        .in("status", ["todo", "in_progress", "blocked"])
        .not("due_date", "is", null)
        .lte("due_date", horizon.toISOString().slice(0, 10)) as Promise<{
        data: ReminderTaskRow[] | null;
      }>,
      supabase.from("cases").select("id, name").eq("user_id", userId),
    ]);

    const nameOf = new Map((casesRes.data ?? []).map((c) => [c.id, c.name]));
    const out: DueReminder[] = [];

    for (const e of eventsRes.data ?? []) {
      const triggerAt = new Date(
        new Date(e.scheduled_at).getTime() - (e.reminder_lead_minutes ?? 60) * 60000,
      );
      out.push({
        id: e.id,
        case_id: e.case_id,
        case_name: nameOf.get(e.case_id) ?? "—",
        title: e.title,
        type: "event",
        triggerAt: triggerAt.toISOString(),
        channels: e.reminder_channels ?? ["browser"],
      });
    }
    for (const t of tasksRes.data ?? []) {
      if (!t.due_date) continue;
      const triggerAt = new Date(
        new Date(`${t.due_date}T15:00:00.000Z`).getTime() -
          (t.reminder_lead_minutes ?? 1440) * 60000,
      );
      out.push({
        id: t.id,
        case_id: t.case_id,
        case_name: nameOf.get(t.case_id) ?? "—",
        title: t.title,
        type: "task",
        triggerAt: triggerAt.toISOString(),
        channels: t.reminder_channels ?? ["browser"],
      });
    }

    const cutoff = now.getTime() + 5 * 60000;
    return out.filter((r) => new Date(r.triggerAt).getTime() <= cutoff);
  });

// ---------------------------------------------------------------------------
// Lifecycle status (attorney-facing; the pipeline never writes it)
// ---------------------------------------------------------------------------

export const setCaseLifecycleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caseId: string; status: string }) =>
    z.object({ caseId: uuid, status: z.string().min(1).max(64) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const c = await assertCaseAccess(context.supabase, data.caseId);
    const allowed = getApplicableLifecycleStatuses(c.case_type);
    if (!allowed.includes(data.status)) {
      throw new Error(`Estado no aplicable a esta materia: ${data.status}`);
    }
    const { error } = await context.supabase
      .from("cases")
      .update({ lifecycle_status: data.status })
      .eq("id", data.caseId);
    if (error) throw new Error(error.message);
    return { ok: true, lifecycle_status: data.status };
  });

// ---------------------------------------------------------------------------
// Attorney Home aggregation — six real-data cards, batched (no N+1).
// ---------------------------------------------------------------------------

export const getAttorneyHome = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const in7 = new Date(now.getTime() + 7 * 86400000);

    type HomeEventRow = {
      id: string;
      case_id: string;
      title: string;
      event_type: string;
      scheduled_at: string;
      location: string | null;
      reminder_enabled: boolean;
      reminder_lead_minutes: number;
      reminder_channels: string[];
    };
    type HomeTaskRow = {
      id: string;
      case_id: string;
      title: string;
      due_date: string | null;
      priority: string;
      status: string;
      reminder_enabled: boolean;
      reminder_lead_minutes: number;
      reminder_channels: string[];
    };

    const [eventsRes, tasksRes, findingsRes, reportsRes, chatRes, casesRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("case_events") as any)
        .select(
          "id, case_id, title, event_type, scheduled_at, location, reminder_enabled, reminder_lead_minutes, reminder_channels",
        )
        .eq("user_id", userId)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", in30.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(8) as Promise<{ data: HomeEventRow[] | null }>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("case_tasks") as any)
        .select(
          "id, case_id, title, due_date, priority, status, reminder_enabled, reminder_lead_minutes, reminder_channels",
        )
        .eq("user_id", userId)
        .in("status", ["todo", "in_progress", "blocked"])
        .not("due_date", "is", null)
        .lte("due_date", in7.toISOString().slice(0, 10))
        .order("due_date", { ascending: true })
        .limit(8) as Promise<{ data: HomeTaskRow[] | null }>,
      supabase
        .from("case_findings")
        .select("id, case_id, title, priority, created_at")
        .eq("user_id", userId)
        .lte("priority", 2)
        .not("source_module", "like", PROJECTION_LIKE)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("reports")
        .select("id, case_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("case_chat_messages")
        .select("id, case_id, content, created_at, role")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("cases")
        .select("id, name, case_type, status, lifecycle_status, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);

    const cases = casesRes.data ?? [];
    const nameOf = new Map(cases.map((c) => [c.id, c.name]));
    const withName = <T extends { case_id: string }>(rows: T[] | null) =>
      (rows ?? []).map((r) => ({ ...r, case_name: nameOf.get(r.case_id) ?? "—" }));

    return {
      upcomingEvents: withName(eventsRes.data),
      deadlines: withName(tasksRes.data),
      aiAlerts: withName(findingsRes.data),
      recentReports: withName(reportsRes.data),
      recentConversations: withName(chatRes.data),
      quickResume: cases.slice(0, 6),
    };
  });

// ---------------------------------------------------------------------------
// Communications log (core capability; no outbound delivery in this phase)
// ---------------------------------------------------------------------------

export const listCaseCommunications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { caseId: string }) => z.object({ caseId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCaseAccess(context.supabase, data.caseId);
    const { data: rows, error } = await context.supabase
      .from("case_communications")
      .select("*")
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const commInput = z.object({
  caseId: uuid,
  id: uuid.optional(),
  channel: z.string().min(1).max(64).default("internal_note"),
  direction: z.enum(["outbound", "inbound", "internal"]).default("internal"),
  subject: z.string().max(300).nullable().optional(),
  body: z.string().min(1).max(20000),
  status: z.enum(["draft", "pending_review", "sent", "logged"]).default("draft"),
});

export const upsertCaseCommunication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof commInput>) => commInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertCaseAccess(context.supabase, data.caseId);
    const approving = data.status === "sent" || data.status === "logged";
    const row = {
      case_id: data.caseId,
      user_id: context.userId,
      channel: data.channel,
      direction: data.direction,
      subject: data.subject ?? null,
      body: data.body,
      status: data.status,
      approved_by: approving ? context.userId : null,
      approved_at: approving ? new Date().toISOString() : null,
    };
    const q = data.id
      ? context.supabase
          .from("case_communications")
          .update(row)
          .eq("id", data.id)
          .select("*")
          .single()
      : context.supabase.from("case_communications").insert(row).select("*").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteCaseCommunication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("case_communications").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
