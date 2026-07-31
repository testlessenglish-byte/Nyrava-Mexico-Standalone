// VoiceCompanion — true conversational assistant.
// Modes:
//  • Push-to-talk: single tap records until you tap stop.
//  • Conversation: tap Start Conversation; mic auto-listens, detects silence,
//    sends to AI, plays the response, then auto-restarts the mic — looping
//    until you tap End Conversation. Interrupt by tapping End at any time.
// Status pill always shows: Idle / Listening / Processing / Speaking / Error.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { askCaseAi } from "@/lib/cases.functions";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import {
  Mic,
  MicOff,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Volume2,
  Radio,
  PhoneOff,
  Phone,
} from "lucide-react";

type Stage = "idle" | "running" | "ok" | "error" | "skipped";
type Status = "idle" | "listening" | "processing" | "speaking" | "error";
type Diag = {
  mic: Stage;
  record: Stage;
  stt: Stage;
  ai: Stage;
  tts: Stage;
  play: Stage;
  transcript?: string;
  reply?: string;
  error?: string;
};
type VoicePrefs = {
  voice_id: string;
  voice_speed: number;
  voice_muted: boolean;
  voice_autoplay: boolean;
  voice_continuous: boolean;
  voice_pitch: "low" | "medium" | "high";
  voice_accent: string;
};
const emptyDiag: Diag = { mic: "idle", record: "idle", stt: "idle", ai: "idle", tts: "idle", play: "idle" };
const ACCENT_LABEL: Record<string, string> = {
  us: "American English",
  uk: "British English",
  au: "Australian English",
  ca: "Canadian English",
  "es-mx": "Mexican Spanish",
  "es-es": "Spain Spanish",
  neutral: "Neutral",
};

