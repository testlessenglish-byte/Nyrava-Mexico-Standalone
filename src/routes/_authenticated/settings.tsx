import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listGroqKeys,
  addGroqKey,
  setGroqKeyPriority,
  toggleGroqKey,
  replaceGroqKey,
  deleteGroqKey,
  testGroqConnection,
  getGroqUsageSummary,
  checkIsAdmin,
  bootstrapAdmin,
} from "@/lib/cases.functions";
import { toast } from "sonner";
import {
  Key,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Activity,
  Zap,
  AlertTriangle,
  Loader2,
  ArrowUp,
  ArrowDown,
  Power,
} from "lucide-react";
export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Nyrava" }] }),
  component: SettingsPage,
});

function friendlyError(e: unknown): string {
  const msg = (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/i, "");
  if (/rate.limit|quota|429/i.test(msg)) {
    return `Groq quota reached for this key. Add or switch to another Groq key below, then retry. (${msg})`;
  }
  if (/401|403|invalid.+api.+key|unauthorized/i.test(msg)) {
    // Surface the actual upstream response so the user can see why Groq rejected it.
    return `Groq rejected this key: ${msg}`;
  }
  return msg;
}

function SettingsPage() {
  const listKeys = useServerFn(listGroqKeys);
  const addKey = useServerFn(addGroqKey);
  const setPriority = useServerFn(setGroqKeyPriority);
  const toggleActive = useServerFn(toggleGroqKey);
  const replace = useServerFn(replaceGroqKey);
  const remove = useServerFn(deleteGroqKey);
  const test = useServerFn(testGroqConnection);
  const usage = useServerFn(getGroqUsageSummary);

  const keysQ = useQuery({ queryKey: ["groqKeys"], queryFn: () => listKeys() });
  const usageQ = useQuery({ queryKey: ["groqUsage"], queryFn: () => usage() });

  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replaceValue, setReplaceValue] = useState("");

  const keys = keysQ.data?.keys ?? [];
  const platformConfigured = keysQ.data?.platformConfigured ?? false;
  const hasAny = keys.length > 0 || platformConfigured;

  async function handleAdd() {
    if (newKey.length < 10) return toast.error("Enter a valid Groq API key");
    setAdding(true);
    try {
      await addKey({ data: { apiKey: newKey, label: newLabel || undefined } });
      toast.success("Groq key saved — usage counters reset for the new key");
      setNewKey("");
      setNewLabel("");
      await Promise.all([keysQ.refetch(), usageQ.refetch()]);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setAdding(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await test();
      if (r.ok) {
        setTestResult({ ok: true, msg: `Online · ${r.latencyMs}ms · ${r.model}` });
        toast.success("Groq connection OK");
      } else {
        setTestResult({ ok: false, msg: friendlyError(new Error(r.error ?? "Unknown")) });
        toast.error("Groq test failed");
      }
    } catch (e) {
      setTestResult({ ok: false, msg: friendlyError(e) });
      toast.error(friendlyError(e));
    } finally {
      setTesting(false);
    }
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const idx = keys.findIndex((k) => k.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= keys.length) return;
    const a = keys[idx];
    const b = keys[swapIdx];
    try {
      await Promise.all([
        setPriority({ data: { id: a.id, priority: b.priority } }),
        setPriority({ data: { id: b.id, priority: a.priority } }),
      ]);
      await Promise.all([keysQ.refetch(), usageQ.refetch()]);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this Groq key?")) return;
    try {
      await remove({ data: { id } });
      toast.success("Key removed");
      await Promise.all([keysQ.refetch(), usageQ.refetch()]);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function handleToggleActive(id: string, isActive: boolean) {
    try {
      await toggleActive({ data: { id, isActive } });
      toast.success(isActive ? "Key enabled" : "Key disabled — it will be skipped");
      await keysQ.refetch();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function handleReplace(id: string) {
    if (replaceValue.length < 10) return toast.error("Enter a valid Groq API key");
    try {
      await replace({ data: { id, apiKey: replaceValue } });
      toast.success("Key replaced — usage counters reset");
      setReplacingId(null);
      setReplaceValue("");
      await Promise.all([keysQ.refetch(), usageQ.refetch()]);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  const u = usageQ.data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Account-level administration. To add, test, or manage your own OpenAI, Anthropic, Gemini, Groq, or OpenRouter
        keys, go to{" "}
        <Link to="/ai-keys" className="text-accent underline">
          Intelligence Providers
        </Link>
        . This page covers admin bootstrap and the platform-wide Groq fallback pool.
      </p>

      <AdminClaimPanel />

      {/* --- Below: the admin-level Groq rotation pool (org-wide fallback keys, separate from each user's own keys under Intelligence Providers) --- */}
      <h2 className="mt-10 text-lg font-semibold">Admin: Groq key rotation pool</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        These Groq keys are shared platform-wide fallback keys, tried in priority order below your own active keys
        above.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <InfoTile label="Provider" value="Groq (platform pool)" icon={<Zap className="h-4 w-4 text-accent" />} />
        <InfoTile
          label="Default model"
          value="Llama 4 Scout (17B 16E Instruct)"
          icon={<Activity className="h-4 w-4 text-accent" />}
        />
        <InfoTile
          label="Connection status"
          value={hasAny ? "Configured" : "No key configured"}
          tone={hasAny ? "success" : "warning"}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <InfoTile
          label="Keys in rotation"
          value={`${keys.length}${platformConfigured ? " + platform" : ""}`}
          icon={<Key className="h-4 w-4 text-accent" />}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        All saved keys are active simultaneously. The router tries them in priority order and falls through to the next
        on rate-limit or auth errors.
      </p>

      {/* Usage */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold">Usage</h2>
          </div>
          <button
            onClick={() => usageQ.refetch()}
            disabled={usageQ.isFetching}
            className="flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {usageQ.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Tokens today (all keys)" value={u?.tokensToday?.toLocaleString() ?? "—"} />
          <Metric
            label="Remaining today (combined)"
            value={(u?.combinedRemainingToday ?? u?.remainingToday)?.toLocaleString() ?? "—"}
            sub={u?.totalKeys ? `${u.totalKeys} key(s) × 500K/day` : "Groq free-tier ~500K/key"}
          />
          <Metric
            label="Tokens this month"
            value={u?.tokensMonth?.toLocaleString() ?? "—"}
            sub={`${u?.callsMonth ?? 0} calls`}
          />
        </div>
        {u && u.failuresMonth > 0 && (
          <p className="mt-3 text-xs text-warning">
            {u.failuresMonth} failed call{u.failuresMonth === 1 ? "" : "s"} this month — usually quota or transient
            network issues.
          </p>
        )}

        {/* Per-key breakdown — the fastest way to confirm rotation is happening */}
        {u?.perKey && u.perKey.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Per-key usage today</h3>
              <span className="text-[11px] text-muted-foreground">Tokens used / 500K daily limit per key</span>
            </div>
            <div className="space-y-2">
              {u.perKey.map((k) => {
                const pct = Math.min(100, Math.round((k.tokensToday / 500_000) * 100));
                const bar = pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-accent";
                return (
                  <div key={k.id} className="rounded-md border border-border bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-medium">{k.label}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {k.masked}
                        </code>
                        <span className="text-muted-foreground">· priority {k.priority}</span>
                      </div>
                      <div className="whitespace-nowrap text-muted-foreground">
                        <span className="font-mono text-foreground">{k.tokensToday.toLocaleString()}</span>
                        <span className="mx-1">/</span>
                        <span className="font-mono">500,000</span>
                        <span className="ml-2">({pct}%)</span>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                      <span>
                        {k.callsToday} call(s) today · {k.callsMonth} this month
                      </span>
                      <span>
                        {k.tokensMonth.toLocaleString()} tok / month
                        {k.legacy > 0 && (
                          <span className="ml-1 italic" title="Rows without attribution — pre-fix historical usage">
                            ({k.legacy} legacy)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              If only one row moves during a run, rotation is not triggering. All keys should share the load as
              individual keys approach their daily quota.
            </p>
          </div>
        )}
      </div>

      {/* Add new key */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold">Add a Groq API key</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Get a key at{" "}
          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-accent underline">
            console.groq.com/keys
          </a>
          . Add more than one so Nyrava can rotate automatically when a quota is reached.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Personal, Backup)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <input
          type="password"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="gsk_…"
          className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleAdd}
            disabled={adding}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {adding ? "Validating…" : "Save & validate"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !hasAny}
            className="flex items-center gap-1.5 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Test connection
          </button>
        </div>
        {testResult && (
          <div
            className={`mt-3 rounded-md px-3 py-2 text-sm ${
              testResult.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            }`}
          >
            {testResult.ok ? "✓ " : "✗ "}
            {testResult.msg}
          </div>
        )}
      </div>

      {/* Existing keys */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold">Platform Groq keys (admin pool)</h2>
        </div>
        {keys.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {platformConfigured
              ? "Using the platform-provided key. Add your own above to take control of quotas and rotation."
              : "No keys yet — add one above to start."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {keys.map((k, i) => (
              <li key={k.id} className={`py-3 ${k.is_active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                        #{i + 1}
                      </span>
                      <span className="font-medium">{k.label}</span>
                      {k.is_active ? (
                        <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          <XCircle className="h-3 w-3" />
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{k.masked}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {k.usage30d
                        ? `${k.usage30d.tokens.toLocaleString()} tokens · ${k.usage30d.calls} calls (30d)`
                        : "No usage yet"}
                      {k.usage30d && k.usage30d.failures > 0 && (
                        <span className="ml-1 text-warning">· {k.usage30d.failures} failed</span>
                      )}
                    </div>
                    {k.last_error && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        {k.last_error.slice(0, 120)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleActive(k.id, !k.is_active)}
                      title={k.is_active ? "Disable this key" : "Enable this key"}
                      className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium ${
                        k.is_active
                          ? "border-input bg-background hover:bg-muted"
                          : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15"
                      }`}
                    >
                      <Power className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleMove(k.id, "up")}
                      disabled={i === 0}
                      title="Move up in priority"
                      className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleMove(k.id, "down")}
                      disabled={i === keys.length - 1}
                      title="Move down in priority"
                      className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => {
                        setReplacingId(replacingId === k.id ? null : k.id);
                        setReplaceValue("");
                      }}
                      className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => handleDelete(k.id)}
                      className="flex items-center gap-1 rounded-md border border-destructive/30 bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
                {replacingId === k.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      value={replaceValue}
                      onChange={(e) => setReplaceValue(e.target.value)}
                      placeholder="New gsk_…"
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                    />
                    <button
                      onClick={() => handleReplace(k.id)}
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      Save
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InfoTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "success" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 text-sm font-medium ${
          tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function AdminClaimPanel() {
  const isAdmin = useServerFn(checkIsAdmin);
  const claim = useServerFn(bootstrapAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => isAdmin() });
  const [busy, setBusy] = useState(false);

  if (adminQ.isLoading) return null;
  const already = adminQ.data?.isAdmin;

  async function handleClaim() {
    setBusy(true);
    try {
      const r = await claim();
      toast.success(r.alreadyAdmin ? "You already have admin." : "Admin role granted. Reloading…");
      await adminQ.refetch();
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`mt-4 rounded-xl border p-4 ${already ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {already ? "Administrator access: granted" : "Claim owner / admin role"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {already
              ? "You can open Admin, AI Providers, and System Health."
              : "Available only if no administrator exists yet. Use this once to bootstrap the owner account."}
          </div>
        </div>
        {!already && (
          <button
            onClick={handleClaim}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Granting…" : "Make me admin"}
          </button>
        )}
      </div>
    </div>
  );
}
