// Non-determinism instrumentation.
//
// Same fixture, same prompts, same model can still produce different findings
// counts across runs. To diagnose whether variance is (a) temperature, (b)
// batch-boundary timing, or (c) genuine model non-determinism, every engine
// call site should stamp:
//   - the actual sampling temperature it used
//   - the seed it passed (if any — Groq accepts `seed` but honors it best-effort)
//   - a stable hash of the ordered input payload (docs/prompt/schema)
//
// The hash lets us prove that two runs saw byte-identical input, so any
// output delta is model-side rather than upstream. Consumers merge the
// returned object into `EngineStats.determinism`; `runEngine()` persists it
// under `pipeline_engine_runs.meta.determinism`.
import { createHash } from "crypto";

export type DeterminismMeta = {
  temperature?: number | null;
  seed?: number | null;
  input_hash?: string | null;
};

/** SHA-256 of a JSON-stable representation of arbitrary input. */
export function hashInput(input: unknown): string {
  const canonical = stableStringify(input);
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildDeterminismMeta(args: {
  temperature?: number | null;
  seed?: number | null;
  input?: unknown;
  input_hash?: string | null;
}): DeterminismMeta {
  return {
    temperature: args.temperature ?? null,
    seed: args.seed ?? null,
    input_hash:
      args.input_hash ??
      (args.input === undefined ? null : hashInput(args.input)),
  };
}

// Deterministic JSON with sorted object keys.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
