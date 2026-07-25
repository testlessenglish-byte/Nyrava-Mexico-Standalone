import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createCaseAndUpload, listGroqKeys } from "@/lib/cases.functions";
import { toast } from "sonner";
import { Upload, FileText, X, KeyRound } from "lucide-react";
import { CASE_TYPE_SELECT_GROUPS } from "@/lib/intelligence/practice-areas";
import { JURISDICTION_OPTIONS } from "@/lib/intelligence/jurisdictions";

export const Route = createFileRoute("/_app/new")({
  head: () => ({ meta: [{ title: "New case — Nyrava" }] }),
  component: NewCasePage,
});

function NewCasePage() {
  const nav = useNavigate();
  const uploadCase = useServerFn(createCaseAndUpload);
  const fetchKeyStatus = useServerFn(listGroqKeys);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<"strict" | "balanced" | "exploratory">("balanced");
  // No default: a silent "general_civil" default caused cases to be
  // misclassified whenever a user didn't explicitly touch this dropdown
  // (e.g. a case named "criminal test" still ran as civil), which in turn
  // silently skipped every criminal-only engine (Attack Surface, Chain of
  // Custody, Constitutional, Procedural Violations). Force an explicit pick.
  const [caseType, setCaseType] = useState<string>("");
  // Not required, unlike case type: leaving it unset just means case-law
  // lookups search nationwide instead of scoping to one state's courts.
  const [jurisdiction, setJurisdiction] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [drag, setDrag] = useState(false);
  const { data: keyStatus } = useQuery({
    queryKey: ["keyStatus"],
    queryFn: () => fetchKeyStatus(),
  });
  const hasKey = (keyStatus?.keys.length ?? 0) > 0 || (keyStatus?.platformConfigured ?? false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasKey) {
      toast.error("AI key not configured on the server");
      return;
    }
    if (!name.trim()) {
      toast.error("Name your case");
      return;
    }
    if (files.length === 0) {
      toast.error("Add at least one file");
      return;
    }
    if (!caseType) {
      toast.error("Choose a case type — this locks the legal framework and can't be inferred automatically");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    fd.append("name", name);
    fd.append("description", desc);
    fd.append("analysis_mode", mode);
    fd.append("case_type", caseType);
    if (jurisdiction) fd.append("jurisdiction", jurisdiction);

    for (const f of files) fd.append("files", f);
    toast.info("Uploading evidence…");
    try {
      const res = await uploadCase({ data: fd });
      toast.success("Evidence uploaded — open the workspace to run extraction");
      nav({ to: "/cases/$caseId", params: { caseId: res.caseId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-3xl font-semibold">New case</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload evidence. You'll run extraction, analyzers, agents, scoring, and reports independently from the
        workspace.
      </p>

      {!hasKey && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="flex-1">
            <p className="font-medium text-warning">AI key not configured</p>
            <p className="mt-1 text-muted-foreground">
              No AI provider is reachable. Check the Health page for details.
            </p>
            <Link
              to="/settings"
              className="mt-2 inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
            >
              Open Settings →
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div>
          <label className="text-sm font-medium">Case name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Doe v. Acme — Q3 production"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-sm font-medium">
            Description <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Case type</label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Locks the legal framework. The engine will never apply criminal terminology (Miranda, suppression,
            conviction) to a civil case, or vice versa — except Tax Law, which starts civil (audit, Tax Court) and
            automatically unlocks criminal tax-fraud analysis only if a charging document appears in the evidence.
          </p>
          <select
            value={caseType}
            onChange={(e) => setCaseType(e.target.value)}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="" disabled>
              Select a case type…
            </option>
            {CASE_TYPE_SELECT_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">
            Jurisdiction <span className="text-muted-foreground">(optional)</span>
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Scopes case-law lookups to this state's courts instead of searching nationwide. Leave unset to search
            nationwide.
          </p>
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Nationwide (no state filter)</option>
            {JURISDICTION_OPTIONS.filter((o) => o.value !== "federal").map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Analysis mode</label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Controls how strictly Nyrava filters AI-generated content. Strict keeps only items with verifiable evidence;
            Exploratory shows AI theories with a tag.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(["strict", "balanced", "exploratory"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  mode === m
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary/40"
                }`}
              >
                <div className="text-sm font-semibold capitalize text-foreground">
                  {m === "strict" ? "Strict evidence" : m}
                </div>
                <div className="mt-0.5">
                  {m === "strict" && "Only direct evidence. Drops inferences and theories."}
                  {m === "balanced" && "Direct evidence + evidence-based inferences."}
                  {m === "exploratory" && "Includes AI theories, clearly labeled."}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Evidence files</label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`mt-1 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              drag ? "border-accent bg-accent/5" : "border-border bg-card hover:bg-secondary/40"
            }`}
          >
            <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Drop files here or click to browse</p>
            <p className="mt-1 text-xs text-muted-foreground">ZIP · PDF · DOCX · TXT · Images · Audio</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept=".zip,.pdf,.doc,.docx,.txt,.md,.csv,.json,.xml,.html,image/*,audio/*"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>
          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-card text-sm">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          disabled={submitting}
          className="rounded-md bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Uploading…" : "Upload evidence"}
        </button>
      </form>
    </div>
  );
}
