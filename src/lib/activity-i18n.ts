/**
 * Localization layer for the live activity feed (pipeline_events).
 *
 * Event rows are written server-side in English ("Report Generator completed",
 * "Attack Surface skipped"). Rather than rewriting historical rows or coupling
 * the worker to a locale, we translate them at render time: the stage name
 * resolves through the canonical MX stage labels and the trailing verb through
 * `pipeline.event.*` keys.
 *
 * Anything we can't confidently parse is returned untouched, so a new
 * server-side message never renders as a broken key.
 */
import { engineLabelKey, resolveStageKeyLoose, stageLabelKey } from "@/lib/execution/mx-pipeline";

type T = (key: string, params?: Record<string, string | number>) => string;

/** English display names the worker emits → canonical stage keys. */
const NAME_TO_STAGE: Record<string, string> = {
  "extraction": "extraction",
  "document extraction": "extraction",
  "ocr": "extraction",
  "analyzers": "analyzers",
  "legal analyzers": "analyzers",
  "contradictions": "contradictions",
  "contradiction analysis": "contradictions",
  "timeline": "timeline",
  "timeline intelligence": "timeline",
  "witness": "witness",
  "witness intelligence": "witness",
  "evidence intelligence": "evidence_intel",
  "evidence intel": "evidence_intel",
  "evidence map": "evidence_map",
  "evidence mapping": "evidence_map",
  "discovery": "discovery",
  "discovery gaps": "discovery",
  "discovery gap detection": "discovery",
  "constitutional": "constitutional",
  "constitutional compliance": "constitutional",
  "constitutional analysis": "constitutional",
  "perspectives": "perspectives",
  "multi-perspective analysis": "perspectives",
  "multi perspective analysis": "perspectives",
  "theories": "theories",
  "theory": "theories",
  "case theory": "theories",
  "opportunity": "opportunities",
  "opportunities": "opportunities",
  "strategic opportunities": "opportunities",
  "strategy": "strategy",
  "strategy synthesis": "strategy",
  "litigation strategy center": "litigation_strategy_center",
  "trial prep": "trial_prep",
  "trial prep & jury simulation": "trial_prep",
  "work product": "work_product",
  "attorney work product": "work_product",
  "scoring": "scoring",
  "score case": "scoring",
  "hallucination": "hallucination",
  "hallucination review": "hallucination",
  "agents": "agents",
  "verification agents": "agents",
  "multi agent": "multi_agent",
  "multi-agent": "multi_agent",
  "report": "report",
  "report generator": "report",
  "generate report": "report",
};

/**
 * Names the worker emits that have no canonical stage row (they belong to
 * sub-steps or UI-only surfaces). Mapped straight to a display key.
 */
const NAME_TO_KEY: Record<string, string> = {
  "attack surface": "caseTab.attack",
  "attack surface analysis": "caseTab.attack",
  "motion center": "nav.motionIntelligence",
  "motion intelligence": "nav.motionIntelligence",
  "scorecard": "caseTab.scorecard",
  "evidence explorer": "nav.evidenceExplorer",
};

/** Verb suffixes, longest-first so "checkpointed — will resume…" wins. */
const VERBS: Array<{ re: RegExp; key: string }> = [
  { re: /\s+checkpointed\s+—\s+will resume on next worker tick\.?$/i, key: "pipeline.event.checkpointedResume" },
  { re: /\s+checkpointed\.?$/i, key: "pipeline.event.checkpointed" },
  { re: /\s+completed\.?$/i, key: "pipeline.event.completed" },
  { re: /\s+complete\.?$/i, key: "pipeline.event.complete" },
  { re: /\s+started\.?$/i, key: "pipeline.event.started" },
  { re: /\s+skipped\.?$/i, key: "pipeline.event.skipped" },
  { re: /\s+blocked\.?$/i, key: "pipeline.event.blocked" },
  { re: /\s+failed\.?$/i, key: "pipeline.event.failed" },
  { re: /\s+queued\.?$/i, key: "pipeline.event.queued" },
  { re: /\s+running\.?$/i, key: "pipeline.event.running" },
];

function resolveStageLabel(
  rawName: string,
  stage: string | null | undefined,
  caseType: string | null | undefined,
  t: T,
): string | null {
  // Strip the agent-count parenthetical: "Multi-Agent Review (13 Agents)".
  const cleaned = rawName
    .replace(/\s*\(\d+\s+agents?\)\s*$/i, "")
    .replace(/\s+review$/i, "")
    .trim();
  const direct = NAME_TO_KEY[cleaned.toLowerCase()] ?? NAME_TO_KEY[rawName.trim().toLowerCase()];
  if (direct) return t(direct);
  const stageKey =
    NAME_TO_STAGE[cleaned.toLowerCase()] ??
    NAME_TO_STAGE[rawName.trim().toLowerCase()] ??
    (stage ? resolveStageKeyLoose(stage) : null);
  if (!stageKey) return null;
  return t(stageLabelKey(stageKey, caseType));
}

/**
 * Translate one activity-feed row. Returns the original message when the
 * shape isn't recognized.
 */
export function localizeActivityMessage(
  message: string,
  stage: string | null | undefined,
  caseType: string | null | undefined,
  t: T,
  locale: string,
): string {
  if (!message) return message;
  if (locale === "en") return message;

  // "Blocked: upstream stage(s) failed — report"
  const blocked = message.match(/^Blocked:\s*upstream stage\(s\) failed\s*—\s*(.+)$/i);
  if (blocked) {
    const label = resolveStageLabel(blocked[1], blocked[1], caseType, t) ?? blocked[1];
    return t("pipeline.event.blockedUpstream", { stage: label });
  }

  for (const v of VERBS) {
    const m = message.match(v.re);
    if (!m) continue;
    const name = message.slice(0, m.index).trim();
    const label = resolveStageLabel(name, stage, caseType, t);
    if (!label) continue;
    return `${label} ${t(v.key)}`;
  }

  // Bare stage name with no verb (rare) — still localize the label.
  const bare = resolveStageLabel(message, stage, caseType, t);
  if (bare && bare.toLowerCase() !== message.toLowerCase()) return bare;

  return message;
}

/** Localize an engine/stage identifier for compact status chips. */
export function localizeStageName(
  stage: string,
  caseType: string | null | undefined,
  t: T,
): string {
  const key = engineLabelKey(stage, caseType);
  return key ? t(key) : stage;
}
