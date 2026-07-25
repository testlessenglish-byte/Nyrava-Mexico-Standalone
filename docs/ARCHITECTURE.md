# Nyrava Intelligence México — Architecture Blueprint

_Last updated: end of Phase 2 (validation & hardening)._

This document is the authoritative blueprint for the platform's foundation:
tenancy, security, matter management, documents, intelligence engines,
legal knowledge, billing, and audit.

---

## 1. Isolation & Environment

- Dedicated Lovable Cloud (Supabase) project — no shared infrastructure with any other Nyrava deployment.
- Frontend: TanStack Start (React 19, Vite 7) on Cloudflare Workers.
- All server logic lives in `createServerFn` handlers or `src/routes/api/*` route handlers. No Supabase Edge Functions.
- Secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`.

## 2. Multi-Tenant Model

```
auth.users
   │
   ├── profiles          (1:1 personal profile)
   ├── user_roles        (global app roles: super_admin, platform_admin, admin, moderator, user)
   └── org_memberships   (N:N users ↔ organizations, with role_in_org + status)
                                    │
                                    └── organizations
                                             │
                                             ├── matters
                                             │      ├── matter_parties
                                             │      ├── matter_events
                                             │      ├── matter_documents ── document_versions
                                             │      │                    └── document_processing_jobs
                                             │      ├── matter_notes
                                             │      ├── matter_tasks
                                             │      ├── matter_knowledge
                                             │      └── intelligence_runs
                                             ├── org_role_permissions   (per-org RBAC overrides)
                                             ├── org_subscriptions      (Mercado Pago)
                                             └── billing_payments
```

Every tenant-scoped table carries `org_id UUID NOT NULL REFERENCES organizations(id)`.
Isolation is enforced by RLS through two `SECURITY DEFINER` helpers:

- `is_org_member(user, org)` — active membership check.
- `can_manage_org(user, org)` / `can_contribute_org(user, org)` — role gates.

There is no application code path that can read cross-tenant rows: even the
publishable client is blocked by RLS, and the service role is only used
inside verified server-only handlers.

## 3. RBAC — Scalable Permission System

Roles are NOT hardcoded in application logic. Permissions flow:

```
User → org_membership.role_in_org → role_permissions (baseline)
                                  ↘ org_role_permissions (per-org override, can grant/revoke)
                                    → permissions (resource + action registry)
                                      → has_permission(user, org, code) → feature access
```

### Enum `org_role`

`owner`, `admin`, `lawyer`, `paralegal`, `viewer`,
`firm_administrator`, `attorney`, `associate_attorney`, `legal_assistant`,
`client`, `read_only`.

### Enum `app_role` (global)

`super_admin`, `platform_admin`, `admin`, `moderator`, `user`.

### Permission codes (initial catalog)

`matters.view|create|update|delete`, `documents.view|upload|download|delete`,
`notes.write`, `tasks.write`, `parties.write`, `events.write`,
`members.manage`, `billing.view|manage`, `intelligence.run`, `audit.view`.

Add new codes via `INSERT INTO public.permissions`. Assign to roles via
`role_permissions`. Override per organization via `org_role_permissions`
without shipping code.

### Runtime check

```sql
SELECT public.has_permission(auth.uid(), :org_id, 'documents.download');
```

Callable from server functions and RLS `USING` clauses. Internally scoped to
`auth.uid()` so users cannot probe permissions of others.

## 4. Matter Management

Central concept is **Matter**, not "case". `matter_type` enum covers:

`litigation, criminal, civil, commercial, labor, family, constitutional,
administrative, corporate, tax, immigration, contract, advisory, compliance,
transaction`.

Common fields: `title, description, client_name, jurisdiction, court,
docket_number, reference_code, matter_type, status, priority, tags[],
lead_lawyer_id, opened_at, closed_at`.

Every child table (`matter_parties`, `matter_events`, `matter_documents`,
`matter_notes`, `matter_tasks`) carries `org_id` + `matter_id` and is
independently RLS-gated.

Soft delete on every row (`deleted_at TIMESTAMPTZ NULL`); SELECT policies
filter `deleted_at IS NULL`.

## 5. Document Foundation

- **Metadata**: `matter_documents` — title, `media_kind` (pdf/docx/image/audio/video/email/spreadsheet), `mime_type`, `size_bytes`, `checksum`, `classification JSONB`, `metadata JSONB`.
- **Versioning**: `document_versions (document_id, version, storage_path, checksum, uploaded_by)` with unique `(document_id, version)`.
- **Processing state**: `processing_status` enum tracks the full pipeline `pending → uploaded → extracted → classified → analyzed | failed`.
- **Queue**: `document_processing_jobs` — durable job queue consumed by future server functions or `pg_net`-invoked handlers.

### Storage

Private bucket **`matter-documents`**. Path convention:

```
{org_id}/{matter_id}/{document_id}/v{version}/{filename}
```

Storage policies parse the first path segment as `org_id` and delegate to the
same helper functions used by table RLS.

### Pipeline (to implement in Phase 3)

```
Upload (signed URL)
   → matter_documents row (pending)
   → document_versions row
   → document_processing_jobs (stage=extract)
   → server-fn worker
   → extract text / OCR
   → stage=classify
   → stage=analyze (intelligence engine)
   → matter_knowledge rows written
