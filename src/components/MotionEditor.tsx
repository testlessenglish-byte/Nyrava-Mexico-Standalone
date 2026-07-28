// Editable drafting surface for Motion Intelligence (Phase 1).
//
// Deliberately built on the existing constrained-markdown block model
// (parseMotionMarkdown / MotionPreview / motionMarkdownToPdf) instead of a
// rich-text editor library (TipTap, etc). A real structured document editor
// is the right long-term foundation for later phases — live evidence chips
// that survive editing, paragraph-level evidence tracking — but that's a
// bigger, separate migration (new document format, migrating stored drafts,
// custom editor nodes). This gets attorneys real editing + autosave + a
// PDF that matches the screen today, without touching the storage format or
// blocking on that larger rewrite.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  ListOrdered,
  Minus,
  PenLine,
  Eye,
  Pencil,
  Printer,
  FileDown,
  StickyNote,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { updateMotionDraft, updateMotionDraftNotes } from "@/lib/cases.functions";
import { MotionPreview, downloadMotionPdf, printMotion } from "@/lib/motion-markdown";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep textarea selection/focus
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    >
      {children}
    </button>
  );
}

export function MotionEditor({
  draftId,
  title,
  initialMarkdown,
  initialNotes,
  onSaved,
}: {
  draftId: string;
  title: string;
  initialMarkdown: string;
  initialNotes?: string;
  onSaved?: (markdown: string) => void;
}) {
  const [value, setValue] = useState(initialMarkdown);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [notesStatus, setNotesStatus] = useState<SaveStatus>("idle");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const savedValueRef = useRef(initialMarkdown);
  const savedNotesRef = useRef(initialNotes ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveFn = useServerFn(updateMotionDraft);
  const mutation = useMutation({
    mutationFn: (bodyMarkdown: string) => saveFn({ data: { draftId, bodyMarkdown } }),
    onMutate: () => setStatus("saving"),
    onSuccess: (res, bodyMarkdown) => {
      savedValueRef.current = bodyMarkdown;
      setStatus("saved");
      onSaved?.(bodyMarkdown);
    },
    onError: (e: unknown) => {
      setStatus("error");
      toast.error(e instanceof Error ? e.message : "Autosave failed — your edits are still in this tab.");
    },
  });

  // Debounced autosave: 1s after the attorney stops typing, and only if the
  // content actually changed since the last successful save.
  useEffect(() => {
    if (value === savedValueRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      mutation.mutate(value);
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Flush any pending edit on unmount (e.g. attorney collapses the row right
  // after typing) so a save is never silently dropped by the debounce timer.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (value !== savedValueRef.current) {
        saveFn({ data: { draftId, bodyMarkdown: value } }).catch(() => {
          /* best-effort flush on unmount */
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveNotesFn = useServerFn(updateMotionDraftNotes);
  const notesMutation = useMutation({
    mutationFn: (attorneyNotes: string) => saveNotesFn({ data: { draftId, attorneyNotes } }),
    onMutate: () => setNotesStatus("saving"),
    onSuccess: (res, attorneyNotes) => {
      savedNotesRef.current = attorneyNotes;
      setNotesStatus("saved");
    },
    onError: (e: unknown) => {
      setNotesStatus("error");
      toast.error(e instanceof Error ? e.message : "Note autosave failed — still saved in this tab.");
    },
  });

  useEffect(() => {
    if (notes === savedNotesRef.current) return;
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => {
      notesMutation.mutate(notes);
    }, 1000);
    return () => {
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  useEffect(() => {
    return () => {
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
      if (notes !== savedNotesRef.current) {
        saveNotesFn({ data: { draftId, attorneyNotes: notes } }).catch(() => {
          /* best-effort flush on unmount */
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrapSelection = (before: string, after = before) => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e);
    const next = value.slice(0, s) + before + selected + after + value.slice(e);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = s + before.length;
      el.selectionEnd = s + before.length + selected.length;
    });
  };

  const insertLinePrefix = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const s = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = s + prefix.length;
    });
  };

  const insertBlock = (text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const s = el.selectionStart;
    const needsLeadingBreak = s > 0 && value[s - 1] !== "\n";
    const insert = `${needsLeadingBreak ? "\n\n" : ""}${text}\n\n`;
    const next = value.slice(0, s) + insert + value.slice(s);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + insert.length;
      el.selectionStart = el.selectionEnd = pos;
    });
  };

  const nextOrderedIndex = useMemo(() => {
    const matches = value.match(/^(\d+)\.\s/gm);
    if (!matches || matches.length === 0) return 1;
    const last = matches[matches.length - 1];
    return Number(last.match(/^(\d+)/)?.[1] ?? 0) + 1;
  }, [value]);

  const statusLabel =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : "";

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border bg-card/80">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
        <ToolbarButton title="Bold" onClick={() => wrapSelection("**")}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => wrapSelection("*")}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton title="Heading" onClick={() => insertLinePrefix("# ")}>
          <Heading1 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Subheading" onClick={() => insertLinePrefix("## ")}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Sub-subheading" onClick={() => insertLinePrefix("### ")}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton title="Numbered item" onClick={() => insertLinePrefix(`${nextOrderedIndex}. `)}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Divider" onClick={() => insertBlock("***")}>
          <Minus className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Signature line" onClick={() => insertBlock("____________________")}>
          <PenLine className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {mutation.isPending ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => setMode((m) => (m === "edit" ? "preview" : "edit"))}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted/60"
          >
            {mode === "edit" ? (
              <>
                <Eye className="h-3 w-3" /> Preview
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" /> Edit
              </>
            )}
          </button>
          <button
            type="button"
            title="Attorney notes (private — never included in the exported motion)"
            onClick={() => setNotesOpen((v) => !v)}
            className={`flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted/60 ${notesOpen ? "bg-muted/60" : ""}`}
          >
            <StickyNote className="h-3 w-3" /> Notes
          </button>
          <button
            type="button"
            title="Print"
            onClick={() => printMotion(title, value)}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium hover:bg-muted/60"
          >
            <Printer className="h-3 w-3" /> Print
          </button>
          <button
            type="button"
            title="Download PDF"
            onClick={() =>
              downloadMotionPdf(title, value).catch((e) =>
                toast.error(e instanceof Error ? e.message : "PDF export failed"),
              )
            }
            className="flex items-center gap-1 rounded border border-border bg-foreground px-2 py-1 text-[11px] font-medium text-background hover:opacity-90"
          >
            <FileDown className="h-3 w-3" /> PDF
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck
          className="h-96 w-full resize-y bg-transparent p-4 font-serif text-[13px] leading-relaxed text-foreground/90 outline-none"
        />
      ) : (
        <div className="max-h-96 overflow-y-auto p-4">
          <MotionPreview markdown={value} />
        </div>
      )}

      {notesOpen ? (
        <div className="border-t border-border bg-amber-500/5 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-400">
              <StickyNote className="h-3 w-3" /> Attorney Notes — private, never included in the filed motion
            </span>
            <span className="text-[11px] text-muted-foreground">
              {notesMutation.isPending ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
              {notesStatus === "saving" ? "Saving…" : notesStatus === "saved" ? "Saved" : ""}
            </span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Need expert affidavit. Confirm chain of custody. Call witness before filing."
            className="h-24 w-full resize-y rounded border border-border/60 bg-background/60 p-2 text-[12px] leading-relaxed outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}
