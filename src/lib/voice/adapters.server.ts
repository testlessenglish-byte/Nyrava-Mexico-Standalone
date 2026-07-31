// Provider-agnostic Speech-to-Text / Text-to-Speech adapters.
//
// Each voice-capable provider (Groq, OpenAI, Gemini) has its own audio API
// shape — this file is the only place that knows those shapes. The routes
// (/api/voice/transcribe, /api/voice/speak) just walk the provider chain
// from resolveVoiceProviderChain() and call transcribeAudio()/speakText()
// for whichever provider comes up next; they never talk to a provider's
// HTTP API directly.
//
// Anthropic and OpenRouter are intentionally absent — neither exposes a
// native STT or TTS endpoint, so they're skipped for voice specifically
// even though they're valid providers for text chat.
import type { VoiceProvider } from "@/lib/ai-key-router.server";

export class VoiceProviderError extends Error {
  readonly status: number;
  readonly rotatable: boolean;
  constructor(message: string, status: number, rotatable: boolean) {
    super(message);
    this.name = "VoiceProviderError";
    this.status = status;
    this.rotatable = rotatable;
  }
}

// Same failure classification used across the platform's other provider
// rotation (ai/router.server.ts, ai-key-router.server.ts): only advance to
// the next key/provider on auth/quota/payment failures. Anything else would
// fail identically everywhere, so surface it immediately instead of
// burning through the whole chain.
export function isRotatableError(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true; // bad/revoked key
  if (status === 402) return true; // payment required / out of credits
  // Groq/OpenAI phrase hard-quota 429s as "insufficient_quota" / "quota
  // exceeded". Gemini phrases the identical condition differently —
  // "You exceeded your current quota..." plus a RESOURCE_EXHAUSTED status —
  // so both forms need to match or Gemini's quota errors get treated as
  // non-rotatable and rotation stops after the first key instead of trying
  // the next one.
  if (
    status === 429 &&
    /insufficient_quota|quota exceeded|exceeded your current quota|resource_exhausted/i.test(bodyText)
  )
    return true; // hard quota, not a soft rate limit
  // Provider-level model availability problems: the model exists but this
  // account can't use it (Groq requires org acceptance of Orpheus terms,
  // models get decommissioned/renamed). Every key for THAT provider fails
  // the same way, but another provider in the chain can still speak — so
  // rotate instead of dead-ending the whole request.
  if (
    (status === 400 || status === 404) &&
    /model_terms_required|requires terms acceptance|model_not_found|does not exist|decommissioned|not supported/i.test(
      bodyText,
    )
  )
    return true;
  // Request-shape rejections: the provider cannot accept THIS request (e.g.
  // Groq's Orpheus only accepts its own voice names). Every key for that
  // provider fails identically, but another provider can serve it — rotate
  // rather than dead-ending the whole request.
  if (
    status === 400 &&
    /voice must be one of|unsupported voice|invalid.*voice|invalid_request_error/i.test(bodyText)
  )
    return true;
  return false;
}



// ---------------------------------------------------------------------------
// WAV helpers — every provider's audio is normalized to 16-bit PCM WAV
// before it's returned to the browser, since that's the one format every
// provider can either return natively or be coerced into, and it's what the
// existing frontend <audio> playback already expects from Groq/Orpheus.
// ---------------------------------------------------------------------------
function pcmToWav(pcm: ArrayBuffer, sampleRate: number, channels: number, bitsPerSample: number): ArrayBuffer {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm));
  return buffer;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// STT
// ---------------------------------------------------------------------------
export interface TranscribeArgs {
  provider: VoiceProvider;
  apiKey: string;
  audioBytes: ArrayBuffer;
  mime: string;
  ext: string;
  /** BCP-47-ish hint ("es" | "en") — the UI's current language toggle. */
  language?: "es" | "en";
}

