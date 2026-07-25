// Nyrava Intelligence Control Center.
//
// This is deliberately NOT an API-key management screen. Providers
// (OpenAI, Anthropic, Gemini, Groq, OpenRouter) are invisible infrastructure
// — the UI exposes "Nyrava Intelligence": status, provider order/failover,
// and which provider + mode powers each feature. Raw keys are one layer
// down, behind "Manage" → "Keys", never on the main surface.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sparkles,
  ShieldCheck,
  Plus,
  ChevronRight,
  GripVertical,
  Loader2,
  CheckCircle2,
  Key as KeyIcon,
  Trash2,
  RotateCw,
  Power,
  Settings2,
  ArrowDown,
  Lock,
  Gauge,
  Eye,
  EyeOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  listUserAIKeys,
  addUserAIKey,
  deleteUserAIKey,
  toggleUserAIKey,
  toggleProviderAIKeys,
  deleteProviderAIKeys,
  testUserAIKey,
  type UserAIKeyView,
} from "@/lib/ai-keys.functions";
import {
  listProviderOrder,
  setProviderOrder,
  listFeatureRouting,
  setFeatureRouting,
  type Provider,
  type FeatureKey,
  type Mode,
} from "@/lib/intelligence-providers.functions";

// ------------------------------------------------------------
// Static provider + feature metadata (display only — never affects routing)
// ------------------------------------------------------------
const PROVIDER_META: Record<
  Provider,
  { label: string; letter: string; color: string; models: string[]; hint: string }
> = {
  openai: {
    label: "OpenAI",
    letter: "O",
    color: "#10a37f",
    models: ["GPT-4o mini"],
    hint: "sk-… from platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic",
    letter: "A",
    color: "#d97757",
    models: ["Claude 3.5 Sonnet"],
    hint: "sk-ant-… from console.anthropic.com/settings/keys",
  },
  gemini: {
    label: "Google Gemini",
    letter: "G",
    color: "#4285f4",
    models: ["Gemini 2.0 Flash"],
    hint: "AIza… from aistudio.google.com/apikey",
  },
  groq: {
    label: "Groq",
    letter: "Q",
    color: "#f55036",
    models: ["GPT-OSS 120B (via Groq)"],
    hint: "gsk_… from console.groq.com/keys",
  },
  openrouter: {
    label: "OpenRouter",
    letter: "R",
    color: "#8b5cf6",
    models: ["Multi-model routing"],
    hint: "sk-or-… from openrouter.ai/keys",
  },
};

const PROVIDER_LIST: Provider[] = ["openai", "anthropic", "gemini", "groq", "openrouter"];
const ORDER_LABELS = ["Primary", "Secondary", "Third", "Backup", "Final Backup"];

const FEATURES: Array<{ key: FeatureKey; label: string; purpose: string }> = [
  {
    key: "case_intelligence",
    label: "Case Intelligence",
    purpose: "Deep analysis of facts, evidence & law",
  },
  { key: "talk_to_cases", label: "Talk to Cases", purpose: "Conversational Q&A about your case" },
  {
    key: "motion_drafting",
    label: "Motion Drafting",
    purpose: "Draft motions and legal documents",
  },
  { key: "reports", label: "Reports", purpose: "Comprehensive case reports" },
  {
    key: "ocr_documents",
    label: "OCR & Document Processing",
    purpose: "Extract text and process documents",
  },
  {
    key: "voice_transcription",
    label: "Voice Transcription",
    purpose: "Audio transcription and summarization",
  },
  {
    key: "evidence_explorer",
    label: "Evidence Explorer",
    purpose: "Explore and organize evidence",
  },
  {
    key: "timeline_builder",
    label: "Timeline Builder",
    purpose: "Build and analyze case timelines",
  },
  {
    key: "witness_intelligence",
    label: "Witness Intelligence",
    purpose: "Analyze witness statements & credibility",
  },
  {
    key: "strategy_center",
    label: "Strategy Center",
    purpose: "Generate strategy and recommendations",
  },
];

