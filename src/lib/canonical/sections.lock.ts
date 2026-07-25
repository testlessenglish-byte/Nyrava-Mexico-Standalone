// Report Engine v1.0 — Section lock.
//
// This module is the programmatic counterpart to docs/FREEZE.md and the
// Nyrava Legal Intelligence Report Engine v1.0 release. The 17 canonical
// sections are immutable. Any attempt to add, remove, rename, or reorder
// them at runtime is a breaking change and must fail validation.
//
// New sections require a documented business justification, product approval,
// and a new report-engine minor version.

export const REPORT_ENGINE_VERSION = "1.0.0";

// The canonical sections as released in Report Engine v1.0. Order is part of
// the contract; sections are rendered in this order in the PDF and the UI.
export const LOCKED_CANONICAL_SECTIONS = [
  "Metadata",
  "ExecutiveSummary",
  "Facts",
  "Timeline",
  "Evidence",
  "Findings",
  "Witnesses",
  "Contradictions",
  "Discovery",
  "Risks",
  "Scores",
  "Recommendations",
  "Strategy",
  "CrossExam",
  "Impeachment",
  "WorkProduct",
  "Appendices",
] as const;

export type LockedCanonicalSection = (typeof LOCKED_CANONICAL_SECTIONS)[number];

// Runtime guard: throws if the running binary's section list deviates from
// the locked contract. Called during build-time tests and by strict
// validators.
export function assertSectionsLocked(sections: string[]): void {
  const expected = LOCKED_CANONICAL_SECTIONS.join("|");
  const actual = sections.join("|");
  if (expected !== actual) {
    throw new Error(
      `Report Engine v${REPORT_ENGINE_VERSION} section lock violation: expected [${expected}], got [${actual}]. ` +
        `New sections require documented business justification and a version bump.`,
    );
  }
}

// Section guard: returns a validation-friendly list of violations for extra
// sections that are not part of the locked v1.0 contract.
export function getLockedSectionViolations(
  actualSections: string[],
): Array<{ section: string; message: string }> {
  const locked = new Set<string>(LOCKED_CANONICAL_SECTIONS);
  const violations: Array<{ section: string; message: string }> = [];
  for (const section of actualSections) {
    if (section === "_canonical") continue; // marker field, not a section
    if (!locked.has(section)) {
      violations.push({
        section,
        message: `Section "${section}" is not part of Report Engine v${REPORT_ENGINE_VERSION}. ` +
          `New sections require a version bump and documented business justification.`,
      });
    }
  }
  return violations;
}
