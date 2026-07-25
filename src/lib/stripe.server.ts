// Server-only Stripe client. Never import this from a client component —
// it reads STRIPE_SECRET_KEY, which must never reach the browser bundle.
import Stripe from "stripe";

let _stripe: Stripe | null = null;

/** Lazily-constructed singleton. Throws a clear error if the env var is missing
 * instead of Stripe's own less-obvious constructor error. */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Add it in your deployment's environment variables (Stripe Dashboard → Developers → API keys).",
    );
  }
  _stripe = new Stripe(key, {
    // Pinned explicitly so a Stripe dashboard default change can't silently
    // alter response shapes this code was written against.
    apiVersion: "2026-05-27.dahlia" as unknown as Stripe.LatestApiVersion,
  });
  return _stripe;
}
