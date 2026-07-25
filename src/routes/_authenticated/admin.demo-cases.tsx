// Admin console for the "Experience Nyrava" homepage demo cases. Lets an
// admin curate one sample case per practice area — full evidence, timeline,
// witness analysis, motion, attorney report, and final report — that
// signed-out visitors can explore from the homepage without an account.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronDown,
  Plus,
  Save,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  Sparkles,
  Upload,
  FileText,
  ExternalLink,
  X,
  Image as ImageIcon,
} from "lucide-react";
import {
  adminListDemoCases,
  adminSaveDemoCase,
  adminDeleteDemoCase,
  adminUploadDemoDocument,
  adminUploadDemoThumbnail,
  adminDeleteDemoDocument,
  DEMO_DOC_TYPES,
  DEMO_DOC_TYPE_LABELS,
  type DemoDocType,
  type DemoCaseInput,
} from "@/lib/demo-cases.functions";
import { PRACTICE_AREA_LABELS, type PracticeArea } from "@/lib/intelligence/practice-areas";

export const Route = createFileRoute("/_authenticated/admin/demo-cases")({
  head: () => ({ meta: [{ title: "Demo cases — Admin" }] }),
  component: AdminDemoCasesPage,
});

const CASE_TYPES = Object.entries(PRACTICE_AREA_LABELS) as [PracticeArea, string][];
const FIXED_DOC_TYPES = DEMO_DOC_TYPES.filter((t) => t !== "other") as Exclude<DemoDocType, "other">[];

