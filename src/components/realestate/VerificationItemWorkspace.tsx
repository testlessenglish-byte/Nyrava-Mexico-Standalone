// Per-item verification workspace. Opened from the Centro de Verificación
// grid: an attorney can change the status, attach or replace the supporting
// instrument, annotate it, ask Nyrava Intelligence about that specific
// requirement, and draft the request letter to whoever holds the record —
// all without leaving the Transaction Center.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Loader2, Upload, Download, Link2, Sparkles, Send, FileText, Trash2, Save,
} from "lucide-react";
import { useI18n } from "@/i18n";
import {
  upsertVerificationItem,
  uploadVerificationDocument,
  listVerificationDocuments,
  type VerificationCategory,
  type VerificationItem,
} from "@/lib/real-estate.functions";
import { askCaseAi, getDocumentDownloadUrl } from "@/lib/cases.functions";
import { upsertCaseCommunication } from "@/lib/casework.functions";

type Status = VerificationItem["status"];

const STATUS_ORDER: Status[] = ["pending", "verified", "issue_found", "missing"];

/** Who normally holds each requirement — the channel is data, the prose is i18n. */
export const CATEGORY_CHANNEL: Record<VerificationCategory, string> = {
  ownership: "notary",
  registry: "registry",
  catastro: "authority",
  predial: "authority",
  water: "authority",
  cfe: "authority",
  hoa: "other",
  mortgage: "lender",
  permits: "authority",
  corporate_authority: "counterparty",
  environmental: "authority",
};