function pickMime(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

function StageRow({ label, stage, hint }: { label: string; stage: Stage; hint?: string }) {
  const icon =
    stage === "ok" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    ) : stage === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    ) : stage === "error" ? (
      <XCircle className="h-3.5 w-3.5 text-red-500" />
    ) : stage === "skipped" ? (
      <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />
    ) : (
      <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
    );
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {hint ? <span className="text-muted-foreground truncate max-w-[60%]">{hint}</span> : null}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
    idle: {
      label: "Idle",
      cls: "bg-slate-500/15 text-slate-300 border-slate-500/30",
      icon: <MinusCircle className="h-3 w-3" />,
    },
    listening: {
      label: "Listening",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 animate-pulse",
      icon: <Radio className="h-3 w-3" />,
    },
    processing: {
      label: "Processing",
      cls: "bg-primary/15 text-primary border-primary/30",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    speaking: {
      label: "Speaking",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      icon: <Volume2 className="h-3 w-3" />,
    },
    error: {
      label: "Error",
      cls: "bg-red-500/15 text-red-300 border-red-500/30",
      icon: <XCircle className="h-3 w-3" />,
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${s.cls}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

export function VoiceCompanion({ caseId, caseName }: { caseId: string; caseName?: string }) {
  const ask = useServerFn(askCaseAi);
  const { locale, t } = useI18n();
  const [diag, setDiag] = useState<Diag>(emptyDiag);
  const [status, setStatus] = useState<Status>("idle");
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [conversation, setConversation] = useState(false);
  const [prefs, setPrefs] = useState<VoicePrefs>({
    voice_id: "alloy",
    voice_speed: 1,
    voice_muted: false,
    voice_autoplay: true,
    voice_continuous: false,
    voice_pitch: "medium",
    voice_accent: "us",
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Persistent, reused <audio> element for TTS playback. Mobile Safari (and,
  // more loosely, Chrome for Android) only allows programmatic audio.play()
  // when it is "tied" to a recent user gesture. `new Audio(url).play()`
  // called after a multi-step async chain (STT fetch -> AI fetch -> TTS
  // fetch) has drifted too far from the original tap by the time it runs,
  // so mobile browsers silently reject it — the response never speaks and
  // falls back to the manual "Play response" button on every single turn,
  // breaking the hands-free conversation loop. Fix: create ONE <audio>
  // element and "unlock" it with a play() call made synchronously inside
  // the click handler (see unlockAudioPlayback below) before any awaits
  // happen. Once an element has been unlocked by a real gesture, mobile
  // browsers keep allowing programmatic .play() on that SAME element for
  // the rest of the session — so we reuse it every turn instead of
  // constructing a fresh Audio() each time.
  const playbackElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const conversationRef = useRef(false);
  const speakingRef = useRef(false);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  // Load saved voice preferences from user_settings.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user?.id) return;
        const { data: s } = await supabase
          .from("user_settings")
          .select("voice_id,voice_speed,voice_muted,voice_autoplay,voice_continuous,voice_pitch,voice_accent")
          .eq("user_id", u.user.id)
          .maybeSingle();
        if (!s || cancelled) return;
        const row = s as Partial<VoicePrefs>;
        setPrefs((p) => ({
          ...p,
          voice_id: row.voice_id ?? p.voice_id,
          voice_speed: typeof row.voice_speed === "number" ? row.voice_speed : p.voice_speed,
          voice_muted: !!row.voice_muted,
          voice_autoplay: row.voice_autoplay !== false,
          voice_continuous: !!row.voice_continuous,
          voice_pitch: (row.voice_pitch as VoicePrefs["voice_pitch"]) ?? p.voice_pitch,
          voice_accent: row.voice_accent ?? p.voice_accent,
        }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      teardown();
    },
    [],
  );

  function teardown() {
    if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = null;
    analyserRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      /* noop */
    }
    audioCtxRef.current = null;
    try {
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
    } catch {
      /* noop */
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }

  // Must be called SYNCHRONOUSLY inside a real click handler, before any
  // `await`. Playing (and immediately pausing) a silent clip on the
  // persistent element, within the same task as the user's tap, is what
  // grants that element standing programmatic-play permission on mobile
  // Safari/Chrome for the rest of the session — even when the later real
  // .play() call happens after several async round-trips.
  const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  function unlockAudioPlayback() {
    if (!playbackElRef.current) {
      const el = new Audio();
      el.preload = "auto";
      playbackElRef.current = el;
    }
    const el = playbackElRef.current;
    try {
      el.src = SILENT_WAV;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => el.pause()).catch(() => {
          /* unlock attempt failed; real play() will still be tried later */
        });
      } else {
        el.pause();
      }
    } catch {
      /* noop — best-effort unlock */
    }
  }

  function instructionsFor(): string {
    const accentLabel = ACCENT_LABEL[prefs.voice_accent] ?? "American English";
    const pitchPhrase =
      prefs.voice_pitch === "low"
        ? "with a lower, deeper pitch"
        : prefs.voice_pitch === "high"
          ? "with a higher, brighter pitch"
          : "with a natural pitch";
    return `Speak in ${accentLabel} ${pitchPhrase}, warm, clear, and professional.`;
  }

  // Acquire mic + start a recording with silence-based auto-stop when in conversation mode.
  async function startListening(autoStop: boolean) {
    setDiag({ ...emptyDiag, mic: "running" });
    setAudioUrl(null);

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("error");
      setDiag((d) => ({ ...d, mic: "error", error: "Microphone requires HTTPS." }));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setDiag((d) => ({ ...d, mic: "error", error: "This browser does not expose microphone APIs." }));
      return;
    }
    try {
      const status = await navigator.permissions?.query?.({ name: "microphone" as PermissionName });
      if (status?.state === "denied") {
        setStatus("error");
        setDiag((d) => ({
          ...d,
          mic: "error",
          error: "Microphone is blocked for this site. Tap the lock icon → Site settings → Microphone → Allow.",
        }));
        return;
      }
    } catch {
      /* ignore */
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setDiag((d) => ({ ...d, mic: "ok" }));
      const mime = pickMime();
      if (!mime) {
        setStatus("error");
        setDiag((d) => ({ ...d, record: "error", error: "Browser cannot record a supported audio format." }));
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopVad();
        void runPipeline(mime);
      };
      recorderRef.current = rec;
      rec.start();
      setDiag((d) => ({ ...d, record: "running" }));
      setRecording(true);
      setStatus("listening");

      if (autoStop) startVad(stream);
    } catch (err) {
      const e = err as DOMException;
      const name = e?.name ?? "";
      const inIframe = typeof window !== "undefined" && window.self !== window.top;
      let msg = e?.message || "Microphone permission denied.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        msg = inIframe
          ? "Microphone blocked inside the preview frame. Open the app in a new tab and allow microphone access."
          : "Permission denied. Tap the lock icon → Site settings → Microphone → Allow, then reload.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg = "No microphone found. Connect a mic or check OS sound input settings.";
      } else if (name === "NotReadableError") {
        msg = "Microphone is in use by another app.";
      }
      setStatus("error");
      setDiag((d) => ({ ...d, mic: "error", error: msg }));
      setConversation(false);
    }
  }

  // Voice activity detection: stop the recorder after ~1.4s of sustained silence.
  function startVad(stream: MediaStream) {
    try {
      const Ctx: typeof AudioContext =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      // Mobile browsers (iOS Safari especially, sometimes Chrome/Android)
      // frequently create a new AudioContext in a "suspended" state unless
      // it's explicitly resumed. A suspended context still runs the graph,
      // but the analyser reads back silence the whole time — everVoiced
      // never flips true, so the mic never detects real speech and just
      // sits "listening" until the 30s hard cap. Resuming here (best-effort;
      // some browsers reject resume() outside a gesture, in which case VAD
      // simply falls back to the manual Stop & send button, same as before).
      ctx.resume().catch(() => {
        /* best-effort; falls back to manual stop */
      });
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.fftSize);
      const startedAt = Date.now();
      let silenceStart: number | null = null;
      const MAX_DURATION_MS = 30_000; // hard cap on a single utterance
      const MIN_VOICED_MS = 600; // require some speech before allowing silence-stop
      const SILENCE_HANG_MS = 1400; // continuous silence before auto-stop
      const THRESHOLD = 0.018; // RMS gate
      let everVoiced = false;

      const tick = () => {
        if (!analyserRef.current || !recorderRef.current) return;
        analyser.getByteTimeDomainData(buf);
        // RMS
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        const elapsed = now - startedAt;
        if (rms > THRESHOLD) {
          everVoiced = true;
          silenceStart = null;
        } else if (everVoiced && elapsed > MIN_VOICED_MS) {
          if (silenceStart == null) silenceStart = now;
          else if (now - silenceStart > SILENCE_HANG_MS) {
            stopListening();
            return;
          }
        }
        if (elapsed > MAX_DURATION_MS) {
          stopListening();
          return;
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch {
      // VAD failed — fall back to manual stop only.
    }
  }

  function stopVad() {
    if (vadRafRef.current) cancelAnimationFrame(vadRafRef.current);
    vadRafRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      /* noop */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  function stopListening() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
    setDiag((d) => ({ ...d, record: "ok" }));
  }

  // Conversation control
  async function startConversation() {
    // Must happen first and synchronously — this is the real user gesture.
    unlockAudioPlayback();
    setConversation(true);
    conversationRef.current = true;
    await startListening(true);
  }

  function endConversation() {
    setConversation(false);
    conversationRef.current = false;
    // Stop anything currently happening.
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* noop */
      }
      audioRef.current = null;
    }
    speakingRef.current = false;
    teardown();
    setRecording(false);
    setStatus("idle");
  }

  function humanizeVoiceError(kind: "stt" | "tts", status: number, bodyText: string): string {
    // The server returns structured JSON ({ error, detail, diag }) — parse
    // it so the UI can show something an attorney can act on, instead of
    // the raw provider error text (which is always in English regardless
    // of the app's locale, and reads as "the app is broken" rather than
    // "add another provider key").
    let parsed: { error?: string; detail?: string; diag?: { lastProvider?: string } } = {};
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // Not JSON (network-level failure, HTML error page, etc.) — fall
      // through to the generic message below with the raw text as detail.
    }
    const provider = parsed.diag?.lastProvider ?? "";
    const detail = (parsed.detail ?? bodyText).slice(0, 200);

    if (parsed.error === "No voice-capable AI provider configured") {
      return t("voiceCompanion.error.noProvider");
    }
    if (status === 429) {
      return t("voiceCompanion.error.quota", { provider: provider || "AI" });
    }
    if (status === 401 || status === 403) {
      return t("voiceCompanion.error.authInvalid", { provider: provider || "AI" });
    }
    return t(kind === "stt" ? "voiceCompanion.error.sttGeneric" : "voiceCompanion.error.ttsGeneric", {
      status,
      detail,
    });
  }

  async function runPipeline(mime: string) {
    try {
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size < 1024) {
        setStatus(conversationRef.current ? "listening" : "idle");
        setDiag((d) => ({ ...d, stt: "error", error: t("voiceCompanion.error.tooShort") }));
        if (conversationRef.current)
          setTimeout(() => {
            if (conversationRef.current) void startListening(true);
          }, 400);
        return;
      }

      setStatus("processing");
      setDiag((d) => ({ ...d, stt: "running" }));
      const fd = new FormData();
      fd.append("file", blob, `recording.${mime.includes("mp4") ? "mp4" : "webm"}`);
      fd.append("language", locale);
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      if (!authToken) {
        setStatus("error");
        setDiag((d) => ({ ...d, stt: "error", error: t("voiceCompanion.error.signInRequired") }));
        return;
      }
      const sttRes = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: fd,
      });
      if (!sttRes.ok) {
        const body = await sttRes.text().catch(() => "");
        setStatus("error");
        setDiag((d) => ({
          ...d,
          stt: "error",
          error: humanizeVoiceError("stt", sttRes.status, body),
        }));
        return;
      }
      const { text: transcript } = (await sttRes.json()) as { text: string };
      if (!transcript.trim()) {
        setDiag((d) => ({ ...d, stt: "error", error: t("voiceCompanion.error.noSpeech") }));
        if (conversationRef.current) {
          setStatus("listening");
          setTimeout(() => {
            if (conversationRef.current) void startListening(true);
          }, 400);
        } else setStatus("idle");
        return;
      }
      setDiag((d) => ({ ...d, stt: "ok", transcript }));

      setDiag((d) => ({ ...d, ai: "running" }));
      const aiResult = (await ask({ data: { caseId, question: transcript, locale, voiceMode: true } })) as
        | { answer?: string }
        | string;
      const reply = typeof aiResult === "string" ? aiResult : (aiResult?.answer ?? "");
      if (!reply.trim()) {
        setStatus("error");
        setDiag((d) => ({ ...d, ai: "error", error: "Nyrava Intelligence returned an empty response." }));
        return;
      }
      setDiag((d) => ({ ...d, ai: "ok", reply }));

      // TTS
      if (prefs.voice_muted || !prefs.voice_autoplay) {
        setDiag((d) => ({ ...d, tts: "skipped", play: "skipped" }));
        if (conversationRef.current) {
          setStatus("listening");
          setTimeout(() => {
            if (conversationRef.current) void startListening(true);
          }, 300);
        } else setStatus("idle");
        return;
      }
      setDiag((d) => ({ ...d, tts: "running" }));
      const ttsRes = await fetch("/api/voice/speak", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          text: speakableText(reply),
          voice: prefs.voice_id,
          speed: prefs.voice_speed,
          instructions: instructionsFor(),
          locale,
        }),
      });
      if (!ttsRes.ok) {
        const body = await ttsRes.text().catch(() => "");
        setStatus("error");
        setDiag((d) => ({ ...d, tts: "error", error: humanizeVoiceError("tts", ttsRes.status, body) }));
        return;
      }
      const audioBlob = await ttsRes.blob();
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      setDiag((d) => ({ ...d, tts: "ok", play: "running" }));

      setStatus("speaking");
      // Reuse the SAME element that was unlocked by the original tap
      // (see unlockAudioPlayback). Constructing `new Audio(url)` fresh each
      // turn is what breaks autoplay on mobile — a brand-new element has no
      // gesture standing of its own, even mid-session. Fall back to
      // constructing one if it somehow doesn't exist yet (e.g. teardown ran
      // between turns), same as before, so behavior on desktop is unchanged.
      const audio = playbackElRef.current ?? new Audio();
      playbackElRef.current = audio;
      audio.src = url;
      audioRef.current = audio;
      speakingRef.current = true;
      const onFinish = () => {
        speakingRef.current = false;
        audioRef.current = null;
        setDiag((d) => ({ ...d, play: "ok" }));
        if (conversationRef.current) {
          setStatus("listening");
          setTimeout(() => {
            if (conversationRef.current) void startListening(true);
          }, 250);
        } else {
          setStatus("idle");
        }
      };
      audio.onended = onFinish;
      audio.onerror = () => {
        setDiag((d) => ({ ...d, play: "error", error: t("voiceCompanion.error.playback") }));
        onFinish();
      };
      try {
        await audio.play();
      } catch {
        setDiag((d) => ({ ...d, play: "skipped" }));
        onFinish();
      }
    } catch (err) {
      setStatus("error");
      setDiag((d) => ({ ...d, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  const busy = status === "processing" || status === "speaking";
  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Voice Companion{caseName ? ` — ${caseName}` : ""}</h3>
        <StatusPill status={status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!conversation ? (
          <button
            onClick={startConversation}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            title="Start a hands-free back-and-forth conversation"
          >
            <Phone className="h-4 w-4" /> Start Conversation
          </button>
        ) : (
          <button
            onClick={endConversation}
            className="inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <PhoneOff className="h-4 w-4" /> End Conversation
          </button>
        )}

        {!conversation && !recording && (
          <button
            onClick={() => {
              unlockAudioPlayback();
              void startListening(false);
            }}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            title="Push-to-talk: record one question manually"
          >
            <Mic className="h-4 w-4" /> Push to talk
          </button>
        )}
        {!conversation && recording && (
          <button
            onClick={() => stopListening()}
            className="inline-flex items-center gap-2 rounded-full bg-red-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <MicOff className="h-4 w-4" /> Stop & send
          </button>
        )}

        {audioUrl && diag.play === "skipped" && (
          <button
            onClick={() =>
              new Audio(audioUrl)
                .play()
                .then(() => setDiag((d) => ({ ...d, play: "ok" })))
                .catch(() => {})
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          >
            <Volume2 className="h-3.5 w-3.5" /> Play response
          </button>
        )}
        {diag.mic === "error" && inIframe && (
          <button
            onClick={() => window.open(window.location.href, "_blank", "noopener")}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300"
          >
            Open in new tab to enable mic ↗
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Voice: <span className="font-medium text-foreground">{prefs.voice_id}</span> · Accent:{" "}
        {ACCENT_LABEL[prefs.voice_accent] ?? prefs.voice_accent} · Speed {prefs.voice_speed.toFixed(2)}× · Pitch{" "}
        {prefs.voice_pitch}
        {prefs.voice_muted ? " · muted" : ""}
        {" · "}
        <a href="/account" className="underline hover:text-foreground">
          Change in Account
        </a>
      </p>

      {/* Diagnostics */}
      <div className="mt-4 rounded-md border border-border bg-background/40 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pipeline diagnostics
        </div>
        <StageRow label="Microphone permission" stage={diag.mic} />
        <StageRow label="Recording" stage={diag.record} />
        <StageRow
          label="Speech-to-text"
          stage={diag.stt}
          hint={
            diag.transcript ? `"${diag.transcript.slice(0, 60)}${diag.transcript.length > 60 ? "…" : ""}"` : undefined
          }
        />
        <StageRow
          label="Nyrava Intelligence response"
          stage={diag.ai}
          hint={diag.reply ? `${diag.reply.slice(0, 60)}${diag.reply.length > 60 ? "…" : ""}` : undefined}
        />
        <StageRow label="Text-to-speech" stage={diag.tts} />
        <StageRow label="Playback" stage={diag.play} />
        {diag.error && <div className="mt-2 rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-300">{diag.error}</div>}
      </div>

      {diag.transcript && (
        <div className="mt-3 rounded-md border border-border bg-background/40 p-3 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">You said</div>
          <p className="mt-1 whitespace-pre-wrap">{diag.transcript}</p>
        </div>
      )}
      {diag.reply && (
        <div className="mt-2 rounded-md border border-border bg-background/40 p-3 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kay</div>
          <p className="mt-1 whitespace-pre-wrap">{diag.reply}</p>
        </div>
      )}
    </div>
  );
}

export default VoiceCompanion;
