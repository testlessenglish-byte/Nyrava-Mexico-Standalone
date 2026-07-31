// Admin billing plans — CRUD for subscription tiers. Prices/features/Mercado
// Pago plan IDs are all editable here so support can add or reprice plans
// without a code deploy.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  Plus,
  Save,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Layers,
  Gauge,
  Eye,
  Check,
  Tag,
  DollarSign,
  CreditCard,
  ListChecks,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import {
  adminListBillingPlans,
  adminUpsertBillingPlan,
  adminDeleteBillingPlan,
  type BillingPlanRow,
} from "@/lib/billing-plans.functions";
import { adminGetMercadoPagoConfigStatus, adminListWebhookEvents } from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/admin/billing")({
  head: () => ({ meta: [{ title: "Billing plans — Admin" }] }),
  component: AdminBillingPage,
});

type Draft = {
  id?: string;
  key: string;
  label: string;
  tagline: string;
  featuresText: string;
  price_cents: number;
  currency: string;
  interval: "month" | "year" | "one_time";
  stripe_price_id: string;
  mercadopago_plan_id: string;
  self_serve: boolean;
  contact_url: string;
  sort_order: number;
  active: boolean;
  included_seats: number;
  per_seat_price_cents: number | null;
  per_seat_stripe_price_id: string;
  internal_notes: string;
  // Usage metering — see usage.server.ts. null = unlimited.
  ai_requests_monthly: number | null;
  talk_to_case_monthly: number | null;
  case_limit: number | null;
  storage_gb_limit: number | null;
  team_member_limit: number | null;
  byok_allowed: boolean;
  overage_price_cents: number | null;
};

function toDraft(p: BillingPlanRow): Draft {
  const feats = Array.isArray(p.features)
    ? (p.features as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  // Cast — new columns may not be in the generated Database types until regen.
  const px = p as unknown as {
    included_seats?: number | null;
    per_seat_price_cents?: number | null;
    per_seat_stripe_price_id?: string | null;
    internal_notes?: string | null;
  };
  return {
    id: p.id,
    key: p.key ?? "",
    label: p.label ?? "",
    tagline: p.tagline ?? "",
    featuresText: feats.join("\n"),
    price_cents: p.price_cents,
    currency: p.currency,
    interval: (p.interval as Draft["interval"]) ?? "month",
    stripe_price_id: p.stripe_price_id ?? "",
    mercadopago_plan_id: p.mercadopago_plan_id ?? "",
    self_serve: p.self_serve,
    contact_url: p.contact_url ?? "",
    sort_order: p.sort_order,
    active: p.active,
    included_seats: typeof px.included_seats === "number" ? px.included_seats : 1,
    per_seat_price_cents:
      typeof px.per_seat_price_cents === "number" ? px.per_seat_price_cents : null,
    per_seat_stripe_price_id: px.per_seat_stripe_price_id ?? "",
    internal_notes: px.internal_notes ?? "",
    ai_requests_monthly: typeof p.ai_requests_monthly === "number" ? p.ai_requests_monthly : null,
    talk_to_case_monthly:
      typeof p.talk_to_case_monthly === "number" ? p.talk_to_case_monthly : null,
    case_limit: typeof p.case_limit === "number" ? p.case_limit : null,
    storage_gb_limit: typeof p.storage_gb_limit === "number" ? p.storage_gb_limit : null,
    team_member_limit: typeof p.team_member_limit === "number" ? p.team_member_limit : null,
    byok_allowed: p.byok_allowed ?? true,
    overage_price_cents: typeof p.overage_price_cents === "number" ? p.overage_price_cents : null,
  };
}

function emptyDraft(nextSort: number): Draft {
  return {
    key: "",
    label: "",
    tagline: "",
    featuresText: "",
    price_cents: 0,
    currency: "usd",
    interval: "month",
    stripe_price_id: "",
    mercadopago_plan_id: "",
    self_serve: true,
    contact_url: "",
    sort_order: nextSort,
    active: true,
    included_seats: 1,
    per_seat_price_cents: null,
    per_seat_stripe_price_id: "",
    internal_notes: "",
    ai_requests_monthly: null,
    talk_to_case_monthly: null,
    case_limit: null,
    storage_gb_limit: null,
    team_member_limit: null,
    byok_allowed: true,
    overage_price_cents: null,
  };
}

// ---------------------------------------------------------------------
// Formatting helpers — shared by the edit form and the live preview card
// so the number an admin types is always the number a customer would see.
// ---------------------------------------------------------------------

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
      minimumFractionDigits: 2,
    }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }
}

