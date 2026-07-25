// Provider-key validators. Each does a cheap, real API probe using the
// smallest supported call. Called both at add-time and by testUserAIKey.
export type ProviderName = "groq" | "openai" | "gemini" | "anthropic" | "openrouter";

async function withTimeout<T>(p: Promise<T>, ms = 12_000): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await p;
  } finally {
    clearTimeout(t);
  }
}

async function probeUrl(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body?: string }> {
  const res = await withTimeout(fetch(url, { method: "GET", headers }));
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
}

export async function validateProviderKey(
  provider: ProviderName,
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey || apiKey.trim().length < 8) return { ok: false, error: "API key is too short." };
  try {
    switch (provider) {
      case "groq": {
        const r = await probeUrl("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${apiKey}` });
        if (r.ok) return { ok: true };
        if (r.status === 401 || r.status === 403) return { ok: false, error: "Groq rejected the key (401/403)." };
        return { ok: false, error: `Groq probe failed (${r.status}).` };
      }
      case "openai": {
        const r = await probeUrl("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
        if (r.ok) return { ok: true };
        if (r.status === 401 || r.status === 403) return { ok: false, error: "OpenAI rejected the key (401/403)." };
        return { ok: false, error: `OpenAI probe failed (${r.status}).` };
      }
      case "gemini": {
        const r = await probeUrl(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {});
        if (r.ok) return { ok: true };
        if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, error: "Gemini rejected the key." };
        return { ok: false, error: `Gemini probe failed (${r.status}).` };
      }
      case "anthropic": {
        // Anthropic has no listing endpoint; do a minimal 1-token completion probe.
        const res = await withTimeout(fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-3-5-haiku-latest",
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          }),
        }));
        if (res.ok) return { ok: true };
        if (res.status === 401 || res.status === 403) return { ok: false, error: "Anthropic rejected the key." };
        // 400 with valid auth still means the key was accepted.
        if (res.status === 400) return { ok: true };
        return { ok: false, error: `Anthropic probe failed (${res.status}).` };
      }
      case "openrouter": {
        const r = await probeUrl("https://openrouter.ai/api/v1/auth/key", { Authorization: `Bearer ${apiKey}` });
        if (r.ok) return { ok: true };
        if (r.status === 401 || r.status === 403) return { ok: false, error: "OpenRouter rejected the key." };
        return { ok: false, error: `OpenRouter probe failed (${r.status}).` };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Probe failed." };
  }
  return { ok: false, error: "Unknown provider." };
}
