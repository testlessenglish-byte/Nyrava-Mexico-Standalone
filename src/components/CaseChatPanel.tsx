import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  askCaseAi,
  getCaseChat,
  clearCaseChat,
  uploadCaseEvidence,
  listCaseDocuments,
  deleteCaseDocument,
  getDocumentDownloadUrl,
} from "@/lib/cases.functions";
import {
  usePushChatCorrectionsToReport,
  type CorrectionPreview,
} from "@/hooks/usePushChatCorrectionsToReport";
import { ChatMarkdown } from "@/lib/chat-markdown";
import { useI18n } from "@/i18n";
import {
  Loader2,
  MessageSquare,
  Trash2,
  Send,
  Paperclip,
  Upload,
  FileText,
  Download,
  X,
  FolderOpen,
  RotateCw,
  FilePenLine,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";

type ChatMsg = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  metadata?: { suggests_rerun?: boolean; rerun_reason?: string; error?: boolean } | null;
};

type Doc = {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: string | null;
  created_at: string;
  has_text: boolean;
};

const ACCEPTED =
  ".pdf,.zip,.docx,.doc,.txt,.rtf,.md,.csv,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff,.gif";

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function CaseChatPanel({
  caseId,
  caseName,
  heightClass = "h-[70vh]",
}: {
  caseId: string;
  caseName?: string;
  heightClass?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const fetchChat = useServerFn(getCaseChat);
  const askAi = useServerFn(askCaseAi);
  const clearChat = useServerFn(clearCaseChat);
  const uploadFn = useServerFn(uploadCaseEvidence);
  const listDocs = useServerFn(listCaseDocuments);
  const deleteDoc = useServerFn(deleteCaseDocument);
  const signDoc = useServerFn(getDocumentDownloadUrl);
  const regen = usePushChatCorrectionsToReport(caseId);

  const { data: history = [] } = useQuery<ChatMsg[]>({
    queryKey: ["chat", caseId],
    queryFn: () => fetchChat({ data: { caseId } }) as Promise<ChatMsg[]>,
  });

  const { data: docs = [] } = useQuery<Doc[]>({
    queryKey: ["case-docs", caseId],
    queryFn: () => listDocs({ data: { caseId } }) as Promise<Doc[]>,
    refetchInterval: 6000,
  });

  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  // Which message's "review correction" button is loading its preview.
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // The active preview panel: the attorney must approve (or cancel) the
  // proposed patch set before anything is written — see
  // usePushChatCorrectionsToReport's doc comment for why this is a
  // deliberate two-step flow, not a single click-and-go action.
  const [correctionReview, setCorrectionReview] = useState<{
    messageId: string;
    data: CorrectionPreview;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keyed by message id so the scroll effect can find exactly the message
  // that just arrived and bring its top edge into view, instead of guessing
  // an offset. Populated via each message row's ref callback below.
  const messageElsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const prevHistoryLenRef = useRef(0);

  const ask = useMutation({
    mutationFn: (question: string) => askAi({ data: { caseId, question, locale } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", caseId] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Chat failed"),
  });
  const clear = useMutation({
    mutationFn: () => clearChat({ data: { caseId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", caseId] }),
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      fd.append("caseId", caseId);
      for (const f of files) fd.append("files", f);
      return uploadFn({ data: fd });
    },
    onSuccess: (res) => {
      toast.success(`Uploaded ${res?.uploaded ?? 0} file(s) — extracting in background`);
      qc.invalidateQueries({ queryKey: ["case-docs", caseId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });

  const del = useMutation({
    mutationFn: (documentId: string) => deleteDoc({ data: { caseId, documentId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case-docs", caseId] });
      toast.success("Document removed");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, [caseId]);

  // Expanded (pop-out) reading view: Esc closes it, and the page behind it
  // shouldn't scroll while it's open. Nothing here touches conversation
  // state, evidence, or the active case — expanding/collapsing is purely a
  // layout change on the same mounted component.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  // Question submitted, reply still in flight: follow the "Thinking…"
  // indicator to the bottom so the user sees their question was received.
  // This only runs once per submit (isPending flips true→false exactly
  // once per question) — it never re-fires while a reply is streaming in,
  // so it can't fight a manual scroll mid-answer.
  useEffect(() => {
    if (!ask.isPending) return;
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [ask.isPending]);

  // New message(s) landed in history. If the newest one is the assistant's
  // answer, scroll so its FIRST line is at the top of the visible area —
  // not the bottom of the container — so the user reads it from the start.
  // If instead the newest is the user's own question (e.g. optimistic UIs
  // elsewhere, or a future streaming change), keep following the bottom.
  useEffect(() => {
    const container = scrollRef.current;
    const prevLen = prevHistoryLenRef.current;
    prevHistoryLenRef.current = history.length;
    if (!container || history.length <= prevLen) return;

    const last = history[history.length - 1];
    if (!last) return;

    if (last.role === "assistant") {
      // Wait a frame so the new message has actually been laid out before
      // we measure its position.
      requestAnimationFrame(() => {
        const el = messageElsRef.current[last.id];
        if (!el) return;
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const delta = elRect.top - containerRect.top;
        container.scrollTo({ top: container.scrollTop + delta - 8, behavior: "smooth" });
      });
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [history]);

  const submit = () => {
    const q = input.trim();
    if (!q || ask.isPending) return;
    setInput("");
    ask.mutate(q, { onSettled: () => inputRef.current?.focus() });
  };

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    upload.mutate(arr);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // Ctrl/Cmd+A inside the textarea must only select the textarea's contents,
  // not the entire app page. Stop propagation so document-level listeners /
  // mobile select-all menus do not escalate the selection.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.stopPropagation();
      e.preventDefault();
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(0, el.value.length);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Reviews this chat exchange against the EXISTING findings and shows the
  // attorney the resulting patch set (keep/amend/remove/merge/create/
  // dispute_evidence) BEFORE anything is written — see
  // usePushChatCorrectionsToReport / chat-patch.server.ts. This does NOT
  // re-run the full pipeline: no new evidence document is fabricated from
  // the exchange, no analyzer/agent/engine stage re-executes, and a finding
  // the AI just corrected cannot simply reappear from the unchanged corpus,
  // which is exactly what the old addEvidenceAndRerun-based flow risked.
  const handleReviewCorrection = (msg: ChatMsg) => {
    setRegeneratingId(msg.id);
    regen
      .preview(msg.id)
      .then((data) => {
        if (data.patches.length === 0) {
          // Self-audit notices (Phase B) cover every active finding, not
          // just ones this exchange proposes correcting — still worth
          // showing even when there's nothing to approve.
          if (data.selfAuditNotices.length > 0) {
            setCorrectionReview({ messageId: msg.id, data });
            return;
          }
          toast(
            data.ungrounded > 0
              ? "NYRAVA proposed a correction here, but it could not be verified against the case record with the precision required — no report change was made. This is a safeguard, not an error: an unverifiable correction is never applied automatically."
              : "This exchange doesn't change any existing finding.",
          );
          return;
        }
        setCorrectionReview({ messageId: msg.id, data });
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Could not review this exchange");
      })
      .finally(() => {
        setRegeneratingId(null);
      });
  };

  const handleApplyCorrection = () => {
    if (!correctionReview) return;
    setApplying(true);
    const messageId = correctionReview.messageId;
    regen
      .apply(messageId, correctionReview.data.patches)
      .then(async (res) => {
        if (!res.ok) {
          // The finding(s) this proposal targeted were superseded by
          // something else (e.g. an earlier correction on this case) since
          // it was previewed — nothing was written. The server already
          // regenerated a fresh proposal against the case's current
          // findings; show that instead of leaving the attorney stuck with
          // a dead modal and a bare error.
          setCorrectionReview({ messageId, data: res.refreshedPreview });
          toast(
            res.refreshedPreview.patches.length > 0
              ? "This proposal's target changed since you opened it (another correction was applied in the meantime) — showing an updated proposal against the current findings. Please review again."
              : "This proposal's target changed since you opened it (another correction was applied in the meantime), and the exchange no longer warrants any change to the current findings.",
          );
          return;
        }
        await qc.invalidateQueries({ queryKey: ["case", caseId] });
        setCorrectionReview(null);
        toast.success(
          res.nextVersion
            ? `Report updated to v${res.nextVersion} (${res.patchCount} finding change${res.patchCount === 1 ? "" : "s"})`
            : "Report updated",
        );
        if (res.staleCitationCount > 0) {
          toast(
            `${res.staleCitationCount} report citation${res.staleCitationCount === 1 ? "" : "s"} may still reference superseded evidence — review before relying on this report.`,
          );
        }
        navigate({ to: "/cases/$caseId", params: { caseId } });
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : "Report update failed");
      })
      .finally(() => {
        setApplying(false);
      });
  };

  const suggestions = [
    t("chat.suggestion.summarize"),
    t("chat.suggestion.strongest"),
    t("chat.suggestion.weakest"),
    t("chat.suggestion.nextEvidence"),
    t("chat.suggestion.motions"),
  ];

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-40 hidden bg-background/70 backdrop-blur-sm md:block"
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      )}
      <div
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-label={expanded ? t("chat.expanded.label") : undefined}
        className={
          expanded
            ? "fixed inset-0 z-50 flex flex-col bg-card md:inset-6 md:rounded-xl md:border md:border-border md:shadow-2xl"
            : `relative flex ${heightClass} flex-col rounded-xl border border-border bg-card`
        }
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-background/80 backdrop-blur-sm">
            <div className="text-center">
              <Upload className="mx-auto h-8 w-8 text-accent" />
              <p className="mt-2 text-sm font-semibold text-foreground">{t("chat.drop.title")}</p>
              <p className="text-xs text-muted-foreground">{t("chat.drop.hint")}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-accent" />
            <h3 className="truncate text-sm font-semibold">
              {caseName ? t("chat.header.talkingTo", { name: caseName }) : t("chat.header.default")}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowEvidence((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${showEvidence ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"}`}
              title={t("chat.evidence.title")}
            >
              <FolderOpen className="h-3 w-3" /> {t("chat.evidence", { count: docs.length })}
            </button>
            <button
              onClick={() => clear.mutate()}
              disabled={history.length === 0}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> {t("chat.clear")}
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              title={expanded ? t("chat.collapse.title") : t("chat.expand.title")}
            >
              {expanded ? (
                <>
                  <Minimize2 className="h-3 w-3" /> {t("chat.close")}
                </>
              ) : (
                <>
                  <Maximize2 className="h-3 w-3" /> {t("chat.expand")}
                </>
              )}
            </button>
          </div>
        </div>

        {showEvidence && (
          <div className="max-h-56 overflow-y-auto border-b border-border bg-background/40 px-3 py-2">
            {docs.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">{t("chat.evidence.none")}</p>
            ) : (
              <ul className="space-y-1">
                {docs.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/50"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">{d.filename}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{fmtBytes(d.size_bytes)}</span>
                        <span>·</span>
                        <span className="uppercase">{d.status ?? "pending"}</span>
                        {d.has_text && <span className="text-accent">· OCR ✓</span>}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          const r = await signDoc({ data: { caseId, documentId: d.id } });
                          window.open(r.url, "_blank");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Download failed");
                        }
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      title={t("chat.download")}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${d.filename}"?`)) del.mutate(d.id);
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      title={t("chat.delete")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {history.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("chat.empty")}</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground/80 hover:bg-secondary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.map((m) => {
            // A provider-failure notice is not an answer — it must never offer
            // to be pushed into the report.
            const isErrorNotice = m.role === "assistant" && !!m.metadata?.error;
            const suggestsRerun =
              m.role === "assistant" && !isErrorNotice && !!m.metadata?.suggests_rerun;
            const isRegeneratingThis = regeneratingId === m.id;

            return (
              <div
                key={m.id}
                ref={(el) => {
                  messageElsRef.current[m.id] = el;
                }}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                    m.role === "user" ? "bg-accent text-accent-foreground" : "text-foreground"
                  }`}
                >
                  {m.role === "user" ? (
                    <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
                  ) : (
                    <ChatMarkdown text={m.content} className="leading-relaxed" />
                  )}

                  {suggestsRerun && (
                    <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
                      <p className="text-xs text-foreground/80">
                        {m.metadata?.rerun_reason || t("chat.report.flagged")}
                      </p>
                      <button
                        onClick={() => handleReviewCorrection(m)}
                        disabled={regen.busy}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {isRegeneratingThis ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCw className="h-3 w-3" />
                        )}
                        {isRegeneratingThis
                          ? regen.progress || t("chat.report.regenerating")
                          : t("chat.report.regenerate")}
                      </button>
                    </div>
                  )}

                  {/* Manual control: available on every assistant answer, not just
                    ones the model itself flagged via [[RERUN_SUGGESTED]]. Lets
                    the attorney push a correction into the report on their own
                    judgment even when the AI didn't think to suggest it. */}
                  {m.role === "assistant" && !suggestsRerun && !isErrorNotice && (
                    <div className="mt-2">
                      <button
                        onClick={() => handleReviewCorrection(m)}
                        disabled={regen.busy}
                        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
                        title={t("chat.report.manualTitle")}
                      >
                        {isRegeneratingThis ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <FilePenLine className="h-3 w-3" />
                        )}
                        {isRegeneratingThis
                          ? regen.progress || t("chat.report.updatingShort")
                          : t("chat.report.update")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {ask.isPending && (
            <div className="flex justify-start">
              <div className="text-sm text-muted-foreground">
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> {t("chat.thinking")}
              </div>
            </div>
          )}
          {upload.isPending && (
            <div className="flex justify-start">
              <div className="text-xs text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin" /> {t("chat.uploading")}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex items-end gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-accent disabled:opacity-50"
              title={t("chat.attach")}
              type="button"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={t("chat.placeholder")}
              // The text input is its own selection scope; CSS hint keeps mobile
              // long-press select-all from bleeding into surrounding chat content.
              style={{ WebkitUserSelect: "text", userSelect: "text" }}
              className="min-h-[40px] max-h-32 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={submit}
              disabled={!input.trim() || ask.isPending}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">{t("chat.send")}</span>
            </button>
          </div>
        </div>
      </div>

      {correctionReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("chat.correction.title")}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("chat.correction.subtitle")}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {correctionReview.data.selfAuditNotices.length > 0 && (
                <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs font-medium text-foreground">
                    {t("chat.correction.selfAuditTitle")}
                  </p>
                  {correctionReview.data.selfAuditNotices.map((n, i) => (
                    <div key={i} className="mt-1.5 text-xs text-foreground/80">
                      <span className="font-medium">{n.findingTitle}</span> — {n.reason}
                    </div>
                  ))}
                </div>
              )}
              {correctionReview.data.patches.map((p, i) => {
                const current = p.finding_ids
                  .map((id) => correctionReview.data.currentFindings.find((f) => f.id === id))
                  .filter((f): f is NonNullable<typeof f> => !!f);
                return (
                  <div key={i} className="mb-3 rounded-md border border-border bg-background p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        {p.action.replace("_", " ")}
                      </span>
                    </div>
                    {current.length > 0 && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {current.map((f) => f.title).join(", ")}
                      </p>
                    )}
                    {(p.new_title || p.new_description) && (
                      <p className="mt-1 text-xs text-foreground">
                        {p.new_title && <span className="font-medium">{p.new_title}: </span>}
                        {p.new_description}
                      </p>
                    )}
                    {p.action === "dispute_evidence" && (
                      <p className="mt-1 text-xs text-foreground">
                        {t("chat.correction.disputeStatus")}:{" "}
                        <span className="font-medium">{p.dispute_status}</span>
                      </p>
                    )}
                    <p className="mt-1.5 text-xs italic text-muted-foreground">"{p.reason}"</p>
                  </div>
                );
              })}
              {correctionReview.data.impact && (
                <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-foreground/80">
                  <p className="font-medium text-foreground">{t("chat.correction.affected")}</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {correctionReview.data.impact.dependentFindingIds.length > 0 && (
                      <li>
                        {t("chat.correction.affectedFindings", {
                          count: correctionReview.data.impact.dependentFindingIds.length,
                        })}
                      </li>
                    )}
                    {correctionReview.data.impact.scoreAffected && (
                      <li>{t("chat.correction.affectedScore")}</li>
                    )}
                    {correctionReview.data.impact.affectedOpportunityIds.length > 0 && (
                      <li>
                        {t("chat.correction.affectedOpportunities", {
                          count: correctionReview.data.impact.affectedOpportunityIds.length,
                        })}
                      </li>
                    )}
                    {correctionReview.data.impact.affectedCitationCount > 0 && (
                      <li>
                        {t("chat.correction.affectedCitations", {
                          count: correctionReview.data.impact.affectedCitationCount,
                        })}
                      </li>
                    )}
                    {correctionReview.data.impact.dependentFindingIds.length === 0 &&
                      !correctionReview.data.impact.scoreAffected &&
                      correctionReview.data.impact.affectedOpportunityIds.length === 0 &&
                      correctionReview.data.impact.affectedCitationCount === 0 && (
                        <li>{t("chat.correction.affectedNone")}</li>
                      )}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => setCorrectionReview(null)}
                disabled={applying}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-50"
              >
                {correctionReview.data.patches.length === 0
                  ? t("chat.correction.close")
                  : t("chat.correction.cancel")}
              </button>
              {correctionReview.data.patches.length > 0 && (
                <button
                  onClick={handleApplyCorrection}
                  disabled={applying}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {applying
                    ? regen.progress || t("chat.correction.applying")
                    : t("chat.correction.apply")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
