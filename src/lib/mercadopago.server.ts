// Server-only Mercado Pago client. Never import this from a client
// component — it reads MERCADOPAGO_ACCESS_TOKEN, which must never reach the
// browser bundle. Replaces stripe.server.ts.
//
// Implemented with plain `fetch` against Mercado Pago's REST API rather than
// their SDK — this integration only needs a handful of endpoints
// (Preapproval Plans + Preapprovals), so a small typed wrapper avoids adding
// a new dependency for it. If you need more of the SDK's surface later,
// swapping this file for the official `mercadopago` package is a contained
// change — nothing outside this file talks to the MP API directly.
//
// NOTE: written from Mercado Pago's documented REST contract (Preapproval
// Plan / Preapproval resources, notification signature scheme). This
// sandbox has no network access to verify against the live API — test
// against a real Mercado Pago sandbox/test account before going live, and
// double check the request/response shapes against current Mercado Pago
// docs in case anything has changed since.
const MP_API_BASE = "https://api.mercadopago.com";

function getAccessToken(): string {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "MERCADOPAGO_ACCESS_TOKEN is not configured. Add it in your deployment's environment variables (Mercado Pago → Your integrations → Credentials → Access token).",
    );
  }
  return token;
}

async function mpFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MP_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getAccessToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "message" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).message)
        : `Mercado Pago API error (${res.status}) on ${path}`;
    throw new Error(message);
  }
  return body as T;
}

export type PreapprovalPlan = {
  id: string;
  reason: string;
  auto_recurring: {
    frequency: number;
    frequency_type: "days" | "months";
    transaction_amount: number;
    currency_id: string;
  };
  back_url?: string;
  status?: string;
};

/** Creates (or, if you already have one, this is skippable) the recurring
 * plan Mercado Pago charges against. Analogous to a Stripe Price. Admins
 * create these once per plan/price and paste the resulting id into
 * Admin -> Billing Plans (mercadopago_plan_id) — this app does not create
 * plans automatically the way it never auto-created Stripe Prices either. */
export async function createPreapprovalPlan(input: {
  reason: string;
  amountMxn: number;
  backUrl: string;
}): Promise<PreapprovalPlan> {
  return mpFetch<PreapprovalPlan>("/preapproval_plan", {
    method: "POST",
    body: JSON.stringify({
      reason: input.reason,
      back_url: input.backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.amountMxn,
        currency_id: "MXN",
      },
    }),
  });
}

export type Preapproval = {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled";
  payer_id?: number;
  payer_email?: string;
  external_reference?: string | null;
  init_point?: string;
  preapproval_plan_id?: string;
};

/** Creates a subscription checkout. Returns `init_point` — the URL to send
 * the user to so they can enter a card and authorize the recurring charge.
 * `externalReference` carries our own user_id through to the webhook,
 * the same role Stripe's `metadata.user_id` played. */
export async function createPreapproval(input: {
  preapprovalPlanId: string;
  payerEmail: string;
  externalReference: string;
  backUrl: string;
}): Promise<Preapproval> {
  return mpFetch<Preapproval>("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      preapproval_plan_id: input.preapprovalPlanId,
      payer_email: input.payerEmail,
      external_reference: input.externalReference,
      back_url: input.backUrl,
    }),
  });
}

export async function getPreapproval(id: string): Promise<Preapproval> {
  return mpFetch<Preapproval>(`/preapproval/${id}`, { method: "GET" });
}

/** Cancels a subscription. Mercado Pago has no hosted self-service billing
 * portal the way Stripe does, so "Manage billing" in the app calls this
 * directly instead of redirecting out to one. */
export async function cancelPreapproval(id: string): Promise<Preapproval> {
  return mpFetch<Preapproval>(`/preapproval/${id}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled" }),
  });
}

export type MpPayment = {
  id: number;
  status: "approved" | "pending" | "rejected" | "cancelled" | "refunded" | "in_process";
  external_reference?: string | null;
};

export async function getPayment(id: string | number): Promise<MpPayment> {
  return mpFetch<MpPayment>(`/v1/payments/${id}`, { method: "GET" });
}

/**
 * Verifies a webhook notification's `x-signature` header per Mercado
 * Pago's documented HMAC-SHA256 scheme:
 *   x-signature: "ts=<unix_ts>,v1=<hex_hmac>"
 *   manifest    = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 *   expected    = HMAC_SHA256(manifest, MERCADOPAGO_WEBHOOK_SECRET) as hex
 * `dataId` is the resource id from the notification's query string
 * (`data.id` / `id` param) or JSON body — Mercado Pago sends it both ways
 * depending on notification version, so callers should try the query
 * string first and fall back to the body.
 */
export async function verifyWebhookSignature(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}): Promise<boolean> {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret || !args.xSignature || !args.dataId) return false;

  const parts = Object.fromEntries(
    args.xSignature.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${args.dataId};${args.xRequestId ? `request-id:${args.xRequestId};` : ""}ts:${ts};`;

  const { createHmac } = await import("node:crypto");
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  // Constant-time compare — same reasoning as the pipeline worker's shared
  // secret check elsewhere in this codebase (confidentiality.tsx references
  // it): a signature check that's fast to time-attack isn't a real check.
  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
