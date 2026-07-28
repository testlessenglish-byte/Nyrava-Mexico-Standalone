
# Universal Practice Area Architecture — Phases 1–3

## Standing principle (becomes law in this codebase)

Nyrava is one Mexican legal operating system. Every capability is either **Core Platform** (present on every materia, no exceptions) or a **Practice Area Module** (declared in the centralized registry). Nothing is hard-coded to a materia in a component. Adding a future Mexican materia must mean adding one registry entry — never touching UI, engines, or the pipeline.

Scope stays Mexican: penal, civil, mercantil, familiar, laboral, administrativo, fiscal, amparo, constitucional, electoral, agrario, ambiental, inmobiliario. No foreign practice areas.

---

## Phase 1 — Make the registry the whole truth

Today `mexico-policy.ts` drives engines, findings, motions, blocked terms, report sections, and tabs. Two gaps: `MX_TABS` currently lists only *specialized* tabs per materia (e.g. penal → opportunities, perspectives, scorecard, strategy, theories, trial), and dashboard modules are hand-checked in components rather than declared.

Work:
1. Define the **Core Platform** capability set explicitly (case management, documents, AI assistant, reports, timeline, tasks, calendar, parties, communications, notes, work product, search, audit trail, version history) as `CORE_CAPABILITIES` — guaranteed for every materia, merged in `getApplicableTabs()`/`getApplicableSections()` the way `UNIVERSAL_TABS` already works.
2. Add `MX_DASHBOARD_MODULES` + `materiaDashboardModules()` to the registry, and `getApplicableDashboardModules()` in `practice-areas.ts`, mirroring the existing tabs helper exactly.
3. Declare each materia's specialized modules in one place: inmobiliario → transaction_center, closing_readiness, title_review, registry, escrow, property_intelligence; penal → evidence_management, discovery_review, witness_management, trial_prep, sentencing_analysis, motion_strategy; familiar → parenting_plan, custody_analysis, alimentos, asset_division, financial_disclosure; civil/mercantil → pleadings, discovery, expert_witnesses, trial_prep; amparo/constitucional, laboral, fiscal, administrativo, agrario, ambiental, electoral each get their Mexican equivalents.
4. Replace hard-coded materia checks in components with registry lookups (`isModuleApplicable(caseType, moduleId, activeDomains)`). Freeze `matters/*` with a header comment — not extended, not deleted.
5. Add a lint-style unit test that fails if a component references a literal materia string outside the registry files.

Regression check: one full pipeline run per materia still completes; all existing tabs still render; Workbench still opens and saves.

## Phase 2 — Parties + Transaction Center completion

- New `case_parties` table (case-scoped, RLS by owner + admin, `tg_set_updated_at`), with Mexican party roles (comprador, vendedor, cliente, notario, corredor, acreedor, registro público, municipio, ministerio público, perito, testigo, contraparte, co-abogado, otro).
- `CasePartiesPanel.tsx` as a **core** panel — available on every materia via the Parties tab — and additionally embedded inside `TransactionCenterPanel` for inmobiliario. One component, two mount points, no duplication.
- `property_records` buyer/seller strings fall back cleanly when no `case_parties` rows exist.

## Phase 3 — Core Tasks, Calendar, and Attorney Home

- New `case_tasks` and `case_events` tables, same case-scoped pattern.
- `CaseTasksTab.tsx` and `CaseCalendarTab.tsx` as core tabs on every materia; the *labels and default task templates* come from the registry (e.g. inmobiliario seeds closing checklist items, penal seeds audiencia deadlines) so the surface is universal and the content is practice-aware.
- Wire Mexican deadline logic already in `mx-deadlines.ts` into task due dates rather than a second scheduler.
- Expand Attorney Home (`dashboard.tsx`) with six real-data cards: upcoming events, deadlines (tasks due < 7 days), AI alerts (high-priority findings), recent reports, recent AI conversations, quick resume. Batched queries, real empty states, no placeholders.
- Add `cases.lifecycle_status` (attorney-facing, never written by the pipeline) with the allowed values driven by the registry per materia — inmobiliario gets closing states, litigation materias get procedural states.

## AI behavior

The AI persona, prompt preamble, terminology, and document generators resolve from the registry for the active materia — extending the existing Mexico-lock preamble rather than adding a parallel prompt system. Case-assistant context assembly gains open tasks, upcoming events, and the party roster so "¿qué falta?" is answered from stored data first.

## Technical notes

- Registry files touched: `src/lib/jurisdiction/mexico-policy.ts`, `mexico.ts`, `src/lib/intelligence/practice-areas.ts`. All additive exports; existing signatures unchanged.
- One migration per phase, each creating tables with GRANTs, RLS, policies, and updated_at triggers in that order.
- All new UI uses existing `src/components/ui/*` primitives and full es/en i18n keys — no new visual language.
- Tests: registry parity test (every materia declares every core capability), module-gating tests, and existing intelligence suites must stay green.

## Deliverables

Docs updated (`docs/ARCHITECTURE.md` gains a "Universal Practice Area Architecture" section) and the principle saved to project memory as a standing rule for every future feature.
