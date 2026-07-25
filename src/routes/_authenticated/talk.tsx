import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo, useEffect } from "react";
import { listCases } from "@/lib/cases.functions";
import { CaseChatPanel } from "@/components/CaseChatPanel";
import { VoiceCompanion } from "@/components/VoiceCompanion";
import { MessageSquare, Plus, FolderOpen, ChevronDown, Mic } from "lucide-react";

export const Route = createFileRoute("/_authenticated/talk")({
  head: () => ({ meta: [{ title: "Talk To Cases — Nyrava" }] }),
  component: TalkPage,
});

function TalkPage() {
  const fetchCases = useServerFn(listCases);
  const { data, isLoading } = useQuery({
    queryKey: ["cases"],
    queryFn: () => fetchCases(),
    refetchInterval: 10000,
  });
  const cases = useMemo(() => (data ?? []).filter((c) => !c.archived_at), [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "voice">("chat");

  // Auto-pick the first case once loaded
  useEffect(() => {
    if (!selectedId && cases.length > 0) setSelectedId(cases[0].id);
  }, [cases, selectedId]);

  const selected = cases.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-5 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Talk To Cases</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a case and ask anything. Answers are grounded in that case's evidence and findings.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card/60 p-10 text-center text-sm text-muted-foreground">
          Loading your cases…
        </div>
      ) : cases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/60 p-10 text-center">
          <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            Upload a case first, then come back to chat with it.
          </p>
          <Link
            to="/new"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New case
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <label className="mb-1.5 block px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active case
            </label>
            <div className="relative">
              <select
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 pr-9 text-sm outline-none focus:border-primary"
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.status_message ?? c.status}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setMode("chat")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${mode === "chat" ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground hover:text-foreground"}`}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Text
            </button>
            <button
              onClick={() => setMode("voice")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${mode === "voice" ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground hover:text-foreground"}`}
            >
              <Mic className="h-3.5 w-3.5" /> Voice
            </button>
          </div>

          {selected ? (
            mode === "voice" ? (
              <VoiceCompanion key={`voice-${selected.id}`} caseId={selected.id} caseName={selected.name} />
            ) : (
              <CaseChatPanel
                key={selected.id}
                caseId={selected.id}
                caseName={selected.name}
                heightClass="h-[calc(100vh-22rem)] min-h-[420px]"
              />
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
