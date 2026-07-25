# Nyrava Frozen Contracts — v1.0.1-STABLE

Any change to the items below requires a new minor version tag and an update
to this document.

## Pipeline Order

The 19-stage pipeline defined in `docs/BASELINE.md` section 1 is frozen.
Stages may not be reordered, renamed, or removed without a minor version bump.

## Engine Registry

Canonical engine ids listed in `docs/ARCHITECTURE.md` section 2 are frozen.
No alternate spellings.

## Evidence Schema

The `evidence` table schema, including the unique constraint on `hash` and
the `ON CONFLICT DO NOTHING` idempotency guarantee, is frozen.

## Report Versions

`report_versions` is append-only. The `REVOKE UPDATE/DELETE` policy is
frozen. `report_hash` computation (sha256 of canonical JSON via
`sha256Hex`) is frozen.

## Timeline Semantics

`case_timeline_events` uses supersede-not-delete semantics. Active events
are always `WHERE superseded_by IS NULL`. This contract is frozen.

## Provenance Requirement

Every finding must carry document, page, quote, and confidence. Findings
without all four are suppressed by `addGatedFindings`. This is frozen.

## Citation Integrity Gate

A report with `quality_blocked = true` must never produce a downloadable
PDF or DOCX. This is frozen.

## Report Engine v1.0 Structure

The Nyrava Legal Intelligence Report Engine is locked at v1.0. The canonical
report is composed of exactly 17 sections in a fixed order, defined in
`src/lib/canonical/sections.lock.ts`:

`Metadata`, `ExecutiveSummary`, `Facts`, `Timeline`, `Evidence`, `Findings`,
`Witnesses`, `Contradictions`, `Discovery`, `Risks`, `Scores`,
`Recommendations`, `Strategy`, `CrossExam`, `Impeachment`, `WorkProduct`,
`Appendices`.

Sections may not be added, removed, renamed, or reordered. Scoring formulas
and output prompts may only change to fix verified bugs, factual errors,
legal analysis errors, broken citations, or formatting bugs. Any new section
requires a documented business justification and a new Report Engine minor
version. See `docs/RELEASE-REPORT-ENGINE-v1.0.md`.
