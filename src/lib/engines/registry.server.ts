/**
 * Engine registry — the single source of truth for which engines exist and
 * how the runtime finds them. Add a new engine here to plug it in.
 */
import type { EngineCode, IntelligenceEngine } from "./types";
import { caseEngine } from "./case.server";
import { legalEngine } from "./legal.server";
import { evidenceEngine } from "./evidence.server";

export const ENGINES: Record<Extract<EngineCode, "case" | "legal" | "evidence">, IntelligenceEngine> = {
  case: caseEngine,
  legal: legalEngine,
  evidence: evidenceEngine,
};

export function getEngine(code: EngineCode): IntelligenceEngine {
  const e = (ENGINES as Record<string, IntelligenceEngine>)[code];
  if (!e) throw new Error(`Engine "${code}" no está registrado todavía.`);
  return e;
}

export const AVAILABLE_ENGINE_CODES: EngineCode[] = ["case", "legal", "evidence"];
