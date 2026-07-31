// Mercado Pago webhook receiver. Lives under /api/public/* like
// pipeline-worker.ts (unauthenticated by Supabase session — Mercado Pago
// can't send a Bearer token), verified instead via Mercado Pago's HMAC
// signature scheme (see mercadopago.server.ts's verifyWebhookSignature).
//
// Configure this URL (https://<your-domain>/api/public/hooks/mercadopago-webhook)
// in Mercado Pago → Your integrations → Webhooks, subscribed to at minimum:
//   subscription_preapproval, subscription_authorized_payment
//
// Mercado Pago notifications are lightweight — just a resource id and
// type — so every branch below re-fetches the real object from the API
// before trusting anything in it, the same way the Stripe handler trusted
// only what Stripe's own signed event body contained.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isPlanKey } from "@/lib/billing-plans";

function log(event: string, extra: Record<string, unknown> = {}) {
  console.info(
    `[mercadopago-webhook] ${JSON.stringify({ t: new Date().toISOString(), event, ...extra })}`,
  );
}

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("backend env unavailable");
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

type Admin = ReturnType<typeof getAdmin>;

/** Resolve which user a preapproval belongs to. Prefers external_reference
 * (our user_id, set at checkout time — see billing.functions.ts); falls
 * back to matching mercadopago_preapproval_id for events that arrive after
 * we've already stored it. */
