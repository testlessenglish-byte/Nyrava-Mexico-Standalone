# Nyrava Production Readiness Audit

_Last updated: 2026-06-25_

## 1. Authentication & RBAC
| Area | Status | Notes |
| --- | --- | --- |
| Email/password auth | ✅ Wired | `/auth` route + Supabase |
| Google OAuth | ✅ Wired via Lovable broker | |
| Role enum | ✅ `super_admin`, `admin`, `firm_admin`, `case_manager`, `user` | migration applied |
| Helper RPCs | ✅ `has_role`, `is_super_admin`, `is_admin_tier`, `is_case_manager` | SECURITY DEFINER (required) |
| `/admin/users` UI | ✅ Toggle roles per user; last super-admin protection | super-admin gated |
| Protected layout | ✅ `_authenticated/route.tsx` (managed) | bearer auto-attached |
| Existing owner | ✅ auto-promoted to `super_admin` | one-time data migration |

## 2. Account Administration
| Area | Status |
| --- | --- |
| `/account` Profile (name, phone, firm, title, avatar) | ✅ persists in `user_settings` |
| Email change with confirmation | ✅ via `supabase.auth.updateUser` |
| Password change | ✅ via `supabase.auth.updateUser` |
| Voice profile (6 voices × accents) + preview + speed + mute | ✅ |
| Notification toggles (4) | ✅ |
| AI defaults (mode/style/max-length) | ✅ |
| Activity history | ✅ cases + engine runs + chat |

## 3. AI Companion & Voice
| Area | Status |
| --- | --- |
| Mic capture (webm/mp4 fallback) | ✅ + secure-context + permissions probe |
| Iframe detection + "Open in new tab" rescue | ✅ |
| Specific error mapping (NotAllowed/NotFound/NotReadable/SecurityError) | ✅ |
| Lovable Gateway STT (`/api/voice/transcribe`) | ✅ |
| Lovable Gateway TTS (`/api/voice/speak`) | ✅ honors saved voice + mute |
| Case-grounded answers (`askCaseAi`) | ✅ retrieves evidence, witnesses, contradictions, timeline |
| Continuous conversation loop | ✅ checkbox; auto-relisten after playback |
| Self-test (no mic required) | ✅ |
| Diagnostic stages (mic→record→stt→ai→tts→play) | ✅ |

## 4. Pipeline Orchestration
- ✅ 18-stage strict sequential pipeline (`runFullPipelineStep`).
- ✅ `pipeline_engine_runs` is the single source of truth (realtime).
- ✅ Per-stage Rerun, Out-of-Date detection on new uploads.
- ✅ Execution log drawer with duration / output / error.

## 5. Intelligence Modules
| Module | Status |
| --- | --- |
| Evidence Explorer | ✅ live |
| Timeline Builder | ✅ live |
| Witness Intelligence | ✅ live |
| Motion Center | ✅ live |
| Strategy Center | ✅ live |
| Reports | ✅ live |
| Alerts & Briefings | ✅ live |
| Command Center dashboard | ✅ live radar + nodes + metrics |
| Evidence Sufficiency (ESS) | ✅ enforced; "Insufficient evidence" notice |
| Secondary validator | ✅ traceability strips untraceable sentences |

## 6. Mobile / PWA
- ✅ Mobile hamburger drawer w/ all nav sections.
- ✅ Manifest + `N` monogram icon (512px) for installable app.
- ✅ Cases list pagination + responsive grid.
- ✅ No horizontal scroll on 360-wide viewports.

## 7. Known Gaps / Recommendations
1. **Continuous voice on iOS Safari** — autoplay restrictions still require the first response play to be user-initiated; the loop reliably continues after the first reply.
2. **Background pipeline execution** — `runFullPipelineStep` runs in the request lifetime; long pipelines benefit from moving to a queue (Supabase Edge Function + cron). Current synchronous approach works for cases ≤ ~50 documents.
3. **Per-firm tenancy** — `firm_admin` role exists but firm-scoped data partitioning is opt-in; cases are still owned by individual users. A `firm_id` column on `cases` and policy scoping is the next step.
4. **Audit log breadth** — `admin_audit_log` covers role grants; expand to cover case deletes, provider key edits, and report exports.
5. **Security definer linter warnings** — these are the documented Supabase pattern for `has_role`-style functions and are required for RLS without recursion. Safe to keep.

## 8. Removed / Hidden Placeholders
All "Coming soon" stubs replaced with functional modules (Section 5). No menu entry routes to an unimplemented page.
