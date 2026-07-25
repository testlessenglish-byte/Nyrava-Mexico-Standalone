# Nyrava México — Full Feature Parity Build (Phase 1)

This package merges the complete Nyrava USA source into your Nyrava México
project (Lovable starter), so México now has the same features, routes,
components, and engines as the live USA app. Your México branding,
Supabase project keys, `.env`, `mexico-lock.ts` prompt system, and
`matters`-based routes are preserved as-is; everything USA had that México
was missing has been added on top.

## What changed
- **63 routes** (was ~24): all admin, billing, evidence, timeline, motion,
  strategy, witness, talk, alerts, ai-keys, health, security-dashboard,
  settings, account, reports, plus every marketing/legal page (about,
  privacy, terms, help center, docs, etc.) and the `/api` webhook + voice
  endpoints.
- **92 components** (was 54): every panel/dashboard from USA
  (CaseChatPanel, LitigationImpactDashboard, MotionEditor, MultiAgentPanel,
  IntelligenceProviders, LegalMemorandumPanel, etc.) copied in alongside
  your existing MX-only components (AppShell, SiteHeader,
  LanguageSwitcher, IntelligenceTab, DocumentsTab, all shadcn/ui primitives).
- **186 lib files**: full intelligence engine, canonical pipeline,
  execution framework, and test suites — same as USA, still with USA
  content, ready for the Phase 2 rewrite.
- **99 DB migrations** (92 from USA + your 7): gives you the full schema
  history to apply to your new Supabase project. Review before pushing —
  see "Data model" below.
- Docs, patches, scripts, tests, and branding assets (icons, logo) carried
  over as reference/placeholders.

## What I deliberately did NOT touch (this is Phase 2 — the engine/DB swap you asked for next)

1. **`cases` vs `matters` naming.** USA's newly-added routes/components
   (evidence.tsx, motion.tsx, timeline.tsx, witness.tsx, etc.) still use
   "case"/"cases" terminology and link to `/cases/...`. Your existing
   `matters.tsx` / `matters.$id.tsx` use "matter." Both `cases.functions.ts`
   and `matters.ts` exist in `src/lib`. **Decide and tell Lovable:**
   consolidate everything to "matters" (recommended, matches your
   existing MX pages), or keep "cases" for consistency with USA. Either
   way this needs a pass through the ~29 newly-added route files.

2. **`mexico-lock.ts` wiring.** Your Spanish/Mexican-law prompt lock is
   built and correct, but it's only wired into whichever engine files
   Lovable had already touched. The freshly-copied engine files
   (`report-augment.server.ts`, `chat.server.ts`, `litigation.server.ts`,
   `motion-draft.server.ts`, and others) don't import it yet — every AI
   call needs `mexicoLock()` injected into its system prompt or it'll
   reason like a US lawyer.

3. **`jurisdictions.ts` and `case-law.server.ts` are still 100% U.S.**
   — a 50-state dropdown mapped to CourtListener (a U.S.-only case-law
   API). This is the biggest real piece of Phase 2 work: swap in Mexican
   states/circuits and a Mexican source strategy (SCJN/DOF-based lookup
   or attorney-curated citations — there's no Mexican equivalent of
   CourtListener's public API).

4. **~50 other files in `src/lib/intelligence/`** still contain U.S.
   procedural terms/logic (motions, discovery, claim classes, litigation
   impact scoring built for common-law procedure). These need rewriting
   for Mexican civil-law procedure (amparo stages, juicio oral, CNPP,
   etc.) — have your attorney review each engine's output as you convert
   it, per your earlier answer.

5. **`.env`**: USA's `COURTLISTENER_API_TOKEN` was intentionally not
   carried over — you'll need a different token/service once the
   case-law engine is rebuilt.

## Data model
The 99 migrations are just copied in, not applied. Before running them
against your new Supabase project, check for USA-specific enums/tables
(jurisdiction lists, case-type taxonomies) that will need Mexican
equivalents — don't blindly `db push` without a review pass.

## Suggested order for Phase 2
1. Resolve cases/matters naming (mechanical, do first — unblocks everything else).
2. Wire `mexicoLock()` into every AI-calling engine file.
3. Rebuild `jurisdictions.ts` + `case-law.server.ts` for Mexico.
4. Work through the remaining `src/lib/intelligence/*` files with attorney review, engine by engine.