async function resolveUserId(
  admin: Admin,
  externalReference: string | null | undefined,
  preapprovalId: string | null | undefined,
): Promise<string | null> {
  if (externalReference) return externalReference;
  if (!preapprovalId) return null;
  const { data } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("mercadopago_preapproval_id", preapprovalId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/** Same firm seat-sync behavior the Stripe webhook had — kept unchanged,
 * this has nothing to do with which processor billed the card. */
async function syncFirmPlan(admin: Admin, userId: string, plan: string | null) {
  if (!plan) return;
  const { data: settings } = await admin
    .from("user_settings")
    .select("firm_id")
    .eq("user_id", userId)
    .maybeSingle();
  const firmId = settings?.firm_id;
  if (!firmId) return;
  const { data: seatData } = await admin.rpc("plan_seat_limit", { _plan: plan });
  const seatLimit = typeof seatData === "number" ? seatData : 1;
  await admin
    .from("firms")
    .update({ plan_key: plan, seat_limit: seatLimit, owner_user_id: userId })
    .eq("id", firmId);
  log("firm_plan_synced", { firmId, plan, seatLimit, ownerUserId: userId });
}

function mapPreapprovalStatus(
  status: string,
): Database["public"]["Tables"]["subscriptions"]["Row"]["status"] {
  switch (status) {
    case "authorized":
      return "active";
    case "paused":
      return "past_due";
    case "cancelled":
      return "canceled";
    default:
      return "incomplete";
  }
}

export const Route = createFileRoute("/api/public/hooks/mercadopago-webhook")({
  server: {
    handlers: {
      GET: async () => new Response("Method Not Allowed", { status: 405 }),
      POST: async ({ request }) => {
        const url = new URL(request.url);
        // MP sends the resource id both in the query string (data.id / id)
        // and in the JSON body, depending on notification version — read
        // both, query string first.
        const dataIdFromQuery = url.searchParams.get("data.id") ?? url.searchParams.get("id");
        const notificationType =
          url.searchParams.get("type") ?? url.searchParams.get("topic") ?? undefined;

        const rawBody = await request.text();
        let body: { type?: string; action?: string; data?: { id?: string } } = {};
        try {
          body = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          // Some notification variants have no JSON body at all (id/type
          // only in the query string) — that's fine, body stays {}.
        }

        const dataId = dataIdFromQuery ?? body.data?.id ?? null;
        const type = notificationType ?? body.type;

        const { verifyWebhookSignature } = await import("@/lib/mercadopago.server");
        const verified = await verifyWebhookSignature({
          xSignature: request.headers.get("x-signature"),
          xRequestId: request.headers.get("x-request-id"),
          dataId,
        });
        if (!verified) {
          log("signature_verification_failed", { type, dataId });
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const admin = getAdmin();
        let resolvedUserId: string | null = null;
        let logStatus: "processed" | "ignored" | "error" = "processed";
        let logDetail: string | null = null;

        try {
          if (!dataId) {
            logStatus = "ignored";
            logDetail = "notification carried no resource id";
          } else if (type === "subscription_preapproval") {
            const { getPreapproval } = await import("@/lib/mercadopago.server");
            const preapproval = await getPreapproval(dataId);
            const userId = await resolveUserId(
              admin,
              preapproval.external_reference,
              preapproval.id,
            );
            resolvedUserId = userId;
            if (!userId) {
              log("preapproval_no_user", { preapprovalId: preapproval.id });
              logStatus = "ignored";
              logDetail = "no matching user_id";
            } else {
              // Plan key isn't carried on the preapproval itself — look it
              // up from which billing_plans row has this preapproval_plan_id,
              // same role Stripe's session.metadata.plan played.
              let plan: string | null = null;
              if (preapproval.preapproval_plan_id) {
                const { data: planRow } = await admin
                  .from("billing_plans")
                  .select("key")
                  .eq("mercadopago_plan_id", preapproval.preapproval_plan_id)
                  .maybeSingle();
                plan = isPlanKey(planRow?.key) ? planRow!.key : null;
              }
              await admin.from("subscriptions").upsert(
                {
                  user_id: userId,
                  mercadopago_preapproval_id: preapproval.id,
                  mercadopago_payer_id:
                    preapproval.payer_id != null ? String(preapproval.payer_id) : null,
                  mercadopago_payer_email: preapproval.payer_email ?? null,
                  ...(plan ? { plan } : {}),
                  status: mapPreapprovalStatus(preapproval.status),
                },
                { onConflict: "user_id" },
              );
              log("preapproval_updated", { userId, status: preapproval.status, plan });
              if (plan) await syncFirmPlan(admin, userId, plan);
            }
          } else if (type === "subscription_authorized_payment" || type === "payment") {
            const { getPayment } = await import("@/lib/mercadopago.server");
            const payment = await getPayment(dataId);
            const userId = await resolveUserId(admin, payment.external_reference, null);
            resolvedUserId = userId;
            if (!userId) {
              log("payment_no_user", { paymentId: payment.id });
              logStatus = "ignored";
              logDetail = "no matching user_id";
            } else if (payment.status === "rejected") {
              await admin
                .from("subscriptions")
                .update({ status: "past_due" })
                .eq("user_id", userId);
              log("payment_failed", { userId });
            } else {
              logStatus = "ignored";
              logDetail = `payment status ${payment.status} — no action needed`;
            }
          } else {
            // Unhandled notification types are expected and fine — Mercado
            // Pago sends more types than we act on. Ack with 200 either way.
            logStatus = "ignored";
            logDetail = `unhandled notification type: ${type ?? "unknown"}`;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log("handler_error", { type, dataId, error: msg.slice(0, 500) });
          logStatus = "error";
          logDetail = msg.slice(0, 500);
          // Still return 200 below: Mercado Pago retries on non-2xx, and a
          // transient DB hiccup here shouldn't cause it to hammer retries
          // indefinitely for an event we've already logged.
        }

        try {
          await admin.from("webhook_events").upsert(
            {
              mp_event_id: `${type ?? "unknown"}:${dataId ?? "none"}`,
              provider: "mercadopago",
              event_type: type ?? "unknown",
              status: logStatus,
              user_id: resolvedUserId,
              detail: logDetail,
            },
            { onConflict: "mp_event_id" },
          );
        } catch (e) {
          log("event_log_write_failed", { error: e instanceof Error ? e.message : String(e) });
        }

        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
