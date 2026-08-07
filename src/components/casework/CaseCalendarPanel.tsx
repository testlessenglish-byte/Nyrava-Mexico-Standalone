// Case Calendar — CORE platform capability. Hearings, filings, closings and
// deadlines share one timeline regardless of materia.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { listCaseEvents, upsertCaseEvent, deleteCaseEvent } from "@/lib/casework.functions";
import { EVENT_TYPE_LABELS, label } from "./labels";
import { ReminderControl, type ReminderValue } from "./ReminderControl";

const EVENT_TYPES = ["hearing", "filing", "meeting", "closing", "deadline", "other"] as const;

type Draft = {
  title: string;
  event_type: string;
  scheduled_at: string;
  location: string;
  notes: string;
  reminder: ReminderValue;
};
const DEFAULT_REMINDER: ReminderValue = { enabled: false, leadMinutes: 60, channels: ["browser"] };

export function CaseCalendarPanel({ caseId, embedded }: { caseId: string; embedded?: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const key = ["case-events", caseId];
  const list = useServerFn(listCaseEvents);
  const save = useServerFn(upsertCaseEvent);
  const remove = useServerFn(deleteCaseEvent);

  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => list({ data: { caseId } }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const mSave = useMutation({
    mutationFn: (d: Draft) =>
      save({
        data: {
          caseId,
          title: d.title.trim(),
          event_type: d.event_type,
          scheduled_at: d.scheduled_at,
          location: d.location || null,
          notes: d.notes || null,
          reminder_enabled: d.reminder.enabled,
          reminder_lead_minutes: d.reminder.leadMinutes,
          reminder_channels: d.reminder.channels,
        },
      }),
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const events = data ?? [];
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const body = (
    <>
      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          {t("calendar.empty")}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {events.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <Badge variant="secondary" className="shrink-0">
                {label(EVENT_TYPE_LABELS, e.event_type, locale)}
              </Badge>
              <span className="font-medium">{e.title}</span>
              <span className="text-muted-foreground">{fmt.format(new Date(e.scheduled_at))}</span>
              {e.location && <span className="text-xs text-muted-foreground">{e.location}</span>}
              <Button size="icon" variant="ghost" className="ml-auto" onClick={() => mDelete.mutate(e.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-border p-3 md:grid-cols-2">
          <Input
            placeholder={t("calendar.eventTitle")}
            value={draft.title}
            onChange={(ev) => setDraft({ ...draft, title: ev.target.value })}
          />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={draft.event_type}
            onChange={(ev) => setDraft({ ...draft, event_type: ev.target.value })}
          >
            {EVENT_TYPES.map((v) => (
              <option key={v} value={v}>
                {label(EVENT_TYPE_LABELS, v, locale)}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={draft.scheduled_at}
            onChange={(ev) => setDraft({ ...draft, scheduled_at: ev.target.value })}
          />
          <Input
            placeholder={t("calendar.location")}
            value={draft.location}
            onChange={(ev) => setDraft({ ...draft, location: ev.target.value })}
          />
          <textarea
            placeholder="Notas"
            value={draft.notes}
            onChange={(ev) => setDraft({ ...draft, notes: ev.target.value })}
            className="min-h-[60px] rounded-md border border-input bg-background px-2 py-1.5 text-sm md:col-span-2"
          />
          <div className="flex items-center gap-2 md:col-span-2">
            <ReminderControl
              itemType="event"
              enabled={draft.reminder.enabled}
              leadMinutes={draft.reminder.leadMinutes}
              channels={draft.reminder.channels}
              align="left"
              onSave={(v) => setDraft({ ...draft, reminder: v })}
            />
            <span className="text-xs text-muted-foreground">
              {draft.reminder.enabled ? "Recordatorio activado" : "Sin recordatorio"}
            </span>
          </div>
          <div className="flex gap-2 md:col-span-2">
            <Button
              size="sm"
              disabled={!draft.title.trim() || !draft.scheduled_at || mSave.isPending}
              onClick={() => mSave.mutate(draft)}
            >
              {mSave.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() =>
            setDraft({
              title: "",
              event_type: "hearing",
              scheduled_at: "",
              location: "",
              notes: "",
              reminder: DEFAULT_REMINDER,
            })
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("calendar.add")}
        </Button>
      )}
    </>
  );

  if (embedded) {
    return (
      <div>
        <div className="mb-2 text-sm font-medium">{t("calendar.title")}</div>
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("calendar.title")}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
