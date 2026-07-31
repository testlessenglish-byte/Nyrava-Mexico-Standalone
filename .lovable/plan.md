## What's actually broken

Confirmed from the error payload in your screenshot plus the code:

`{"error":"TTS 400","detail":"Groq TTS 400: voice must be one of the following voices: [autumn diana hannah austin daniel troy]" ... "providersAvailable":["groq","gemini"],"triedCount":3,"lastProvider":"groq","chunksCompleted":0}`

1. **Wrong voice names sent to Groq.** The UI voice ids are OpenAI-style (`alloy`, `nova`, `shimmer`, `sage`, `coral`, `fable`). `src/lib/voice/adapters.server.ts` maps those for OpenAI and Gemini, but sends them **raw to Groq**, whose Orpheus model only accepts `autumn, diana, hannah, austin, daniel, troy`. Every Groq TTS call 400s regardless of key or quota.
2. **That 400 dead-ends the whole request.** `isRotatableError()` matches `model_terms_required`, `model_not_found`, etc., but not `voice must be one of` / `invalid_request_error`. So the loop `break`s instead of rotating to Gemini, and zero audio comes back (`chunksCompleted: 0`).
3. **Auto-speak is off.** In the screenshot "Auto-speak responses" is unchecked, and `VoiceCompanion` skips TTS entirely when `!prefs.voice_autoplay` — that's why earlier attempts showed Text-to-speech as a dash. Even with a fixed backend, nothing plays until that box is on.

## Fix

**`src/lib/voice/adapters.server.ts`**
- Add a `GROQ_VOICE_MAP` from the platform's voice ids to Orpheus voices (female: `nova/shimmer/coral/sage → diana/hannah/autumn`, `alloy/fable → diana`; male: `onyx/echo/ash/ballad/verse → austin/daniel/troy`), defaulting to `diana`, and resolve through it before calling Groq — mirroring what OpenAI and Gemini already do.
- Extend `isRotatableError()` so provider-side *request-shape* rejections (`voice must be one of`, `invalid_request_error`, `unsupported voice`, `invalid value.*voice`) rotate to the next provider instead of ending the request. A provider that can't accept the request is exactly the case another provider can serve.

**`src/routes/api/voice/speak.ts`**
- Last-resort fallback: after the user's provider chain is exhausted, try the Lovable AI Gateway (`/v1/audio/speech`, `openai/gpt-4o-mini-tts`, `response_format: wav`) with `LOVABLE_API_KEY`, so voice never hard-fails on quota-exhausted personal keys. Same pattern the text pipeline already uses.
- Keep the existing JSON diagnostics, but include the Gateway attempt in `diag`.

**`src/routes/api/voice/transcribe.ts`** — same audit pass: confirm the rotation loop uses the widened `isRotatableError` and add the Gateway (`openai/gpt-4o-transcribe`) as the final STT fallback, since your Gemini keys are the ones hitting 429.

**`src/components/VoiceCompanion.tsx`**
- When `voice_autoplay` is off (or muted), show an explicit inline note on the Text-to-speech stage — "auto-speak disabled in Account" with a link — instead of a silent dash, so the skip is never mistaken for a failure.

**`src/routes/_authenticated/account.tsx`**
- Default new profiles to auto-speak on for a conversational companion, and label the Preview buttons' failures with the same friendly error mapping the companion uses (Previews hit the same `/api/voice/speak` route, so they're fixed by the voice map too).

## Verification

- Play a Preview for each of the six listed voices from Account and confirm audio returns 200 `audio/wav`.
- Run a full Talk To Cases voice turn and confirm all six diagnostics (Mic → Recording → STT → Intelligence → TTS → Playback) go green.
- Force a Groq failure (bad key) and confirm the request rotates to Gemini/Gateway and still speaks.
