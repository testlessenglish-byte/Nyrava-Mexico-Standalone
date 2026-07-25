// Account Administration Panel — every signed-in user.
// Profile · Email · Password · Voice · Notifications · AI Companion · Activity
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getAccount, updateProfile, updateVoicePrefs, updateNotificationPrefs,
  updateAIPrefs, changePassword, changeEmail, getRecentActivity,
} from "@/lib/account.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  User, Mail, Lock, Mic, Bell, Bot, History, Save, Loader2, Volume2, PlayCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [{ title: "Account — Nyrava" }] }),
  component: AccountPage,
});

const VOICES: { id: string; label: string; accent: string; gender: "F" | "M" }[] = [
  { id: "nova",    label: "Nova",    accent: "American · Professional", gender: "F" },
  { id: "shimmer", label: "Shimmer", accent: "American · Warm",         gender: "F" },
  { id: "alloy",   label: "Alloy",   accent: "Neutral · Balanced",      gender: "F" },
  { id: "coral",   label: "Coral",   accent: "American · Bright",       gender: "F" },
  { id: "sage",    label: "Sage",    accent: "American · Calm",         gender: "F" },
  { id: "fable",   label: "Fable",   accent: "British · Refined",       gender: "F" },
  { id: "onyx",    label: "Onyx",    accent: "American · Deep",         gender: "M" },
  { id: "echo",    label: "Echo",    accent: "American · Clear",        gender: "M" },
  { id: "ash",     label: "Ash",     accent: "American · Authoritative",gender: "M" },
  { id: "ballad",  label: "Ballad",  accent: "British · Storyteller",   gender: "M" },
  { id: "verse",   label: "Verse",   accent: "Neutral · Expressive",    gender: "M" },
];

const ACCENTS: { id: string; label: string }[] = [
  { id: "us",    label: "American English" },
  { id: "uk",    label: "British English" },
  { id: "au",    label: "Australian English" },
  { id: "ca",    label: "Canadian English" },
  { id: "es-mx", label: "Mexican Spanish" },
  { id: "es-es", label: "Spain Spanish" },
  { id: "neutral", label: "Neutral / Auto" },
];

function AccountPage() {
  const getAcc = useServerFn(getAccount);
  const getAct = useServerFn(getRecentActivity);
  const accQ = useQuery({ queryKey: ["account"], queryFn: () => getAcc() });
  const actQ = useQuery({ queryKey: ["account-activity"], queryFn: () => getAct() });

  if (accQ.isLoading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading account…</div>;
  }
  if (accQ.error || !accQ.data) {
    return <div className="p-10 text-center text-sm text-destructive">Failed to load account.</div>;
  }

  const acc = accQ.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Account</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage your profile, security, voice, notifications, and Nyrava Intelligence Companion preferences.
        </p>
        {acc.roles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {acc.roles.map((r: string) => (
              <span key={r} className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200">{r}</span>
            ))}
          </div>
        )}
      </header>

      <ProfileCard acc={acc} onSaved={() => accQ.refetch()} />
      <SecurityCard email={acc.email ?? ""} />
      <VoiceCard settings={acc.settings} onSaved={() => accQ.refetch()} />
      <NotificationCard settings={acc.settings} onSaved={() => accQ.refetch()} />
      <AICompanionCard settings={acc.settings} onSaved={() => accQ.refetch()} />
      <ActivityCard data={actQ.data} loading={actQ.isLoading} />
    </div>
  );
}

// ============================================================ Profile