```

## 6. Intelligence Engine Architecture

Not implemented yet — architecture only. Each engine is an independent module
that consumes matter context, calls a model via the Lovable AI Gateway
(default) or another provider, and writes structured output into
`matter_knowledge`.

### Registry (enum `intelligence_engine`)

`legal, case, evidence, witness, timeline, litigation, contract, research, work_product`.

### Runtime

- `intelligence_runs` — one row per invocation: input, output, model, tokens_used, cost_cents, status, timing, requester.
- `matter_knowledge` — persistent structured knowledge: kind (`fact`, `entity`, `citation`, `timeline_event`, `risk`, `summary`), confidence, source document, source run.

### Interface contract

Each engine will expose:

```ts
type EngineInput  = { orgId: string; matterId: string; scope: unknown };
type EngineOutput = { knowledge: MatterKnowledgeRow[]; artifacts?: unknown };

interface IntelligenceEngine {
  code: IntelligenceEngineCode;
  run(input: EngineInput, ctx: RunContext): Promise<EngineOutput>;
}
```

Engines communicate only through `matter_knowledge` and their own run
records; no direct cross-engine coupling.

## 7. Legal Knowledge (Mexican sources)

Shared reference corpus, readable by anyone (including anon for public
research surfaces).

- `legal_authorities` — laws, codes, articles, regulations, jurisprudence, court decisions, concepts. Full-text index on Spanish `to_tsvector` of title + body.
- `legal_citations` — citation graph between authorities.
- `legal_source_connectors` — external source registry (seeded: SCJN, DOF, TFJA). Connector implementations arrive in later phases; they'll be TanStack server routes writing into `legal_authorities` under the service role.

## 8. Billing & Entitlements (Mercado Pago-ready)

```
billing_plans (free, starter, pro, enterprise, MXN)
   ↘ plan_entitlements (plan → permission code + quota)
      ↘ org_subscriptions (org → plan, provider=mercadopago, status)
         ↘ billing_payments (payment history from webhooks)
```

Billing controls access **through permissions**, not through hardcoded module
gates. Subscription status → active entitlements → `has_permission` returns
true → feature is accessible. Downgrading a plan revokes entitlements
without any code change.

Webhook target (to build in Phase 3): `src/routes/api/public/webhooks/mercadopago.ts`.

## 9. Audit System

`audit_log` fields: `org_id, actor_id, action, entity_type, entity_id,
diff JSONB, ip_address, user_agent, session_id, created_at`.

Track (at minimum): auth events, matter create/update/delete, document
upload/view/download, permission changes, generated documents, intelligence
runs.

RLS: members can read their org's audit, and can insert rows attributed to
themselves in their org. Cross-org audit is invisible.

## 10. Performance & Scale

Indexes shipped:

- Matters: `(org_id, status)`, `(org_id, matter_type)`, `(org_id, updated_at DESC)`, `lead_lawyer_id`, GIN on `tags`.
- Documents: `matter_id`, `(org_id, processing_status)`, versions by `(document_id, version DESC)`.
- Events/tasks/notes/parties: `matter_id`, tasks also `(matter_id, status)` and `assignee_id`.
- Memberships: `user_id`, `org_id`.
- Audit: `(org_id, created_at DESC)`, `(actor_id, created_at DESC)`.
- Processing queue: `(status, scheduled_at)`.
- Intelligence: `(matter_id, created_at DESC)`, partial index for pending/running.
- Legal FTS: GIN `to_tsvector('spanish', title || body)`.

Targets: thousands of orgs, millions of documents, long-running intelligence
jobs consumed off the `document_processing_jobs` queue.

## 11. Security Summary

- RLS enabled on **every** public table.
- Cross-tenant isolation enforced by `is_org_member` / `can_manage_org` / `can_contribute_org`.
- Storage bucket private, path-scoped to `org_id`.
- Service role usage confined to `client.server.ts`, imported only inside handler bodies of `*.functions.ts` / route files, never at module scope.
- `has_role` and `has_permission` are `SECURITY DEFINER` but internally scoped to `auth.uid()`; execute revoked from `PUBLIC`/`anon`, granted to `authenticated` and `service_role`. Linter warning on this class of function is accepted as intentional.
- Google OAuth via the Lovable broker; email/password enabled; anonymous sign-ups off.

## 12. Extension Points

| Extension              | Where                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| New matter type        | Add value to `matter_type` enum via migration                    |
| New role               | Add value to `org_role` + rows in `role_permissions`             |
| New permission         | Insert into `permissions` + assign in `role_permissions`         |
| New intelligence engine| Add value to `intelligence_engine` enum + implement engine module |
| New legal source       | Insert into `legal_source_connectors` + connector server route   |
| New billing plan       | Insert into `billing_plans` + `plan_entitlements` rows           |

## 13. Phase 3 Kickoff Checklist

1. Document ingestion pipeline (upload → storage → `document_processing_jobs`).
2. Text extraction worker (PDF/DOCX/OCR) as a server function invoked by pg_cron on the queue.
3. Legal Intelligence Engine (baseline: summarization, citation extraction against `legal_authorities`).
4. Case Intelligence Engine (facts, parties, timeline synthesis into `matter_knowledge`).
5. Evidence Intelligence Engine (document classification + evidence weighting).
6. Wire `has_permission` gates into UI actions (upload, download, delete, run engine).
