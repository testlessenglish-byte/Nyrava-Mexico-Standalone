// Case Communications — CORE platform capability. An auditable log of client,
// counterparty, court and authority correspondence. Nothing is transmitted from
// here; entries are drafted, reviewed and logged by the attorney.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  listCaseCommunications,
  upsertCaseCommunication,
  deleteCaseCommunication,
} from "@/lib/casework.functions";
import { CHANNEL_LABELS, COMM_STATUS_LABELS, DIRECTION_LABELS, label } from "./labels";

const CHANNELS = [
  "internal_note",
  "client",
  "counterparty",
  "court",
  "authority",
  "notary",
  "broker",
  "lender",
  "registry",
  "other",
] as const;
const DIRECTIONS = ["internal", "outbound", "inbound"] as const;
const STATUSES = ["draft", "pending_review", "sent", "logged"] as const;

type Draft = {
  channel: string;
  direction: string;
  subject: string;
  body: string;
  status: string;
};

const EMPTY: Draft = {
  channel: "client",
  direction: "outbound",
  subject: "",
  body: "",
  status: "draft",
};

export function CaseCommunicationsPanel({ caseId, embedded }: { caseId: string; embedded?: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const key = ["case-communications", caseId];
  const list = useServerFn(listCaseCommunications);
  const save = useServerFn(upsertCaseCommunication);
  const remove = useServerFn(deleteCaseCommunication);

  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => list({ data: { caseId } }) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const mSave = useMutation({
    mutationFn: (d: Draft) =>
      save({
        data: {
          caseId,
          channel: d.channel,
          direction: d.direction as "outbound" | "inbound" | "internal",
          subject: d.subject || null,
          body: d.body.trim(),
          status: d.status as "draft" | "pending_review" | "sent" | "logged",
        },
      }),
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mStatus = useMutation({
    mutationFn: (v: { id: string; row: Record<string, unknown>; status: string }) =>
      save({
        data: {
          caseId,
          id: v.id,
          channel: String(v.row.channel),
          direction: v.row.direction as "outbound" | "inbound" | "internal",
          subject: (v.row.subject as string | null) ?? null,
          body: String(v.row.body),
          status: v.status as "draft" | "pending_review" | "sent" | "logged",
        },
      }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = data ?? [];
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", { dateStyle: "medium" });

  const body = (
    <>
      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : entries.length === 0 && !draft ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          {t("comms.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{label(CHANNEL_LABELS, c.channel, locale)}</Badge>
                <Badge variant="outline">{label(DIRECTION_LABELS, c.direction, locale)}</Badge>
                <span className="font-medium">{c.subject || "—"}</span>
                <span className="text-xs text-muted-foreground">{fmt.format(new Date(c.created_at))}</span>
                <select
                  className="ml-auto h-7 rounded-md border border-input bg-background px-1.5 text-xs"
                  value={c.status}
                  onChange={(e) =>
                    mStatus.mutate({ id: c.id, row: c as Record<string, unknown>, status: e.target.value })
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(COMM_STATUS_LABELS, s, locale)}
                    </option>
                  ))}
                </select>
                <Button size="icon" variant="ghost" onClick={() => mDelete.mutate(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-border p-3 md:grid-cols-3">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={draft.channel}
            onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
          >
            {CHANNELS.map((v) => (
              <option key={v} value={v}>
                {label(CHANNEL_LABELS, v, locale)}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={draft.direction}
            onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
          >
            {DIRECTIONS.map((v) => (
              <option key={v} value={v}>
                {label(DIRECTION_LABELS, v, locale)}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            {STATUSES.map((v) => (
              <option key={v} value={v}>
                {label(COMM_STATUS_LABELS, v, locale)}
              </option>
            ))}
          </select>
          <Input
            className="md:col-span-3"
            placeholder={t("comms.subject")}
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
          />
          <Textarea
            className="md:col-span-3"
            rows={4}
            placeholder={t("comms.body")}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          <div className="flex gap-2 md:col-span-3">
            <Button size="sm" disabled={!draft.body.trim() || mSave.isPending} onClick={() => mSave.mutate(draft)}>
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
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setDraft({ ...EMPTY })}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("comms.add")}
        </Button>
      )}
    </>
  );

  if (embedded) {
    return (
      <div>
        <div className="mb-2 text-sm font-medium">{t("comms.title")}</div>
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("comms.title")}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
