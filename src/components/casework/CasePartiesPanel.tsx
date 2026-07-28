// Case Parties — CORE platform capability, available on every materia.
// The available roles come from the practice-area registry, so this single
// component serves an inmobiliario closing and a penal carpeta alike.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, Pencil, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { listCaseParties, upsertCaseParty, deleteCaseParty } from "@/lib/casework.functions";
import { PARTY_ROLE_LABELS, label } from "./labels";

type Party = {
  id: string;
  party_role: string;
  name: string;
  role_description: string | null;
  contact: Record<string, string> | null;
};

export function CasePartiesPanel({ caseId, embedded }: { caseId: string; embedded?: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const key = ["case-parties", caseId];
  const list = useServerFn(listCaseParties);
  const save = useServerFn(upsertCaseParty);
  const remove = useServerFn(deleteCaseParty);

  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => list({ data: { caseId } }) });
  const [editing, setEditing] = useState<Partial<Party> | null>(null);

  const mSave = useMutation({
    mutationFn: (p: Partial<Party>) =>
      save({
        data: {
          caseId,
          id: p.id,
          party_role: p.party_role || "otro",
          name: (p.name ?? "").trim(),
          role_description: p.role_description ?? null,
          contact: p.contact ?? {},
        },
      }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: key });
      toast.success(t("parties.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  const parties = (data?.parties ?? []) as Party[];
  const roles = data?.allowedRoles ?? [];

  const body = (
    <>
      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : parties.length === 0 && !editing ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          {t("parties.empty")}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {parties.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <Badge variant="secondary" className="shrink-0">
                {label(PARTY_ROLE_LABELS, p.party_role, locale)}
              </Badge>
              <span className="font-medium">{p.name}</span>
              {p.contact?.email && (
                <span className="text-muted-foreground">{p.contact.email}</span>
              )}
              {p.contact?.phone && (
                <span className="text-muted-foreground">{p.contact.phone}</span>
              )}
              {p.role_description && (
                <span className="text-xs text-muted-foreground">{p.role_description}</span>
              )}
              <div className="ml-auto flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(p)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => mDelete.mutate(p.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-border p-3 md:grid-cols-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={editing.party_role ?? roles[0] ?? "otro"}
            onChange={(e) => setEditing({ ...editing, party_role: e.target.value })}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {label(PARTY_ROLE_LABELS, r, locale)}
              </option>
            ))}
          </select>
          <Input
            placeholder={t("parties.name")}
            value={editing.name ?? ""}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
          <Input
            placeholder={t("parties.email")}
            value={editing.contact?.email ?? ""}
            onChange={(e) =>
              setEditing({ ...editing, contact: { ...(editing.contact ?? {}), email: e.target.value } })
            }
          />
          <Input
            placeholder={t("parties.phone")}
            value={editing.contact?.phone ?? ""}
            onChange={(e) =>
              setEditing({ ...editing, contact: { ...(editing.contact ?? {}), phone: e.target.value } })
            }
          />
          <Input
            className="md:col-span-2"
            placeholder={t("parties.note")}
            value={editing.role_description ?? ""}
            onChange={(e) => setEditing({ ...editing, role_description: e.target.value })}
          />
          <div className="flex gap-2 md:col-span-2">
            <Button
              size="sm"
              disabled={!editing.name?.trim() || mSave.isPending}
              onClick={() => mSave.mutate(editing)}
            >
              {mSave.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
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
          onClick={() => setEditing({ party_role: roles[0] ?? "otro", name: "", contact: {} })}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("parties.add")}
        </Button>
      )}
    </>
  );

  if (embedded) {
    return (
      <div>
        <div className="mb-2 text-sm font-medium">{t("parties.title")}</div>
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("parties.title")}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
