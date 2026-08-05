// Engine identity standardization — regression guard.
//
// A stage has TWO identifiers that are NOT interchangeable:
//   stage key  (UI / dependency graph)  e.g. "witness", "report"
//   engine id  (pipeline_engine_runs)   e.g. "witness_intelligence", "report_generator"
//
// `src/lib/execution/canonical.ts` is the single source of truth for both and
// for the mapping between them. These tests fail if any module reintroduces a
// duplicate mapping, a duplicate stage list, or a raw engine string literal in
// execution code.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICAL_STAGES,
  CANONICAL_ENGINES,
  ENGINE,
  ENGINE_ORDER,
  STAGE_KEYS,
  engineForStage,
  stageKeyForEngine,
  requireEngineForStage,
  isCanonicalEngine,
} from "../canonical";
import { PIPELINE_STAGES } from "@/lib/cases.functions";
import { UNIVERSAL_ENGINES } from "@/lib/intelligence/practice-areas";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).filter((f) => !f.endsWith(join("execution", "canonical.ts")));

describe("engine identity — single source of truth", () => {
  it("every stage maps to exactly one engine and back", () => {
    expect(new Set(STAGE_KEYS).size).toBe(CANONICAL_STAGES.length);
    expect(new Set(ENGINE_ORDER).size).toBe(CANONICAL_STAGES.length);
    for (const s of CANONICAL_STAGES) {
      expect(engineForStage(s.key)).toBe(s.engine);
      expect(stageKeyForEngine(s.engine)).toBe(s.key);
      expect(requireEngineForStage(s.key)).toBe(s.engine);
      expect(isCanonicalEngine(s.engine)).toBe(true);
      expect(ENGINE[s.key as keyof typeof ENGINE]).toBe(s.engine);
    }
  });

  it("requireEngineForStage throws on an unknown stage key (no silent pass-through)", () => {
    expect(() => requireEngineForStage("witness_intel")).toThrow(/Unknown canonical stage key/);
  });

  it("a stage key that differs from its engine id is NOT itself a canonical engine", () => {
    // Guards the classic bug: writing a ledger row keyed by "witness" or
    // "report" instead of "witness_intelligence" / "report_generator".
    for (const s of CANONICAL_STAGES) {
      if (s.key === s.engine) continue;
      expect(CANONICAL_ENGINES.has(s.key)).toBe(false);
    }
  });

  it("PIPELINE_STAGES is derived from CANONICAL_STAGES, not re-declared", () => {
    expect(PIPELINE_STAGES.map((s) => s.key)).toEqual(CANONICAL_STAGES.map((s) => s.key));
    expect(PIPELINE_STAGES.map((s) => s.label)).toEqual(CANONICAL_STAGES.map((s) => s.label));
  });

  it("the case-type manifest universe uses engine ids, never stage keys", () => {
    for (const s of CANONICAL_STAGES) {
      if (s.key === s.engine) continue;
      expect(UNIVERSAL_ENGINES.has(s.key), `manifest must not use stage key "${s.key}"`).toBe(false);
    }
  });

  it("no module outside canonical.ts re-declares a stage→engine mapping", () => {
    const offenders = FILES.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /PIPELINE_STAGE_TO_ENGINE\s*[:=]\s*\{/.test(src) || /const\s+CANONICAL_STAGES\s*=/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("execution code writes ledger rows via ENGINE.*, never a raw engine string literal", () => {
    const literal = new RegExp(`engine:\\s*"(${ENGINE_ORDER.join("|")})"`);
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        if (literal.test(line)) offenders.push(`${f.replace(SRC, "src")}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only one exported symbol named stageKeyForEngine exists (loose display resolver is renamed)", () => {
    const offenders = FILES.filter((f) => /export function stageKeyForEngine\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
