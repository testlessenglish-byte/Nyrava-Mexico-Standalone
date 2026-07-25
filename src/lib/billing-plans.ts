// Single source of truth for subscription tiers. Shared between the
// client-rendered pricing page and the server-side checkout/webhook logic,
// so adding or renaming a plan only has to happen here.
//
// Actual prices live in Stripe (not here) — each self-serve plan points at
// a Stripe Price ID supplied via an env var, so changing a price in the
// Stripe dashboard never requires a code deploy. `priceEnvVar` is the name
// of that env var, read server-side only (see billing.functions.ts).
export type PlanKey = "solo" | "firm" | "enterprise";

export type PlanConfig = {
  key: PlanKey;
  label: string;
  tagline: string;
  features: string[];
  /** True if this plan is purchasable via Stripe Checkout. False = "Contact us" (enterprise). */
  selfServe: boolean;
  /** Env var name holding the Stripe Price ID for this plan. Only set when selfServe is true. */
  priceEnvVar?: string;
};

export const BILLING_PLANS: Record<PlanKey, PlanConfig> = {
  solo: {
    key: "solo",
    label: "Solo",
    tagline: "For solo practitioners and small caseloads",
    features: [
      "Unlimited case analysis",
      "Full 20-stage intelligence pipeline",
      "Motion drafting & reports",
      "Email support",
    ],
    selfServe: true,
    priceEnvVar: "STRIPE_PRICE_SOLO",
  },
  firm: {
    key: "firm",
    label: "Firm",
    tagline: "For firms running multiple cases at once",
    features: [
      "Everything in Solo",
      "Multiple attorney seats",
      "Priority processing",
      "Priority support",
    ],
    selfServe: true,
    priceEnvVar: "STRIPE_PRICE_FIRM",
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    tagline: "For large firms with custom needs",
    features: [
      "Everything in Firm",
      "Custom seat count & SSO",
      "Dedicated onboarding",
      "Custom contract & invoicing",
    ],
    selfServe: false,
  },
};


export function isPlanKey(v: unknown): v is PlanKey {
  return v === "solo" || v === "firm" || v === "enterprise";
}