function ProfileCard({ acc, onSaved }: { acc: { profile: { full_name?: string | null; avatar_url?: string | null } | null; settings: Record<string, unknown> | null }; onSaved: () => void }) {
  const update = useServerFn(updateProfile);
  const s = (acc.settings ?? {}) as Record<string, string | null>;
  const [form, setForm] = useState({
    full_name: acc.profile?.full_name ?? "",
    display_name: s.display_name ?? "",
    phone: s.phone ?? "",
    firm_name: s.firm_name ?? "",
    title: s.title ?? "",
    avatar_url: s.avatar_url ?? acc.profile?.avatar_url ?? "",
  });
  const m = useMutation({
    mutationFn: () => update({ data: form }),
    onSuccess: () => { toast.success("Profile saved"); onSaved(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Card icon={<User className="h-4 w-4" />} title="Profile">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Full name"    value={form.full_name}    onChange={(v) => setForm({ ...form, full_name: v })} />
        <Field label="Display name" value={form.display_name} onChange={(v) => setForm({ ...form, display_name: v })} />
        <Field label="Phone"        value={form.phone}        onChange={(v) => setForm({ ...form, phone: v })} />
        <Field label="Firm"         value={form.firm_name}    onChange={(v) => setForm({ ...form, firm_name: v })} />
        <Field label="Title"        value={form.title}        onChange={(v) => setForm({ ...form, title: v })} />
        <Field label="Avatar URL"   value={form.avatar_url}   onChange={(v) => setForm({ ...form, avatar_url: v })} />
      </div>
      <SaveButton pending={m.isPending} onClick={() => m.mutate()} />
    </Card>
  );
}

// ============================================================ Security

function SecurityCard({ email }: { email: string }) {
  const setEmailFn = useServerFn(changeEmail);
  const setPwdFn = useServerFn(changePassword);
  const [newEmail, setNewEmail] = useState(email);
  const [newPwd, setNewPwd] = useState("");
  const emailM = useMutation({
    mutationFn: () => setEmailFn({ data: { newEmail } }),
    onSuccess: (r: { message?: string }) => toast.success(r.message ?? "Email update requested"),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Email update failed"),
  });
  const pwdM = useMutation({
    mutationFn: () => setPwdFn({ data: { newPassword: newPwd } }),
    onSuccess: () => { toast.success("Password changed"); setNewPwd(""); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Password update failed"),
  });
  return (
    <Card icon={<Lock className="h-4 w-4" />} title="Security">
      <div className="space-y-4">
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-300"><Mail className="h-3 w-3" /> Email</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
            <button onClick={() => emailM.mutate()} disabled={emailM.isPending || !newEmail || newEmail === email}
              className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50">
              {emailM.isPending ? "Sending…" : "Update email"}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">You'll receive a confirmation link at the new address.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300">New password</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="At least 8 characters"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
            <button onClick={() => pwdM.mutate()} disabled={pwdM.isPending || newPwd.length < 8}
              className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50">
              {pwdM.isPending ? "Saving…" : "Change password"}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ============================================================ Voice

function VoiceCard({ settings, onSaved }: { settings: Record<string, unknown> | null; onSaved: () => void }) {
  const update = useServerFn(updateVoicePrefs);
  const s = (settings ?? {}) as {
    voice_id?: string; voice_speed?: number; voice_muted?: boolean; voice_autoplay?: boolean;
    voice_continuous?: boolean; voice_pitch?: string; voice_accent?: string; voice_gender?: string;
  };
  const [voiceId, setVoiceId] = useState(s.voice_id ?? "alloy");
  const [speed, setSpeed]     = useState(Number(s.voice_speed ?? 1));
  const [muted, setMuted]     = useState(!!s.voice_muted);
  const [autoplay, setAuto]   = useState(s.voice_autoplay !== false);
  const [continuous, setCont] = useState(!!s.voice_continuous);
  const [pitch, setPitch]     = useState<"low" | "medium" | "high">((s.voice_pitch as "low" | "medium" | "high") ?? "medium");
  const [accent, setAccent]   = useState(s.voice_accent ?? "us");
  const [genderFilter, setGenderFilter] = useState<"all" | "F" | "M">((s.voice_gender === "male" ? "M" : s.voice_gender === "female" ? "F" : "all"));
  const [previewing, setPreview] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () => update({ data: {
      voice_id: voiceId, voice_speed: speed, voice_muted: muted, voice_autoplay: autoplay,
      voice_continuous: continuous, voice_pitch: pitch,
      voice_accent: accent as "us" | "uk" | "au" | "ca" | "es-mx" | "es-es" | "neutral",
      voice_gender: genderFilter === "M" ? "male" : genderFilter === "F" ? "female" : undefined,
    } }),
    onSuccess: () => { toast.success("Voice preferences saved"); onSaved(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  function instructionsFor(): string {
    const accentLabel = ACCENTS.find((a) => a.id === accent)?.label ?? "American English";
    const pitchPhrase = pitch === "low" ? "with a lower pitch" : pitch === "high" ? "with a higher pitch" : "with a natural pitch";
    return `Speak in ${accentLabel} ${pitchPhrase}, warm, clear, and professional.`;
  }

  async function previewVoice(id: string) {
    setPreview(id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      if (!authToken) throw new Error("Sign in required");
      const res = await fetch("/api/voice/speak", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          text: "This is Nyrava — your evidence-grounded legal intelligence companion.",
          voice: id, speed, instructions: instructionsFor(),
        }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Preview failed"));
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); await a.play();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreview(null);
    }
  }

  const filteredVoices = VOICES.filter((v) => genderFilter === "all" || v.gender === genderFilter);

  return (
    <Card icon={<Mic className="h-4 w-4" />} title="Voice Companion">
      <p className="mb-3 text-xs text-slate-400">Choose how Nyrava sounds and how it converses with you. Preferences sync across web and mobile.</p>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Voice gender" value={genderFilter} onChange={(v) => setGenderFilter(v as typeof genderFilter)}
          options={[
            { value: "all", label: "All voices" },
            { value: "F",   label: "Female voices" },
            { value: "M",   label: "Male voices" },
          ]} />
        <Select label="Accent / Language" value={accent} onChange={setAccent}
          options={ACCENTS.map((a) => ({ value: a.id, label: a.label }))} />
        <Select label="Pitch" value={pitch} onChange={(v) => setPitch(v as typeof pitch)}
          options={[
            { value: "low",    label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high",   label: "High" },
          ]} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {filteredVoices.map((v) => (
          <label key={v.id}
            className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-3 transition ${
              voiceId === v.id ? "border-cyan-400/60 bg-cyan-400/10" : "border-slate-700 bg-slate-900 hover:border-slate-600"
            }`}>
            <div className="flex items-center gap-2">
              <input type="radio" name="voice" checked={voiceId === v.id} onChange={() => setVoiceId(v.id)} className="accent-cyan-400" />
              <div>
                <div className="text-sm font-medium text-white">{v.label} <span className="ml-1 text-[10px] text-slate-400">({v.gender === "F" ? "Female" : "Male"})</span></div>
                <div className="text-[11px] text-slate-400">{v.accent}</div>
              </div>
            </div>
            <button onClick={(e) => { e.preventDefault(); previewVoice(v.id); }} disabled={previewing === v.id}
              className="flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50">
              {previewing === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />} Preview
            </button>
          </label>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-300">Speaking speed: {speed.toFixed(2)}×</label>
          <input type="range" min={0.5} max={1.5} step={0.05} value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="mt-1 w-full accent-cyan-400" />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500"><span>Slow</span><span>Normal</span><span>Fast</span></div>
        </div>
        <div className="space-y-2">
          <Toggle label="Auto-speak responses"        checked={autoplay}   onChange={setAuto} />
          <Toggle label="Continuous conversation mode" checked={continuous} onChange={setCont} />
          <Toggle label="Mute voice (text-only)"       checked={muted}      onChange={setMuted} icon={<Volume2 className="h-3 w-3" />} />
        </div>
      </div>
      <SaveButton pending={m.isPending} onClick={() => m.mutate()} />
    </Card>
  );
}

// ============================================================ Notifications

function NotificationCard({ settings, onSaved }: { settings: Record<string, unknown> | null; onSaved: () => void }) {
  const update = useServerFn(updateNotificationPrefs);
  const s = (settings ?? {}) as Record<string, boolean | undefined>;
  const [form, setForm] = useState({
    notify_email: s.notify_email !== false,
    notify_pipeline_complete: s.notify_pipeline_complete !== false,
    notify_pipeline_failed: s.notify_pipeline_failed !== false,
    notify_new_evidence: !!s.notify_new_evidence,
  });
  const m = useMutation({
    mutationFn: () => update({ data: form }),
    onSuccess: () => { toast.success("Notifications saved"); onSaved(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Card icon={<Bell className="h-4 w-4" />} title="Notifications">
      <div className="space-y-2">
        <Toggle label="Email notifications"             checked={form.notify_email}              onChange={(v) => setForm({ ...form, notify_email: v })} />
        <Toggle label="Pipeline completed"              checked={form.notify_pipeline_complete}  onChange={(v) => setForm({ ...form, notify_pipeline_complete: v })} />
        <Toggle label="Pipeline failed"                 checked={form.notify_pipeline_failed}    onChange={(v) => setForm({ ...form, notify_pipeline_failed: v })} />
        <Toggle label="New evidence uploaded to a case" checked={form.notify_new_evidence}       onChange={(v) => setForm({ ...form, notify_new_evidence: v })} />
      </div>
      <SaveButton pending={m.isPending} onClick={() => m.mutate()} />
    </Card>
  );
}

// ============================================================ AI Companion

function AICompanionCard({ settings, onSaved }: { settings: Record<string, unknown> | null; onSaved: () => void }) {
  const update = useServerFn(updateAIPrefs);
  const s = (settings ?? {}) as { ai_default_mode?: string; ai_response_style?: string; ai_max_response_chars?: number };
  const [mode, setMode] = useState((s.ai_default_mode as "evidence_grounded" | "exploratory" | "strategic") ?? "evidence_grounded");
  const [style, setStyle] = useState((s.ai_response_style as "professional" | "conversational" | "concise") ?? "professional");
  const [maxChars, setMaxChars] = useState(Number(s.ai_max_response_chars ?? 1500));
  const m = useMutation({
    mutationFn: () => update({ data: { ai_default_mode: mode, ai_response_style: style, ai_max_response_chars: maxChars } }),
    onSuccess: () => { toast.success("Nyrava Intelligence Companion saved"); onSaved(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Card icon={<Bot className="h-4 w-4" />} title="Nyrava Intelligence Companion">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select label="Default mode" value={mode} onChange={(v) => setMode(v as typeof mode)}
          options={[
            { value: "evidence_grounded", label: "Evidence-grounded (default)" },
            { value: "exploratory",       label: "Exploratory" },
            { value: "strategic",         label: "Strategic" },
          ]} />
        <Select label="Response style" value={style} onChange={(v) => setStyle(v as typeof style)}
          options={[
            { value: "professional",   label: "Professional" },
            { value: "conversational", label: "Conversational" },
            { value: "concise",        label: "Concise" },
          ]} />
        <div>
          <label className="block text-xs font-medium text-slate-300">Max response length: {maxChars} chars</label>
          <input type="range" min={200} max={4000} step={100} value={maxChars}
            onChange={(e) => setMaxChars(parseInt(e.target.value))}
            className="mt-1 w-full accent-cyan-400" />
        </div>
      </div>
      <SaveButton pending={m.isPending} onClick={() => m.mutate()} />
    </Card>
  );
}

// ============================================================ Activity

function ActivityCard({ data, loading }: {
  data: { cases: Array<{ id: string; name: string; status: string; created_at: string }>;
          runs: Array<{ id: string; engine: string; status: string; started_at: string | null; case_id: string }>;
          chats: Array<{ id: string; role: string; created_at: string; case_id: string }>; } | undefined;
  loading: boolean;
}) {
  return (
    <Card icon={<History className="h-4 w-4" />} title="Recent activity">
      {loading
        ? <p className="text-xs text-slate-400">Loading…</p>
        : !data
          ? <p className="text-xs text-slate-400">No activity yet.</p>
          : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ActivityCol title="Cases">
                {data.cases.length === 0 ? <Empty/> : data.cases.map((c) => (
                  <li key={c.id} className="truncate text-xs"><span className="text-white">{c.name}</span> <span className="text-slate-500">· {c.status}</span></li>
                ))}
              </ActivityCol>
              <ActivityCol title="Engine runs">
                {data.runs.length === 0 ? <Empty/> : data.runs.map((r) => (
                  <li key={r.id} className="truncate text-xs"><span className="font-mono text-slate-200">{r.engine}</span> <span className="text-slate-500">· {r.status}</span></li>
                ))}
              </ActivityCol>
              <ActivityCol title="Chat messages">
                {data.chats.length === 0 ? <Empty/> : data.chats.map((c) => (
                  <li key={c.id} className="truncate text-xs"><span className="text-slate-300">{c.role}</span> <span className="text-slate-500">· {new Date(c.created_at).toLocaleString()}</span></li>
                ))}
              </ActivityCol>
            </div>
          )}
    </Card>
  );
}
function ActivityCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}
function Empty() { return <li className="text-xs text-slate-500">No items.</li>; }

// ============================================================ Primitives

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-300">{label}</span>
      <input type="text" value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60" />
    </label>
  );
}
function Toggle({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200">
      <span className="flex items-center gap-2">{icon}{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
    </label>
  );
}
function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-300">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
function SaveButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <div className="mt-4 flex justify-end">
      <button onClick={onClick} disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/40 bg-cyan-400/15 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/25 disabled:opacity-50">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save changes
      </button>
    </div>
  );
}

// Silence unused warning for useEffect import (kept for future side-effects)
void useEffect;