const MODE_META: Record<Mode, { label: string; icon: typeof Sparkles }> = {
  maximum_accuracy: { label: "Maximum Accuracy", icon: Sparkles },
  balanced: { label: "Balanced", icon: Gauge },
  fastest: { label: "Fastest", icon: RotateCw },
  lowest_cost: { label: "Lowest Cost", icon: ChevronRight },
  private: { label: "Private", icon: Lock },
};

type Health = "healthy" | "slow" | "offline" | "unverified" | "not_connected";

function timeAgo(iso: string | null): string {
  if (!iso) return "Never tested";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function providerHealth(keys: UserAIKeyView[]): {
  health: Health;
  latencyMs: number | null;
  lastTested: string | null;
} {
  const active = keys.filter((k) => k.isActive);
  if (keys.length === 0) return { health: "not_connected", latencyMs: null, lastTested: null };
  if (active.length === 0) return { health: "offline", latencyMs: null, lastTested: null };

  const tested = active.filter((k) => k.lastTestOk != null);
  const lastTested = keys.reduce<string | null>((acc, k) => {
    if (!k.lastUsedAt) return acc;
    if (!acc || new Date(k.lastUsedAt) > new Date(acc)) return k.lastUsedAt;
    return acc;
  }, null);

  if (tested.length === 0) return { health: "unverified", latencyMs: null, lastTested };
  const anyOk = tested.some((k) => k.lastTestOk);
  if (!anyOk) return { health: "offline", latencyMs: null, lastTested };

  const okKeys = tested.filter((k) => k.lastTestOk);
  const latencyMs = Math.min(
    ...okKeys.map((k) => k.lastTestLatencyMs ?? Infinity).filter((n) => Number.isFinite(n)),
  );
  const finalLatency = Number.isFinite(latencyMs) ? latencyMs : null;
  return {
    health: finalLatency != null && finalLatency > 2500 ? "slow" : "healthy",
    latencyMs: finalLatency,
    lastTested,
  };
}

function HealthBadge({ health }: { health: Health }) {
  const map: Record<Health, { label: string; className: string; dot: string }> = {
    healthy: { label: "Healthy", className: "text-success", dot: "bg-success" },
    slow: { label: "Slow", className: "text-warning", dot: "bg-warning" },
    offline: { label: "Offline", className: "text-destructive", dot: "bg-destructive" },
    unverified: {
      label: "Not tested",
      className: "text-muted-foreground",
      dot: "bg-muted-foreground",
    },
    not_connected: {
      label: "Not Connected",
      className: "text-muted-foreground",
      dot: "bg-muted-foreground",
    },
  };
  const m = map[health];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

function ProviderMark({ provider, size = 40 }: { provider: Provider; size?: number }) {
  const m = PROVIDER_META[provider];
  return (
    <div
      className="grid shrink-0 place-items-center rounded-xl font-bold text-white"
      style={{ background: m.color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {m.letter}
    </div>
  );
}

// ==============================================================
// Main component
// ==============================================================
export function IntelligenceProviders() {
  const qc = useQueryClient();

  const listFn = useServerFn(listUserAIKeys);
  const addFn = useServerFn(addUserAIKey);
  const delFn = useServerFn(deleteUserAIKey);
  const toggleFn = useServerFn(toggleUserAIKey);
  const toggleProviderFn = useServerFn(toggleProviderAIKeys);
  const deleteProviderFn = useServerFn(deleteProviderAIKeys);
  const testFn = useServerFn(testUserAIKey);
  const listOrderFn = useServerFn(listProviderOrder);
  const setOrderFn = useServerFn(setProviderOrder);
  const listFeaturesFn = useServerFn(listFeatureRouting);
  const setFeatureFn = useServerFn(setFeatureRouting);

  const keysQ = useQuery({
    queryKey: ["userAIKeys"],
    queryFn: () => listFn(),
    refetchInterval: 20_000,
  });
  const orderQ = useQuery({ queryKey: ["providerOrder"], queryFn: () => listOrderFn() });
  const featuresQ = useQuery({ queryKey: ["featureRouting"], queryFn: () => listFeaturesFn() });

  const invalidateKeys = () => qc.invalidateQueries({ queryKey: ["userAIKeys"] });

  const byProvider = useMemo(() => {
    const m = new Map<Provider, UserAIKeyView[]>();
    for (const p of PROVIDER_LIST) m.set(p, []);
    for (const k of keysQ.data ?? []) m.get(k.provider as Provider)?.push(k);
    return m;
  }, [keysQ.data]);

  const order = orderQ.data ?? PROVIDER_LIST;
  const connectedCount = PROVIDER_LIST.filter((p) => (byProvider.get(p)?.length ?? 0) > 0).length;

  // First healthy provider in failover order = "current provider"
  const currentProvider = useMemo(() => {
    for (const p of order) {
      const h = providerHealth(byProvider.get(p) ?? []);
      if (h.health === "healthy" || h.health === "slow") return { provider: p, ...h };
    }
    return null;
  }, [order, byProvider]);

  const overallHealth: "excellent" | "degraded" | "offline" = currentProvider
    ? currentProvider.health === "healthy"
      ? "excellent"
      : "degraded"
    : "offline";

  const [manageProvider, setManageProvider] = useState<Provider | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // ---- mutations ----
  const reorderMut = useMutation({
    mutationFn: (next: Provider[]) => setOrderFn({ data: { order: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providerOrder"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const featureMut = useMutation({
    mutationFn: (v: { featureKey: FeatureKey; provider: Provider | "auto"; mode: Mode }) =>
      setFeatureFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["featureRouting"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- drag and drop for provider order ----
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...order];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    setDragIdx(null);
    reorderMut.mutate(next);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Intelligence Providers</h1>
          <p className="text-sm text-muted-foreground">
            Manage how Nyrava Intelligence powers your case work.
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Provider
        </Button>
      </div>

      {/* SECTION 1 — Intelligence Status */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Nyrava Intelligence</h2>
                <Badge
                  variant="outline"
                  className={
                    overallHealth === "excellent"
                      ? "border-success/30 bg-success/10 text-success"
                      : overallHealth === "degraded"
                        ? "border-warning/30 bg-warning/10 text-warning"
                        : "border-destructive/30 bg-destructive/10 text-destructive"
                  }
                >
                  {overallHealth === "excellent"
                    ? "Operational"
                    : overallHealth === "degraded"
                      ? "Degraded"
                      : "Offline"}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div>
                  <div className="font-medium">
                    {connectedCount} Provider{connectedCount === 1 ? "" : "s"} Available
                  </div>
                  <div className="text-xs text-muted-foreground">
                    of {PROVIDER_LIST.length} supported
                  </div>
                </div>
                <div>
                  <div className="font-medium text-success">Automatic Failover Enabled</div>
                  <div className="text-xs text-muted-foreground">Switches providers instantly</div>
                </div>
                <div>
                  <div className="font-medium">
                    Provider Health —{" "}
                    <span
                      className={
                        overallHealth === "excellent"
                          ? "text-success"
                          : overallHealth === "degraded"
                            ? "text-warning"
                            : "text-destructive"
                      }
                    >
                      {overallHealth === "excellent"
                        ? "Excellent"
                        : overallHealth === "degraded"
                          ? "Degraded"
                          : "No coverage"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {overallHealth === "excellent"
                      ? "All systems operational."
                      : "Connect a provider to restore full coverage."}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-4 border-t border-border pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div>
              <div className="text-xs text-muted-foreground">Current Provider</div>
              <div className="mt-0.5 flex items-center gap-2 font-medium">
                {currentProvider ? (
                  <>
                    <ProviderMark provider={currentProvider.provider} size={20} />
                    {PROVIDER_META[currentProvider.provider].label}
                  </>
                ) : (
                  <span className="text-muted-foreground">None connected</span>
                )}
              </div>
            </div>
            <div className="flex gap-8">
              <div>
                <div className="text-xs text-muted-foreground">Response Time</div>
                <div className="font-medium">
                  {currentProvider?.latencyMs ? `${currentProvider.latencyMs}ms` : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Quality Mode</div>
                <div className="font-medium">
                  {
                    MODE_META[
                      featuresQ.data?.find((f) => f.featureKey === "case_intelligence")?.mode ??
                        "maximum_accuracy"
                    ].label
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2 — Connected Providers */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Connected Providers</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PROVIDER_LIST.map((p) => {
            const keys = byProvider.get(p) ?? [];
            const h = providerHealth(keys);
            const meta = PROVIDER_META[p];
            return (
              <div key={p} className="flex flex-col rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <ProviderMark provider={p} />
                  <div>
                    <div className="font-semibold leading-tight">{meta.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {keys.length > 0 ? "Connected" : "Not Connected"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex-1 space-y-1 text-xs text-muted-foreground">
                  <div className="truncate">{meta.models.join(", ")}</div>
                  <div>
                    {keys.length} Key{keys.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <HealthBadge health={h.health} />
                  <span className="text-[11px] text-muted-foreground">{timeAgo(h.lastTested)}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setManageProvider(p)}
                >
                  Manage
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      {/* SECTION 3 — Provider Order */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Provider Order</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Drag to reorder. Nyrava will use providers in this order with automatic failover.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {order.map((p, i) => (
            <div
              key={p}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-background p-3 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                  {ORDER_LABELS[i] ?? `#${i + 1}`}
                </div>
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <ProviderMark provider={p} size={18} />
                  {PROVIDER_META[p].label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Automatic Failover visual */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div>
            <h3 className="font-semibold">How Automatic Failover Works</h3>
            <p className="text-sm text-muted-foreground">
              Nyrava automatically switches providers if one becomes unavailable.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {order.map((p, i) => {
            const h = providerHealth(byProvider.get(p) ?? []);
            const isRunning = currentProvider?.provider === p;
            return (
              <div key={p} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    isRunning
                      ? "border-success/40 bg-success/10"
                      : h.health === "offline" || h.health === "not_connected"
                        ? "border-border bg-muted/40 opacity-60"
                        : "border-border bg-background"
                  }`}
                >
                  <ProviderMark provider={p} size={20} />
                  <span className="font-medium">{PROVIDER_META[p].label}</span>
                  {isRunning && (
                    <Badge className="bg-success text-success-foreground">Running</Badge>
                  )}
                </div>
                {i < order.length - 1 && (
                  <ArrowDown className="h-4 w-4 rotate-[-90deg] text-muted-foreground" />
                )}
              </div>
            );
          })}
          <ArrowDown className="h-4 w-4 rotate-[-90deg] text-muted-foreground" />
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            Case Continues
          </div>
        </div>
      </section>

      {/* SECTION 4 — Intelligence Features */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Intelligence Features</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Every feature chooses how Nyrava should think — not which API to call.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Feature</th>
                <th className="pb-2 pr-4 font-medium">Provider</th>
                <th className="pb-2 font-medium">Mode</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => {
                const routing = featuresQ.data?.find((r) => r.featureKey === f.key);
                return (
                  <tr key={f.key} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 pr-4">
                      <div className="font-medium">{f.label}</div>
                      <div className="text-xs text-muted-foreground">{f.purpose}</div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Select
                        value={routing?.provider ?? "auto"}
                        onValueChange={(v) =>
                          featureMut.mutate({
                            featureKey: f.key,
                            provider: v as Provider | "auto",
                            mode: routing?.mode ?? "balanced",
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-[180px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto (Best Available)</SelectItem>
                          {PROVIDER_LIST.map((p) => (
                            <SelectItem key={p} value={p}>
                              {PROVIDER_META[p].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2.5">
                      <Select
                        value={routing?.mode ?? "balanced"}
                        onValueChange={(v) =>
                          featureMut.mutate({
                            featureKey: f.key,
                            provider: routing?.provider ?? "auto",
                            mode: v as Mode,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-[170px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(MODE_META) as Mode[]).map((m) => (
                            <SelectItem key={m} value={m}>
                              {MODE_META[m].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Security footer */}
      <section className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div className="text-sm">
          <div className="font-medium">Your API keys are encrypted.</div>
          <p className="text-muted-foreground">
            Stored securely, never shared, and only used inside your account. Nyrava cannot view
            your legal data.
          </p>
        </div>
      </section>

      <ManageDrawer
        provider={manageProvider}
        onClose={() => setManageProvider(null)}
        keys={manageProvider ? (byProvider.get(manageProvider) ?? []) : []}
        onChanged={invalidateKeys}
        mutators={{ toggleProviderFn, deleteProviderFn, toggleFn, testFn, delFn, addFn }}
      />

      <AddProviderWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        addFn={addFn}
        onAdded={invalidateKeys}
      />
    </div>
  );
}

// ==============================================================
// Manage drawer
// ==============================================================
function ManageDrawer({
  provider,
  onClose,
  keys,
  onChanged,
  mutators,
}: {
  provider: Provider | null;
  onClose: () => void;
  keys: UserAIKeyView[];
  onChanged: () => void;
  mutators: {
    toggleProviderFn: ReturnType<typeof useServerFn<typeof toggleProviderAIKeys>>;
    deleteProviderFn: ReturnType<typeof useServerFn<typeof deleteProviderAIKeys>>;
    toggleFn: ReturnType<typeof useServerFn<typeof toggleUserAIKey>>;
    testFn: ReturnType<typeof useServerFn<typeof testUserAIKey>>;
    delFn: ReturnType<typeof useServerFn<typeof deleteUserAIKey>>;
    addFn: ReturnType<typeof useServerFn<typeof addUserAIKey>>;
  };
}) {
  const [showKeys, setShowKeys] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [addingKey, setAddingKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!provider) return null;
  const meta = PROVIDER_META[provider];
  const enabled = keys.some((k) => k.isActive);
  const h = providerHealth(keys);

  async function handleToggleEnabled(next: boolean) {
    try {
      await mutators.toggleProviderFn({ data: { provider: provider as Provider, isActive: next } });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update provider.");
    }
  }

  async function handleDeleteProvider() {
    if (!confirm(`Remove all ${meta.label} keys? This can't be undone.`)) return;
    try {
      await mutators.deleteProviderFn({ data: { provider: provider as Provider } });
      onChanged();
      onClose();
      toast.success(`${meta.label} disconnected.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete provider.");
    }
  }

  async function handleAddKey() {
    if (!newKey.trim()) return;
    setBusyId("__add__");
    try {
      const r = await mutators.addFn({
        data: { provider: provider as Provider, apiKey: newKey, label: newLabel || undefined },
      });
      if (r.validated) {
        toast.success("Key connected.");
        setNewKey("");
        setNewLabel("");
        setAddingKey(false);
        onChanged();
      } else {
        toast.error(r.validationError ?? "Key validation failed.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add key.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet open={!!provider} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <ProviderMark provider={provider} />
            <div>
              <SheetTitle>{meta.label}</SheetTitle>
              <SheetDescription>Connection settings</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <div className="text-sm font-medium">Connection Status</div>
              <HealthBadge health={h.health} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <div className="text-sm font-medium">Enabled</div>
              <div className="text-xs text-muted-foreground">
                Let Nyrava route requests to {meta.label}.
              </div>
            </div>
            <Switch
              checked={enabled}
              disabled={keys.length === 0}
              onCheckedChange={handleToggleEnabled}
            />
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Models</div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {meta.models.map((m) => (
                <li key={m} className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {m}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <button
              onClick={() => setShowKeys((s) => !s)}
              className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <KeyIcon className="h-4 w-4" /> Keys ({keys.length})
              </span>
              {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>

            {showKeys && (
              <div className="mt-3 space-y-2">
                {keys.length === 0 && <p className="text-xs text-muted-foreground">No keys yet.</p>}
                {keys.map((k) => (
                  <div key={k.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{k.keyPreview}</div>
                        {k.label && (
                          <div className="truncate text-xs text-muted-foreground">{k.label}</div>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                          k.isActive
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {k.isActive ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={busyId === k.id}
                        onClick={async () => {
                          setBusyId(k.id);
                          try {
                            const r = await mutators.testFn({ data: { id: k.id } });
                            if (r.ok) toast.success(`Key OK (${r.latencyMs}ms)`);
                            else toast.error(r.error ?? "Test failed.");
                            onChanged();
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        {busyId === k.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={async () => {
                          await mutators.toggleFn({ data: { id: k.id, isActive: !k.isActive } });
                          onChanged();
                        }}
                      >
                        <Power className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={async () => {
                          if (!confirm("Delete this key?")) return;
                          await mutators.delFn({ data: { id: k.id } });
                          onChanged();
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {showAdvanced && (
                      <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
                        <div>id: {k.id}</div>
                        <div>priority: {k.priority ?? "—"}</div>
                        <div>added: {new Date(k.createdAt).toLocaleString()}</div>
                        {k.lastTestError && (
                          <div className="text-destructive">last error: {k.lastTestError}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {!addingKey ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1"
                    onClick={() => setAddingKey(true)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Key
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                    <input
                      autoFocus
                      type="password"
                      placeholder="Paste API key"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-mono"
                    />
                    <input
                      placeholder="Label (optional)"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busyId === "__add__" || !newKey}
                        onClick={handleAddKey}
                      >
                        {busyId === "__add__" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Verify & Save"
                        )}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAddingKey(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" /> {showAdvanced ? "Hide" : "Show"} advanced details
          </button>

          <div className="border-t border-border pt-4">
            <Button
              variant="outline"
              className="w-full gap-2 text-destructive hover:text-destructive"
              onClick={handleDeleteProvider}
            >
              <Trash2 className="h-4 w-4" /> Delete Provider
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ==============================================================
// Add Provider wizard
// ==============================================================
function AddProviderWizard({
  open,
  onOpenChange,
  addFn,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  addFn: ReturnType<typeof useServerFn<typeof addUserAIKey>>;
  onAdded: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [provider, setProvider] = useState<Provider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep(1);
    setProvider("openai");
    setApiKey("");
    setLabel("");
  }

  async function handleSave() {
    setBusy(true);
    try {
      const r = await addFn({ data: { provider, apiKey, label: label || undefined } });
      if (r.validated) {
        toast.success(`${PROVIDER_META[provider].label} connected.`);
        onAdded();
        onOpenChange(false);
        reset();
      } else {
        toast.error(r.validationError ?? "Key validation failed.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add provider.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Choose an intelligence provider to connect."
              : "Paste the key — Nyrava verifies it before saving."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid grid-cols-2 gap-2 py-2">
            {PROVIDER_LIST.map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
                  provider === p
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/40"
                }`}
              >
                <ProviderMark provider={p} size={28} />
                <span className="font-medium">{PROVIDER_META[p].label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-border p-3">
              <ProviderMark provider={provider} size={28} />
              <span className="font-medium">{PROVIDER_META[provider].label}</span>
            </div>
            <input
              autoFocus
              type="password"
              placeholder="Paste API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <input
              placeholder="Label (optional)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">{PROVIDER_META[provider].hint}</p>
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          {step === 2 ? (
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 1 ? (
            <Button onClick={() => setStep(2)} className="gap-1">
              Continue <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={busy || !apiKey} className="gap-2">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Verify Connection & Save
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
