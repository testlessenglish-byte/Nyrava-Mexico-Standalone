// Property Intelligence Summary — the two-second read at the top of a
// property file. Built from the same deterministic state the checklist and
// the assistant use, so the three panels can never contradict each other.

import type { ClosingProgress } from "./closing-checklist";
import { detectionMap } from "./document-detection";
import type { PropertyFileState } from "./closing-checklist";

export type SummaryLine = {
  id: string;
  tone: "ok" | "missing";
  /** i18n key `re.sum.<id>` */
  messageKey: string;
  values?: Record<string, string>;
};

export function buildPropertySummary(
  state: PropertyFileState,
  progress: ClosingProgress,
): SummaryLine[] {
  const { property, detected } = state;
  const docs = detectionMap(detected);
  const rows = new Map(progress.rows.map((r) => [r.key, r]));
  const ok = (k: Parameters<typeof rows.get>[0]) => rows.get(k)?.satisfied === true;

  const lines: SummaryLine[] = [];

  lines.push(
    docs.has("deed")
      ? { id: "ownershipConsistent", tone: "ok", messageKey: "re.sum.ownershipConsistent" }
      : { id: "noDeed", tone: "missing", messageKey: "re.sum.noDeed" },
  );

  lines.push(
    ok("registry_search")
      ? { id: "registryOk", tone: "ok", messageKey: "re.sum.registryOk" }
      : { id: "noRegistry", tone: "missing", messageKey: "re.sum.noRegistry" },
  );

  lines.push(
    ok("buyer_identity") && ok("seller_identity")
      ? { id: "identityComplete", tone: "ok", messageKey: "re.sum.identityComplete" }
      : { id: "identityIncomplete", tone: "missing", messageKey: "re.sum.identityIncomplete" },
  );

  lines.push(
    ok("rfc_verification")
      ? { id: "rfcOk", tone: "ok", messageKey: "re.sum.rfcOk" }
      : { id: "rfcMissing", tone: "missing", messageKey: "re.sum.rfcMissing" },
  );

  lines.push(
    ok("predial_receipt")
      ? { id: "predialOk", tone: "ok", messageKey: "re.sum.predialOk" }
      : { id: "predialMissing", tone: "missing", messageKey: "re.sum.predialMissing" },
  );

  lines.push(
    property?.notary
      ? { id: "notaryOk", tone: "ok", messageKey: "re.sum.notaryOk", values: { notary: property.notary } }
      : { id: "notaryMissing", tone: "missing", messageKey: "re.sum.notaryMissing" },
  );

  if (property?.foreign_buyer) {
    lines.push(
      property.fideicomiso
        ? { id: "fideicomisoOk", tone: "ok", messageKey: "re.sum.fideicomisoOk" }
        : { id: "fideicomisoMissing", tone: "missing", messageKey: "re.sum.fideicomisoMissing" },
    );
  }

  return lines;
}
