// Nyrava Intelligence Control Center — provider connections, failover
// order, and per-feature routing. Not a raw API-key admin page.
import { createFileRoute } from "@tanstack/react-router";
import { IntelligenceProviders } from "@/components/IntelligenceProviders";

export const Route = createFileRoute("/_authenticated/ai-keys")({
  head: () => ({ meta: [{ title: "Intelligence Providers — Nyrava" }] }),
  component: IntelligenceProvidersPage,
});

function IntelligenceProvidersPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <IntelligenceProviders />
    </div>
  );
}