export function VerificationItemWorkspace({
  caseId,
  category,
  categoryLabel,
  item,
  open,
  onOpenChange,
  onChanged,
}: {
  caseId: string;
  category: VerificationCategory;
  categoryLabel: string;
  item: VerificationItem | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { t } = useI18n();

  const doc = t(`re.doc.${category}`);
  const holder = t(`re.holder.${category}`);
  const channel = CATEGORY_CHANNEL[category];

  const save = useServerFn(upsertVerificationItem);
  const uploadFn = useServerFn(uploadVerificationDocument);
  const listDocs = useServerFn(listVerificationDocuments);
  const askFn = useServerFn(askCaseAi);
  const downloadFn = useServerFn(getDocumentDownloadUrl);
  const commFn = useServerFn(upsertCaseCommunication);

  const [notes, setNotes] = useState(item?.notes ?? "");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [requestBody, setRequestBody] = useState(t("re.ws.requestBody", { doc }));
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: docs } = useQuery({
    queryKey: ["verification-docs", caseId],
    queryFn: () => listDocs({ data: { caseId } }),
    enabled: open,
  });

  const attached = docs?.find((d) => d.id === item?.evidence_document_id) ?? null;

  const refresh = () => {
    onChanged();
    void qc.invalidateQueries({ queryKey: ["verification-docs", caseId] });
  };

  const mSave = useMutation({
    mutationFn: (patch: Partial<{ status: Status; notes: string | null; evidence_document_id: string | null }>) =>
      save({
        data: {
          caseId,
          category,
          status: patch.status ?? item?.status ?? "pending",
          verification_mode:
            patch.evidence_document_id !== undefined
              ? patch.evidence_document_id
                ? "document"
                : "manual"
              : (item?.verification_mode ?? "manual"),
          notes: patch.notes !== undefined ? patch.notes : (item?.notes ?? null),
          evidence_document_id:
            patch.evidence_document_id !== undefined
              ? patch.evidence_document_id
              : (item?.evidence_document_id ?? null),
        },
      }),
    onSuccess: () => {
      refresh();
      toast.success(t("re.toast.updated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mUpload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("caseId", caseId);
      fd.append("category", category);
      fd.append("file", file);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (uploadFn as any)({ data: fd });
    },
    onSuccess: () => {
      refresh();
      toast.success(t("re.toast.uploaded"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mAsk = useMutation({
    mutationFn: (q: string) => askFn({ data: { caseId, question: q } }),
    onSuccess: (res: { answer?: string }) => setAnswer(res?.answer ?? "—"),
    onError: (e: Error) => toast.error(e.message),
  });

  const mRequest = useMutation({
    mutationFn: () =>
      commFn({
        data: {
          caseId,
          channel,
          direction: "outbound" as const,
          subject: `${t("re.ws.requestSubject", { label: categoryLabel })}${recipient ? ` (${recipient})` : ""}`,
          body: requestBody.trim(),
          status: "pending_review" as const,
        },
      }),
    onSuccess: () => {
      toast.success(t("re.toast.requested"));
      void qc.invalidateQueries({ queryKey: ["case-communications", caseId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const askAbout = (prompt: string) => {
    setAnswer(null);
    mAsk.mutate(prompt);
  };

  const download = async () => {
    if (!attached) return;
    try {
      const { url } = await downloadFn({ data: { caseId, documentId: attached.id } });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{categoryLabel}</SheetTitle>
          <SheetDescription>{t("re.ws.expected", { doc, holder })}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status */}
          <section className="space-y-2">
            <h4 className="text-sm font-medium">{t("re.ws.status")}</h4>
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={(item?.status ?? "pending") === s ? "default" : "outline"}
                  disabled={mSave.isPending}
                  onClick={() => mSave.mutate({ status: s })}
                >
                  {t(`re.status.${s}`)}
                </Button>
              ))}
            </div>
          </section>

          <Separator />

          {/* Document */}
          <section className="space-y-3">
            <h4 className="text-sm font-medium">{t("re.ws.supportDoc")}</h4>
            {attached ? (
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{attached.filename}</div>
                    <Badge variant="outline" className="mt-1 text-xs">{attached.status}</Badge>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={download}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mSave.isPending}
                    onClick={() => mSave.mutate({ evidence_document_id: null })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("re.ws.noDoc")}</p>
            )}

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) mUpload.mutate(f);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={mUpload.isPending} onClick={() => fileRef.current?.click()}>
                {mUpload.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-3.5 w-3.5" />
                )}
                {attached ? t("re.ws.replace") : t("re.ws.upload")}
              </Button>
            </div>

            {(docs?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Link2 className="h-3 w-3" /> {t("re.ws.linkExisting")}
                </div>
                <select
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  value={item?.evidence_document_id ?? ""}
                  onChange={(e) =>
                    mSave.mutate({ evidence_document_id: e.target.value || null })
                  }
                >
                  <option value="">{t("re.ws.none")}</option>
                  {docs!.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          <Separator />

          {/* Notes */}
          <section className="space-y-2">
            <h4 className="text-sm font-medium">{t("re.ws.notes")}</h4>
            <Textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("re.ws.notesPlaceholder")}
            />
            <Button size="sm" variant="outline" disabled={mSave.isPending} onClick={() => mSave.mutate({ notes })}>
              <Save className="mr-1 h-3.5 w-3.5" /> {t("re.ws.saveNotes")}
            </Button>
          </section>

          <Separator />

          {/* AI assistance */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1 text-sm font-medium">
              <Sparkles className="h-4 w-4" /> {t("re.ws.ai")}
            </h4>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={mAsk.isPending}
                onClick={() => askAbout(t("re.ws.aiReviewPrompt", { label: categoryLabel, doc }))}
              >
                {t("re.ws.aiReview")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={mAsk.isPending}
                onClick={() => askAbout(t("re.ws.aiHowPrompt", { doc, holder }))}
              >
                {t("re.ws.aiHow")}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t("re.ws.aiPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && question.trim()) askAbout(`[${categoryLabel}] ${question.trim()}`);
                }}
              />
              <Button
                size="sm"
                disabled={mAsk.isPending || !question.trim()}
                onClick={() => askAbout(`[${categoryLabel}] ${question.trim()}`)}
              >
                {mAsk.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            {mAsk.isPending && <p className="text-xs text-muted-foreground">{t("re.ws.aiThinking")}</p>}
            {answer && (
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm">
                {answer}
              </div>
            )}
          </section>

          <Separator />

          {/* Request to a third party */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1 text-sm font-medium">
              <Send className="h-4 w-4" /> {t("re.ws.request")}
            </h4>
            <p className="text-xs text-muted-foreground">{t("re.ws.requestHint")}</p>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={t("re.ws.recipient", { holder })}
            />
            <Textarea rows={5} value={requestBody} onChange={(e) => setRequestBody(e.target.value)} />
            <Button
              size="sm"
              disabled={mRequest.isPending || !requestBody.trim()}
              onClick={() => mRequest.mutate()}
            >
              {mRequest.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1 h-3.5 w-3.5" />
              )}
              {t("re.ws.registerRequest")}
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
