// Voice text-to-speech proxy — provider-agnostic TTS.
// Body: { text: string, voice?: string, locale?: "es" | "en" }
// Returns audio/wav bytes.
//
// Tries every active key across every voice-capable provider the user has
// configured (Groq, OpenAI, Gemini) in priority order, same rotation
// contract as text chat's routeAI(). Groq's Orpheus model is English-only,
// so when locale is "es" it's tried last rather than first (see
// reorderForTtsLocale in adapters.server.ts) — otherwise a Spanish reply
// would go to a model that can't speak Spanish before ever reaching a
// provider that can.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Groq/Orpheus caps input at 200 chars/request; other providers are far
// more generous, but chunking uniformly keeps one code path and keeps
// per-request latency low across the board.
const MAX_CHARS_PER_CHUNK = 180;

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cut = -1;
    for (const boundary of [". ", "! ", "? ", "; ", ", ", " "]) {
      const idx = remaining.lastIndexOf(boundary, maxLen);
      if (idx > 0) {
        cut = idx + boundary.length;
        break;
      }
    }
    if (cut <= 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

// Concatenate multiple same-format WAV buffers into one playable WAV by
// keeping the first file's header and appending everyone's PCM data, then
// rewriting the RIFF/data sizes.
function concatWav(buffers: ArrayBuffer[]): ArrayBuffer {
  if (buffers.length === 1) return buffers[0];
  const headerSize = 44;
  const dataParts = buffers.map((b) => b.slice(headerSize));
  const totalDataLen = dataParts.reduce((sum, b) => sum + b.byteLength, 0);

  const header = new Uint8Array(buffers[0].slice(0, headerSize));
  const out = new Uint8Array(headerSize + totalDataLen);
  out.set(header, 0);
  let offset = headerSize;
  for (const part of dataParts) {
    out.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }

  const view = new DataView(out.buffer);
  view.setUint32(4, 36 + totalDataLen, true);
  view.setUint32(40, totalDataLen, true);
  return out.buffer;
}

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

export const Route = createFileRoute("/api/voice/speak")({
  server: {
    handlers: {
      GET: async () => new Response("Method Not Allowed", { status: 405 }),
      POST: async ({ request }) => {
        const authed = await requireAuthedClient(request);
        if (authed instanceof Response) return authed;
        const { supabase, userId } = authed;

        const { resolveVoiceProviderChain, flattenVoiceChain } = await import("@/lib/ai-key-router.server");
        const { speakText, reorderForTtsLocale, VoiceProviderError } = await import("@/lib/voice/adapters.server");

        const { text, voice, locale } = (await request.json().catch(() => ({}))) as {
          text?: string;
          voice?: string;
          locale?: string;
        };
        const language = locale === "en" || locale === "es" ? locale : undefined;

        const chain = await resolveVoiceProviderChain(supabase, userId);
        let attempts = flattenVoiceChain(chain);
        attempts = reorderForTtsLocale(attempts, language);
        if (attempts.length === 0) {
          return new Response(
            JSON.stringify({
              error: "No voice-capable AI provider configured",
              detail: "Add a Groq, OpenAI, or Gemini key in Admin \u2192 AI Providers to use voice.",
              diag: { userKeyCount: chain.userKeyCount, hasPlatform: chain.hasPlatform },
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const cleaned = (text ?? "").trim();
        if (!cleaned) return new Response("Empty text", { status: 400 });

        const input = cleaned.slice(0, 3000);
        const resolvedVoice = voice || "alloy";
        const chunks = chunkText(input, MAX_CHARS_PER_CHUNK);

        let lastStatus = 500;
        let lastMessage = "";
        let lastProvider = "";
        let triedCount = 0;
        let attemptStart = 0; // once an attempt works for one chunk, try it first for the rest
        const audioChunks: ArrayBuffer[] = [];

        chunkLoop: for (const chunk of chunks) {
          for (let offset = 0; offset < attempts.length; offset++) {
            const i = (attemptStart + offset) % attempts.length;
            const { provider, key } = attempts[i];
            triedCount++;
            try {
              const wav = await speakText({ provider, apiKey: key, text: chunk, voice: resolvedVoice, language });
              audioChunks.push(wav);
              attemptStart = i;
              continue chunkLoop;
            } catch (err) {
              lastProvider = provider;
              if (err instanceof VoiceProviderError) {
                lastStatus = err.status;
                lastMessage = err.message;
                if (offset < attempts.length - 1 && err.rotatable) {
                  console.warn(`[voice/speak] ${provider} attempt ${i} failed (${err.status}), trying next`);
                  continue;
                }
              } else {
                lastMessage = err instanceof Error ? err.message : String(err);
              }
              break chunkLoop;
            }
          }
        }

        if (audioChunks.length === chunks.length) {
          const combined = concatWav(audioChunks);
          return new Response(combined, { headers: { "Content-Type": "audio/wav" } });
        }

        return new Response(
          JSON.stringify({
            error: `TTS ${lastStatus}`,
            detail: lastMessage.slice(0, 500),
            diag: {
              userKeyCount: chain.userKeyCount,
              providersAvailable: [...new Set(attempts.map((a) => a.provider))],
              triedCount,
              lastProvider,
              chunkCount: chunks.length,
              chunksCompleted: audioChunks.length,
            },
          }),
          { status: lastStatus, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
