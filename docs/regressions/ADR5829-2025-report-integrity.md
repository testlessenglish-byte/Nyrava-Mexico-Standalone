# ADR5829/2025 report integrity regression

This regression records four invariants reproduced in the 2026-08-19 production run and fixed by PR #172:

1. A finding whose own quoted source states that no duty of personal notice existed must not characterize the absence of personal notice as a defect, nullity, prejudice, weakness, or litigation risk.
2. PDF/DOCX chronology must prefer `full_report.canonical_timeline.events` over free-form `timeline_summary` prose when canonical events exist.
3. Public risk rendering must use the canonical deterministic risk score; `constitutional_compliance` is a compliance/strength dimension and must not be inverted into a risk score.
4. A `concluded_audit` report must not surface a recommended filing/motion card as though the concluded proceeding were still awaiting an initiating motion.

These are report-integrity invariants, not case-specific legal conclusions. The source-meaning guard applies whenever quoted evidence expressly negates the duty that generated prose attempts to turn into a defect.

## 2026-08-20 release-integrity follow-up

PR #176 added blocking semantic checks for the ADR5829/2025 holding inversion, competence/procedencia mismatch, zero-evidence theories, quote-span deduplication, and terminal release-state persistence. This follow-up records the production deployment boundary at merge commit `818416e56bf56ed46f1419e2a186f7e852ba2a25` so connected deployment systems can synchronize the repaired main branch.
