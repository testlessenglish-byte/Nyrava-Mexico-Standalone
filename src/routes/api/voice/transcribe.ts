// Voice transcription proxy → Groq Whisper (STT).
// Accepts multipart/form-data with `file` (audio blob).
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function requireAuthedClient(
  request: Request,
): Promise<{ supabase: ReturnType<typeof createClient<Database>>; userId: string } | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return new Response("Unauthorized", { status: 401 });
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return { supabase, userId: data.claims.sub };
}

// Same failure classification router.server.ts uses to decide whether a
// key is worth rotating past (auth/quota/payment) vs. a hard stop that
// would fail identically on every other key too.
function isRotatableError(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true; // bad/revoked key
  if (status === 402) return true; // payment required / out of credits
  if (status === 429 && /insufficient_quota|quota exceeded/i.test(bodyText)) return true; // hard quota, not a soft rate limit
  return false;
}

export const Route = createFileRoute("/api/voice/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authed = await requireAuthedClient(request);
        if (authed instanceof Response) return authed;
        const { supabase, userId } = authed;

        const { resolveProviderKeys } = await import("@/lib/ai-key-router.server");
        const { keys, keyIds, userKeyCount, hasPlatform } = await resolveProviderKeys(supabase, userId, "groq");
        if (keys.length === 0) {
          return new Response(
            JSON.stringify({
              error: "No Groq API key configured",
              // TEMP DIAGNOSTIC — remove once the key issue is found.
              diag: { userKeyCount, hasPlatform },
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const incoming = await request.formData();
        const file = incoming.get("file");
        if (!(file instanceof Blob) || file.size < 256) {
          return new Response(JSON.stringify({ error: "Empty or missing audio" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB — Groq Whisper limit
        if (file.size > MAX_AUDIO_BYTES) {
          return new Response(JSON.stringify({ error: "Audio file too large (max 25 MB)" }), {
            status: 413,
            headers: { "Content-Type": "application/json" },
          });
        }

        const mime = (file.type || "audio/webm").split(";")[0];
        const ext =
          mime === "audio/mp4"
            ? "mp4"
            : mime === "audio/mpeg"
              ? "mp3"
              : mime === "audio/wav" || mime === "audio/x-wav"
                ? "wav"
                : mime === "audio/ogg"
                  ? "ogg"
                  : "webm";

        const audioBytes = await file.arrayBuffer();

        // Try every active key in priority order. Only advance to the next
        // key on an auth/quota/payment failure — those are the failure
        // modes where "this key is bad, try another" is the correct
        // response. Anything else (bad audio, transport error, etc.) would
        // fail identically on every key, so surface it immediately instead
        // of burning through the whole chain.
        let lastStatus = 500;
        let lastBody = "";
        let triedCount = 0;
        let lastWasPlatformKey = false;
        for (let i = 0; i < keys.length; i++) {
          triedCount++;
          lastWasPlatformKey = keyIds[i] == null;
          const upstream = new FormData();
          upstream.append("model", "whisper-large-v3-turbo");
          upstream.append("file", new Blob([audioBytes], { type: mime }), `recording.${ext}`);
          upstream.append("response_format", "json");

          const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${keys[i]}` },
            body: upstream,
          });

          if (res.ok) {
            const json = (await res.json().catch(() => ({}))) as { text?: string };
            return Response.json({ text: json.text ?? "" });
          }

          lastStatus = res.status;
          lastBody = await res.text().catch(() => "");

          if (i < keys.length - 1 && isRotatableError(res.status, lastBody)) {
            console.warn(`[voice/transcribe] key ${i} failed (${res.status}), trying next key`);
            continue;
          }
          break;
        }

        return new Response(
          JSON.stringify({
            error: `STT ${lastStatus}`,
            detail: lastBody.slice(0, 500),
            // TEMP DIAGNOSTIC — remove once the key issue is found.
            diag: { userKeyCount, decryptedKeyCount: keys.length, triedCount, lastWasPlatformKey },
          }),
          { status: lastStatus, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
