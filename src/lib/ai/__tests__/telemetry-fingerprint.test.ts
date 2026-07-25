import { describe, it, expect } from "vitest";
import {
  withTelemetryScope,
  addReplayHints,
  recordJsonValidation,
  recordCorpusSnapshot,
  summarizeScope,
  computePromptSha256,
  computeConfigHash,
  captureBuildFingerprint,
  sha256Hex,
} from "../telemetry.server";

describe("telemetry fingerprints (Phase 6.5)", () => {
  it("computes a deterministic prompt hash", () => {
    const a = computePromptSha256({ systemInstruction: "sys", userContent: "u", model: "m", temperature: 0.2, json: true });
    const b = computePromptSha256({ systemInstruction: "sys", userContent: "u", model: "m", temperature: 0.2, json: true });
    const c = computePromptSha256({ systemInstruction: "sys", userContent: "u", model: "m", temperature: 0.3, json: true });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it("computes a deterministic config hash", () => {
    const h1 = computeConfigHash({ provider: "groq", model: "x", temperature: 0.2, top_p: 1, max_tokens: 500 });
    const h2 = computeConfigHash({ provider: "groq", model: "x", temperature: 0.2, top_p: 1, max_tokens: 500 });
    const h3 = computeConfigHash({ provider: "groq", model: "x", temperature: 0.4, top_p: 1, max_tokens: 500 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("captures build fingerprint from env", () => {
    const prev = process.env.ENGINE_VERSION;
    process.env.ENGINE_VERSION = "9.9.9";
    const fp = captureBuildFingerprint();
    expect(fp.engine_version).toBe("9.9.9");
    if (prev == null) delete process.env.ENGINE_VERSION;
    else process.env.ENGINE_VERSION = prev;
  });

  it("aggregates replay hints, corpus, and json validation into the summary", async () => {
    const { scope } = await withTelemetryScope({ runId: "t1", replay: { engine: "theory" } }, async () => {
      addReplayHints({
        prompt_version: "theory_v3",
        prompt_sha256: sha256Hex(["p"]),
        temperature: 0.2,
        provider: "groq",
        model: "llama-x",
        evidence_ids: ["e1", "e2"],
        document_ids: ["d1"],
      });
      recordCorpusSnapshot({
        case_id: "c1",
        document_count: 1,
        evidence_count: 2,
        corpus_hash: "abc",
        captured_at: new Date().toISOString(),
      });
      recordJsonValidation({ responseValidJson: true, repairAttempts: 0, repairStrategy: "none" });
      recordJsonValidation({ responseValidJson: false, repairAttempts: 2, repairStrategy: "regex-extract-braces", repairReason: "trailing text" });
    });
    const s = summarizeScope(scope);
    expect(scope.replay.prompt_version).toBe("theory_v3");
    expect(scope.replay.evidence_ids).toEqual(["e1", "e2"]);
    expect(scope.replay.config_hash).toBeTruthy();
    expect(scope.corpus?.corpus_hash).toBe("abc");
    expect(s.responseValidJson).toBe(false);
    expect(s.repairAttempts).toBe(2);
    expect(s.repairStrategies).toContain("regex-extract-braces");
    expect(s.repairReasons).toContain("trailing text");
  });

  it("responseValidJson stays null when no validation is recorded (never inferred)", async () => {
    const { scope } = await withTelemetryScope({ runId: "t2" }, async () => { /* nothing */ });
    expect(summarizeScope(scope).responseValidJson).toBeNull();
  });
});
