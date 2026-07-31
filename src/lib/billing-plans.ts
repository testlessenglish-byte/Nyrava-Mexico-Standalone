// Single source of truth for subscription tiers. Shared between the
// client-rendered pricing page and the server-side checkout/webhook logic,
// so adding or renaming a plan only has to happen here.
//
// Actual prices live in Mercado Pago (not here) — each self-serve plan
// points at a Mercado Pago Preapproval Plan id, configured per-plan from
// Admin -> Billing Plans (mercadopago_plan_id column on billing_plans),
// so changing a price in Mercado Pago never requires a code deploy.
// `mpPlanEnvVar` is a legacy env-var fallback (see billing.functions.ts) for
// setups that haven't moved the id into the admin-managed billing_plans row
// yet — new deployments should just set it in Admin -> Billing Plans.
export type PlanKey = "solo" | "firm" | "enterprise";

export type PlanConfig = {
  key: PlanKey;
  label: string;
  tagline: string;
  features: string[];
  /** True if this plan is purchasable via Mercado Pago checkout. False = "Contact us" (enterprise). */
  selfServe: boolean;
  /** Env var name holding a fallback Mercado Pago Preapproval Plan id. Only set when selfServe is true. */
  mpPlanEnvVar?: string;
};

export const BILLING_PLANS: Record<PlanKey, PlanConfig> = {
  solo: {
    key: "solo",
    label: "Solo",
    tagline: "For solo practitioners and small caseloads",
    features: [
      "150 AI requests / month",
      "30 Talk-to-Case conversations / month",
      "Full 20-stage intelligence pipeline",
      "Motion drafting & reports",
      "Connect your own AI keys (BYOK)",
      "Email support",
    ],
    selfServe: true,
    mpPlanEnvVar: "MERCADOPAGO_PLAN_SOLO",
  },
  firm: {
    key: "firm",
    label: "Firm",
    tagline: "For firms running multiple cases at once",
    features: [
      "750 AI requests / month",
      "150 Talk-to-Case conversations / month",
      "Everything in Solo",
      "Multiple attorney seats",
      "Priority processing",
      "Priority support",
    ],
    selfServe: true,
    mpPlanEnvVar: "MERCADOPAGO_PLAN_FIRM",
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    tagline: "For large firms with custom needs",
    features: [
      "Custom monthly AI + Talk-to-Case allowance",
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