export async function transcribeAudio(args: TranscribeArgs): Promise<string> {
  const { provider, apiKey, audioBytes, mime, ext, language } = args;

  if (provider === "groq") {
    const form = new FormData();
    form.append("model", "whisper-large-v3-turbo");
    form.append("file", new Blob([audioBytes], { type: mime }), `recording.${ext}`);
    form.append("response_format", "json");
    if (language) form.append("language", language);
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new VoiceProviderError(
        `Groq STT ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        isRotatableError(res.status, body),
      );
    }
    const json = (await res.json().catch(() => ({}))) as { text?: string };
    return json.text ?? "";
  }

  if (provider === "openai") {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([audioBytes], { type: mime }), `recording.${ext}`);
    form.append("response_format", "json");
    if (language) form.append("language", language);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new VoiceProviderError(
        `OpenAI STT ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        isRotatableError(res.status, body),
      );
    }
    const json = (await res.json().catch(() => ({}))) as { text?: string };
    return json.text ?? "";
  }

  // Gemini: no dedicated transcription endpoint — uses multimodal
  // generateContent with the audio as an inline part and an instruction to
  // transcribe verbatim.
  const b64 = Buffer.from(audioBytes).toString("base64");
  const prompt =
    language === "en"
      ? "Transcribe this audio exactly as spoken. Output ONLY the transcription text, no commentary, no quotation marks."
      : "Transcribe el audio exactamente como se habla. Responde ÚNICAMENTE con el texto transcrito, sin comentarios ni comillas.";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceProviderError(
      `Gemini STT ${res.status}: ${body.slice(0, 300)}`,
      res.status,
      isRotatableError(res.status, body),
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------
// OpenAI's TTS voice ids (alloy, nova, shimmer, echo, fable, onyx, sage,
// ash, ballad, coral, verse) already match the platform's existing UI voice
// ids one-to-one — gpt-4o-mini-tts supports all 11. No mapping needed.
const OPENAI_VALID_VOICES = new Set([
  "alloy",
  "nova",
  "shimmer",
  "echo",
  "fable",
  "onyx",
  "sage",
  "ash",
  "ballad",
  "coral",
  "verse",
]);

// Gemini's prebuilt voices use entirely different names. Best-effort map
// from the platform's existing voice ids to a reasonable Gemini voice —
// tune freely, this is not a semantic requirement, just keeps a consistent
// character across providers when a request rotates from Groq/OpenAI to
// Gemini mid-fallback.
const GEMINI_VOICE_MAP: Record<string, string> = {
  alloy: "Kore",
  nova: "Aoede",
  shimmer: "Leda",
  echo: "Puck",
  fable: "Charon",
  onyx: "Fenrir",
  sage: "Despina",
  ash: "Orus",
  ballad: "Enceladus",
  coral: "Autonoe",
  verse: "Callirrhoe",
};

// Groq's Orpheus model accepts ONLY its own six voice names — sending the
// platform's OpenAI-style ids ("alloy", "nova", ...) is a hard 400
// ("voice must be one of the following voices: [autumn diana hannah austin
// daniel troy]"). Map by gender/character so the voice the attorney picked
// still sounds close when a request lands on Groq.
const GROQ_VOICE_MAP: Record<string, string> = {
  // female
  alloy: "diana",
  nova: "diana",
  shimmer: "hannah",
  coral: "autumn",
  sage: "hannah",
  fable: "autumn",
  // male
  onyx: "austin",
  echo: "daniel",
  ash: "troy",
  ballad: "daniel",
  verse: "troy",
};
const GROQ_VALID_VOICES = new Set(["autumn", "diana", "hannah", "austin", "daniel", "troy"]);

export interface SpeakArgs {
  provider: VoiceProvider;
  apiKey: string;
  text: string;
  voice: string;
  /** BCP-47-ish hint ("es" | "en") — the UI's current language toggle. */
  language?: "es" | "en";
}


/** Returns raw WAV bytes, ready to stream back to the browser as-is. */
export async function speakText(args: SpeakArgs): Promise<ArrayBuffer> {
  const { provider, apiKey, text, voice } = args;

  if (provider === "groq") {
    const lower = voice.toLowerCase();
    const groqVoice = GROQ_VALID_VOICES.has(lower) ? lower : (GROQ_VOICE_MAP[lower] ?? "diana");
    const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "canopylabs/orpheus-v1-english",
        input: text,
        voice: groqVoice,
        response_format: "wav",
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new VoiceProviderError(
        `Groq TTS ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        isRotatableError(res.status, body),
      );
    }
    return await res.arrayBuffer();
  }

  if (provider === "openai") {
    const resolvedVoice = OPENAI_VALID_VOICES.has(voice.toLowerCase()) ? voice.toLowerCase() : "alloy";
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        input: text,
        voice: resolvedVoice,
        response_format: "wav",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new VoiceProviderError(
        `OpenAI TTS ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        isRotatableError(res.status, body),
      );
    }
    return await res.arrayBuffer();
  }

  // Gemini TTS: returns base64 PCM (16-bit signed, mono, 24kHz) inside the
  // generateContent response — wrap it in a WAV header ourselves.
  const resolvedVoice = GEMINI_VOICE_MAP[voice.toLowerCase()] ?? "Kore";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: resolvedVoice } } },
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceProviderError(
      `Gemini TTS ${res.status}: ${body.slice(0, 300)}`,
      res.status,
      isRotatableError(res.status, body),
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  const b64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new VoiceProviderError("Gemini TTS returned no audio", 502, false);
  return pcmToWav(base64ToArrayBuffer(b64), 24000, 1, 16);
}

/**
 * Groq's Orpheus model is English-only (no Spanish voice support). When the
 * UI is set to Spanish, Orpheus would either error or mispronounce the
 * reply — so it should be tried LAST for TTS, after any multilingual
 * provider (OpenAI, Gemini), not first. STT has no such restriction:
 * Whisper/OpenAI/Gemini all handle Spanish audio input fine on every
 * provider, so this only applies to speakText's provider ordering.
 */
export function reorderForTtsLocale<T extends { provider: VoiceProvider }>(
  chain: T[],
  language: "es" | "en" | undefined,
): T[] {
  if (language !== "es") return chain;
  const groq = chain.filter((c) => c.provider === "groq");
  const rest = chain.filter((c) => c.provider !== "groq");
  return [...rest, ...groq];
}