function intervalSuffix(interval: Draft["interval"]): string {
  if (interval === "year") return "/yr";
  if (interval === "one_time") return "";
  return "/mo";
}

function AdminBillingPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListBillingPlans);
  const upsertFn = useServerFn(adminUpsertBillingPlan);
  const deleteFn = useServerFn(adminDeleteBillingPlan);

  const plansQ = useQuery({ queryKey: ["admin-billing-plans"], queryFn: () => listFn() });

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [creating, setCreating] = useState<Draft | null>(null);

  const rows = useMemo(() => plansQ.data ?? [], [plansQ.data]);

  const getDraft = (p: BillingPlanRow): Draft => drafts[p.id] ?? toDraft(p);
  const patchDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const base = prev[id] ?? toDraft(rows.find((r) => r.id === id)!);
      return { ...prev, [id]: { ...base, ...patch } };
    });
  };

  const upsertM = useMutation({
    mutationFn: async (d: Draft) => {
      const features = d.featuresText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return await upsertFn({
        data: {
          id: d.id,
          key: d.key,
          label: d.label,
          tagline: d.tagline,
          features,
          price_cents: Math.round(d.price_cents),
          currency: d.currency,
          interval: d.interval,
          stripe_price_id: d.stripe_price_id.trim() || null,
          mercadopago_plan_id: d.mercadopago_plan_id.trim() || null,
          self_serve: d.self_serve,
          contact_url: d.contact_url.trim() || null,
          sort_order: Math.round(d.sort_order),
          active: d.active,
          included_seats: Math.max(1, Math.round(d.included_seats || 1)),
          per_seat_price_cents:
            typeof d.per_seat_price_cents === "number"
              ? Math.max(0, Math.round(d.per_seat_price_cents))
              : null,
          per_seat_stripe_price_id: d.per_seat_stripe_price_id.trim() || null,
          internal_notes: d.internal_notes.trim() || null,
          ai_requests_monthly:
            typeof d.ai_requests_monthly === "number"
              ? Math.max(0, Math.round(d.ai_requests_monthly))
              : null,
          talk_to_case_monthly:
            typeof d.talk_to_case_monthly === "number"
              ? Math.max(0, Math.round(d.talk_to_case_monthly))
              : null,
          case_limit:
            typeof d.case_limit === "number" ? Math.max(0, Math.round(d.case_limit)) : null,
          storage_gb_limit:
            typeof d.storage_gb_limit === "number" ? Math.max(0, d.storage_gb_limit) : null,
          team_member_limit:
            typeof d.team_member_limit === "number"
              ? Math.max(0, Math.round(d.team_member_limit))
              : null,
          byok_allowed: d.byok_allowed,
          overage_price_cents:
            typeof d.overage_price_cents === "number"
              ? Math.max(0, Math.round(d.overage_price_cents))
              : null,
        },
      });
    },
    onSuccess: (saved) => {
      toast.success(`Saved ${saved.label}`);
      setDrafts((prev) => {
        const { [saved.id]: _, ...rest } = prev;
        void _;
        return rest;
      });
      setCreating(null);
      qc.invalidateQueries({ queryKey: ["admin-billing-plans"] });
      qc.invalidateQueries({ queryKey: ["billing-plans-public"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Plan deleted");
      qc.invalidateQueries({ queryKey: ["admin-billing-plans"] });
      qc.invalidateQueries({ queryKey: ["billing-plans-public"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const nextSort = (rows[rows.length - 1]?.sort_order ?? 0) + 10;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <div className="flex items-center gap-2">
        <Link
          to="/admin"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Admin
        </Link>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">Billing plans</h1>
          <p className="text-sm text-muted-foreground">
            Powers the public{" "}
            <Link to="/billing" className="underline underline-offset-2 hover:text-foreground">
              /billing
            </Link>{" "}
            page and Mercado Pago checkout.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <MercadoPagoConfigPanel />
      </div>

      {plansQ.isLoading && <div className="mt-6 text-sm text-muted-foreground">Loading…</div>}
      {plansQ.error && <div className="mt-6 text-sm text-destructive">Failed to load plans.</div>}

      <div className="mt-8 space-y-5">
        {rows.map((p) => {
          const d = getDraft(p);
          const dirty = drafts[p.id] !== undefined;
          return (
            <PlanEditor
              key={p.id}
              draft={d}
              dirty={dirty}
              onChange={(patch) => patchDraft(p.id, patch)}
              onSave={() => upsertM.mutate(d)}
              onDelete={() => {
                if (confirm(`Delete plan "${p.label}"? This cannot be undone.`))
                  deleteM.mutate(p.id);
              }}
              saving={upsertM.isPending && upsertM.variables?.id === p.id}
              deleting={deleteM.isPending && deleteM.variables === p.id}
            />
          );
        })}
      </div>

      <div className="mt-6">
        {creating ? (
          <PlanEditor
            draft={creating}
            dirty
            isNew
            onChange={(patch) => setCreating({ ...creating, ...patch })}
            onSave={() => upsertM.mutate(creating)}
            onDelete={() => setCreating(null)}
            saving={upsertM.isPending && !upsertM.variables?.id}
            deleting={false}
            deleteLabel="Cancel"
          />
        ) : (
          <button
            onClick={() => setCreating(emptyDraft(nextSort))}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-accent/50 hover:bg-card hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> Add plan
          </button>
        )}
      </div>
    </div>
  );
}

function GroupLabel({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </div>
  );
}

/** Dollar-denominated price input. Draft still stores price_cents under the
 * hood (unchanged data flow, unchanged save payload) — this just removes
 * the "type 4900 to mean $49.00" mental-math step from the actual editing
 * experience. */
function PriceCentsInput({
  cents,
  onChange,
}: {
  cents: number;
  onChange: (cents: number) => void;
}) {
  const dollars = Math.round(cents || 0) / 100;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <input
        type="number"
        min={0}
        step="0.01"
        className="w-full rounded-md border border-border bg-background py-2 pl-6 pr-3 text-sm tabular-nums"
        value={dollars}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(Number.isFinite(v) ? Math.round(v * 100) : 0);
        }}
      />
    </div>
  );
}

/** Nullable numeric limit input — checking "Unlimited" clears the field to
 * null (no cap), otherwise stores a plain number. Used for every usage
 * metering limit below (AI requests, Talk-to-Case, cases, storage, seats). */
function LimitInput({
  value,
  onChange,
  step,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  const isUnlimited = value == null;
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        step={step ?? 1}
        disabled={isUnlimited}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums disabled:opacity-40"
        value={isUnlimited ? "" : value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const v = Number(raw);
          onChange(Number.isFinite(v) ? v : null);
        }}
        placeholder="Unlimited"
      />
      <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-border accent-accent"
          checked={isUnlimited}
          onChange={(e) => onChange(e.target.checked ? null : 0)}
        />
        Unlimited
      </label>
    </div>
  );
}

/** What a customer actually sees on /billing for this plan, updating live
 * as the admin edits — so pricing, features, and copy can be sanity-checked
 * without leaving this page or guessing how the raw fields will render. */
function PlanPreviewCard({ draft }: { draft: Draft }) {
  const features = draft.featuresText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="md:sticky md:top-6">
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Eye className="h-3.5 w-3.5" /> Customer preview
      </div>
      <div
        className={`rounded-xl border p-5 transition-opacity ${
          draft.active ? "border-border bg-card" : "border-border/50 bg-card/50 opacity-60"
        }`}
      >
        <div className="text-base font-semibold">{draft.label || "Untitled plan"}</div>
        {draft.tagline && <div className="mt-1 text-sm text-muted-foreground">{draft.tagline}</div>}

        <div className="mt-4 flex items-baseline gap-1">
          <span className="text-3xl font-semibold tabular-nums text-accent">
            {formatMoney(draft.price_cents, draft.currency)}
          </span>
          {draft.interval !== "one_time" && (
            <span className="text-sm text-muted-foreground">{intervalSuffix(draft.interval)}</span>
          )}
        </div>

        {features.length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 text-sm italic text-muted-foreground">No features listed yet.</div>
        )}

        <div className="mt-5 rounded-md border border-border bg-background px-3 py-2 text-center text-sm font-medium text-muted-foreground">
          {draft.self_serve ? "Subscribe" : "Contact us"}
        </div>

        {!draft.active && (
          <div className="mt-3 text-center text-xs text-muted-foreground">Hidden from /billing</div>
        )}
      </div>
    </div>
  );
}

function PlanEditor({
  draft,
  dirty,
  isNew,
  onChange,
  onSave,
  onDelete,
  saving,
  deleting,
  deleteLabel,
}: {
  draft: Draft;
  dirty: boolean;
  isNew?: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
  deleteLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              draft.active ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"
            }`}
          >
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{isNew ? "New plan" : draft.label || draft.key}</h3>
              {!draft.active && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Inactive
                </span>
              )}
              {dirty && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {draft.self_serve ? "Self-serve checkout" : "Contact-us only"} · Sort order{" "}
              {draft.sort_order}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{" "}
            Save
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {deleteLabel ?? "Delete"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
        <PlanPreviewCard draft={draft} />

        <div className="space-y-6">
          <div>
            <GroupLabel icon={Tag}>Identity</GroupLabel>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Key (used in checkout metadata)">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                  value={draft.key}
                  onChange={(e) => onChange({ key: e.target.value })}
                  disabled={!isNew}
                  placeholder="solo"
                />
              </Field>
              <Field label="Display label">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={draft.label}
                  onChange={(e) => onChange({ label: e.target.value })}
                  placeholder="Solo"
                />
              </Field>
              <Field label="Tagline" className="md:col-span-2">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={draft.tagline}
                  onChange={(e) => onChange({ tagline: e.target.value })}
                  placeholder="For solo practitioners and small caseloads"
                />
              </Field>
            </div>
          </div>

          <div>
            <GroupLabel icon={DollarSign}>Pricing</GroupLabel>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Price">
                <PriceCentsInput
                  cents={draft.price_cents}
                  onChange={(price_cents) => onChange({ price_cents })}
                />
              </Field>
              <Field label="Currency (3-letter)">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm uppercase"
                  value={draft.currency}
                  onChange={(e) => onChange({ currency: e.target.value.toLowerCase() })}
                  maxLength={3}
                />
              </Field>
              <Field label="Billing interval">
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={draft.interval}
                  onChange={(e) => onChange({ interval: e.target.value as Draft["interval"] })}
                >
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                  <option value="one_time">One-time</option>
                </select>
              </Field>
              <Field label="Sort order (lower = earlier)">
                <input
                  type="number"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums"
                  value={draft.sort_order}
                  onChange={(e) => onChange({ sort_order: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>
          </div>

          {draft.self_serve && (
            <div>
              <GroupLabel icon={Layers}>Seats</GroupLabel>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Included seats (covered by base price)">
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums"
                    value={draft.included_seats}
                    onChange={(e) =>
                      onChange({ included_seats: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                </Field>
                <Field label="Per-seat price (optional add-on)">
                  <PriceCentsInput
                    cents={draft.per_seat_price_cents ?? 0}
                    onChange={(cents) =>
                      onChange({ per_seat_price_cents: cents > 0 ? cents : null })
                    }
                  />
                </Field>
                <Field
                  label="Per-seat Stripe Price ID (legacy — not used by Mercado Pago checkout)"
                  className="md:col-span-2"
                >
                  <input
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs opacity-60"
                    value={draft.per_seat_stripe_price_id}
                    onChange={(e) => onChange({ per_seat_stripe_price_id: e.target.value })}
                    placeholder="Unused since the move to Mercado Pago"
                  />
                </Field>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Leave the per-seat fields blank for flat-price plans. Mercado Pago Preapproval
                subscriptions don&apos;t support a second recurring line item the way Stripe did, so
                per-seat pricing isn&apos;t currently automated at checkout — track seat counts here
                and invoice/adjust manually, or via Admin → Team &amp; Seats.
              </p>
            </div>
          )}

          <div>
            <GroupLabel icon={Gauge}>Usage limits (monthly, resets each billing cycle)</GroupLabel>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="AI requests / month">
                <LimitInput
                  value={draft.ai_requests_monthly}
                  onChange={(v) => onChange({ ai_requests_monthly: v })}
                />
              </Field>
              <Field label="Talk-to-Case conversations / month">
                <LimitInput
                  value={draft.talk_to_case_monthly}
                  onChange={(v) => onChange({ talk_to_case_monthly: v })}
                />
              </Field>
              <Field label="Max active cases">
                <LimitInput
                  value={draft.case_limit}
                  onChange={(v) => onChange({ case_limit: v })}
                />
              </Field>
              <Field label="Storage limit (GB)">
                <LimitInput
                  value={draft.storage_gb_limit}
                  onChange={(v) => onChange({ storage_gb_limit: v })}
                  step={0.5}
                />
              </Field>
              <Field label="Team / firm seats">
                <LimitInput
                  value={draft.team_member_limit}
                  onChange={(v) => onChange({ team_member_limit: v })}
                />
              </Field>
              <Field label="Overage price (reserved for future pay-as-you-go)">
                <PriceCentsInput
                  cents={draft.overage_price_cents ?? 0}
                  onChange={(cents) => onChange({ overage_price_cents: cents > 0 ? cents : null })}
                />
              </Field>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-accent"
                checked={draft.byok_allowed}
                onChange={(e) => onChange({ byok_allowed: e.target.checked })}
              />
              Allow Bring-Your-Own-Key (users on this plan may connect their own AI provider keys to
              bypass the platform allowance)
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              Check "Unlimited" to remove a cap entirely (e.g. Enterprise). AI requests cover Case
              Intelligence processing, AI document analysis, report generation, motion generation,
              strategic analysis, and future intelligence modules — Talk-to-Case is metered
              separately since it performs continuous AI reasoning.
            </p>
          </div>

          <div>
            <GroupLabel icon={ListChecks}>Internal notes (not shown to customers)</GroupLabel>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={draft.internal_notes}
              onChange={(e) => onChange({ internal_notes: e.target.value })}
              placeholder="Negotiation floors, deal notes, etc. Admin-only — never rendered on /billing."
            />
          </div>

          <div>
            <GroupLabel icon={CreditCard}>Checkout</GroupLabel>
            <div className="grid grid-cols-1 gap-4">
              <Field label="Mercado Pago Plan ID (preapproval_plan_id)">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  value={draft.mercadopago_plan_id}
                  onChange={(e) => onChange({ mercadopago_plan_id: e.target.value })}
                  placeholder="2c9380847...  (from POST /preapproval_plan)"
                />
              </Field>
              <Field label="Contact URL (used when self-serve is off)">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={draft.contact_url}
                  onChange={(e) => onChange({ contact_url: e.target.value })}
                  placeholder="mailto:sales@nyrava.com"
                />
              </Field>
            </div>
          </div>

          <div>
            <GroupLabel icon={ListChecks}>Features (one per line)</GroupLabel>
            <textarea
              className="min-h-[120px] w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              value={draft.featuresText}
              onChange={(e) => onChange({ featuresText: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-accent"
                checked={draft.self_serve}
                onChange={(e) => onChange({ self_serve: e.target.checked })}
              />
              Self-serve checkout (uncheck for &quot;Contact us&quot;)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-accent"
                checked={draft.active}
                onChange={(e) => onChange({ active: e.target.checked })}
              />
              Active (visible on /billing)
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function StatusChip({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border p-3 ${
        ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

function fmtWhen(s: string) {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Mercado Pago config status + recent webhook deliveries, so an admin can
 * see at a glance whether Mercado Pago is actually wired up end-to-end:
 * access token present, webhook secret present, and events actually
 * arriving — not just that env vars exist. Configure the endpoint in
 * Mercado Pago → Your integrations → Webhooks as
 * https://<your-domain>/api/public/hooks/mercadopago-webhook, subscribed to
 * subscription_preapproval and subscription_authorized_payment. */
function MercadoPagoConfigPanel() {
  const statusFn = useServerFn(adminGetMercadoPagoConfigStatus);
  const eventsFn = useServerFn(adminListWebhookEvents);

  const statusQ = useQuery({ queryKey: ["admin-mercadopago-status"], queryFn: () => statusFn() });
  const eventsQ = useQuery({
    queryKey: ["admin-webhook-events"],
    queryFn: () => eventsFn(),
    refetchInterval: 15000,
  });

  const s = statusQ.data;
  const events = eventsQ.data ?? [];
  const bothConfigured = Boolean(s?.hasAccessToken && s?.hasWebhookSecret);

  return (
    <div className="rounded-xl border border-border bg-card p-5 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck
            className={`h-4 w-4 ${bothConfigured ? "text-success" : "text-muted-foreground"}`}
          />
          <h2 className="font-semibold">Mercado Pago configuration</h2>
          {/* Nyrava ↔ Mercado Pago connection indicator — a quick "is this
              actually wired end-to-end" read before scanning the two chips
              below. */}
          <div className="ml-1 flex items-center gap-1.5" aria-hidden="true">
            <span
              className={`h-2 w-2 rounded-full ${bothConfigured ? "bg-success" : "bg-destructive"}`}
            />
            <span className="h-px w-6 bg-border" />
            <span
              className={`h-2 w-2 rounded-full ${bothConfigured ? "bg-success" : "bg-muted"}`}
            />
          </div>
        </div>
        <button
          onClick={() => {
            statusQ.refetch();
            eventsQ.refetch();
          }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {statusQ.isLoading && <div className="text-sm text-muted-foreground">Checking…</div>}
      {s && (
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <StatusChip
            ok={s.hasAccessToken}
            label="Mercado Pago access token configured"
            detail={
              s.accessTokenMode
                ? `${s.accessTokenMode} mode`
                : s.hasAccessToken
                  ? "unrecognized prefix"
                  : undefined
            }
          />
          <StatusChip
            ok={s.hasWebhookSecret}
            label="Webhook signing secret configured"
            detail={s.webhookSecretLast4 ? `ends …${s.webhookSecretLast4}` : undefined}
          />
        </div>
      )}

      <p className="mb-4 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Webhook className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Webhook endpoint: <code className="font-mono">/api/public/hooks/mercadopago-webhook</code>{" "}
          — set this in Mercado Pago → Your integrations → Webhooks, subscribed to{" "}
          <code className="font-mono">subscription_preapproval</code> and{" "}
          <code className="font-mono">subscription_authorized_payment</code>.
        </span>
      </p>

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Recent deliveries
      </h3>
      {eventsQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!eventsQ.isLoading && events.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No webhook events received yet — once Mercado Pago sends its first event, it&apos;ll show
          up here.
        </div>
      )}
      {events.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Event</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Detail</th>
                <th className="px-3 py-2 text-left font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 15).map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono">{e.event_type}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={
                        e.status === "processed"
                          ? "text-success"
                          : e.status === "error"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{e.detail ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{fmtWhen(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
