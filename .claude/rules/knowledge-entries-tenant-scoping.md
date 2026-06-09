# knowledge_entries Tenant Scoping (the law)

`knowledge_entries` is a **HYBRID corpus**. It holds two kinds of rows, and any
code that reads or writes it MUST respect the distinction. Getting this wrong
causes one of two failures: a **cross-tenant leak** (one customer sees another's
uploaded manual — #1833) or a **disappeared corpus** (the shared OEM library
returns ~0 rows for real tenants — #1761).

This rule is the canonical decision. It supersedes the older, contradictory
framings ("`knowledge_entries` is universal, just don't filter it" and
"`knowledge_entries` is tenant-scoped, filter by `tenant_id`"). Both are half
right; the law is the hybrid below.

## The two kinds of rows

| Class | `is_private` | `tenant_id` | Who may see it | Written by |
|---|---|---|---|---|
| **Shared OEM corpus** | `false` | legacy non-UUID slug (`'mike'`, `MIRA_TENANT_ID`) | **everyone** | bulk OEM ingest, seeds, public crawls (`mira-crawler` OEM tasks, `tools/seeds/*`, `mira-core/scripts/ingest_manuals.py`) |
| **Per-tenant upload** | `true` | the owning tenant's **UUID** | **only that tenant** | customer uploads (`mira-hub /api/documents/upload`, folder=brain `/api/uploads/*` → ingest, MiraDrop) |

Background: the OEM corpus (~83.5k chunks) was tagged with whatever
`MIRA_TENANT_ID` was set to at ingest — typically the literal `'mike'`, a
non-UUID. Per-user signup (migration 008) mints **UUID** tenant ids that never
match `'mike'`, so filtering the corpus by `tenant_id = $caller` returns ~0 rows
(#1761). Then #1592 (folder=brain) wired **per-tenant uploads INTO the same
table** under real UUID tenant ids — so the table stopped being purely shared.

## Read law

**Per-tenant read surfaces** (a tenant browsing "their documents") MUST filter:

```sql
WHERE (is_private = false OR tenant_id = $caller)
```

- This returns the shared OEM corpus **and** the caller's own uploads, and
  **never** another tenant's uploads.
- Run it on the **raw owner pool** (BYPASSRLS), NOT `withTenantContext`. The RLS
  policy on `knowledge_entries` (migration 003 / 011) is pure
  `tenant_id = app.tenant_id` — under it the `is_private = false` OEM rows are
  invisible, so RLS **cannot express the hybrid**. Raw pool + the explicit
  predicate above is the only correct shape.
- `$caller` is `ctx.tenantId` from `sessionOr401` / `sessionOrDemo` — always a
  UUID (the session layer rejects non-UUID tenants).

**Aggregate OEM-corpus surfaces** (manufacturer rollups, KB counts — the
"library browser", not "my documents") stay **universal** — no tenant predicate
at all. These are `/api/knowledge`, `/api/knowledge/*`, `/api/usage` KB count,
`/api/library/*` manufacturer rollups. They show the shared corpus only; they
must NOT surface per-tenant upload **content** keyed to a specific tenant. (If a
future aggregate needs per-tenant counts, add `is_private = false` to keep it to
the shared corpus — do not add `tenant_id = $caller`, which reintroduces #1761.)

**Pure-tenant surfaces** that join `knowledge_entries` only through an asset the
caller already owns may use `withTenantContext` + `tenant_id = $caller`, but know
that this **hides the shared OEM corpus** by design (it shows only the tenant's
own rows). If the surface should also show OEM manuals, it is a *hybrid* surface
and takes the read law above instead.

## Write law

- **Per-tenant uploads set `is_private = true`.** Every write path that ingests a
  *customer's own* document into `knowledge_entries` MUST set `is_private = true`
  and tag it with the owning tenant's UUID. The column default is `false`; an
  upload path that relies on the default is a bug (it leaks — #1833).
- **Shared OEM ingest sets `is_private = false`** (the default is fine). Bulk OEM
  manuals, seeds, and public crawls are shared by definition.
- Never make a row MORE visible than its source. When in doubt for a *customer*
  document, `is_private = true`.

## What the audit / reviewer must catch

- ❌ A per-tenant document read surface that queries `knowledge_entries` with **no
  tenant predicate** (universal read) — leaks uploads (#1833).
- ❌ A per-tenant document read surface that filters **`tenant_id = $caller`
  alone** — hides the OEM corpus (#1761). Use the `(is_private = false OR …)`
  hybrid.
- ❌ A hybrid read run through `withTenantContext` — RLS silently drops the OEM
  corpus. Hybrid reads use the raw pool.
- ❌ An upload write path that inserts into `knowledge_entries` **without
  `is_private = true`** — a future leak.
- ❌ Resolving `cmms_equipment` (or any pure-tenant table) **by id without
  `tenant_id = $caller`** — IDOR (#1833).

## Rollout status (this is a program, not one route)

- ✅ `/api/documents` — hybrid read filter + `cmms_equipment` tenant scope (#1833).
- ✅ `/api/documents/upload` — writes `is_private = true`.
- ✅ Migration 045 — backfills existing UUID-tenant rows to `is_private = true`.
- ⏳ **Follow-up (tracked):** apply the hybrid read filter to the remaining
  per-tenant document/RAG surfaces (`/api/assets/[id]/documents`,
  `mira-hub/src/lib/manual-rag.ts`, `mira-hub/src/lib/agents/asset-intelligence.ts`)
  and set `is_private = true` in the production upload write path
  (`mira-crawler/ingest/store.py` + the folder=brain ingest task, which must
  distinguish customer-upload ingest from OEM/public crawl). Until that ships,
  NEW production (folder=brain) uploads land `is_private = false`; migration 045
  protects all rows existing at apply time, and `/api/documents/upload` is
  already correct.

## When this applies

- Any code under `mira-hub/`, `mira-core/`, `mira-crawler/`, `mira-bots/` that
  reads or writes `knowledge_entries`.
- Any new "documents", "library", "KB", or RAG-retrieval surface.

## When this does NOT apply

- `kg_entities` / `kg_relationships` / `cmms_*` — those are pure-tenant tables
  (use `withTenantContext` + `tenant_id = $caller`, or RLS). The hybrid rule is
  specific to `knowledge_entries` because it mixes shared + private rows.

## Cross-references

- `mira-hub/src/app/api/documents/route.ts` — reference implementation.
- `mira-hub/db/migrations/045_knowledge_entries_private_uploads.sql` — backfill.
- `mira-hub/db/migrations/011_grant_app_kb_access.sql` — the RLS policy that makes
  `withTenantContext` pure-tenant-scope (why hybrid reads use the raw pool).
- `docs/migrations/001_knowledge_entries.sql` — the `is_private` column.
- Issues: #1833 (this leak), #1761 (universal OEM corpus), #1592 (folder=brain
  uploads into `knowledge_entries`).
