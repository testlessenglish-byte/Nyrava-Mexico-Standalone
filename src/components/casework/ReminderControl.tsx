// Shared reminder toggle used by the dashboard's Events/Deadlines cards and
// by CaseCalendarPanel/CaseTasksPanel — enable a reminder on a hearing/event
// or task deadline, pick how far in advance it fires, and pick channels
// (desktop notification while the app is open, and/or email).
import { useState } from "react";
import { Bell } from "lucide-react";
import { requestDesktopNotificationPermission } from "@/hooks/useReminderNotifications";

export type ReminderChannel = "browser" | "email";
export type ReminderValue = { enabled: boolean; leadMinutes: number; channels: ReminderChannel[] };

const EVENT_LEAD_OPTIONS = [
  { value: 30, label: "30 min antes" },
  { value: 60, label: "1 hora antes" },
  { value: 180, label: "3 horas antes" },
  { value: 1440, label: "1 día antes" },
  { value: 4320, label: "3 días antes" },
];
const TASK_LEAD_OPTIONS = [
  { value: 1440, label: "1 día antes" },
  { value: 4320, label: "3 días antes" },
  { value: 10080, label: "7 días antes" },
];

export function ReminderControl({
  itemType,
  enabled,
  leadMinutes,
  channels,
  onSave,
  align = "right",
}: {
  itemType: "event" | "task";
  enabled: boolean;
  leadMinutes: number;
  channels: string[];
  onSave: (v: ReminderValue) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [localLead, setLocalLead] = useState(leadMinutes);
  const [localChannels, setLocalChannels] = useState<ReminderChannel[]>(
    (channels as ReminderChannel[]) ?? ["browser"],
  );
  const options = itemType === "event" ? EVENT_LEAD_OPTIONS : TASK_LEAD_OPTIONS;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setLocalEnabled(enabled);
          setLocalLead(leadMinutes);
          setLocalChannels((channels as ReminderChannel[]) ?? ["browser"]);
          setOpen((o) => !o);
        }}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${
          enabled ? "text-primary" : "text-muted-foreground"
        } hover:bg-primary/10`}
        title={enabled ? "Recordatorio activado" : "Activar recordatorio"}
      >
        <Bell className="h-3.5 w-3.5" fill={enabled ? "currentColor" : "none"} />
      </button>
      {open && (
        <div
          className={`absolute top-7 z-20 w-60 space-y-2 rounded-lg border border-border bg-popover p-3 text-xs shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
          onClick={(ev) => ev.stopPropagation()}
        >
          <label className="flex items-center justify-between gap-2 font-medium text-foreground">
            Recordatorio
            <input
              type="checkbox"
              checked={localEnabled}
              onChange={(ev) => setLocalEnabled(ev.target.checked)}
              className="h-3.5 w-3.5"
            />
          </label>
          <select
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
            value={localLead}
            disabled={!localEnabled}
            onChange={(ev) => setLocalLead(Number(ev.target.value))}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex flex-col gap-1.5 text-muted-foreground">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                disabled={!localEnabled}
                checked={localChannels.includes("browser")}
                onChange={(ev) =>
                  setLocalChannels((c) =>
                    ev.target.checked
                      ? Array.from(new Set([...c, "browser" as const]))
                      : c.filter((x) => x !== "browser"),
                  )
                }
              />
              Notificarme en esta computadora
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                disabled={!localEnabled}
                checked={localChannels.includes("email")}
                onChange={(ev) =>
                  setLocalChannels((c) =>
                    ev.target.checked
                      ? Array.from(new Set([...c, "email" as const]))
                      : c.filter((x) => x !== "email"),
                  )
                }
              />
              Enviarme un correo
            </label>
          </div>
          <button
            type="button"
            className="w-full rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            onClick={() => {
              const chans = localChannels.length ? localChannels : (["browser"] as ReminderChannel[]);
              if (localEnabled) void requestDesktopNotificationPermission();
              onSave({ enabled: localEnabled, leadMinutes: localLead, channels: chans });
              setOpen(false);
            }}
          >
            Guardar
          </button>
        </div>
      )}
    </div>
  );
}
