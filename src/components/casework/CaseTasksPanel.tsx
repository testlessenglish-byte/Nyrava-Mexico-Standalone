// Case Tasks — CORE platform capability. The checklist templates come from the
// practice-area registry, so each materia gets its own starting checklist while
// the task engine itself stays universal.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2, ListChecks, X } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  listCaseTasks,
  upsertCaseTask,
  deleteCaseTask,
  seedCaseTaskTemplates,
} from "@/lib/casework.functions";
import { TASK_STATUS_LABELS, PRIORITY_LABELS, label } from "./labels";

type Task = {
  id: string;
  title: string;
  due_date: string | null;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "low" | "normal" | "high";
  template_key: string | null;
};

const STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high"] as const;

export function CaseTasksPanel({ caseId, embedded }: { caseId: string; embedded?: boolean }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const key = ["case-tasks", caseId];
  const list = useServerFn(listCaseTasks);
  const save = useServerFn(upsertCaseTask);
  const remove = useServerFn(deleteCaseTask);
  const seed = useServerFn(seedCaseTaskTemplates);

  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => list({ data: { caseId } }) });
  const [draft, setDraft] = useState<{ title: string; due_date: string; priority: string } | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const mSave = useMutation({
    mutationFn: (p: Partial<Task> & { title: string }) =>
      save({
        data: {
          caseId,
          id: p.id,
          title: p.title,
          due_date: p.due_date || null,
          status: p.status ?? "todo",
          priority: p.priority ?? "normal",
          template_key: p.template_key ?? null,
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

  const mSeed = useMutation({
    mutationFn: () => seed({ data: { caseId, locale: locale === "en" ? "en" : "es" } }),
    onSuccess: (r) => {
      invalidate();
      toast.success(t("tasks.seeded", { count: r.inserted }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tasks = (data?.tasks ?? []) as Task[];
  const pendingTemplates = data?.templates ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const body = (
    <>
      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
              {t("tasks.empty")}
            </div>
          )}
          {tasks.map((task) => {
            const overdue = task.due_date && task.due_date < today && task.status !== "done";
            return (
              <div
                key={task.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={task.status === "done"}
                  onCheckedChange={(v) =>
                    mSave.mutate({ ...task, status: v ? "done" : "todo" })
                  }
                />
                <span className={task.status === "done" ? "line-through text-muted-foreground" : "font-medium"}>
                  {task.title}
                </span>
                <select
                  className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
                  value={task.status}
                  onChange={(e) => mSave.mutate({ ...task, status: e.target.value as Task["status"] })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(TASK_STATUS_LABELS, s, locale)}
                    </option>
                  ))}
                </select>
                <Badge variant={task.priority === "high" ? "destructive" : "secondary"} className="text-[10px]">
                  {label(PRIORITY_LABELS, task.priority, locale)}
                </Badge>
                <input
                  type="date"
                  className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
                  value={task.due_date ?? ""}
                  onChange={(e) => mSave.mutate({ ...task, due_date: e.target.value })}
                />
                {overdue && (
                  <span className="text-xs font-medium text-destructive">{t("tasks.overdue")}</span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => mDelete.mutate(task.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {draft ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <Input
            className="min-w-[220px] flex-1"
            placeholder={t("tasks.title")}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={draft.due_date}
            onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
          />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {label(PRIORITY_LABELS, p, locale)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!draft.title.trim() || mSave.isPending}
            onClick={() =>
              mSave.mutate({
                title: draft.title.trim(),
                due_date: draft.due_date,
                priority: draft.priority as Task["priority"],
                status: "todo",
              })
            }
          >
            {t("common.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft({ title: "", due_date: "", priority: "normal" })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("tasks.add")}
          </Button>
          {pendingTemplates.length > 0 && (
            <Button size="sm" variant="secondary" disabled={mSeed.isPending} onClick={() => mSeed.mutate()}>
              {mSeed.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListChecks className="mr-1 h-3.5 w-3.5" />
              )}
              {t("tasks.seed", { count: pendingTemplates.length })}
            </Button>
          )}
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div>
        <div className="mb-2 text-sm font-medium">{t("tasks.title")}</div>
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("tasks.title")}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