type DemoDoc = { id: string; doc_type: string; file_name: string; file_size: number; url: string };
type DemoCaseRow = {
  id: string;
  slug: string;
  name: string;
  case_type: string;
  summary: string;
  description: string;
  published: boolean;
  sort_order: number;
  thumbnail_url: string | null;
  documents: DemoDoc[];
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function AdminDemoCasesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListDemoCases);
  const saveFn = useServerFn(adminSaveDemoCase);
  const deleteFn = useServerFn(adminDeleteDemoCase);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-demo-cases"],
    queryFn: () => listFn(),
  });
  const rows = (data ?? []) as DemoCaseRow[];
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-demo-cases"] });
    qc.invalidateQueries({ queryKey: ["published-demo-cases"] });
  };

  const saveM = useMutation({
    mutationFn: (input: DemoCaseInput) => saveFn({ data: input }),
    onSuccess: (saved) => {
      toast.success(`Saved "${saved.name}"`);
      invalidate();
      setCreating(false);
      setExpanded(saved.id);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Demo case deleted");
      invalidate();
      setExpanded(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const nextSort = (rows[rows.length - 1]?.sort_order ?? 0) + 10;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Link to="/admin" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Admin
      </Link>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">Demo cases</h1>
          <p className="text-sm text-muted-foreground">
            Powers "Experience Nyrava" on the public homepage. Only <span className="font-medium">Published</span>{" "}
            cases are visible to signed-out visitors.
          </p>
        </div>
      </div>

      {isLoading && <div className="mt-8 text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="mt-8 text-sm text-destructive">Failed to load demo cases.</div>}

      <div className="mt-8 space-y-3">
        {rows.map((c) => (
          <DemoCaseCard
            key={c.id}
            row={c}
            expanded={expanded === c.id}
            onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
            onSave={(patch) => saveM.mutate({ id: c.id, ...patch })}
            onDelete={() => {
              if (confirm(`Delete demo case "${c.name}"? This removes all uploaded files too.`)) deleteM.mutate(c.id);
            }}
            saving={saveM.isPending && saveM.variables?.id === c.id}
            deleting={deleteM.isPending && deleteM.variables === c.id}
            onFilesChanged={invalidate}
          />
        ))}
      </div>

      <div className="mt-6">
        {creating ? (
          <DemoCaseCard
            expanded
            isNew
            onToggle={() => setCreating(false)}
            onSave={(patch) => saveM.mutate(patch)}
            onDelete={() => setCreating(false)}
            saving={saveM.isPending && !saveM.variables?.id}
            deleting={false}
            onFilesChanged={invalidate}
            row={{
              id: "",
              slug: "",
              name: "",
              case_type: CASE_TYPES[0][0],
              summary: "",
              description: "",
              published: false,
              sort_order: nextSort,
              thumbnail_url: null,
              documents: [],
            }}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-accent/50 hover:bg-card hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> New demo case
          </button>
        )}
      </div>
    </div>
  );
}

function DemoCaseCard({
  row,
  expanded,
  onToggle,
  onSave,
  onDelete,
  saving,
  deleting,
  isNew,
  onFilesChanged,
}: {
  row: DemoCaseRow;
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: {
    slug: string;
    name: string;
    case_type: PracticeArea;
    summary: string;
    description: string;
    sort_order: number;
    published: boolean;
  }) => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
  isNew?: boolean;
  onFilesChanged: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [slug, setSlug] = useState(row.slug);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [caseType, setCaseType] = useState<PracticeArea>((row.case_type as PracticeArea) ?? CASE_TYPES[0][0]);
  const [summary, setSummary] = useState(row.summary);
  const [description, setDescription] = useState(row.description);
  const [published, setPublished] = useState(row.published);

  const docByType = new Map(row.documents.map((d) => [d.doc_type, d]));
  const otherDocs = row.documents.filter((d) => d.doc_type === "other");

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
            {row.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{isNew ? "New demo case" : row.name || "Untitled"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {PRACTICE_AREA_LABELS[caseType]} · {row.documents.length} file{row.documents.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isNew &&
            (row.published ? (
              <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-1 text-[11px] font-medium text-success">
                <Eye className="h-3 w-3" /> Published
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                <EyeOff className="h-3 w-3" /> Draft
              </span>
            ))}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Case name">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="State v. Marcus Franklin"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="URL slug">
              <input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="criminal-defense"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              />
            </Field>
            <Field label="Case type">
              <select
                value={caseType}
                onChange={(e) => setCaseType(e.target.value as PracticeArea)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {CASE_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Summary (shown on homepage card)">
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Breach of Contract"
                maxLength={300}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <Field label="Description (shown on the demo page)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          {!isNew && <ThumbnailUploader demoCaseId={row.id} currentUrl={row.thumbnail_url} onDone={onFilesChanged} />}

          {!isNew && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Case documents
              </div>
              <div className="space-y-2">
                {FIXED_DOC_TYPES.map((docType) => (
                  <DocSlot
                    key={docType}
                    demoCaseId={row.id}
                    docType={docType}
                    doc={docByType.get(docType)}
                    onDone={onFilesChanged}
                  />
                ))}
                {otherDocs.map((d) => (
                  <DocSlot key={d.id} demoCaseId={row.id} docType="other" doc={d} onDone={onFilesChanged} isExtra />
                ))}
                <DocSlot demoCaseId={row.id} docType="other" doc={undefined} onDone={onFilesChanged} isExtra addAnother />
              </div>
            </div>
          )}

          {isNew && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Save the case first, then upload files and set it to Published.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="h-4 w-4" />
            Published — visible on the public homepage
          </label>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <button
              onClick={onDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/15 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {isNew ? "Cancel" : "Delete"}
            </button>
            <button
              onClick={() =>
                onSave({
                  slug,
                  name,
                  case_type: caseType,
                  summary,
                  description,
                  sort_order: row.sort_order,
                  published,
                })
              }
              disabled={saving || !name.trim() || !slug.trim()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ThumbnailUploader({
  demoCaseId,
  currentUrl,
  onDone,
}: {
  demoCaseId: string;
  currentUrl: string | null;
  onDone: () => void;
}) {
  const uploadFn = useServerFn(adminUploadDemoThumbnail);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("demo_case_id", demoCaseId);
      fd.set("file", file);
      await uploadFn({ data: fd });
      toast.success("Thumbnail updated");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Field label="Thumbnail">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload image
        </button>
      </div>
    </Field>
  );
}

function DocSlot({
  demoCaseId,
  docType,
  doc,
  onDone,
  isExtra,
  addAnother,
}: {
  demoCaseId: string;
  docType: DemoDocType;
  doc: DemoDoc | undefined;
  onDone: () => void;
  isExtra?: boolean;
  addAnother?: boolean;
}) {
  const uploadFn = useServerFn(adminUploadDemoDocument);
  const deleteFn = useServerFn(adminDeleteDemoDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("demo_case_id", demoCaseId);
      fd.set("doc_type", docType);
      fd.set("file", file);
      await uploadFn({ data: fd });
      toast.success(`Uploaded ${file.name}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDelete = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await deleteFn({ data: { id: doc.id } });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {addAnother ? "Add supporting file" : DEMO_DOC_TYPE_LABELS[docType]}
            {isExtra && !addAnother ? "" : ""}
          </div>
          {doc ? (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 truncate text-xs text-primary hover:underline"
            >
              {doc.file_name} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <div className="text-xs text-muted-foreground">
              {addAnother ? "Police report, 911 call, body-cam transcript, etc." : "No file uploaded"}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {doc ? "Replace" : "Upload"}
        </button>
        {doc && (
          <button
            onClick={onDelete}
            disabled={busy}
            className="flex items-center justify-center rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label="Remove file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
