// Text-to-speech proxy → Groq Orpheus TTS.
// (playai-tts was decommissioned by Groq in Dec 2025; the whole platform
// moved to canopylabs/orpheus-v1-english. Orpheus only ships 6 English
// voices — autumn/diana/hannah (female), austin/daniel/troy (male) — and
// caps input at 200 chars/request, unlike PlayAI which took long input in
// one shot. Both of those are handled below: VOICE_MAP maps old UI voice
// ids onto the closest Orpheus voice, and the handler chunks + stitches
// audio so replies longer than 200 chars still work.)
// Body: { text: string, voice?: string }
// Returns audio/wav bytes.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const TTS_MODEL = "canopylabs/orpheus-v1-english";
// Groq enforces this server-side; stay comfortably under it to leave room
// for multi-byte characters / punctuation the model may expand.
const MAX_CHARS_PER_CHUNK = 180;

// Map old PlayAI-era UI voice ids → nearest Orpheus voice. Orpheus has
// only 6 voices total, so this is a many-to-one approximation, not a
// perfect match — good enough to keep existing user_settings rows working
// without a migration.
const VOICE_MAP: Record<string, string> = {
  alloy: "austin",
  nova: "autumn",
  shimmer: "hannah",
  echo: "daniel",
  fable: "troy",
  onyx: "daniel",
  sage: "diana",
  ash: "austin",
  ballad: "troy",
  coral: "diana",
  verse: "hannah",
};

const VALID_ORPHEUS_VOICES = new Set(["autumn", "diana", "hannah", "austin", "daniel", "troy"]);

function resolveVoice(v?: string): string {
  if (!v) return "autumn";
  const lower = v.toLowerCase();
  if (VALID_ORPHEUS_VOICES.has(lower)) return lower;
  return VOICE_MAP[lower] ?? "autumn";
}

// Split text into <=maxLen chunks on sentence/clause boundaries where
// possible so each chunk stays under Orpheus's 200-char limit without
// cutting words mid-sentence any more than necessary.
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
    if (cut <= 0) cut = maxLen; // no natural break found — hard cut
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}

// Concatenate multiple WAV buffers (same format) into a single playable
// WAV by keeping the first file's header and appending everyone's PCM
// data, then rewriting the RIFF/data sizes. Orpheus returns standard
// 44-byte-header PCM WAV per call, so this doesn't need general RIFF
// chunk parsing.
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
  view.setUint32(4, 36 + totalDataLen, true); // RIFF chunk size
  view.setUint32(40, totalDataLen, true); // data chunk size
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

// Same failure classification router.server.ts uses to decide whether a
// key is worth rotating past (auth/quota/payment) vs. a hard stop that
// would fail identically on every other key too.
function isRotatableError(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true; // bad/revoked key
  if (status === 402) return true; // payment required / out of credits
  if (status === 429 && /insufficient_quota|quota exceeded/i.test(bodyText)) return true; // hard quota, not a soft rate limit
  return false;
}

export const Route = createFileRoute("/api/voice/speak")({
  server: {
    handlers: {
      GET: async () => new Response("Method Not Allowed", { status: 405 }),
      POST: async ({ request }) => {
        const authed = await requireAuthedClient(request);
        if (authed instanceof Response) return authed;
        const { supabase, userId } = authed;

        // Resolve every active key for this user (priority order), with the
        // platform GROQ_API_KEY as the final fallback when the user has
        // none configured — same rotation contract as text chat's
        // routeAI(), so a single bad/expired/out-of-credit key doesn't take
        // voice down while chat keeps working fine on the next key.
        const { resolveProviderKeys } = await import("@/lib/ai-key-router.server");
        const { keys, keyIds, userKeyCount, hasPlatform } = await resolveProviderKeys(supabase, userId, "groq");
        if (keys.length === 0) {
          return new Response(
            JSON.stringify({
              error: "No Groq API key configured",
              // TEMP DIAGNOSTIC — remove once the key issue is found.
              // userKeyCount = active rows found in user_ai_keys for this
              // user+provider. If this is >0 while keys.length is 0, every
              // one of those rows failed to decrypt (see decryptKey's
              // catch{continue} in ai-key-router.server.ts) — almost always
              // an AI_PROVIDER_ENCRYPTION_KEY mismatch between when the key
              // was saved and now, not a bad key.
              diag: { userKeyCount, hasPlatform },
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const { text, voice } = (await request.json().catch(() => ({}))) as {
          text?: string;
          voice?: string;
        };
        const cleaned = (text ?? "").trim();
        if (!cleaned) return new Response("Empty text", { status: 400 });

        // Overall cap to bound latency/cost per request; Orpheus is
        // per-chunk limited anyway (see MAX_CHARS_PER_CHUNK), this just
        // stops a huge reply from turning into 50+ sequential calls.
        const input = cleaned.slice(0, 3000);
        const resolvedVoice = resolveVoice(voice);
        const chunks = chunkText(input, MAX_CHARS_PER_CHUNK);

        let lastStatus = 500;
        let lastBody = "";
        let triedCount = 0;
        let lastWasPlatformKey = false;
        let keyStart = 0; // once a key works for one chunk, try it first for the rest
        const audioChunks: ArrayBuffer[] = [];

        chunkLoop: for (const chunk of chunks) {
          for (let offset = 0; offset < keys.length; offset++) {
            const i = (keyStart + offset) % keys.length;
            triedCount++;
            lastWasPlatformKey = keyIds[i] == null; // null keyId = platform env fallback, not a saved user key
            const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${keys[i]}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: TTS_MODEL,
                input: chunk,
                voice: resolvedVoice,
                response_format: "wav",
              }),
            });

            if (res.ok) {
              audioChunks.push(await res.arrayBuffer());
              keyStart = i;
              continue chunkLoop;
            }

            lastStatus = res.status;
            lastBody = await res.text().catch(() => "");

            if (offset < keys.length - 1 && isRotatableError(res.status, lastBody)) {
              console.warn(`[voice/speak] key ${i} failed (${res.status}), trying next key`);
              continue;
            }
            // Every key failed (or hit a non-rotatable error) for this
            // chunk — bail out of the whole request rather than returning
            // partial audio with a silent gap.
            break chunkLoop;
          }
        }

        if (audioChunks.length === chunks.length) {
          const combined = concatWav(audioChunks);
          return new Response(combined, {
            headers: { "Content-Type": "audio/wav" },
          });
        }

        return new Response(
          JSON.stringify({
            error: `TTS ${lastStatus}`,
            detail: lastBody.slice(0, 500),
            // TEMP DIAGNOSTIC — remove once the key issue is found.
            // userKeyCount: active rows in user_ai_keys for this user+groq.
            // decryptedKeyCount: how many of those actually decrypted into
            // usable keys (keys.length) — if this is LOWER than
            // userKeyCount, some saved keys are silently failing to
            // decrypt and never even get tried against Groq.
            // triedCount: how many keys this request actually attempted
            // before giving up.
            // lastWasPlatformKey: true means the LAST attempt (the one
            // whose error you're looking at) was the platform GROQ_API_KEY
            // env var, not one of your saved keys — meaning your saved
            // keys either don't exist here, didn't decrypt, or all
            // rotated through cleanly earlier and this is the fallback.
            diag: {
              userKeyCount,
              decryptedKeyCount: keys.length,
              triedCount,
              lastWasPlatformKey,
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
