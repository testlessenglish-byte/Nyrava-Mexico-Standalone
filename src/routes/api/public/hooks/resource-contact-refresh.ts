// Central refresh job for Resource Network contact information.
//
// Same security pattern as the other workers: lives under /api/public/* but
// does nothing without the shared worker secret. Fetches each approved
// official source, validates the extracted values against that source's
// allowed domains, and stores them. Users never trigger network calls by
// opening the Resource Network page.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { refreshOfficialContacts } from "@/lib/resource-directory/contact-refresh.server";

export const Route = createFileRoute("/api/public/hooks/resource-contact-refresh")({
  server: {
    handlers: {
      GET: async () => new Response("Method Not Allowed", { status: 405 }),
      POST: async ({ request }) => {
        const json = (body: unknown, status: number) =>
          new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

        const provided = request.headers.get("x-worker-secret");
        if (!provided) return json({ error: "unauthorized" }, 401);

        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !serviceKey) return json({ error: "backend env unavailable" }, 500);

        const admin = createClient<Database>(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: sec, error: secErr } = await (admin as any)
          .from("worker_secrets")
          .select("secret")
          .eq("name", "legal_ingest_worker")
          .maybeSingle();
        if (secErr || !sec?.secret || sec.secret !== provided) return json({ error: "unauthorized" }, 401);

        const results = await refreshOfficialContacts(admin);
        console.info(
          `[resource-contact-refresh] ${JSON.stringify({
            t: new Date().toISOString(),
            checked: results.length,
            updated: results.filter((r) => r.status === "updated").length,
            failed: results.filter((r) => r.status === "failed").length,
          })}`,
        );
        return json({ checked: results.length, results }, 200);
      },
    },
  },
});
