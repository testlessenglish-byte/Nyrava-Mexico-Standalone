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
import { useAddEvidenceAndRerun } from "@/hooks/useAddEvidenceAndRerun";
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
  CheckCircle2,
  FilePenLine,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";

// Session-only, single-shot signal used to tell the Case Workspace which tab
// to land on right after a Talk-to-Case push. Read once on the workspace's
// mount effect and cleared immediately — see cases.$caseId.tsx. sessionStorage
// (not React state) is required because this crosses a full route navigation,
// which unmounts this component entirely.
const OPEN_TAB_KEY = (caseId: string) => `nyrava:open-tab:${caseId}`;

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

const ACCEPTED = ".pdf,.zip,.docx,.doc,.txt,.rtf,.md,.csv,.xlsx,.xls,.jpg,.jpeg,.png,.webp,.heic,.tif,.tiff,.gif";

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
  const { locale } = useI18n();
  const fetchChat = useServerFn(getCaseChat);
  const askAi = useServerFn(askCaseAi);
  const clearChat = useServerFn(clearCaseChat);
  const uploadFn = useServerFn(uploadCaseEvidence);
  const listDocs = useServerFn(listCaseDocuments);
  const deleteDoc = useServerFn(deleteCaseDocument);
  const signDoc = useServerFn(getDocumentDownloadUrl);
  const regen = useAddEvidenceAndRerun(caseId);

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
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  // Per-message: which messages have already had a rerun triggered from
  // them, and which report version that rerun landed on. Keyed by message
  // id so re-rendering the same suggestion after the mutation succeeds
  // shows a confirmation instead of the button again.
  const [regeneratedVersions, setRegeneratedVersions] = useState<Record<string, number | null>>({});
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

  // Packages a resolved chat exchange as a small clarification document and
  // runs it through the same versioned, audited rerun the Evidence tab uses
  // (addEvidenceAndRerun -> queue -> drive -> finalize change log). This is
  // deliberately a click, not an automatic side effect of the AI's answer —
  // see the "REPORT UPDATE SIGNAL" rule in chat.server.ts for why.
  const handleRegenerate = async (msg: ChatMsg, precedingQuestion: string | null, manualReason?: string) => {
    setRegeneratingId(msg.id);
    try {
      const reason = manualReason ?? msg.metadata?.rerun_reason ?? "Resolves a report-flagged item.";
      const body = [
        "ATTORNEY CLARIFICATION — Case Chat",
        caseName ? `Case: ${caseName}` : null,
        `Date: ${new Date().toISOString()}`,
        "",
        "Attorney note / question:",
        precedingQuestion || "(not captured)",
        "",
        "Nyrava Intelligence response:",
        msg.content,
        "",
        `Reason flagged for report update: ${reason}`,
      ]
        .filter((l): l is string => l !== null)
        .join("\n");
      const file = new File([body], `case-chat-clarification-${Date.now()}.txt`, {
        type: "text/plain",
      });
      const res = await regen.run([file]);
      setRegeneratedVersions((prev) => ({ ...prev, [msg.id]: res.nextVersion }));
      // Invalidate BEFORE navigating so the case query is already marked
      // stale by the time the workspace route mounts — it then fetches the
      // fresh report/pipeline state on that mount instead of ever serving
      // what was cached from before this rerun. This (not a page reload) is
      // what removes the need for a manual browser refresh.
      await qc.invalidateQueries({ queryKey: ["case", caseId] });
      await qc.invalidateQueries({ queryKey: ["case-docs", caseId] });
      toast.success(res.nextVersion ? `Report updated to v${res.nextVersion}` : "Report updated");
      // One-shot handoff so the workspace opens on the Report tab. Read and
      // cleared on the workspace's mount effect (see cases.$caseId.tsx) —
      // sessionStorage is required here (not React state) because this is a
      // full route navigation that unmounts this component.
      try {
        window.sessionStorage.setItem(OPEN_TAB_KEY(caseId), "report");
      } catch {
        /* ignore — sessionStorage unavailable (private browsing, etc.) */
      }
      navigate({ to: "/cases/$caseId", params: { caseId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Regenerate failed");
    } finally {
      setRegeneratingId(null);
    }
  };

  const suggestions = [
    "Summarize this case for me.",
    "What is the strongest argument we have?",
    "Where is the evidence weakest?",
    "What evidence should I upload next?",
    "What motions should be filed first?",
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
        aria-label={expanded ? "Talk To Case — expanded" : undefined}
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
              <p className="mt-2 text-sm font-semibold text-foreground">Drop files to attach to this case</p>
              <p className="text-xs text-muted-foreground">PDF, DOCX, ZIP, images, scans — up to 50 MB each</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-accent" />
            <h3 className="truncate text-sm font-semibold">
              {caseName ? `Talking to: ${caseName}` : "Case Intelligence"}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowEvidence((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${showEvidence ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"}`}
              title="Show evidence in this case"
            >
              <FolderOpen className="h-3 w-3" /> Evidence ({docs.length})
            </button>
            <button
              onClick={() => clear.mutate()}
              disabled={history.length === 0}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              title={expanded ? "Collapse to normal view" : "Expand to full-screen reading view"}
            >
              {expanded ? (
                <>
                  <Minimize2 className="h-3 w-3" /> Close
                </>
              ) : (
                <>
                  <Maximize2 className="h-3 w-3" /> Expand
                </>
              )}
            </button>
          </div>
        </div>

        {showEvidence && (
          <div className="max-h-56 overflow-y-auto border-b border-border bg-background/40 px-3 py-2">
            {docs.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">
                No evidence uploaded yet. Drag files anywhere on this chat, or use the paperclip below.
              </p>
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
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${d.filename}"?`)) del.mutate(d.id);
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      title="Delete"
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
              <p className="text-sm text-muted-foreground">
                Ask anything about this case. Drag files into this window to add evidence — Nyrava Intelligence will
                read them and tell you what's still missing.
              </p>
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
          {history.map((m, idx) => {
            const precedingQuestion =
              m.role === "assistant"
                ? ([...history.slice(0, idx)].reverse().find((h) => h.role === "user")?.content ?? null)
                : null;
            // A provider-failure notice is not an answer — it must never offer
            // to be pushed into the report.
            const isErrorNotice = m.role === "assistant" && !!m.metadata?.error;
            const suggestsRerun = m.role === "assistant" && !isErrorNotice && !!m.metadata?.suggests_rerun;
            const alreadyRegenerated = Object.prototype.hasOwnProperty.call(regeneratedVersions, m.id);
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
                      {alreadyRegenerated ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          {regeneratedVersions[m.id]
                            ? `Report updated to v${regeneratedVersions[m.id]}`
                            : "Report updated"}
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-foreground/80">
                            {m.metadata?.rerun_reason || "This resolves something the report flagged."}
                          </p>
                          <button
                            onClick={() => handleRegenerate(m, precedingQuestion)}
                            disabled={regen.busy}
                            className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {isRegeneratingThis ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCw className="h-3 w-3" />
                            )}
                            {isRegeneratingThis ? regen.progress || "Regenerating…" : "Regenerate report with this"}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Manual control: available on every assistant answer, not just
                    ones the model itself flagged via [[RERUN_SUGGESTED]]. Lets
                    the attorney push a correction into the report on their own
                    judgment even when the AI didn't think to suggest it. */}
                  {m.role === "assistant" && !suggestsRerun && !isErrorNotice && (
                    <div className="mt-2">
                      {alreadyRegenerated ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          {regeneratedVersions[m.id]
                            ? `Report updated to v${regeneratedVersions[m.id]}`
                            : "Report updated"}
                        </div>
                      ) : (
                        <button
                          onClick={() =>
                            handleRegenerate(
                              m,
                              precedingQuestion,
                              "Attorney manually pushed this chat answer into the report.",
                            )
                          }
                          disabled={regen.busy}
                          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
                          title="Not covered by an automatic flag — manually push this into the report and rerun"
                        >
                          {isRegeneratingThis ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FilePenLine className="h-3 w-3" />
                          )}
                          {isRegeneratingThis ? regen.progress || "Updating…" : "Update report with this"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {ask.isPending && (
            <div className="flex justify-start">
              <div className="text-sm text-muted-foreground">
                <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
          {upload.isPending && (
            <div className="flex justify-start">
              <div className="text-xs text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin" /> Uploading evidence to this case…
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
              title="Attach evidence"
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
              placeholder="Ask Nyrava Intelligence or drop files…"
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
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
